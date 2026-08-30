/**
 * EXEC-04 — retry the same Scene as a new provider attempt.
 * POST .../scenes/:sceneExecutionId/retry
 */
import { authorizeAiStoryExecution, GeneratedSceneReviewError } from "@ceo-agent/agents";
import { AiStoryExecutionDeniedError } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse } from "@/lib/ai-story-execution-plan-access";
import {
  authorizeGeneratedSceneReviewWrite,
  createdGeneratedSceneReviewService,
  rejectForgedGeneratedSceneReviewBody,
} from "@/lib/ai-story-generated-scene-review-access";

type RouteParams = {
  params: Promise<{
    id: string;
    storyId: string;
    executionPlanId: string;
    sceneExecutionId: string;
  }>;
};

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } =
      await params;
    const body = await request.json().catch(() => ({}));
    const retryAuthorizationId =
      body && typeof body === "object" && typeof (body as { retryAuthorizationId?: unknown }).retryAuthorizationId === "string"
        ? (body as { retryAuthorizationId: string }).retryAuthorizationId
        : null;
    if (!retryAuthorizationId) {
      return apiError("Human retry authorization is required", "GENERATED_SCENE_RETRY_NOT_ELIGIBLE", 409);
    }
    const forged = rejectForgedGeneratedSceneReviewBody(body);
    if (forged) {
      return apiError(
        "Client-forged review identity is not accepted",
        "GENERATED_SCENE_IDENTITY_FORGED",
        422
      );
    }

    const ctx = await authorizeGeneratedSceneReviewWrite({
      user,
      campaignId,
      storyId,
      executionPlanId,
      sceneExecutionId,
      clientClaims: body,
    });
    const executionAuthorization = await authorizeAiStoryExecution({
      user,
      orgId: ctx.orgId,
      workspaceId: ctx.workspaceId,
      minRole: "operator",
      clientClaims: body,
    });

    const result = await createdGeneratedSceneReviewService().retry({
      executionPlanId: ctx.executionPlanId,
      sceneExecutionId,
      actorUserId: user.id,
      workspaceId: ctx.workspaceId,
      executionAuthorization,
      retryAuthorizationId,
    });
    return apiSuccess(result);
  } catch (error) {
    if (error instanceof AiStoryExecutionDeniedError) {
      return apiError(error.message, error.code, error.status);
    }
    if (error instanceof GeneratedSceneReviewError) {
      return apiError(error.message, error.code, error.status);
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
