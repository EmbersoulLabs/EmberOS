import {
  AiStoryExecutionDeniedError,
  StagedSceneReleaseError,
  authorizeAiStoryExecution,
  releaseNextEligibleScene,
} from "@ceo-agent/agents";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { executionPlanRouteErrorResponse, resolveAuthorizedExecutionPlan } from "@/lib/ai-story-execution-plan-access";
import { resolveCanonicalWebExecuteProviderAuthority } from "@/lib/ai-story-canonical-execute-router";

type RouteParams = { params: Promise<{ id: string; storyId: string; executionPlanId: string }> };

function requestCorrelationId(request: Request): string {
  const supplied = request.headers.get("x-emberos-request-correlation-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

export async function POST(request: Request, { params }: RouteParams) {
  const correlationId = requestCorrelationId(request);
  const startedAt = performance.now();
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
    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id, campaignId, storyId, executionPlanId, minRole: "operator",
    });
    const executionAuthorization = await authorizeAiStoryExecution({
      user, orgId: ctx.orgId, workspaceId: ctx.workspaceId, minRole: "operator", clientClaims: {},
    });
    const providerRouting = await resolveCanonicalWebExecuteProviderAuthority();
    const result = await releaseNextEligibleScene({
      executionPlanId, workspaceId: ctx.workspaceId, actorUserId: user.id,
      executionAuthorization,
      router: providerRouting.router,
      routingPolicy: providerRouting.routingPolicy,
    });
    console.info("ai_story_next_scene_release_completed", {
      correlationId,
      executionPlanId,
      selectedSceneExecutionId: result.selectedSceneExecutionId,
      selectedSceneOrder: result.selectedSceneOrder,
      durationMs: Math.round(performance.now() - startedAt),
    });
    const response = apiSuccess({ ...result, correlationId }, 202);
    response.headers.set("x-emberos-request-correlation-id", correlationId);
    return response;
  } catch (error) {
    const response = error instanceof AiStoryExecutionDeniedError || error instanceof StagedSceneReleaseError
      ? apiError(error.message, error.code, error.status)
      : executionPlanRouteErrorResponse(error) ?? handleApiError(error);
    response.headers.set("x-emberos-request-correlation-id", correlationId);
    return response;
  }
}
