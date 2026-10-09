import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  AiStoryLocalGenerationOutputSchema,
  AiStoryLocalGenerationPackageSchema,
  type AiStoryLocalGenerationOutput,
  type AiStoryLocalGenerationPackage,
  AiStoryPreGenerationQcEvaluationSchema,
} from "@ceo-agent/shared";
import { computeAiStoryLocalGenerationPackageV3Fingerprint } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export class AiStoryLocalGenerationPersistenceError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryLocalGenerationPersistenceError";
  }
}

export class AiStoryLocalGenerationRepository {
  constructor(private readonly db: Db = getDb()) {}

  async loadUnitContext(sceneExecutionId:string,qcEvaluationId:string,qcFingerprint:string) {
    const [scene]=await this.db.select().from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id,sceneExecutionId)).limit(1);
    if(!scene)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Exact persisted execution Unit is missing");
    const [row]=await this.db.select().from(schema.aiStoryPreGenerationQcEvaluations).where(eq(schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId,qcEvaluationId)).limit(1);
    if(!row) {
      if(/^[a-f0-9-]{36}$/i.test(scene.sceneId))throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Canonical Scene is missing frozen Pre-QC lineage");
      return {sceneId:scene.sceneId,planningAuthority:{planningLineageSource:"LEGACY_COMPILED_V1" as const,sceneVersion:1,scriptVersionId:null,handoffId:null,handoffFingerprint:null}};
    }
    const qc=AiStoryPreGenerationQcEvaluationSchema.parse(row.evaluation);
    if(qc.sceneExecutionId!==sceneExecutionId||qc.storyVersionId!==scene.storyVersionId||qc.qcFingerprint!==qcFingerprint)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Pre-QC lineage does not match this frozen execution Unit");
    const [handoff]=await this.db.select().from(schema.aiStoryScriptDirectorHandoffs).where(eq(schema.aiStoryScriptDirectorHandoffs.handoffId,qc.handoffId)).limit(1);
    const versions=qc.sceneVersionIds?.length?await this.db.select().from(schema.aiStoryCanonicalSceneVersions).where(and(
      inArray(schema.aiStoryCanonicalSceneVersions.sceneVersionId,qc.sceneVersionIds),
      eq(schema.aiStoryCanonicalSceneVersions.sceneId,scene.sceneId),
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId,scene.storyVersionId),
      eq(schema.aiStoryCanonicalSceneVersions.scriptVersionId,qc.scriptVersionId),
    )):[];
    if(!handoff||versions.length!==1)throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_AUTHORITY_INVALID","Exact frozen Scene-version/Handoff lineage is required");
    return {sceneId:scene.sceneId,planningAuthority:{planningLineageSource:"FROZEN_SCRIPT_DIRECTOR" as const,sceneVersion:versions[0]!.version,scriptVersionId:qc.scriptVersionId,handoffId:qc.handoffId,handoffFingerprint:handoff.handoffFingerprint}};
  }

  async insertOrConverge(input: {
    readonly packages: readonly AiStoryLocalGenerationPackage[];
    readonly createdBy: string;
  }): Promise<{ packages: readonly AiStoryLocalGenerationPackage[]; replayed: boolean }> {
    const requested = input.packages.map((item) => AiStoryLocalGenerationPackageSchema.parse(item));
    if (requested.length === 0) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_EMPTY", "At least one local Generation Unit is required");
    }
    const inserted = await this.db.transaction(async (tx) => {
      const accepted: AiStoryLocalGenerationPackage[] = [];
      let replayed = true;
      for (const item of requested) {
        const {packageFingerprint,createdAt:_createdAt,...facts}=item;
        const expectedFingerprint = item.version === "local-generation-package.v3"
          ? computeAiStoryLocalGenerationPackageV3Fingerprint(item)
          : canonicalPersistenceHash({kind:item.version,...facts});
        if(packageFingerprint!==expectedFingerprint) throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_IMMUTABLE_CONFLICT","Package fingerprint does not match frozen facts");
        const [runtime]=await tx.select().from(schema.aiStoryRuntimeAuthorizedFacts).where(eq(schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,item.runtimeAuthorizationId)).limit(1);
        const orderedIds = runtime?.orderedSceneExecutionIds ?? [];
        const uniqueOrderedIds = new Set(orderedIds);
        const ledgerScenes = orderedIds.length > 0 && uniqueOrderedIds.size === orderedIds.length
          ? await tx.select().from(schema.aiStorySceneExecutions).where(
              inArray(schema.aiStorySceneExecutions.id, orderedIds),
            )
          : [];
        const scenesById = new Map(
          ledgerScenes.map((candidate) => [candidate.id, candidate]),
        );
        const canonicalLedger = runtime
          && orderedIds.length > 0
          && uniqueOrderedIds.size === orderedIds.length
          && ledgerScenes.length === orderedIds.length
          && orderedIds.every((sceneExecutionId) => {
            const candidate = scenesById.get(sceneExecutionId);
            return candidate
              && candidate.executionPlanId === item.executionPlanId
              && candidate.orgId === item.organizationId
              && candidate.workspaceId === item.workspaceId
              && candidate.campaignId === item.campaignId
              && candidate.storyId === item.storyId
              && candidate.storyVersionId === item.storyVersionId;
          });
        const scene = scenesById.get(item.sceneExecutionId);
        if(!scene||!runtime||!canonicalLedger||item.unitId!==item.sceneExecutionId||
          item.order>orderedIds.length||orderedIds[item.order - 1]!==item.sceneExecutionId||
          scene.sceneId!==item.sceneId||runtime.executionPlanId!==item.executionPlanId||
          runtime.orgId!==item.organizationId||runtime.workspaceId!==item.workspaceId||
          runtime.campaignId!==item.campaignId||runtime.storyId!==item.storyId||
          runtime.storyVersionId!==item.storyVersionId) throw new AiStoryLocalGenerationPersistenceError(
            "LOCAL_GENERATION_AUTHORITY_INVALID",
            "Package position and ownership must equal the complete frozen Runtime Authorization ledger",
          );
        const rows = await tx.insert(schema.aiStoryLocalGenerationPackages).values({
          packageId: item.packageId,
          packageFingerprint: item.packageFingerprint,
          orgId: item.organizationId,
          workspaceId: item.workspaceId,
          campaignId: item.campaignId,
          storyId: item.storyId,
          storyVersionId: item.storyVersionId,
          executionPlanId: item.executionPlanId,
          runtimeAuthorizationId: item.runtimeAuthorizationId,
          sceneExecutionId: item.sceneExecutionId,
          unitId: item.unitId,
          unitOrder: item.order,
          successorNumber: item.version === "local-generation-package.v3"
            ? item.successorNumber
            : 0,
          successorOfPackageId: item.version === "local-generation-package.v3"
            ? item.successorOfPackageId
            : null,
          releaseAuthorityId: item.version === "local-generation-package.v3"
            ? item.releaseAuthority.releaseAuthorityId
            : null,
          releaseAuthorityFingerprint:
            item.version === "local-generation-package.v3"
              ? item.releaseAuthority.semanticFingerprint
              : null,
          retryOfPackageId: item.retryOfPackageId,
          retryNumber: item.retryNumber,
          contractVersion: item.version,
          package: item,
          createdBy: input.createdBy,
          createdAt: new Date(item.createdAt),
        }).onConflictDoNothing().returning();
        if (rows[0]) {
          accepted.push(AiStoryLocalGenerationPackageSchema.parse(rows[0].package));
          replayed = false;
          continue;
        }
        const existing = await tx.select().from(schema.aiStoryLocalGenerationPackages).where(and(
          eq(schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId, item.runtimeAuthorizationId),
          eq(schema.aiStoryLocalGenerationPackages.unitId, item.unitId),
          eq(
            schema.aiStoryLocalGenerationPackages.successorNumber,
            item.version === "local-generation-package.v3"
              ? item.successorNumber
              : 0,
          ),
          eq(schema.aiStoryLocalGenerationPackages.retryNumber, item.retryNumber),
        )).limit(1);
        const parsed = existing[0] ? AiStoryLocalGenerationPackageSchema.parse(existing[0].package) : null;
        if (!parsed || parsed.packageFingerprint !== item.packageFingerprint) {
          throw new AiStoryLocalGenerationPersistenceError(
            "LOCAL_GENERATION_IMMUTABLE_CONFLICT",
            "A different package already owns this local Generation Unit identity",
          );
        }
        accepted.push(parsed);
      }
      return { packages: accepted.sort((a, b) => a.order - b.order), replayed };
    });
    return inserted;
  }

  async initializeSequential(input: {
    readonly package: import("@ceo-agent/shared").AiStoryLocalGenerationPackageV3;
    readonly orderedSceneExecutionIds: readonly string[];
    readonly createdBy: string;
  }) {
    const pkg = input.package;
    if (
      pkg.order !== 1
      || pkg.successorNumber !== 0
      || pkg.successorOfPackageId !== null
      || pkg.releaseAuthority.semantic.gateKind !== "INITIAL_UNIT"
      || input.orderedSceneExecutionIds[0] !== pkg.sceneExecutionId
    ) {
      throw new AiStoryLocalGenerationPersistenceError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Sequential initialization requires the exact initial Unit authority",
      );
    }
    return this.db.transaction(async (tx) => {
      // Plan lock serializes initialization with every later release/activation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pkg.executionPlanId}))`);
      const [runtime] = await tx.select({
        orderedSceneExecutionIds:
          schema.aiStoryRuntimeAuthorizedFacts.orderedSceneExecutionIds,
      }).from(schema.aiStoryRuntimeAuthorizedFacts).where(and(
        eq(
          schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId,
          pkg.runtimeAuthorizationId,
        ),
        eq(
          schema.aiStoryRuntimeAuthorizedFacts.workspaceId,
          pkg.workspaceId,
        ),
        eq(
          schema.aiStoryRuntimeAuthorizedFacts.executionPlanId,
          pkg.executionPlanId,
        ),
      )).limit(1);
      if (
        !runtime
        || runtime.orderedSceneExecutionIds.length
          !== input.orderedSceneExecutionIds.length
        || runtime.orderedSceneExecutionIds.some(
          (sceneExecutionId, index) =>
            sceneExecutionId !== input.orderedSceneExecutionIds[index],
        )
      ) {
        throw new AiStoryLocalGenerationPersistenceError(
          "LOCAL_GENERATION_AUTHORITY_INVALID",
          "Sequential release order must equal the frozen Runtime Authorization",
        );
      }
      const repository = new AiStoryLocalGenerationRepository(
        tx as unknown as Db,
      );
      const accepted = await repository.insertOrConverge({
        packages: [pkg],
        createdBy: input.createdBy,
      });
      for (const [index, sceneExecutionId] of input.orderedSceneExecutionIds.entries()) {
        const first = index === 0;
        await tx.insert(schema.aiStorySceneReleaseStates).values({
          sceneExecutionId,
          executionPlanId: pkg.executionPlanId,
          runtimeAuthorizationId: pkg.runtimeAuthorizationId,
          workspaceId: pkg.workspaceId,
          orgId: pkg.organizationId,
          sceneOrder: index + 1,
          releaseState: first ? "RELEASED" : "WAITING_FOR_PREDECESSOR",
          executionMode: "MANUAL_LOCAL",
          gateKind: first ? "INITIAL_UNIT" : "PREDECESSOR_CONTINUITY",
          releaseRevision: 0,
          releaseAuthorityId: first
            ? pkg.releaseAuthority.releaseAuthorityId
            : null,
          releaseAuthorityFingerprint: first
            ? pkg.releaseAuthority.semanticFingerprint
            : null,
          predecessorAuthorityFingerprint: null,
          currentLocalGenerationPackageId: first ? pkg.packageId : null,
          releaseStage: first ? 1 : null,
          releasedBy: first ? input.createdBy : null,
          releasedAt: first
            ? new Date(pkg.releaseAuthority.audit.releasedAt)
            : null,
        }).onConflictDoNothing();
      }
      const releases = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
          eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
        )).orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
      if (
        releases.length !== input.orderedSceneExecutionIds.length
        || releases.some((row, index) =>
          row.sceneExecutionId !== input.orderedSceneExecutionIds[index]
          || row.runtimeAuthorizationId !== pkg.runtimeAuthorizationId
          || row.executionMode !== "MANUAL_LOCAL"
          || (index === 0
            ? row.releaseState !== "RELEASED"
              || row.currentLocalGenerationPackageId !== pkg.packageId
            : row.releaseState !== "WAITING_FOR_PREDECESSOR"
              || row.currentLocalGenerationPackageId !== null))
      ) {
        throw new AiStoryLocalGenerationPersistenceError(
          "LOCAL_GENERATION_IMMUTABLE_CONFLICT",
          "Sequential release ledger does not converge on the authorized order",
        );
      }
      return accepted;
    });
  }

  async insertOrActivateSequentialRetry(input: {
    readonly package: import("@ceo-agent/shared").AiStoryLocalGenerationPackageV3;
    readonly createdBy: string;
  }) {
    const pkg = input.package;
    if (!pkg.retryOfPackageId || pkg.retryNumber < 1) {
      throw new AiStoryLocalGenerationPersistenceError(
        "LOCAL_GENERATION_AUTHORITY_INVALID",
        "Sequential retry must bind the current immutable package",
      );
    }
    const retryOfPackageId = pkg.retryOfPackageId;
    return this.db.transaction(async (tx) => {
      // Lock order: plan advisory lock, then current release row FOR UPDATE.
      // An already-activated exact package is a read-only replay; only the
      // transition from retryOfPackageId invalidates descendants.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pkg.executionPlanId}))`);
      const [release] = await tx.select()
        .from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
          eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
          eq(schema.aiStorySceneReleaseStates.sceneExecutionId, pkg.sceneExecutionId),
        ))
        .limit(1)
        .for("update");
      const [priorRow] = await tx.select()
        .from(schema.aiStoryLocalGenerationPackages)
        .where(and(
          eq(schema.aiStoryLocalGenerationPackages.workspaceId, pkg.workspaceId),
          eq(schema.aiStoryLocalGenerationPackages.executionPlanId, pkg.executionPlanId),
          eq(schema.aiStoryLocalGenerationPackages.packageId, retryOfPackageId),
        ))
        .limit(1);
      const prior = priorRow
        ? AiStoryLocalGenerationPackageSchema.parse(priorRow.package)
        : null;
      const lineageMatches = prior?.version === "local-generation-package.v3"
        && pkg.retryNumber === prior.retryNumber + 1
        && pkg.unitId === prior.unitId
        && pkg.sceneExecutionId === prior.sceneExecutionId
        && pkg.order === prior.order
        && pkg.successorOfPackageId === prior.successorOfPackageId
        && pkg.successorNumber === prior.successorNumber
        && pkg.releaseAuthority.semanticFingerprint
          === prior.releaseAuthority.semanticFingerprint
        && pkg.predecessorAuthority?.semanticFingerprint
          === prior.predecessorAuthority?.semanticFingerprint;
      if (
        !release
        || release.releaseState !== "RELEASED"
        || release.releaseRevision
          !== pkg.releaseAuthority.semantic.releaseRevision
        || !lineageMatches
        || (
          release.currentLocalGenerationPackageId !== retryOfPackageId
          && release.currentLocalGenerationPackageId !== pkg.packageId
        )
      ) {
        throw new AiStoryLocalGenerationPersistenceError(
          "LOCAL_GENERATION_IMMUTABLE_CONFLICT",
          "Sequential retry activation must descend exactly once from current authority",
        );
      }
      const repository = new AiStoryLocalGenerationRepository(
        tx as unknown as Db,
      );
      const accepted = await repository.insertOrConverge({
        packages: [pkg],
        createdBy: input.createdBy,
      });
      if (release.currentLocalGenerationPackageId === pkg.packageId) {
        return { ...accepted, replayed: true };
      }
      const [updated] = await tx.update(schema.aiStorySceneReleaseStates).set({
        currentLocalGenerationPackageId: pkg.packageId,
        updatedAt: new Date(pkg.createdAt),
      }).where(and(
        eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
        eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
        eq(schema.aiStorySceneReleaseStates.sceneExecutionId, pkg.sceneExecutionId),
        eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
        eq(
          schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
          retryOfPackageId,
        ),
        eq(
          schema.aiStorySceneReleaseStates.releaseRevision,
          pkg.releaseAuthority.semantic.releaseRevision,
        ),
      )).returning();
      if (!updated) {
        throw new AiStoryLocalGenerationPersistenceError(
          "LOCAL_GENERATION_IMMUTABLE_CONFLICT",
          "Sequential retry no longer descends from the locked current package",
        );
      }
      await tx.update(schema.aiStorySceneReleaseStates).set({
        releaseState: "WAITING_FOR_PREDECESSOR",
        releaseRevision: sql`${schema.aiStorySceneReleaseStates.releaseRevision} + 1`,
        releaseAuthorityId: null,
        releaseAuthorityFingerprint: null,
        predecessorAuthorityFingerprint: null,
        gateGenerationResultId: null,
        gateGenerationResultDecisionId: null,
        currentLocalGenerationPackageId: null,
        releaseStage: null,
        releasedBy: null,
        releasedAt: null,
        gateSceneExecutionId: null,
        gateProviderAttemptId: null,
        gateSceneResultId: null,
        updatedAt: new Date(pkg.createdAt),
      }).where(and(
        eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
        eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
        gt(schema.aiStorySceneReleaseStates.sceneOrder, pkg.order),
      ));
      return accepted;
    });
  }

  async listByExecutionPlan(input: {
    readonly workspaceId: string;
    readonly executionPlanId: string;
  }): Promise<readonly AiStoryLocalGenerationPackage[]> {
    const rows = await this.db.select().from(schema.aiStoryLocalGenerationPackages).where(and(
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
    )).orderBy(asc(schema.aiStoryLocalGenerationPackages.unitOrder));
    const packages = rows.map((row) =>
      AiStoryLocalGenerationPackageSchema.parse(row.package)
    );
    const releases = await this.db.select({
      packageId: schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
      state: schema.aiStorySceneReleaseStates.releaseState,
    }).from(schema.aiStorySceneReleaseStates).where(and(
      eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
      eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
    ));
    const current = new Set(
      releases
        .filter((row) => row.state === "RELEASED" && row.packageId)
        .map((row) => row.packageId!),
    );
    return packages.filter(
      (item) =>
        item.version !== "local-generation-package.v3"
        || current.has(item.packageId),
    );
  }

  async getPackage(input: {
    readonly workspaceId: string;
    readonly executionPlanId: string;
    readonly packageId: string;
  }): Promise<AiStoryLocalGenerationPackage | null> {
    const rows = await this.db.select().from(schema.aiStoryLocalGenerationPackages).where(and(
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      eq(schema.aiStoryLocalGenerationPackages.packageId, input.packageId),
    )).limit(1);
    return rows[0] ? AiStoryLocalGenerationPackageSchema.parse(rows[0].package) : null;
  }

  async getExecutablePackage(input: {
    readonly workspaceId: string;
    readonly executionPlanId: string;
    readonly packageId: string;
  }): Promise<AiStoryLocalGenerationPackage | null> {
    return this.db.transaction(async (tx) => {
      // This is a consistent executable-authority read. Output and Result
      // acceptance repeat the check under the same plan lock at mutation time.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.executionPlanId}))`);
      const [row] = await tx.select()
        .from(schema.aiStoryLocalGenerationPackages)
        .where(and(
          eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
          eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
          eq(schema.aiStoryLocalGenerationPackages.packageId, input.packageId),
        ))
        .limit(1);
      const item = row
        ? AiStoryLocalGenerationPackageSchema.parse(row.package)
        : null;
      if (!item || item.version !== "local-generation-package.v3") return item;
      const [release] = await tx.select({
        packageId: schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
        state: schema.aiStorySceneReleaseStates.releaseState,
        fingerprint: schema.aiStorySceneReleaseStates.releaseAuthorityFingerprint,
      }).from(schema.aiStorySceneReleaseStates).where(and(
        eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
        eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
        eq(schema.aiStorySceneReleaseStates.sceneExecutionId, item.sceneExecutionId),
      )).limit(1).for("share");
      return release?.state === "RELEASED"
        && release.packageId === item.packageId
        && release.fingerprint === item.releaseAuthority.semanticFingerprint
        ? item
        : null;
    });
  }

  async insertOutput(outputInput: AiStoryLocalGenerationOutput): Promise<{ output: AiStoryLocalGenerationOutput; replayed: boolean }> {
    const output = AiStoryLocalGenerationOutputSchema.parse(outputInput);
    return this.db.transaction(async (tx) => {
    const [pkg]=await tx.select().from(schema.aiStoryLocalGenerationPackages).where(eq(schema.aiStoryLocalGenerationPackages.packageId,output.packageId)).limit(1);
    if (pkg?.contractVersion === "local-generation-package.v3") {
      // Authoritative stale-package fence immediately before output acceptance.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pkg.executionPlanId}))`);
      const [release] = await tx.select().from(schema.aiStorySceneReleaseStates).where(and(
        eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
        eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
        eq(schema.aiStorySceneReleaseStates.sceneExecutionId, pkg.sceneExecutionId),
        eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
        eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, pkg.packageId),
      )).limit(1).for("update");
      if (!release) {
        throw new AiStoryLocalGenerationPersistenceError(
          "LOCAL_GENERATION_PACKAGE_NOT_CURRENT",
          "Only the current released V3 package accepts output",
        );
      }
    }
    const [asset]=await tx.select().from(schema.assets).where(eq(schema.assets.id,output.assetId)).limit(1);
    if(!pkg||!asset||asset.status!=="ready"||pkg.unitId!==output.unitId||pkg.sceneExecutionId!==output.sceneExecutionId||asset.workspaceId!==pkg.workspaceId||asset.orgId!==pkg.orgId||asset.campaignId!==pkg.campaignId||asset.contentHash!==output.contentHash) throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_WRONG_UNIT","Accepted media must match the exact package Unit and private Asset");
    const rows = await tx.insert(schema.aiStoryLocalGenerationOutputs).values({
      outputId: output.outputId,
      packageId: output.packageId,
      unitId: output.unitId,
      sceneExecutionId: output.sceneExecutionId,
      assetId: output.assetId,
      contentHash: output.contentHash,
      mediaType: output.mediaType,
      durationSec: String(output.durationSec),
      width: output.width,
      height: output.height,
      qcState: output.qcState,
      continuityFrameAssetId: output.continuityFrameAssetId,
      uploadedBy: output.uploadedBy,
      uploadedAt: new Date(output.uploadedAt),
    }).onConflictDoNothing().returning();
    if (rows[0]) return { output, replayed: false };
    const existing = await tx.select().from(schema.aiStoryLocalGenerationOutputs).where(
      eq(schema.aiStoryLocalGenerationOutputs.packageId, output.packageId),
    ).limit(1);
    if (!existing[0]) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_CONFLICT", "Local output insert did not converge");
    }
    const parsed = AiStoryLocalGenerationOutputSchema.parse({
      outputId: existing[0].outputId,
      packageId: existing[0].packageId,
      unitId: existing[0].unitId,
      sceneExecutionId: existing[0].sceneExecutionId,
      assetId: existing[0].assetId,
      contentHash: existing[0].contentHash,
      mediaType: existing[0].mediaType,
      durationSec: Number(existing[0].durationSec),
      width: existing[0].width,
      height: existing[0].height,
      uploadedBy: existing[0].uploadedBy,
      uploadedAt: existing[0].uploadedAt.toISOString(),
      qcState: existing[0].qcState,
      continuityFrameAssetId: existing[0].continuityFrameAssetId,
    });
    if (parsed.contentHash !== output.contentHash || parsed.assetId !== output.assetId) {
      throw new AiStoryLocalGenerationPersistenceError("LOCAL_GENERATION_OUTPUT_CONFLICT", "A different output is already bound to this Unit package");
    }
    return { output: parsed, replayed: true };
    });
  }

  async listOutputs(input: { readonly workspaceId: string; readonly executionPlanId: string }) {
    const rows = await this.db.select({ output: schema.aiStoryLocalGenerationOutputs }).from(schema.aiStoryLocalGenerationOutputs)
      .innerJoin(schema.aiStoryLocalGenerationPackages, eq(schema.aiStoryLocalGenerationPackages.packageId, schema.aiStoryLocalGenerationOutputs.packageId))
      .where(and(
        eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
        eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      ));
    return rows.map(({ output }) => AiStoryLocalGenerationOutputSchema.parse({
      outputId: output.outputId,
      packageId: output.packageId,
      unitId: output.unitId,
      sceneExecutionId: output.sceneExecutionId,
      assetId: output.assetId,
      contentHash: output.contentHash,
      mediaType: output.mediaType,
      durationSec: Number(output.durationSec),
      width: output.width,
      height: output.height,
      uploadedBy: output.uploadedBy,
      uploadedAt: output.uploadedAt.toISOString(),
      qcState: output.qcState,
      continuityFrameAssetId: output.continuityFrameAssetId,
    }));
  }
}
