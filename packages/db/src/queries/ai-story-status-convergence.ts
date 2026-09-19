/**
 * Persist Story status as a projection of canonical runtime authority.
 *
 * Loads Scene Result / Generated Scene Review / runtime-entry evidence only.
 * Never reads Provider Attempt.status, timestamps-as-status, commercial rows,
 * or Scene review decisions for mutation. Idempotent compare-and-set write.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  assertAiStoryTransition,
  projectAiStoryStatusFromRuntimeAuthority,
  type AiStoryStatus,
  type AiStoryStatusConvergenceProjection,
  type GeneratedSceneReviewState,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export type ConvergeAiStoryStatusInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storyId: string;
};

export type ConvergedAiStoryStatus = AiStoryStatusConvergenceProjection & {
  readonly story: typeof schema.aiStories.$inferSelect;
};

function isGeneratedSceneReviewDecision(
  value: string
): value is GeneratedSceneReviewState {
  return (
    value === "PENDING_REVIEW" ||
    value === "REJECTED" ||
    value === "APPROVED" ||
    value === "RETRY_REQUESTED" ||
    value === "REJECTED_TERMINAL"
  );
}

function isAiStoryStatus(value: string): value is AiStoryStatus {
  return (
    value === "draft" ||
    value === "generating" ||
    value === "review" ||
    value === "approved" ||
    value === "ready_for_animation" ||
    value === "planning" ||
    value === "planning_review" ||
    value === "ready_for_execution" ||
    value === "generate_review" ||
    value === "executing" ||
    value === "execution_review" ||
    value === "execution_failed" ||
    value === "failed" ||
    value === "archived"
  );
}

export async function convergeAiStoryStatusFromRuntimeAuthority(
  db: QueryDb,
  input: ConvergeAiStoryStatusInput
): Promise<ConvergedAiStoryStatus> {
  const [story] = await db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, input.storyId),
        eq(schema.aiStories.orgId, input.orgId),
        eq(schema.aiStories.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (!story || !isAiStoryStatus(story.status)) {
    throw new Error("AI Story not found for runtime status convergence");
  }

  const [plan] = await db
    .select({
      id: schema.aiStoryExecutionPlans.id,
    })
    .from(schema.aiStoryExecutionPlans)
    .where(
      and(
        eq(schema.aiStoryExecutionPlans.storyId, input.storyId),
        eq(schema.aiStoryExecutionPlans.orgId, input.orgId),
        eq(schema.aiStoryExecutionPlans.workspaceId, input.workspaceId)
      )
    )
    .orderBy(desc(schema.aiStoryExecutionPlans.createdAt))
    .limit(1);

  const scenes = plan
    ? await db
        .select({
          id: schema.aiStorySceneExecutions.id,
          status: schema.aiStorySceneExecutions.status,
        })
        .from(schema.aiStorySceneExecutions)
        .where(
          and(
            eq(schema.aiStorySceneExecutions.executionPlanId, plan.id),
            eq(schema.aiStorySceneExecutions.workspaceId, input.workspaceId)
          )
        )
    : [];
  const sceneIds = scenes.map((scene) => scene.id);

  const results = sceneIds.length
    ? await db
        .select({
          sceneResultId: schema.aiStorySceneResults.sceneResultId,
          sceneExecutionId: schema.aiStorySceneResults.sceneExecutionId,
          providerAttemptId: schema.aiStorySceneResults.providerAttemptId,
          status: schema.aiStorySceneResults.status,
          projectedAt: schema.aiStorySceneResults.projectedAt,
        })
        .from(schema.aiStorySceneResults)
        .where(
          and(
            eq(schema.aiStorySceneResults.workspaceId, input.workspaceId),
            inArray(schema.aiStorySceneResults.sceneExecutionId, sceneIds)
          )
        )
    : [];

  const reviews = sceneIds.length
    ? await db
        .select({
          sceneExecutionId: schema.aiStoryGeneratedSceneReviews.sceneExecutionId,
          providerAttemptId: schema.aiStoryGeneratedSceneReviews.providerAttemptId,
          sceneResultId: schema.aiStoryGeneratedSceneReviews.sceneResultId,
          decision: schema.aiStoryGeneratedSceneReviews.decision,
          createdAt: schema.aiStoryGeneratedSceneReviews.createdAt,
        })
        .from(schema.aiStoryGeneratedSceneReviews)
        .where(
          and(
            eq(schema.aiStoryGeneratedSceneReviews.storyId, input.storyId),
            eq(schema.aiStoryGeneratedSceneReviews.workspaceId, input.workspaceId),
            inArray(schema.aiStoryGeneratedSceneReviews.sceneExecutionId, sceneIds)
          )
        )
    : [];

  const releaseStates = plan
    ? await db
        .select({
          releaseState: schema.aiStorySceneReleaseStates.releaseState,
        })
        .from(schema.aiStorySceneReleaseStates)
        .where(
          and(
            eq(schema.aiStorySceneReleaseStates.executionPlanId, plan.id),
            eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId)
          )
        )
    : [];

  const [scheduling] = plan
    ? await db
        .select({
          correlationId: schema.aiStorySceneSchedulingCorrelations.correlationId,
        })
        .from(schema.aiStorySceneSchedulingCorrelations)
        .where(
          and(
            eq(schema.aiStorySceneSchedulingCorrelations.executionPlanId, plan.id),
            eq(schema.aiStorySceneSchedulingCorrelations.workspaceId, input.workspaceId),
            eq(schema.aiStorySceneSchedulingCorrelations.storyId, input.storyId)
          )
        )
        .limit(1)
    : [];

  const currentByScene = new Map<string, (typeof results)[number]>();
  for (const result of results) {
    const current = currentByScene.get(result.sceneExecutionId);
    if (!current || result.projectedAt > current.projectedAt) {
      currentByScene.set(result.sceneExecutionId, result);
    }
  }
  const currentResults = [...currentByScene.values()];
  let currentGeneratedSceneReviewDecision: GeneratedSceneReviewState | null = null;
  for (const result of currentResults) {
    const matching = reviews.filter(
      (review) =>
        (review.sceneResultId && review.sceneResultId === result.sceneResultId) ||
        (review.sceneExecutionId === result.sceneExecutionId &&
          review.providerAttemptId === result.providerAttemptId)
    );
    matching.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const decision = matching[0]?.decision;
    if (decision === "PENDING_REVIEW") {
      currentGeneratedSceneReviewDecision = "PENDING_REVIEW";
      break;
    }
    if (decision && isGeneratedSceneReviewDecision(decision) && !currentGeneratedSceneReviewDecision) {
      currentGeneratedSceneReviewDecision = decision;
    }
  }

  const enteredRuntime =
    currentResults.length > 0 ||
    Boolean(scheduling) ||
    releaseStates.some((row) => row.releaseState === "RELEASED") ||
    scenes.some((scene) => scene.status !== "PLANNED") ||
    reviews.length > 0;

  const failedBeforeHumanReview =
    currentGeneratedSceneReviewDecision !== "PENDING_REVIEW" &&
    currentResults.some((result) => result.status === "FAILED");

  const projection = projectAiStoryStatusFromRuntimeAuthority({
    currentStoryStatus: story.status,
    archived: story.status === "archived" || Boolean(story.archivedAt),
    hasActiveCanonicalExecutionPlan: Boolean(plan),
    hasSceneEnteredProviderOrRuntimeExecution: enteredRuntime,
    hasCurrentSceneResult: currentResults.length > 0,
    currentGeneratedSceneReviewDecision,
    hasCanonicalExecutionFailureBeforeHumanReview: failedBeforeHumanReview,
  });

  if (!projection.changed) {
    return { ...projection, story };
  }

  assertAiStoryTransition(projection.from, projection.to);
  await db
    .update(schema.aiStories)
    .set({ status: projection.to, updatedAt: new Date() })
    .where(
      and(
        eq(schema.aiStories.id, input.storyId),
        eq(schema.aiStories.orgId, input.orgId),
        eq(schema.aiStories.workspaceId, input.workspaceId),
        eq(schema.aiStories.status, projection.from)
      )
    );

  const [persisted] = await db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, input.storyId),
        eq(schema.aiStories.workspaceId, input.workspaceId)
      )
    )
    .limit(1);

  return { ...projection, story: persisted ?? story };
}
