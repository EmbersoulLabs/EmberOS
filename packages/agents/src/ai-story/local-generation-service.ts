import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  AiStoryCharacterAuthorityVersionSchema,
  AiStoryLocationAuthorityVersionSchema,
  AiStoryEpisodeIntentAuthoritySchema,
  AiStoryPreGenerationQcEvaluationSchema,
  resolveExplicitAiStorySceneGenerationAuthority,
  type AiStoryCanonicalScene,
  type AiStoryEffectiveSceneGenerationAuthority,
  type ProductVisualMaterialSelectionAuthority,
} from "@ceo-agent/shared";
import {
  AiStoryLocalGenerationRepository,
  requireWorkspaceRole,
  AiStorySequentialLocalReleaseRepository,
  AiStorySceneExecutionPersistenceRepository,
  getDb,
  resolveCurrentFrozenCanonicalSceneSet,
  schema,
} from "@ceo-agent/db";
import { AiStoryLocalGenerationError } from "./local-generation-package";
import {
  materializeProviderNeutralLocalGenerationPackage,
  type BoundVisualReference,
  type ProviderNeutralLocalSceneFacts,
} from "./local-generation-source-authority";
import {
  materializeReleasedPackageIntegrityRetry,
  materializeSequentialLocalPackageV3,
  type SequentialContinuityEvidence,
} from "./sequential-local-generation";

export interface AiStoryLocalGenerationPreparationPort {
  prepare(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly executionPlanId: string;
    readonly runtimeAuthorizationId: string;
    readonly orderedSceneExecutionIds: readonly string[];
    readonly actorUserId: string;
    readonly createdAt: string;
  }): Promise<{
    readonly packageIds: readonly string[];
    readonly unitIds: readonly string[];
    readonly replayed: boolean;
  }>;
}

export type AiStoryLocalProductMaterialResolver = (input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  storyVersionId: string;
  sceneId: string;
  sceneVersionId: string;
  actorUserId: string;
  generationAuthority: AiStoryEffectiveSceneGenerationAuthority;
}) => Promise<ProductVisualMaterialSelectionAuthority>;

export class AiStoryLocalGenerationService implements AiStoryLocalGenerationPreparationPort {
  constructor(private readonly options: {
    readonly packages?: AiStoryLocalGenerationRepository;
    readonly loadFacts?: (input: Parameters<AiStoryLocalGenerationPreparationPort["prepare"]>[0]) => Promise<readonly ProviderNeutralLocalSceneFacts[]>;
    readonly productMaterial?: AiStoryLocalProductMaterialResolver;
    readonly persistence?: AiStorySceneExecutionPersistenceRepository;
    readonly releases?: AiStorySequentialLocalReleaseRepository;
  } = {}) {}

