import { and, asc, eq, gt, sql } from "drizzle-orm";
import {
  AiStoryGenerationResultDecisionSchema,
  AiStoryGenerationResultSchema,
  AiStoryLocalGenerationPackageV3Schema,
  AiStoryPostGenerationQcEvaluationSchema,
  postQcAllowsHumanApproval,
  type AiStoryLocalGenerationPackageV3,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { AiStoryLocalGenerationRepository } from "./ai-story-local-generation";

type Db = ReturnType<typeof getDb>;

export function selectStaleSequentialDescendants(
  rows: readonly {
    sceneExecutionId: string;
    sceneOrder: number;
    gateGenerationResultId: string | null;
  }[],
  predecessorOrder: number,
  replacementGenerationResultId: string,
): readonly string[] {
  const immediate = rows.find(
    (row) => row.sceneOrder === predecessorOrder + 1,
  );
  if (
    !immediate?.gateGenerationResultId
    || immediate.gateGenerationResultId === replacementGenerationResultId
  ) {
    return [];
  }
  return rows
    .filter((row) => row.sceneOrder > predecessorOrder)
    .map((row) => row.sceneExecutionId);
}

export class AiStorySequentialLocalReleaseRepository {
  constructor(private readonly db: Db = getDb()) {}

  async nextReleaseContext(input: {
    workspaceId: string;
    executionPlanId: string;
    predecessorSceneExecutionId: string;
  }) {
    const rows = await this.db.select().from(schema.aiStorySceneReleaseStates)
      .where(and(
        eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
        eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
      )).orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
    const predecessor = rows.find(
      (row) => row.sceneExecutionId === input.predecessorSceneExecutionId,
    );
    const candidate = predecessor
      ? rows.find((row) => row.sceneOrder === predecessor.sceneOrder + 1)
      : null;
    return { rows, predecessor: predecessor ?? null, candidate: candidate ?? null };
  }

  async invalidateDescendantsForSupersedingApproval(input: {
    workspaceId: string;
    executionPlanId: string;
    sceneExecutionId: string;
    currentPackageId: string;
    generationResultId: string;
    invalidatedAt: Date;
  }): Promise<readonly string[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.executionPlanId}))`);
      const [predecessor] = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
          eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
          eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
        )).limit(1);
      if (
        !predecessor
        || predecessor.releaseState !== "RELEASED"
        || predecessor.currentLocalGenerationPackageId !== input.currentPackageId
      ) {
        throw new Error("SEQUENTIAL_LOCAL_CURRENT_PACKAGE_REQUIRED");
      }
      const planRows = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(
            schema.aiStorySceneReleaseStates.workspaceId,
            input.workspaceId,
          ),
          eq(
            schema.aiStorySceneReleaseStates.executionPlanId,
            input.executionPlanId,
          ),
        ));
      const staleIds = selectStaleSequentialDescendants(
        planRows,
        predecessor.sceneOrder,
        input.generationResultId,
      );
      if (staleIds.length === 0) {
        return [];
      }
      const stale = await tx.update(schema.aiStorySceneReleaseStates).set({
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
        updatedAt: input.invalidatedAt,
      }).where(and(
        eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
        eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
        gt(schema.aiStorySceneReleaseStates.sceneOrder, predecessor.sceneOrder),
      )).returning({
        sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId,
      });
      return stale.map((row) => row.sceneExecutionId);
    });
  }

  async releaseSuccessor(input: {
    package: AiStoryLocalGenerationPackageV3;
    actorUserId: string;
  }) {
    const pkg = AiStoryLocalGenerationPackageV3Schema.parse(input.package);
    const predecessorAuthority = pkg.predecessorAuthority;
    if (
      !predecessorAuthority
      || pkg.releaseAuthority.semantic.gateKind !== "PREDECESSOR_CONTINUITY"
    ) {
      throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_REQUIRED");
    }
    return this.db.transaction(async (tx) => {
      // Lock order matches initialization/retry: plan advisory lock, then the
      // candidate and predecessor release rows. Concurrent identical releases
      // converge; any different already-released authority fails closed.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${pkg.executionPlanId}))`);
      const [candidate] = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(schema.aiStorySceneReleaseStates.workspaceId, pkg.workspaceId),
          eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
          eq(schema.aiStorySceneReleaseStates.sceneExecutionId, pkg.sceneExecutionId),
        )).limit(1).for("update");
      const [predecessor] = await tx.select().from(schema.aiStorySceneReleaseStates)
        .where(and(
          eq(
            schema.aiStorySceneReleaseStates.workspaceId,
            pkg.workspaceId,
          ),
          eq(schema.aiStorySceneReleaseStates.executionPlanId, pkg.executionPlanId),
          eq(
            schema.aiStorySceneReleaseStates.sceneExecutionId,
            predecessorAuthority.semantic.predecessorSceneExecutionId,
          ),
        )).limit(1).for("update");
      const exactReleasedReplay = candidate?.releaseState === "RELEASED"
        && candidate.currentLocalGenerationPackageId === pkg.packageId
        && candidate.releaseAuthorityId
          === pkg.releaseAuthority.releaseAuthorityId
        && candidate.releaseAuthorityFingerprint
          === pkg.releaseAuthority.semanticFingerprint
        && candidate.predecessorAuthorityFingerprint
          === predecessorAuthority.semanticFingerprint
        && candidate.gateGenerationResultId
          === predecessorAuthority.semantic.predecessorGenerationResultId
        && candidate.gateGenerationResultDecisionId
          === predecessorAuthority.semantic.predecessorDecisionId;
      if (
        !candidate
        || !predecessor
        || (
          candidate.releaseState !== "WAITING_FOR_PREDECESSOR"
          && !exactReleasedReplay
        )
        || candidate.sceneOrder !== predecessor.sceneOrder + 1
        || candidate.releaseRevision
          !== pkg.releaseAuthority.semantic.releaseRevision
        || candidate.runtimeAuthorizationId !== pkg.runtimeAuthorizationId
        || predecessor.releaseState !== "RELEASED"
        || predecessor.runtimeAuthorizationId !== pkg.runtimeAuthorizationId
        || predecessor.currentLocalGenerationPackageId
          !== predecessorAuthority.semantic.predecessorPackageId
      ) {
        throw new Error("SEQUENTIAL_LOCAL_RELEASE_STATE_CONFLICT");
      }

      const [resultRow] = await tx.select().from(schema.aiStoryGenerationResults)
        .where(and(
          eq(
            schema.aiStoryGenerationResults.workspaceId,
            pkg.workspaceId,
          ),
          eq(
            schema.aiStoryGenerationResults.generationResultId,
            predecessorAuthority.semantic.predecessorGenerationResultId,
          ),
        )).limit(1);
      const [decisionRow] = await tx.select()
        .from(schema.aiStoryGenerationResultDecisions)
        .where(eq(
          schema.aiStoryGenerationResultDecisions.decisionId,
          predecessorAuthority.semantic.predecessorDecisionId,
        )).limit(1);
      const [qcRow] = await tx.select()
        .from(schema.aiStoryPostGenerationQcEvaluations)
        .where(and(
          eq(
            schema.aiStoryPostGenerationQcEvaluations.workspaceId,
            pkg.workspaceId,
          ),
          eq(
            schema.aiStoryPostGenerationQcEvaluations.postQcEvaluationId,
            predecessorAuthority.semantic.predecessorPostQcEvaluationId,
          ),
        )).limit(1);
      const [frame] = await tx.select()
        .from(schema.aiStoryGenerationResultContinuityFrames)
        .where(and(
          eq(
            schema.aiStoryGenerationResultContinuityFrames.workspaceId,
            pkg.workspaceId,
          ),
          eq(
            schema.aiStoryGenerationResultContinuityFrames.generationResultId,
            predecessorAuthority.semantic.predecessorGenerationResultId,
          ),
        )).limit(1);
      const result = resultRow
        ? AiStoryGenerationResultSchema.parse(resultRow.result)
        : null;
      const decision = decisionRow
        ? AiStoryGenerationResultDecisionSchema.parse(decisionRow.fact)
        : null;
      const qc = qcRow
        ? AiStoryPostGenerationQcEvaluationSchema.parse(qcRow.evaluation)
        : null;
      if (
        !result
        || !decision
        || !qc
        || !frame
        || result.ownership.orgId !== pkg.organizationId
        || result.ownership.workspaceId !== pkg.workspaceId
        || result.ownership.campaignId !== pkg.campaignId
        || result.ownership.storyId !== pkg.storyId
        || result.ownership.storyVersionId !== pkg.storyVersionId
        || result.ownership.executionPlanId !== pkg.executionPlanId
        || result.runtimeAuthorizationId !== pkg.runtimeAuthorizationId
        || result.sceneExecutionId !== predecessor.sceneExecutionId
        || result.inputAuthority.localPackageId
          !== predecessor.currentLocalGenerationPackageId
        || result.media.assetId
          !== predecessorAuthority.semantic.predecessorOutputAssetId
        || result.media.contentHash
          !== predecessorAuthority.semantic.predecessorOutputContentHash
        || decision.generationResultId !== result.generationResultId
        || decision.decision !== "APPROVED"
        || decision.postQcEvaluationId !== qc.postQcEvaluationId
        || qc.orgId !== pkg.organizationId
        || qc.workspaceId !== pkg.workspaceId
        || qc.generationResultId !== result.generationResultId
        || !postQcAllowsHumanApproval(qc)
        || frame.frameAssetId
          !== predecessorAuthority.semantic.continuityFrameAssetId
        || frame.contentHash
          !== predecessorAuthority.semantic.continuityFrameContentHash
        || frame.sourceContentHash !== result.media.contentHash
        || frame.extractionContractVersion
          !== predecessorAuthority.semantic.extractionContractVersion
        || frame.orgId !== pkg.organizationId
        || frame.workspaceId !== pkg.workspaceId
      ) {
        throw new Error("SEQUENTIAL_LOCAL_PREDECESSOR_AUTHORITY_STALE");
      }
      const repository = new AiStoryLocalGenerationRepository(
        tx as unknown as Db,
      );
      const accepted = await repository.insertOrConverge({
        packages: [pkg],
        createdBy: input.actorUserId,
      });
      if (exactReleasedReplay) {
        return { package: accepted.packages[0]!, replayed: true };
      }
      const [released] = await tx.update(schema.aiStorySceneReleaseStates).set({
        releaseState: "RELEASED",
        releaseAuthorityId: pkg.releaseAuthority.releaseAuthorityId,
        releaseAuthorityFingerprint:
          pkg.releaseAuthority.semanticFingerprint,
        predecessorAuthorityFingerprint:
          predecessorAuthority.semanticFingerprint,
        gateGenerationResultId: result.generationResultId,
        gateGenerationResultDecisionId: decision.decisionId,
        currentLocalGenerationPackageId: pkg.packageId,
        releaseStage: pkg.order,
        releasedBy: input.actorUserId,
        releasedAt: new Date(pkg.releaseAuthority.audit.releasedAt),
        gateSceneExecutionId: predecessor.sceneExecutionId,
        gateProviderAttemptId: null,
        gateSceneResultId: null,
        updatedAt: new Date(pkg.releaseAuthority.audit.releasedAt),
      }).where(and(
        eq(
          schema.aiStorySceneReleaseStates.workspaceId,
          pkg.workspaceId,
        ),
        eq(
          schema.aiStorySceneReleaseStates.executionPlanId,
          pkg.executionPlanId,
        ),
        eq(
          schema.aiStorySceneReleaseStates.sceneExecutionId,
          pkg.sceneExecutionId,
        ),
        eq(
          schema.aiStorySceneReleaseStates.releaseState,
          "WAITING_FOR_PREDECESSOR",
        ),
        eq(
          schema.aiStorySceneReleaseStates.releaseRevision,
          pkg.releaseAuthority.semantic.releaseRevision,
        ),
      )).returning();
      if (!released) throw new Error("SEQUENTIAL_LOCAL_RELEASE_STATE_CONFLICT");
      return { package: accepted.packages[0]!, replayed: accepted.replayed };
    });
  }
}
