/**
 * Sprint 3 Phase 2B PR 2B.4 — non-authoritative Review + Assembly read model.
 * Combines repository projections; never mutates; never unlocks execution.
 */
import { asc, eq } from "drizzle-orm";
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryAiQcResultSchema,
  ExecutionPlanReviewAssemblyReadModelSchema,
  PHASE1_EXECUTION_LOCKED,
  ReviewHistoryReadModelSchema,
  type ExecutionPlanReadiness,
  type ExecutionPlanReviewAssemblyReadModel,
  type ReviewHistoryEvent,
  type ReviewHistoryReadModel,
  type SafeSceneQcSummary,
} from "@ceo-agent/shared";
import type { AuthorizedExecutionPlanContext } from "@/lib/ai-story-execution-plan-access";

function toSafeQc(result: unknown, resultHash: string): SafeSceneQcSummary | null {
  const parsed = AiStoryAiQcResultSchema.safeParse(result);
  if (!parsed.success) return null;
  const qc = parsed.data;
  const findings = qc.errors.map((finding) => ({
    code: finding.code,
    message: finding.message,
    severity: finding.severity,
  }));
  return {
    status: qc.status,
    resultHash,
    validatedAt: qc.validatedAt,
    findingCount: findings.length,
    blockingFindingCount: findings.filter((f) => f.severity === "blocking").length,
    findings,
  };
}

export function deriveExecutionPlanReadiness(input: {
  readonly reviewStatus: string;
  readonly hasDefinition: boolean;
  readonly membershipComplete: boolean;
  readonly orderingDeterministic: boolean;
  readonly scenesHaveNonBlockingQc: boolean;
}): ExecutionPlanReadiness {
  if (
    input.reviewStatus === "APPROVED" &&
    input.hasDefinition &&
    input.membershipComplete &&
    input.orderingDeterministic &&
    input.scenesHaveNonBlockingQc
  ) {
    return "READY_FOR_EXECUTION";
  }
  return "NOT_READY";
}

export async function buildExecutionPlanReviewAssemblyReadModel(
  ctx: AuthorizedExecutionPlanContext
): Promise<ExecutionPlanReviewAssemblyReadModel> {
  const reviewRepo = new ExecutionPlanReviewRepository(ctx.db);
  const assemblyRepo = new ExecutionPlanAssemblyRepository(ctx.db);
  const persistence = new AiStorySceneExecutionPersistenceRepository(ctx.db);

  const review = await reviewRepo.getLogicalProjection(ctx.executionPlanId);
  if (!review) {
    throw Object.assign(new Error("Execution Plan not found"), {
      code: "NOT_FOUND",
      status: 404,
    });
  }

  const assembly = await assemblyRepo.getProjection(ctx.executionPlanId);
  const persisted = await persistence.getByExecutionPlanId(ctx.executionPlanId);
  const scenes = persisted?.intents ?? [];

  const validationByScene = new Map<string, SafeSceneQcSummary | null>();
  for (const intent of scenes) {
    const rows = await ctx.db
      .select()
      .from(schema.aiStorySceneIntentValidationResults)
      .where(
        eq(
          schema.aiStorySceneIntentValidationResults.sceneExecutionId,
          intent.identity.sceneExecutionId
        )
      )
      .orderBy(asc(schema.aiStorySceneIntentValidationResults.acceptedAt));
    const latest = rows[rows.length - 1];
    validationByScene.set(
      intent.identity.sceneExecutionId,
      latest ? toSafeQc(latest.result, latest.resultHash) : null
    );
  }

  const sceneSummaries = scenes
    .slice()
    .sort((a, b) => a.identity.sceneOrder - b.identity.sceneOrder)
    .map((intent) => {
      const decision =
        review.latestSceneDecisionBySceneExecutionId[intent.identity.sceneExecutionId] ??
        null;
      return {
        sceneExecutionId: intent.identity.sceneExecutionId,
        sceneId: intent.identity.sceneId,
        sceneOrder: intent.identity.sceneOrder,
        instructionHash: intent.normalizedPayloadReference.contentHash,
        decision: decision?.decision ?? null,
        reviewedBy: decision?.reviewedBy ?? null,
        reviewedAt: decision?.reviewedAt ?? null,
        comment: decision?.rationale,
        qc: validationByScene.get(intent.identity.sceneExecutionId) ?? null,
      };
    });

  const scenesHaveNonBlockingQc = sceneSummaries.every(
    (scene) => scene.qc != null && scene.qc.status !== "failed"
  );

  const prerequisites = assembly?.prerequisites ?? {
    hasDefinition: false,
    membershipComplete: false,
    reviewApproved: review.status === "APPROVED",
    orderingDeterministic: false,
  };

  const readiness = deriveExecutionPlanReadiness({
    reviewStatus: review.status,
    hasDefinition: prerequisites.hasDefinition,
    membershipComplete: prerequisites.membershipComplete,
    orderingDeterministic: prerequisites.orderingDeterministic,
    scenesHaveNonBlockingQc,
  });

  return ExecutionPlanReviewAssemblyReadModelSchema.parse({
    executionPlan: {
      id: ctx.plan.id,
      status: "PERSISTED",
      orgId: ctx.plan.orgId,
      workspaceId: ctx.plan.workspaceId,
      campaignId: ctx.plan.campaignId,
      storyId: ctx.plan.storyId,
      storyVersionId: ctx.plan.storyVersionId,
      animationPackageId: ctx.plan.animationPackageId,
      readiness,
    },
    review: {
      status: review.status,
      openedAt: review.opened?.openedAt ?? null,
      openedBy: review.opened?.openedBy ?? null,
      scenes: sceneSummaries,
      storyDecision: review.storyDecision
        ? {
            decision: review.storyDecision.decision,
            reviewedBy: review.storyDecision.reviewedBy,
            reviewedAt: review.storyDecision.reviewedAt,
            comment: review.storyDecision.rationale,
          }
        : null,
    },
    assemblyDefinition: {
      status: assembly?.definition ? "PERSISTED" : "NOT_CREATED",
      id: assembly?.definition?.assemblyDefinitionId ?? null,
      sceneCount: assembly?.sceneCount ?? 0,
      integrityHash: assembly?.definition?.deterministicFingerprint ?? null,
      memberships: (assembly?.memberships ?? []).map((m) => ({
        membershipId: m.membershipId,
        sceneExecutionId: m.sceneExecutionId,
        sceneId: m.sceneId,
        sceneOrder: m.sceneOrder,
      })),
      prerequisites,
    },
    executionReadiness: readiness,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  });
}

