/**
 * Sprint 3 PR 3.7 Phase E — GET product runtime projection.
 *
 * GET /api/campaigns/:id/ai-stories/:storyId/execution-plans/:executionPlanId/runtime
 *
 * Read-only. Zero execution side effects.
 */
import { deriveProductRuntimeProjection } from "@ceo-agent/agents";
import { getWorkspaceMembership } from "@ceo-agent/db";
import {
  PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS,
  ProductRuntimeProjectionSchema,
} from "@ceo-agent/shared";
import { apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { mintSceneResultPlayback } from "@/lib/ai-story-scene-media-playback";
import {
  executionPlanRouteErrorResponse,
  resolveAuthorizedExecutionPlan,
} from "@/lib/ai-story-execution-plan-access";

type RouteParams = {
  params: Promise<{ id: string; storyId: string; executionPlanId: string }>;
};

const PLAYBACK_SIGNING_TIMEOUT_MS = 8_000;

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Scene media signing timed out")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function correlationId(request: Request): string {
  const supplied = request.headers.get("x-emberos-request-correlation-id")?.trim();
  return supplied && supplied.length <= 128 ? supplied : crypto.randomUUID();
}

function assertNoForbiddenKeys(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  for (const key of PRODUCT_RUNTIME_FORBIDDEN_RESPONSE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`Forbidden runtime response key leaked: ${key}`);
    }
  }
}

export async function GET(request: Request, { params }: RouteParams) {
  const requestCorrelationId = correlationId(request);
  const startedAt = performance.now();
  const timings: Record<string, number> = {};
  const mark = (name: string, since: number) => {
    timings[name] = Math.round(performance.now() - since);
  };
  try {
    let stageStartedAt = performance.now();
    const user = await requireAuth();
    mark("auth_ms", stageStartedAt);
    stageStartedAt = performance.now();
    const { id: campaignId, storyId, executionPlanId } = await params;
    mark("request_parse_ms", stageStartedAt);

    stageStartedAt = performance.now();
    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "client_viewer",
    });
    mark("workspace_authorization_ms", stageStartedAt);

    stageStartedAt = performance.now();
    const membership = await getWorkspaceMembership(ctx.workspaceId, user.id);
    const projection = await deriveProductRuntimeProjection({
      executionPlanId: ctx.executionPlanId,
      callerRole: membership?.role ?? null,
    });
    mark("runtime_projection_ms", stageStartedAt);

    stageStartedAt = performance.now();
    const generatedSceneReviews = await Promise.all(
      (projection.generatedSceneReviews ?? []).map(async (scene) => {
        if (!scene.generatedMedia) return scene;
        try {
          const delivery = await withDeadline(
            mintSceneResultPlayback({
              workspaceId: ctx.workspaceId,
              executionPlanId: ctx.executionPlanId,
              sceneExecutionId: scene.sceneExecutionId,
              providerAttemptId: scene.generatedMedia.providerAttemptId,
              sceneResultId: scene.generatedMedia.sceneResultId,
            }),
            PLAYBACK_SIGNING_TIMEOUT_MS
          );
          return {
            ...scene,
            generatedMedia: {
              ...scene.generatedMedia,
              ...delivery,
              deliveryStatus: "READY" as const,
              safeError: null,
            },
          };
        } catch {
          return {
            ...scene,
            generatedMedia: {
              ...scene.generatedMedia,
              deliveryUrl: null,
              expiresAt: null,
              deliveryStatus: "UNAVAILABLE" as const,
              safeError: "Scene media preview is temporarily unavailable.",
            },
          };
        }
      })
    );
    mark("private_signing_ms", stageStartedAt);
    stageStartedAt = performance.now();
    const deliveredProjection = ProductRuntimeProjectionSchema.parse({
      ...projection,
      generatedSceneReviews,
    });
    mark("response_serialization_ms", stageStartedAt);

    assertNoForbiddenKeys(deliveredProjection);
    timings.total_request_ms = Math.round(performance.now() - startedAt);
    console.info("ai_story_runtime_read", {
      requestCorrelationId,
      storyId,
      executionPlanId,
      timings,
      outcome: "success",
    });
    const response = apiSuccess(deliveredProjection);
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  } catch (error) {
    timings.total_request_ms = Math.round(performance.now() - startedAt);
    console.error("ai_story_runtime_read_failed", {
      requestCorrelationId,
      timings,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    const response = executionPlanRouteErrorResponse(error) ?? handleApiError(error);
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  }
}
