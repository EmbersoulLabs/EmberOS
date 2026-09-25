import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryProviderAttemptBindingSchema,
  AiStoryReusableCharacterCampaignProjectionSchema,
  AiStoryReusableCharacterVersionSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryProviderAttemptBinding,
  SceneSchedulingBundleSchema,
  type SceneSchedulingBundle,
  isAiStoryProviderAttemptTransitionAllowed,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { isApprovedPrivateSyntheticIdentityAnchorAsset } from "./ai-story-reusable-character";

type Db = ReturnType<typeof getDb>;
type QueryDb = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export class AiStoryProviderRuntimePersistenceError extends Error {
  constructor(readonly code: "IMMUTABLE_CONFLICT" | "ATTEMPT_CONFLICT", message: string) {
    super(message);
    this.name = "AiStoryProviderRuntimePersistenceError";
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function acceptAiStoryCompiledRequest(
  db: QueryDb,
  input: AiStoryCompiledProviderRequest
): Promise<AiStoryCompiledProviderRequest> {
  const request = AiStoryCompiledProviderRequestSchema.parse(input);
  const inserted = await db.insert(schema.aiStoryCompiledProviderRequests).values({
    compiledRequestId: request.compiledRequestId,
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    sceneExecutionId: request.sceneExecutionId,
    requestFingerprint: request.requestFingerprint,
    generationMode: request.generationMode,
    providerId: request.providerId,
    modelId: request.modelId,
    adapterVersion: request.adapterVersion,
    mappingVersion: request.mappingVersion,
    capabilityVersion: request.capabilityVersion,
    qcEvaluationId: request.qcEvaluationId,
    qcFingerprint: request.qcFingerprint,
    compiledRequest: request,
    compiledAt: new Date(request.compiledAt),
  }).onConflictDoNothing().returning({
    compiledRequest: schema.aiStoryCompiledProviderRequests.compiledRequest,
  });
  if (inserted[0]) {
    return AiStoryCompiledProviderRequestSchema.parse(inserted[0].compiledRequest);
  }
  const [row] = await db.select({
    request: schema.aiStoryCompiledProviderRequests.compiledRequest,
  })
    .from(schema.aiStoryCompiledProviderRequests)
    .where(eq(
      schema.aiStoryCompiledProviderRequests.compiledRequestId,
      request.compiledRequestId
    ))
    .limit(1);
  const existing = row
    ? AiStoryCompiledProviderRequestSchema.parse(row.request)
    : null;
  if (!existing || !same(existing, request)) {
    throw new AiStoryProviderRuntimePersistenceError(
      "IMMUTABLE_CONFLICT",
      "Compiled Provider request identity conflicts"
    );
  }
  return existing;
}

export class AiStoryProviderRuntimeRepository {
  constructor(private readonly db: Db = getDb()) {}

  /**
   * Phase 6 durable bridge. The authority is stored beside its immutable
   * Provider Attempt anchor so the existing outbox/Worker lineage can carry
   * references instead of copying mutable planning state into the queue.
   */
  async acceptExecutionAuthorityRecord(input: {
    readonly providerAttemptId: string;
    readonly executionAuthorityId: string;
    readonly authorityFingerprint: string;
    readonly authority: unknown;
    readonly job: unknown;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ providerMetadata: schema.providerAttempts.providerMetadata })
        .from(schema.providerAttempts)
        .where(eq(schema.providerAttempts.attemptId, input.providerAttemptId))
        .limit(1)
        .for("update");
      if (!row) {
        throw new AiStoryProviderRuntimePersistenceError(
          "ATTEMPT_CONFLICT",
          "Execution authority requires its exact Provider Attempt anchor"
        );
      }
      const existing = row.providerMetadata?.assetAwareExecutionAuthority as
        | {
            executionAuthorityId?: string;
            authorityFingerprint?: string;
            authority?: unknown;
            job?: unknown;
          }
        | undefined;
      if (existing) {
        if (
          existing.executionAuthorityId !== input.executionAuthorityId ||
          existing.authorityFingerprint !== input.authorityFingerprint ||
          !same(existing.authority, input.authority) ||
          !same(existing.job, input.job)
        ) {
          throw new AiStoryProviderRuntimePersistenceError(
            "IMMUTABLE_CONFLICT",
            "Provider Attempt execution authority conflicts with persisted authority"
          );
        }
        return;
      }
      await tx
        .update(schema.providerAttempts)
        .set({
          providerMetadata: {
            ...row.providerMetadata,
            assetAwareExecutionAuthority: {
              executionAuthorityId: input.executionAuthorityId,
              authorityFingerprint: input.authorityFingerprint,
              authority: input.authority,
              job: input.job,
            },
          },
        })
        .where(eq(schema.providerAttempts.attemptId, input.providerAttemptId));
    });
  }

  async getExecutionAuthorityRecord(input: {
    readonly providerAttemptId: string;
    readonly executionAuthorityId: string;
  }): Promise<{ readonly authority: unknown; readonly job: unknown } | null> {
    const [row] = await this.db
      .select({ providerMetadata: schema.providerAttempts.providerMetadata })
      .from(schema.providerAttempts)
      .where(eq(schema.providerAttempts.attemptId, input.providerAttemptId))
      .limit(1);
    const record = row?.providerMetadata?.assetAwareExecutionAuthority as
      | {
          executionAuthorityId?: string;
          authority?: unknown;
          job?: unknown;
        }
      | undefined;
    return record?.executionAuthorityId === input.executionAuthorityId &&
      record.authority &&
      record.job
      ? { authority: record.authority, job: record.job }
      : null;
  }

  async acceptCompiledRequest(input: AiStoryCompiledProviderRequest): Promise<AiStoryCompiledProviderRequest> {
    return acceptAiStoryCompiledRequest(this.db, input);
  }

  async getCompiledRequest(compiledRequestId: string): Promise<AiStoryCompiledProviderRequest | null> {
    const [row] = await this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
      .from(schema.aiStoryCompiledProviderRequests)
      .where(eq(schema.aiStoryCompiledProviderRequests.compiledRequestId, compiledRequestId)).limit(1);
    return row ? AiStoryCompiledProviderRequestSchema.parse(row.request) : null;
  }

  async getCompiledRequestBySceneExecutionId(sceneExecutionId: string): Promise<AiStoryCompiledProviderRequest | null> {
    const [row] = await this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
      .from(schema.aiStoryCompiledProviderRequests)
      .where(and(
        eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, sceneExecutionId),
        sql`not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
          where supersession.source_compiled_request_id = ${schema.aiStoryCompiledProviderRequests.compiledRequestId}
        )`
      ))
      .orderBy(sql`${schema.aiStoryCompiledProviderRequests.compiledAt} desc`).limit(1);
    return row ? AiStoryCompiledProviderRequestSchema.parse(row.request) : null;
  }

  /** Canonical campaign_asset_refs-backed MIME/storage authority for compilation. */
  async getReferenceAssetAuthorities(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly assetIds: readonly string[];
    readonly workspaceAssetLibraryIds?: readonly string[];
  }): Promise<readonly { assetId: string; mediaType: string; storagePath?: string; contentHash: string | null }[]> {
    if (input.assetIds.length === 0) return [];
    const workspaceAssetLibraryIds = new Set(
      input.workspaceAssetLibraryIds ?? []
    );
    if (
      [...workspaceAssetLibraryIds].some(
        (assetId) => !input.assetIds.includes(assetId)
      )
    ) {
      throw new AiStoryProviderRuntimePersistenceError(
        "IMMUTABLE_CONFLICT",
        "Workspace Asset Library authority exceeds the effective reference set"
      );
    }
    const campaignAssetIds = input.assetIds.filter(
      (assetId) => !workspaceAssetLibraryIds.has(assetId)
    );
    const rows = campaignAssetIds.length > 0 ? await this.db.select({
      assetId: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      mediaType: schema.assets.mimeType,
      storagePath: schema.assets.storagePath,
      contentHash: schema.assets.contentHash,
      campaignOrgId: schema.campaigns.orgId,
      campaignWorkspaceId: schema.campaigns.workspaceId,
    }).from(schema.campaignAssetRefs)
      .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignAssetRefs.campaignId))
      .innerJoin(schema.assets, eq(schema.assets.id, schema.campaignAssetRefs.assetId))
      .where(and(
        eq(schema.campaignAssetRefs.campaignId, input.campaignId),
        inArray(schema.campaignAssetRefs.assetId, campaignAssetIds)
      )) : [];
    const libraryRows = workspaceAssetLibraryIds.size > 0
      ? await this.db.select({
          assetId: schema.assets.id,
          orgId: schema.assets.orgId,
          workspaceId: schema.assets.workspaceId,
          campaignId: schema.assets.campaignId,
          type: schema.assets.type,
          mediaType: schema.assets.mimeType,
          storagePath: schema.assets.storagePath,
          contentHash: schema.assets.contentHash,
          status: schema.assets.status,
          metadata: schema.assets.metadata,
          deletedAt: schema.assets.deletedAt,
        }).from(schema.assets).where(and(
          eq(schema.assets.orgId, input.orgId),
          eq(schema.assets.workspaceId, input.workspaceId),
          inArray(schema.assets.id, [...workspaceAssetLibraryIds])
        ))
      : [];
    const byId = new Map(rows.map((row) => [row.assetId, row]));
    const libraryById = new Map(
      libraryRows.map((row) => [row.assetId, row])
    );
    return input.assetIds.map((assetId) => {
      if (workspaceAssetLibraryIds.has(assetId)) {
        const row = libraryById.get(assetId);
        if (
          !row ||
          !isApprovedPrivateSyntheticIdentityAnchorAsset({
            ...row,
            mimeType: row.mediaType,
            expectedOrgId: input.orgId,
            expectedWorkspaceId: input.workspaceId,
          })
        ) {
          throw new AiStoryProviderRuntimePersistenceError(
            "IMMUTABLE_CONFLICT",
            "Approved private synthetic Character anchor authority is missing or out of scope"
          );
        }
        return {
          assetId,
          mediaType: row.mediaType!,
          storagePath: row.storagePath,
          contentHash: row.contentHash,
        };
      }
      const row = byId.get(assetId);
      if (!row || row.orgId !== input.orgId || row.workspaceId !== input.workspaceId || row.campaignOrgId !== input.orgId || row.campaignWorkspaceId !== input.workspaceId || !row.mediaType?.trim() || !row.storagePath?.trim()) {
        throw new AiStoryProviderRuntimePersistenceError(
          "IMMUTABLE_CONFLICT",
          "Canonical Campaign reference MIME/storage authority is missing or out of scope"
        );
      }
      return { assetId, mediaType: row.mediaType, storagePath: row.storagePath, contentHash: row.contentHash };
    });
  }

  async getCharacterDnaCompilationAuthority(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
  }) {
    const [storyVersion] = await this.db
      .select({
        createdAt: schema.aiStoryVersions.createdAt,
        frozenAt: schema.aiStoryVersions.frozenAt,
      })
      .from(schema.aiStoryVersions)
      .innerJoin(
        schema.aiStories,
        eq(schema.aiStories.id, schema.aiStoryVersions.storyId)
      )
      .where(and(
        eq(schema.aiStoryVersions.id, input.storyVersionId),
        eq(schema.aiStoryVersions.storyId, input.storyId),
        eq(schema.aiStories.orgId, input.orgId),
        eq(schema.aiStories.workspaceId, input.workspaceId),
        eq(schema.aiStories.campaignId, input.campaignId)
      ))
      .limit(1);
    if (!storyVersion) {
      throw new AiStoryProviderRuntimePersistenceError(
        "IMMUTABLE_CONFLICT",
        "Executing Story version is missing or outside Character DNA scope"
      );
    }
    const bindingCutoff = storyVersion.frozenAt ?? storyVersion.createdAt;
    const bindingRows = await this.db
      .select({ snapshot: schema.aiStoryEpisodeCharacterBindings.snapshot })
      .from(schema.aiStoryEpisodeCharacterBindings)
      .where(and(
        eq(schema.aiStoryEpisodeCharacterBindings.orgId, input.orgId),
        eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, input.workspaceId),
        eq(schema.aiStoryEpisodeCharacterBindings.storyId, input.storyId),
        lte(schema.aiStoryEpisodeCharacterBindings.createdAt, bindingCutoff),
      ))
      .orderBy(desc(schema.aiStoryEpisodeCharacterBindings.createdAt));
    const dnaBindings = bindingRows
      .map((row) => AiStoryEpisodeCharacterBindingSchema.parse(row.snapshot))
      .filter((binding) => Boolean(binding.characterDnaFingerprint));
    if (dnaBindings.length === 0) return null;
    const binding = dnaBindings[0]!;
    if (
      dnaBindings.some(
        (candidate) =>
          candidate.reusableCharacterId !== binding.reusableCharacterId
      )
    ) {
      throw new AiStoryProviderRuntimePersistenceError(
        "IMMUTABLE_CONFLICT",
        "V1 Character DNA compilation supports exactly one recurring Character authority"
      );
    }
    const [versionRow] = await this.db
      .select({ snapshot: schema.aiStoryReusableCharacterVersions.snapshot })
      .from(schema.aiStoryReusableCharacterVersions)
      .where(and(
        eq(
          schema.aiStoryReusableCharacterVersions.reusableCharacterVersionId,
          binding.reusableCharacterVersionId
        ),
        eq(schema.aiStoryReusableCharacterVersions.orgId, input.orgId),
        eq(schema.aiStoryReusableCharacterVersions.workspaceId, input.workspaceId),
      ))
      .limit(1);
    if (!versionRow) {
      throw new AiStoryProviderRuntimePersistenceError(
        "IMMUTABLE_CONFLICT",
        "Pinned Character DNA version is missing"
      );
    }
    const reusable = AiStoryReusableCharacterVersionSchema.parse(
      versionRow.snapshot
    );
    const [projectionRow] = await this.db
      .select({
        snapshot:
          schema.aiStoryReusableCharacterCampaignProjections.snapshot,
      })
      .from(schema.aiStoryReusableCharacterCampaignProjections)
      .where(and(
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.reusableCharacterVersionId,
          binding.reusableCharacterVersionId
        ),
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.campaignId,
          input.campaignId
        ),
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.campaignCharacterId,
          binding.campaignCharacterId
        ),
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.campaignCharacterVersionId,
          binding.campaignCharacterVersionId
        ),
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.orgId,
          input.orgId
        ),
        eq(
          schema.aiStoryReusableCharacterCampaignProjections.workspaceId,
          input.workspaceId
        )
      ))
      .limit(1);
    const projection = projectionRow
      ? AiStoryReusableCharacterCampaignProjectionSchema.parse(
          projectionRow.snapshot
        )
      : null;
    const sourcePortrait = reusable.canonicalAssets.find(
      (asset) => asset.role === "CHARACTER_SOURCE_PORTRAIT"
    );
    const syntheticAnchor = reusable.canonicalAssets.find(
      (asset) => asset.role === "SYNTHETIC_IDENTITY_ANCHOR"
    );
    if (
      reusable.identityMode !== "CHARACTER_DNA" ||
      !reusable.characterDna ||
      !reusable.characterDnaFingerprint ||
      !sourcePortrait ||
      !projection ||
      (binding.campaignCharacterFingerprint !== undefined &&
        binding.campaignCharacterFingerprint !==
          projection.campaignCharacterFingerprint) ||
      binding.characterDnaFingerprint !== reusable.characterDnaFingerprint ||
      (reusable.characterConsistencyMode === "DNA_PLUS_SYNTHETIC_ANCHOR" &&
        binding.compiledCharacterIdentityFingerprint !==
          reusable.compiledCharacterIdentityFingerprint) ||
      binding.identityFingerprint !== reusable.identityFingerprint ||
      binding.sourcePhotoSentToVideoProvider !== false ||
      binding.syntheticIdentityAnchorAssetId !== syntheticAnchor?.assetId
    ) {
      throw new AiStoryProviderRuntimePersistenceError(
        "IMMUTABLE_CONFLICT",
        "Episode Character DNA lineage is incomplete or inconsistent"
      );
    }
    return {
      reusableCharacterId: reusable.reusableCharacterId,
      reusableCharacterVersionId: reusable.reusableCharacterVersionId,
      campaignCharacterId: projection.campaignCharacterId,
      campaignCharacterVersionId: projection.campaignCharacterVersionId,
      campaignCharacterFingerprint: projection.campaignCharacterFingerprint,
      identityFingerprint: reusable.identityFingerprint,
      characterDnaFingerprint: reusable.characterDnaFingerprint,
      dna: reusable.characterDna,
      episodeLook: binding.episodeLook,
      characterConsistencyMode:
        reusable.characterConsistencyMode ?? "SOFT_DESCRIPTION_BASED",
      sourcePortraitAssetId: sourcePortrait.assetId,
      ...(syntheticAnchor
        ? { syntheticIdentityAnchorAssetId: syntheticAnchor.assetId }
        : {}),
    };
  }

  async convergeCompiledRequestForAcceptedBundle(input: {
    readonly bundle: SceneSchedulingBundle;
    readonly compiledProviderRequest: AiStoryCompiledProviderRequest;
  }): Promise<AiStoryCompiledProviderRequest> {
    const bundle = SceneSchedulingBundleSchema.parse(input.bundle);
    const request = AiStoryCompiledProviderRequestSchema.parse(
      input.compiledProviderRequest
    );
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select({
        orgId: schema.aiStorySceneSchedulingCorrelations.orgId,
        workspaceId: schema.aiStorySceneSchedulingCorrelations.workspaceId,
        storyId: schema.aiStorySceneSchedulingCorrelations.storyId,
        storyVersionId: schema.aiStorySceneSchedulingCorrelations.storyVersionId,
        sceneExecutionId: schema.aiStorySceneSchedulingCorrelations.sceneExecutionId,
        providerExecutionId: schema.aiStorySceneSchedulingCorrelations.providerExecutionId,
        outboxJobId: schema.aiStorySceneSchedulingCorrelations.outboxJobId,
      }).from(schema.aiStorySceneSchedulingCorrelations).where(eq(
        schema.aiStorySceneSchedulingCorrelations.correlationId,
        bundle.correlation.correlationId
      )).limit(1).for("update");
      const [outbox] = await tx.select({
        executionId: schema.providerOutboxJobs.executionId,
        completedAt: schema.providerOutboxJobs.completedAt,
        deadLetterAt: schema.providerOutboxJobs.deadLetterAt,
      }).from(schema.providerOutboxJobs).where(eq(
        schema.providerOutboxJobs.jobId,
        bundle.outboxJobId
      )).limit(1).for("update");
      if (
        !row || !outbox || outbox.completedAt || outbox.deadLetterAt ||
        row.orgId !== request.orgId ||
        row.workspaceId !== request.workspaceId ||
        row.storyId !== request.storyId ||
        row.storyVersionId !== request.storyVersionId ||
        row.sceneExecutionId !== request.sceneExecutionId ||
        row.providerExecutionId !== bundle.providerExecutionId ||
        row.outboxJobId !== bundle.outboxJobId ||
        outbox.executionId !== bundle.providerExecutionId
      ) {
        throw new AiStoryProviderRuntimePersistenceError(
          "IMMUTABLE_CONFLICT",
          "Accepted scheduling bundle cannot safely converge compiled request authority"
        );
      }
      const [activeCompiled] = await tx.select({
        compiledRequestId: schema.aiStoryCompiledProviderRequests.compiledRequestId,
        requestFingerprint: schema.aiStoryCompiledProviderRequests.requestFingerprint,
      }).from(schema.aiStoryCompiledProviderRequests).where(and(
        eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, request.sceneExecutionId),
        sql`not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
          where supersession.source_compiled_request_id = ${schema.aiStoryCompiledProviderRequests.compiledRequestId}
        )`
      )).orderBy(desc(schema.aiStoryCompiledProviderRequests.compiledAt)).limit(1).for("update");
      if (
        activeCompiled &&
        (activeCompiled.compiledRequestId !== request.compiledRequestId ||
          activeCompiled.requestFingerprint !== request.requestFingerprint)
      ) {
        throw new AiStoryProviderRuntimePersistenceError(
          "IMMUTABLE_CONFLICT",
          "Accepted scheduling bundle is bound to a different active compiled request; canonical supersession is required"
        );
      }
      return acceptAiStoryCompiledRequest(tx, request);
    });
  }

  async getCompilationAuthorityBySceneExecutionId(input: {
    readonly sceneExecutionId: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
  }): Promise<{
    readonly qcEvaluationId: string;
    readonly qcFingerprint: string;
    readonly qcCapabilityVersion: string;
    readonly directorFingerprint: string;
    readonly motionFingerprint: string;
  } | null> {
    const [row] = await this.db
      .select({
        qcEvaluationId: schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId,
        qcFingerprint: schema.aiStoryPreGenerationQcEvaluations.qcFingerprint,
        qcCapabilityVersion:
          schema.aiStoryPreGenerationQcEvaluations.providerCapabilityVersion,
        dispatchDecision: schema.aiStoryPreGenerationQcEvaluations.dispatchDecision,
        directorFingerprint: schema.aiStoryDirectorPlanVersions.directorFingerprint,
        directorStatus: schema.aiStoryDirectorPlanVersions.status,
        motionFingerprint: schema.aiStoryMotionPlanVersions.motionFingerprint,
        motionStatus: schema.aiStoryMotionPlanVersions.status,
      })
      .from(schema.aiStoryPreGenerationQcEvaluations)
      .innerJoin(
        schema.aiStoryDirectorPlanVersions,
        eq(
          schema.aiStoryDirectorPlanVersions.directorPlanId,
          schema.aiStoryPreGenerationQcEvaluations.directorPlanId
        )
      )
      .innerJoin(
        schema.aiStoryMotionPlanVersions,
        eq(
          schema.aiStoryMotionPlanVersions.motionPlanId,
          schema.aiStoryPreGenerationQcEvaluations.motionPlanId
        )
      )
      .where(
        and(
          eq(
            schema.aiStoryPreGenerationQcEvaluations.sceneExecutionId,
            input.sceneExecutionId
          ),
          eq(schema.aiStoryPreGenerationQcEvaluations.orgId, input.orgId),
          eq(
            schema.aiStoryPreGenerationQcEvaluations.workspaceId,
            input.workspaceId
          ),
          eq(schema.aiStoryPreGenerationQcEvaluations.storyId, input.storyId),
          eq(
            schema.aiStoryPreGenerationQcEvaluations.storyVersionId,
            input.storyVersionId
          )
        )
      )
      .orderBy(desc(schema.aiStoryPreGenerationQcEvaluations.evaluationVersion))
      .limit(1);
    if (
      !row ||
      !["DISPATCH_ELIGIBLE", "DISPATCH_ELIGIBLE_WITH_WARNINGS"].includes(
        row.dispatchDecision
      ) ||
      row.directorStatus !== "FROZEN" ||
      row.motionStatus !== "FROZEN"
    ) {
      return null;
    }
    return {
      qcEvaluationId: row.qcEvaluationId,
      qcFingerprint: row.qcFingerprint,
      qcCapabilityVersion: row.qcCapabilityVersion,
      directorFingerprint: row.directorFingerprint,
      motionFingerprint: row.motionFingerprint,
    };
  }

  async acceptAttempt(input: AiStoryProviderAttemptBinding): Promise<{ attempt: AiStoryProviderAttemptBinding; replayed: boolean }> {
    const binding = AiStoryProviderAttemptBindingSchema.parse(input);
    await this.db.insert(schema.providerAttempts).values({
      attemptId: binding.providerAttemptId,
      executionId: binding.providerExecutionId,
      contractVersion: binding.contractVersion,
      attemptNumber: binding.attemptNumber,
      providerId: binding.providerId,
      providerVersion: binding.capabilityVersion,
      modelVersion: binding.modelId,
      requestHash: binding.requestFingerprint,
      status: "PENDING",
      warnings: [],
      providerMetadata: {
        compiledRequestId: binding.compiledRequestId,
        attemptInputFingerprint: binding.attemptInputFingerprint,
        generationMode: binding.generationMode,
        estimatedCost: binding.estimatedCost,
      },
    }).onConflictDoNothing();
    const inserted = await this.db.insert(schema.aiStoryProviderAttemptCompiledBindings).values({
      providerAttemptId: binding.providerAttemptId,
      compiledRequestId: binding.compiledRequestId,
      orgId: binding.orgId,
      workspaceId: binding.workspaceId,
      sceneExecutionId: binding.sceneExecutionId,
      idempotencyKey: binding.idempotencyKey,
      requestFingerprint: binding.requestFingerprint,
      attemptInputFingerprint: binding.attemptInputFingerprint,
      status: binding.status,
      providerTaskId: binding.providerTaskId,
      submissionClaimOwner: binding.submissionClaimOwner,
      submissionClaimedAt: binding.submissionClaimedAt ? new Date(binding.submissionClaimedAt) : undefined,
      pollCount: binding.pollCount,
      failureClass: binding.failureClass,
      binding,
      createdAt: new Date(binding.createdAt),
      updatedAt: new Date(binding.updatedAt),
    }).onConflictDoNothing().returning({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding });
    if (inserted[0]) return { attempt: AiStoryProviderAttemptBindingSchema.parse(inserted[0].binding), replayed: false };
    const [row] = await this.db.select({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding })
      .from(schema.aiStoryProviderAttemptCompiledBindings)
      .where(eq(schema.aiStoryProviderAttemptCompiledBindings.idempotencyKey, binding.idempotencyKey)).limit(1);
    if (!row) throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", "Attempt was not accepted");
    const existing = AiStoryProviderAttemptBindingSchema.parse(row.binding);
    if (existing.attemptInputFingerprint !== binding.attemptInputFingerprint) throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", "Idempotency key conflicts with Attempt input");
    return { attempt: existing, replayed: true };
  }

  async getAttempt(providerAttemptId: string): Promise<AiStoryProviderAttemptBinding | null> {
    const [row] = await this.db.select({ binding: schema.aiStoryProviderAttemptCompiledBindings.binding })
      .from(schema.aiStoryProviderAttemptCompiledBindings)
      .where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, providerAttemptId)).limit(1);
    return row ? AiStoryProviderAttemptBindingSchema.parse(row.binding) : null;
  }

  async claimSubmission(input: { providerAttemptId: string; workerId: string; claimedAt: string }): Promise<AiStoryProviderAttemptBinding | null> {
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select binding from ai_story_provider_attempt_compiled_bindings
        where provider_attempt_id = ${input.providerAttemptId} and status = 'READY'
        for update skip locked
      `)) as unknown as Array<{ binding: AiStoryProviderAttemptBinding }>;
      const current = rows[0]?.binding ? AiStoryProviderAttemptBindingSchema.parse(rows[0].binding) : null;
      if (!current) return null;
      const claimed = AiStoryProviderAttemptBindingSchema.parse({
        ...current,
        status: "DISPATCHING",
        submissionClaimOwner: input.workerId,
        submissionClaimedAt: input.claimedAt,
        submitStartedAt: input.claimedAt,
        updatedAt: input.claimedAt,
      });
      await tx.update(schema.aiStoryProviderAttemptCompiledBindings).set({
        status: claimed.status,
        submissionClaimOwner: input.workerId,
        submissionClaimedAt: new Date(input.claimedAt),
        binding: claimed,
        updatedAt: new Date(input.claimedAt),
      }).where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, input.providerAttemptId));
      return claimed;
    });
  }

  async updateAttempt(input: AiStoryProviderAttemptBinding): Promise<AiStoryProviderAttemptBinding> {
    const next = AiStoryProviderAttemptBindingSchema.parse(input);
    const current = await this.getAttempt(next.providerAttemptId);
    if (!current || current.compiledRequestId !== next.compiledRequestId || current.requestFingerprint !== next.requestFingerprint || current.attemptInputFingerprint !== next.attemptInputFingerprint) {
      throw new AiStoryProviderRuntimePersistenceError("IMMUTABLE_CONFLICT", "Attempt immutable input cannot change");
    }
    if (!isAiStoryProviderAttemptTransitionAllowed(current.status, next.status)) {
      throw new AiStoryProviderRuntimePersistenceError("ATTEMPT_CONFLICT", `Invalid Provider Attempt transition: ${current.status} → ${next.status}`);
    }
    await this.db.update(schema.aiStoryProviderAttemptCompiledBindings).set({
      status: next.status,
      providerTaskId: next.providerTaskId,
      submissionClaimOwner: next.submissionClaimOwner,
      submissionClaimedAt: next.submissionClaimedAt ? new Date(next.submissionClaimedAt) : undefined,
      pollCount: next.pollCount,
      failureClass: next.failureClass,
      binding: next,
      updatedAt: new Date(next.updatedAt),
    }).where(eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, next.providerAttemptId));
    return next;
  }
}
