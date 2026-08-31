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

export function createDifferentiatedRetryService() {
  return new DifferentiatedRetryService();
}