  async prepare(input: Parameters<AiStoryLocalGenerationPreparationPort["prepare"]>[0]) {
    const facts = this.options.loadFacts
      ? await this.options.loadFacts(input)
      : await this.loadFrozenFacts(input);
    if (facts.length === 0 || facts.length !== input.orderedSceneExecutionIds.length ||
        facts.some((fact, index) => fact.sceneExecutionId !== input.orderedSceneExecutionIds[index])) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Local Generation units do not match the approved Assembly order",
      );
    }
    const initial = materializeSequentialLocalPackageV3({
      basePackage: materializeProviderNeutralLocalGenerationPackage(facts[0]!) as Extract<
        import("@ceo-agent/shared").AiStoryLocalGenerationPackage,
        { version: "local-generation-package.v2" }
      >,
      release: {
        releaseRevision: 0,
        releasedBy: input.actorUserId,
        releasedAt: input.createdAt,
      },
      predecessor: null,
    });
    const repository = this.options.packages
      ?? new AiStoryLocalGenerationRepository();
    const accepted = await repository.initializeSequential({
      package: initial,
      orderedSceneExecutionIds: input.orderedSceneExecutionIds,
      createdBy: input.actorUserId,
    });
    return {
      packageIds: accepted.packages.map((item) => item.packageId),
      unitIds: accepted.packages.map((item) => item.unitId),
      replayed: accepted.replayed,
    };
  }

  async releaseImmediateSuccessor(input: Parameters<
    AiStoryLocalGenerationPreparationPort["prepare"]
  >[0] & {
    predecessor: SequentialContinuityEvidence;
  }) {
    const releases = this.options.releases
      ?? new AiStorySequentialLocalReleaseRepository();
    const context = await releases.nextReleaseContext({
      workspaceId: input.workspaceId,
      executionPlanId: input.executionPlanId,
      predecessorSceneExecutionId:
        input.predecessor.predecessorPackage.sceneExecutionId,
    });
    if (!context.candidate) {
      return { packageId: null, unitId: null, replayed: true, complete: true };
    }
    if (
      !(
        context.candidate.releaseState === "WAITING_FOR_PREDECESSOR"
        || (
          context.candidate.releaseState === "RELEASED"
          && context.candidate.currentLocalGenerationPackageId
        )
      )
      || context.candidate.sceneOrder
        !== input.predecessor.predecessorPackage.order + 1
    ) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "The immediate successor is not waiting on this predecessor",
      );
    }
    const facts = this.options.loadFacts
      ? await this.options.loadFacts(input)
      : await this.loadFrozenFacts(
          input,
          context.candidate.sceneExecutionId,
        );
    const fact = facts.find(
      (candidate) =>
        candidate.sceneExecutionId === context.candidate!.sceneExecutionId
        && candidate.order === context.candidate!.sceneOrder,
    );
    if (!fact) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "The immediate successor frozen Unit is missing",
      );
    }
    const base = materializeProviderNeutralLocalGenerationPackage(fact);
    if (base.version !== "local-generation-package.v2") {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Sequential successor requires the provider-neutral V2 base snapshot",
      );
    }
    const pkg = materializeSequentialLocalPackageV3({
      basePackage: base,
      release: {
        releaseRevision: context.candidate.releaseRevision,
        releasedBy: input.actorUserId,
        releasedAt: input.createdAt,
      },
      predecessor: input.predecessor,
    });
    const accepted = await releases.releaseSuccessor({
      package: pkg,
      actorUserId: input.actorUserId,
    });
    return {
      packageId: accepted.package.packageId,
      unitId: accepted.package.unitId,
      replayed: accepted.replayed,
      complete: false,
    };
  }

  async recoverReleasedPackageIntegrity(input: Parameters<
    AiStoryLocalGenerationPreparationPort["prepare"]
  >[0] & {
    readonly sceneExecutionId: string;
    readonly dryRun?: boolean;
  }) {
    await requireWorkspaceRole(input.workspaceId, input.actorUserId, "editor");
    const repository = this.options.packages ?? new AiStoryLocalGenerationRepository();
    const db = getDb();
    const [release] = await db.select({
      packageId: schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
      state: schema.aiStorySceneReleaseStates.releaseState,
    }).from(schema.aiStorySceneReleaseStates).where(and(
      eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
      eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
    )).limit(1);
    if (release?.state !== "RELEASED" || !release.packageId) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Integrity recovery requires the current released package",
      );
    }
    const current = await repository.getExecutablePackage({
      workspaceId: input.workspaceId,
      executionPlanId: input.executionPlanId,
      packageId: release.packageId,
    });
    if (!current || current.version !== "local-generation-package.v3") {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Integrity recovery requires the current released V3 package",
      );
    }
    if (current.predecessorAuthority) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Integrity recovery of a successor unit requires the existing predecessor continuity evidence",
      );
    }
    const facts = this.options.loadFacts
      ? await this.options.loadFacts(input)
      : await this.loadFrozenFacts(input, input.sceneExecutionId);
    const fact = facts.find((candidate) =>
      candidate.sceneExecutionId === input.sceneExecutionId
      && candidate.order === current.order
    );
    if (!fact) {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "The released Unit frozen authority is missing",
      );
    }
    const base = materializeProviderNeutralLocalGenerationPackage(fact);
    if (base.version !== "local-generation-package.v2") {
      throw new AiStoryLocalGenerationError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Integrity recovery requires the provider-neutral V2 base snapshot",
      );
    }
    const rebuilt = materializeSequentialLocalPackageV3({
      basePackage: base,
      release: {
        releaseRevision: current.releaseAuthority.semantic.releaseRevision,
        releasedBy: current.releaseAuthority.audit.releasedBy,
        releasedAt: current.releaseAuthority.audit.releasedAt,
      },
      predecessor: null,
    });
    const retry = materializeReleasedPackageIntegrityRetry({
      current,
      rebuilt,
      createdAt: input.createdAt,
    });
    if (!retry.changed || input.dryRun) {
      return {
        packageId: retry.changed ? retry.package.packageId : current.packageId,
        retryOfPackageId: retry.changed ? retry.package.retryOfPackageId : current.retryOfPackageId,
        referenceCount: retry.changed ? retry.package.references.length : current.references.length,
        durationSec: retry.changed ? retry.package.durationSec : current.durationSec,
        recommendedWorkflow: retry.changed ? retry.package.recommendedWorkflow : current.recommendedWorkflow,
        replayed: !retry.changed,
        dryRun: input.dryRun === true,
      };
    }
    const accepted = await repository.insertOrActivateSequentialRetry({
      package: retry.package,
      createdBy: input.actorUserId,
    });
    const stored = accepted.packages[0]!;
    return {
      packageId: stored.packageId,
      retryOfPackageId: stored.retryOfPackageId,
      referenceCount: stored.references.length,
      durationSec: stored.durationSec,
      recommendedWorkflow: stored.recommendedWorkflow,
      replayed: accepted.replayed,
      dryRun: false,
    };
  }

  private async loadFrozenFacts(
    input: Parameters<AiStoryLocalGenerationPreparationPort["prepare"]>[0],
    onlySceneExecutionId?: string,
  ) {
    const db = getDb();
    const persistence = this.options.persistence ?? new AiStorySceneExecutionPersistenceRepository();
    const compilation = await persistence.getByExecutionPlanId(input.executionPlanId);
    if (!compilation) {
      throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Approved execution compilation is missing");
    }
    const [story] = await db.select({ episodeIntent: schema.aiStories.episodeIntent }).from(schema.aiStories).where(and(
      eq(schema.aiStories.id, input.storyId),
      eq(schema.aiStories.workspaceId, input.workspaceId),
    )).limit(1);
    const episode = AiStoryEpisodeIntentAuthoritySchema.safeParse(story?.episodeIntent);
    if (!episode.success) {
      throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Frozen Episode aspect-ratio authority is missing");
    }
    const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, input);
    const facts: ProviderNeutralLocalSceneFacts[] = [];
    for (const [index, sceneExecutionId] of input.orderedSceneExecutionIds.entries()) {
      if (onlySceneExecutionId && sceneExecutionId !== onlySceneExecutionId) {
        continue;
      }
      const intent = compilation.intents.find((candidate) => candidate.identity.sceneExecutionId === sceneExecutionId);
      const instructions = compilation.instructionsBySceneExecutionId[sceneExecutionId];
      const [sceneExecution] = await db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id, sceneExecutionId)).limit(1);
      if (!intent || !instructions || !sceneExecution || sceneExecution.executionPlanId !== input.executionPlanId ||
          sceneExecution.storyVersionId !== input.storyVersionId) {
        throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Persisted Scene execution authority is incomplete");
      }
      const scene = scenes?.find((candidate) => candidate.sceneId === sceneExecution.sceneId);
      if (!scene) {
        throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Current frozen Canonical Scene is missing");
      }
      const [qcRow] = await db.select().from(schema.aiStoryPreGenerationQcEvaluations).where(eq(
        schema.aiStoryPreGenerationQcEvaluations.sceneExecutionId, sceneExecutionId,
      )).orderBy(desc(schema.aiStoryPreGenerationQcEvaluations.evaluationVersion)).limit(1);
      if (!qcRow) {
        throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Current Canonical Scene is missing frozen Pre-QC lineage");
      }
      const qc = AiStoryPreGenerationQcEvaluationSchema.parse(qcRow.evaluation);
      if (qc.qcEvaluationId !== qcRow.qcEvaluationId || qc.qcFingerprint !== qcRow.qcFingerprint ||
          qc.sceneExecutionId !== sceneExecutionId || qc.storyVersionId !== input.storyVersionId) {
        throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Pre-Generation QC does not match this Scene execution");
      }
      const [director] = await db.select({ fingerprint: schema.aiStoryDirectorPlanVersions.directorFingerprint }).from(schema.aiStoryDirectorPlanVersions).where(eq(
        schema.aiStoryDirectorPlanVersions.directorPlanId, qc.directorPlanId,
      )).limit(1);
      const [motion] = await db.select({ fingerprint: schema.aiStoryMotionPlanVersions.motionFingerprint }).from(schema.aiStoryMotionPlanVersions).where(eq(
        schema.aiStoryMotionPlanVersions.motionPlanId, qc.motionPlanId,
      )).limit(1);
      const [handoff] = await db.select({ fingerprint: schema.aiStoryScriptDirectorHandoffs.handoffFingerprint }).from(schema.aiStoryScriptDirectorHandoffs).where(eq(
        schema.aiStoryScriptDirectorHandoffs.handoffId, qc.handoffId,
      )).limit(1);
      if (!director?.fingerprint || !motion?.fingerprint || !handoff?.fingerprint) {
        throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Director, Motion, or Handoff fingerprint is missing");
      }
      const imageConditioned = scene.generationAuthority?.strategy !== "TEXT_TO_VIDEO";
      let productMaterial: ProductVisualMaterialSelectionAuthority | null = null;
      let selectedMaterialAsset: ProviderNeutralLocalSceneFacts["selectedMaterialAsset"] = null;
      if (imageConditioned) {
        if (!this.options.productMaterial) {
          throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Image-conditioned execution requires certified Product material selection");
        }
        try {
          productMaterial = await this.options.productMaterial({
            ...input,
            sceneId: scene.sceneId,
            sceneVersionId: scene.sceneVersionId,
            generationAuthority: resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority),
          });
        } catch (error) {
          throw new AiStoryLocalGenerationError(
            "LOCAL_GENERATION_AUTHORITY_INVALID",
            error instanceof Error ? error.message : "Product material selection failed",
          );
        }
        const material = productMaterial.selectedMaterial;
        if (!material) {
          throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Selected Product material is missing");
        }
        const [asset] = await db.select().from(schema.assets).where(and(
          eq(schema.assets.id, material.assetId),
          eq(schema.assets.workspaceId, input.workspaceId),
          eq(schema.assets.orgId, input.orgId),
          eq(schema.assets.status, "ready"),
          isNull(schema.assets.deletedAt),
        )).limit(1);
        if (!asset?.contentHash || asset.contentHash !== material.contentHash || !asset.storagePath || !asset.mimeType) {
          throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Selected Product material content hash does not match the frozen Asset");
        }
        selectedMaterialAsset = {
          assetId: asset.id,
          contentHash: asset.contentHash,
          mediaType: asset.mimeType,
          storagePath: asset.storagePath,
        };
      }
      const generationAuthority = resolveExplicitAiStorySceneGenerationAuthority(scene.generationAuthority);
      const boundVisualReferences = await this.bindVisualReferences(db, {
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        scene,
        generationAuthority,
        productMaterial,
        selectedMaterialAsset,
      });
      facts.push({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        campaignId: input.campaignId,
        storyId: input.storyId,
        storyVersionId: input.storyVersionId,
        executionPlanId: input.executionPlanId,
        runtimeAuthorizationId: input.runtimeAuthorizationId,
        sceneExecutionId,
        sceneExecutionFingerprint: sceneExecution.deterministicFingerprint.startsWith("sha256:")
          ? sceneExecution.deterministicFingerprint
          : sceneExecution.instructionHash.startsWith("sha256:")
            ? sceneExecution.instructionHash
            : (() => { throw new AiStoryLocalGenerationError("LOCAL_GENERATION_AUTHORITY_INVALID", "Scene execution fingerprint is not a canonical hash"); })(),
        instructionContentHash: sceneExecution.instructionHash,
        intent,
        instructions,
        scene,
        preGenerationQcEvaluationId: qc.qcEvaluationId,
        preGenerationQcFingerprint: qc.qcFingerprint,
        preGenerationSceneVersionIds: qc.sceneVersionIds ?? [],
        directorFingerprint: director.fingerprint,
        motionFingerprint: motion.fingerprint,
        handoffId: qc.handoffId,
        handoffFingerprint: handoff.fingerprint,
        aspectRatio: episode.data.aspectRatio,
        productMaterial,
        selectedMaterialAsset,
        boundVisualReferences,
        order: index + 1,
        createdAt: input.createdAt,
      });
    }
    return facts;
  }

  private async bindVisualReferences(
    db: ReturnType<typeof getDb>,
    input: {
      orgId: string;
      workspaceId: string;
      scene: AiStoryCanonicalScene;
      generationAuthority: AiStoryEffectiveSceneGenerationAuthority;
      productMaterial: ProductVisualMaterialSelectionAuthority | null;
      selectedMaterialAsset: ProviderNeutralLocalSceneFacts["selectedMaterialAsset"];
    },
  ): Promise<BoundVisualReference[]> {
    const authority = input.generationAuthority;
    if (authority.referenceSource === "REFERENCE_FREE_T2V") {
      if (authority.effectiveReferenceIds.length > 0) {
        throw new AiStoryLocalGenerationError(
          "LOCAL_GENERATION_REFERENCE_INTEGRITY",
          "Reference-free execution cannot carry visual references",
        );
      }
      return [];
    }
    const persistentCast = input.scene.castBindings.filter((cast) => cast.scope !== "EPHEMERAL_ACTOR");
    const versionIds = persistentCast.map((cast) => cast.authorityVersionId);
    const versionRows = versionIds.length === 0 ? [] : await db.select().from(schema.aiStoryCharacterVersions).where(and(
      eq(schema.aiStoryCharacterVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCharacterVersions.orgId, input.orgId),
      inArray(schema.aiStoryCharacterVersions.characterVersionId, versionIds),
    ));
    const locationBinding = input.scene.locationBinding;
    const locationRows = locationBinding.scope === "EPHEMERAL_ENVIRONMENT" ? [] : await db.select().from(schema.aiStoryLocationVersions).where(and(
      eq(schema.aiStoryLocationVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocationVersions.orgId, input.orgId),
      eq(schema.aiStoryLocationVersions.locationVersionId, locationBinding.authorityVersionId),
    )).limit(1);
    const locations = new Map<string, { locationId: string; displayName: string }>();
    const locationRow = locationRows[0];
    if (locationRow && locationBinding.scope !== "EPHEMERAL_ENVIRONMENT") {
      const version = AiStoryLocationAuthorityVersionSchema.parse(locationRow.snapshot);
      if (version.locationId === locationBinding.id && version.fingerprint === locationBinding.authorityFingerprint) {
        for (const assetId of version.facts.visualAssetIds) {
          locations.set(assetId, { locationId: version.locationId, displayName: version.facts.displayName });
        }
      }
    }
    const characters = new Map<string, { characterId: string; name: string; contentHash: string }>();
    for (const cast of persistentCast) {
      const row = versionRows.find((candidate) => candidate.characterVersionId === cast.authorityVersionId);
      if (!row) continue;
      const version = AiStoryCharacterAuthorityVersionSchema.parse(row.snapshot);
      if (version.characterId !== cast.id || version.fingerprint !== cast.authorityFingerprint) continue;
      for (const visual of version.visualAssetReferences) {
        characters.set(visual.assetId, {
          characterId: version.characterId,
          name: version.name,
          contentHash: visual.contentHash,
        });
      }
    }
    const productSourceId = input.productMaterial?.productAuthority.sourceAssetId ?? null;
    const lookupIds = authority.effectiveReferenceIds.filter((assetId) => assetId !== productSourceId);
    const assetRows = lookupIds.length === 0 ? [] : await db.select().from(schema.assets).where(and(
      eq(schema.assets.workspaceId, input.workspaceId),
      eq(schema.assets.orgId, input.orgId),
      eq(schema.assets.status, "ready"),
      inArray(schema.assets.id, lookupIds),
      isNull(schema.assets.deletedAt),
    ));
    const bound: BoundVisualReference[] = [];
    for (const assetId of authority.effectiveReferenceIds) {
      if (productSourceId === assetId && input.selectedMaterialAsset && input.productMaterial) {
        bound.push({
          assetId: input.selectedMaterialAsset.assetId,
          contentHash: input.selectedMaterialAsset.contentHash,
          mediaType: input.selectedMaterialAsset.mediaType,
          storagePath: input.selectedMaterialAsset.storagePath,
          authorityType: "FIRST_FRAME",
          authorityId: input.productMaterial.productAuthority.productAuthorityId,
          displayName: "selected product first frame",
        });
        continue;
      }
      const character = characters.get(assetId);
      const location = locations.get(assetId);
      const asset = assetRows.find((row) => row.id === assetId);
      if (location && asset?.contentHash && asset.storagePath && asset.mimeType && !character) {
        bound.push({
          assetId: asset.id,
          contentHash: asset.contentHash,
          mediaType: asset.mimeType,
          storagePath: asset.storagePath,
          authorityType: "LOCATION",
          authorityId: location.locationId,
          displayName: location.displayName,
        });
        continue;
      }
      if (!character || !asset?.contentHash || asset.contentHash !== character.contentHash || !asset.storagePath || !asset.mimeType) {
        throw new AiStoryLocalGenerationError(
          "LOCAL_GENERATION_REFERENCE_INTEGRITY",
          `Frozen visual reference ${assetId} is not bound to an approved Character or Product asset`,
        );
      }
      bound.push({
        assetId: asset.id,
        contentHash: asset.contentHash,
        mediaType: asset.mimeType,
        storagePath: asset.storagePath,
        authorityType: "CHARACTER",
        authorityId: character.characterId,
        displayName: character.name,
      });
    }
    return bound;
  }
}
