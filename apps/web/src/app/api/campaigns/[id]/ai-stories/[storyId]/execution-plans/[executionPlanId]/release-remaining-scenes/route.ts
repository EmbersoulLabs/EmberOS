import {
  AiStoryExecutionDeniedError,
  StagedSceneReleaseError,
  authorizeAiStoryExecution,
  releaseRemainingScenes,
  resolveCanonicalExecuteRoutingPolicy,
} from "@ceo-agent/agents";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse, resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { createCanonicalExecuteProviderRouter } from "@/lib/ai-story-canonical-execute-router";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string }> };

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const user = await requireAuth();
    const raw = await request.text();
    if (raw.trim()) {
      try {
        const body = JSON.parse(raw) as unknown;
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
          return apiError("Release accepts an empty object only", "VALIDATION_ERROR", 422);
        }
      } catch {
        return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
      }
    }
    const { id: campaignId, storyId, executionPlanId } = await params;
    const ctx = await resolveAuthorizedExecutionPlan({ userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator" });
    const executionAuthorization = await authorizeAiStoryExecution({
      user, orgId: ctx.orgId, workspaceId: ctx.workspaceId, minRole: "operator", clientClaims: {},
    });
    const result = await releaseRemainingScenes({
      executionPlanId, workspaceId: ctx.workspaceId, actorUserId: user.id,
      executionAuthorization,
      router: createCanonicalExecuteProviderRouter(),
      routingPolicy: resolveCanonicalExecuteRoutingPolicy(),
    });
    return apiSuccess(result, result.converged ? 200 : 202);
  } catch (error) {
    if (error instanceof AiStoryExecutionDeniedError || error instanceof StagedSceneReleaseError) {
      return apiError(error.message, error.code, error.status);
    }
    return executionPlanRouteErrorResponse(error) ?? handleApiError(error);
  }
}