export async function buildReviewHistoryReadModel(
  ctx: AuthorizedExecutionPlanContext
): Promise<ReviewHistoryReadModel> {
  const reviewRepo = new ExecutionPlanReviewRepository(ctx.db);
  const projection = await reviewRepo.getLogicalProjection(ctx.executionPlanId);
  if (!projection) {
    throw Object.assign(new Error("Execution Plan not found"), {
      code: "NOT_FOUND",
      status: 404,
    });
  }

  const events: ReviewHistoryEvent[] = [];

  if (projection.opened) {
    events.push({
      kind: "REVIEW_OPENED",
      at: projection.opened.openedAt,
      actorId: projection.opened.openedBy,
      factId: projection.opened.factId,
      derivedStatus: "UNDER_REVIEW",
    });
  }

  for (const decision of projection.sceneDecisions) {
    events.push({
      kind: "SCENE_DECISION",
      at: decision.reviewedAt,
      actorId: decision.reviewedBy,
      sceneExecutionId: decision.sceneExecutionId,
      sceneId: decision.sceneId,
      decision: decision.decision,
      comment: decision.rationale,
      factId: decision.factId,
    });
  }

  if (projection.storyDecision) {
    events.push({
      kind: "STORY_DECISION",
      at: projection.storyDecision.reviewedAt,
      actorId: projection.storyDecision.reviewedBy,
      decision: projection.storyDecision.decision,
      comment: projection.storyDecision.rationale,
      factId: projection.storyDecision.factId,
    });
  }

  events.push({
    kind: "STATUS_DERIVED",
    at: projection.derivedAt,
    actorId: null,
    derivedStatus: projection.status,
  });

  events.sort((a, b) => {
    if (a.at === b.at) {
      const order = ["REVIEW_OPENED", "SCENE_DECISION", "STORY_DECISION", "STATUS_DERIVED"];
      return order.indexOf(a.kind) - order.indexOf(b.kind);
    }
    return a.at < b.at ? -1 : 1;
  });

  return ReviewHistoryReadModelSchema.parse({
    executionPlanId: ctx.executionPlanId,
    events,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  });
}
