/**
 * EXEC-04 — authorize generated Scene review/retry writes.
 * Server derives product class. Client role/attemptNumber are not trusted.
 */
import {
  authorizeAiStoryExecution,
  GeneratedSceneReviewError,
  GeneratedSceneReviewService,
  DifferentiatedRetryService,
} from "@ceo-agent/agents";
import { isUuid, rejectForgedGeneratedSceneReviewBody } from "@ceo-agent/shared";
import {
  AiStoryPostGenerationQcRepository,
  GeneratedSceneReviewRepository,
} from "@ceo-agent/db";
import { resolveCanonicalWebExecuteProviderAuthority } from "@/lib/ai-story-canonical-execute-router";
import {
  resolveAuthorizedExecutionPlan,
  type AuthorizedExecutionPlanContext,
} from "@/lib/ai-story-execution-plan-access";

export { rejectForgedGeneratedSceneReviewBody };

export async function authorizeGeneratedSceneReviewWrite(input: {
  readonly user: { readonly id: string; readonly email?: string | null };
  readonly campaignId: string;
  readonly storyId: string;
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly clientClaims?: unknown;
}): Promise<AuthorizedExecutionPlanContext> {
  if (!isUuid(input.sceneExecutionId)) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_IDENTITY_FORGED",
      "Invalid Scene identity",
      400
    );
  }
  const ctx = await resolveAuthorizedExecutionPlan({
    userId: input.user.id,
    campaignId: input.campaignId,
    storyId: input.storyId,
    executionPlanId: input.executionPlanId,
    minRole: "operator",
  });
  return ctx;
}

export async function createdGeneratedSceneReviewService() {
  const providerRouting = await resolveCanonicalWebExecuteProviderAuthority();
  return new GeneratedSceneReviewService({
    router: providerRouting.router,
  });
}

/** Required Post-QC evidence is immutable, so a successful read is a stable gate. */
export async function assertGeneratedScenePostQcReviewEligibility(input: {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly workspaceId: string;
  readonly providerAttemptId?: string;
}): Promise<void> {
  const reviews = await new GeneratedSceneReviewRepository()
    .listByExecutionPlanId(input.executionPlanId);
  const pending = reviews.find((review) =>
    review.sceneExecutionId === input.sceneExecutionId &&
    review.decision === "PENDING_REVIEW" &&
    (!input.providerAttemptId || review.providerAttemptId === input.providerAttemptId)
  );
  if (!pending) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_REVIEW_NOT_FOUND",
      "Pending generated Scene review was not found",
      404
    );
  }
  const evaluations = await new AiStoryPostGenerationQcRepository()
    .getLatestByProviderAttemptIds({
      workspaceId: input.workspaceId,
      providerAttemptIds: [pending.providerAttemptId],
    });
  const evaluation = evaluations.get(pending.providerAttemptId);
  if (!evaluation?.eligibleForHumanReview) {
    throw new GeneratedSceneReviewError(
      "GENERATED_SCENE_POST_QC_REQUIRED",
      "Post-generation quality evidence is required before Human Review",
      409
    );
  }
}

export function createDifferentiatedRetryService() {
  return new DifferentiatedRetryService();
}
