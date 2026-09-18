/**
 * EXEC-04 — approve a specific generated Scene attempt.
 * POST .../scenes/:sceneExecutionId/attempts/:attemptId/approve
 */
import { authorizeAiStoryExecution, GeneratedSceneReviewError } from "@ceo-agent/agents";
import { AiStoryExecutionDeniedError } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse } from "@/lib/ai-story-execution-plan-access";
import {
  authorizeGeneratedSceneReviewWrite,
  assertGeneratedScenePostQcReviewEligibility,
  createdGeneratedSceneReviewService,
  rejectForgedGeneratedSceneReviewBody,
} from "@/lib/ai-story-generated-scene-review-access";

type RouteParams = {
  params: Promise<{
    id: string;
    storyId: string;
    executionPlanId: string;
    sceneExecutionId: string;
    attemptId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  const receivedCorrelation = request.headers.get("x-emberos-request-correlation-id");
  const requestCorrelationId =
    receivedCorrelation && /^[0-9a-f-]{36}$/i.test(receivedCorrelation)
      ? receivedCorrelation
      : crypto.randomUUID();
  const startedAt = performance.now();
  let stage = "request_parse";
  const respond = (response: Response) => {
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  };
  try {
    stage = "auth";
    const user = await requireAuth();
    const {
      id: campaignId,
      storyId,
      executionPlanId,
      sceneExecutionId,
      attemptId,
    } = await params;
    if (!attemptId || attemptId.trim().length < 1) {
      return respond(apiError("Invalid attempt identity", "VALIDATION_ERROR", 400));
    }

    const body = await request.json().catch(() => ({}));
    const forged = rejectForgedGeneratedSceneReviewBody(body);
    if (forged) {
      return respond(apiError(
        "Client-forged review identity is not accepted",
        "GENERATED_SCENE_IDENTITY_FORGED",
        422
      ));
    }

    stage = "workspace_authorization";
    const ctx = await authorizeGeneratedSceneReviewWrite({
      user,
      campaignId,
      storyId,
      executionPlanId,
      sceneExecutionId,
      clientClaims: body,
    });
    stage = "execution_authorization";
    const executionAuthorization = await authorizeAiStoryExecution({
      user,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      minRole: "operator",
      clientClaims: body,
    });
    stage = "post_qc_eligibility";
    await assertGeneratedScenePostQcReviewEligibility({
      executionPlanId: ctx.executionPlanId,
      sceneExecutionId,
      workspaceId: ctx.workspaceId,
      providerAttemptId: attemptId,
    });

    stage = "approval_transaction";
    const service = await createdGeneratedSceneReviewService();
    const result = await service.approve({
      executionPlanId: ctx.executionPlanId,
      sceneExecutionId,
      attemptId,
      actorUserId: user.id,
      workspaceId: ctx.workspaceId,
      executionAuthorization,
    });
    stage = "response_serialize";
    console.info("ai_story_scene_approval_completed", {
      requestCorrelationId,
      storyId,
      executionPlanId,
      sceneExecutionId,
      providerAttemptId: attemptId,
      reviewId: result.review.generatedSceneReviewId,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return respond(apiSuccess({ ...result, requestCorrelationId }));
  } catch (error) {
    console.error("ai_story_scene_approval_failed", {
      requestCorrelationId,
      stage,
      durationMs: Math.round(performance.now() - startedAt),
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof AiStoryExecutionDeniedError) {
      return respond(apiError(error.message, error.code, error.status));
    }
    if (error instanceof GeneratedSceneReviewError) {
      return respond(apiError(error.message, error.code, error.status));
    }
    return respond(executionPlanRouteErrorResponse(error) ?? handleApiError(error));
  }
}
