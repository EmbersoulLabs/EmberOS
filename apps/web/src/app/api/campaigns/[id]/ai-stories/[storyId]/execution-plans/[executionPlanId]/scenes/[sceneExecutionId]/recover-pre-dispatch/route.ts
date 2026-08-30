import { PreDispatchRecoveryRepositoryError } from "@ceo-agent/db";
import { authorizeAiStoryExecution } from "@ceo-agent/agents";
import { AiStoryExecutionDeniedError } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";
import { createPreDispatchRecoveryService } from "@/lib/ai-story-pre-dispatch-recovery";

type RouteParams = {
  params: Promise<{
    id: string;
    storyId: string;
    executionPlanId: string;
    sceneExecutionId: string;
  }>;
};

function correlationId(request: Request): string {
  const supplied = request.headers.get("x-emberos-request-correlation-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

export async function POST(request: Request, { params }: RouteParams) {
  const requestCorrelationId = correlationId(request);
  const startedAt = performance.now();
  try {
    const user = await requireAuth();
    const raw = await request.text();
    if (raw.trim()) {
      let body: unknown;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        return apiError("Invalid JSON body", "VALIDATION_ERROR", 422);
      }
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0) {
        return apiError("Recovery accepts an empty object only", "VALIDATION_ERROR", 422);
      }
    }
    const { id: campaignId, storyId, executionPlanId, sceneExecutionId } = await params;
    const context = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "operator",
    });
    await authorizeAiStoryExecution({
      user,
      orgId: context.orgId,
      workspaceId: context.workspaceId,
      minRole: "operator",
      clientClaims: {},
    });
    const result = await createPreDispatchRecoveryService().recover({
      executionPlanId,
      sceneExecutionId,
      orgId: context.orgId,
      workspaceId: context.workspaceId,
      actorUserId: user.id,
      idempotencyKey: `ai-story-pre-dispatch:${executionPlanId}:${sceneExecutionId}`,
      reason: "Human-authorized recovery from pre-provider grounding validation block",
    });
    console.info("ai_story_pre_dispatch_recovery_authorized", {
      requestCorrelationId,
      executionPlanId,
      sceneExecutionId,
      dispatchId: result.dispatchId,
      replayed: result.replayed,
      durationMs: Math.round(performance.now() - startedAt),
    });
    const response = apiSuccess({ ...result, requestCorrelationId }, result.replayed ? 200 : 202);
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  } catch (error) {
    const response = error instanceof PreDispatchRecoveryRepositoryError || error instanceof AiStoryExecutionDeniedError
      ? apiError(error.message, error.code, error.status)
      : executionPlanRouteErrorResponse(error) ?? handleApiError(error);
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  }
}
