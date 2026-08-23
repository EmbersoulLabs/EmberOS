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
import {
  RuntimeReadDeadlineError,
  RuntimeReadStageRecorder,
  SERVER_RUNTIME_DEADLINE_MS,
} from "@/lib/ai-story-runtime-read-observability";

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
  const deadline = new AbortController();
  const recorder = new RuntimeReadStageRecorder(deadline.signal);
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const timingResponse = (status: number, errorCode: string, message: string, timedOutStage?: string) =>
    Response.json({
      error: message,
      errorCode,
      correlationId: requestCorrelationId,
      lastCompletedStage: recorder.lastCompletedStage(),
      timedOutStage: timedOutStage ?? null,
      elapsedMs: recorder.elapsedMs(),
      stageTimings: recorder.snapshot(),
    }, { status, headers: { "x-emberos-request-correlation-id": requestCorrelationId } });

  const execute = async () => {
    const { id: campaignId, storyId, executionPlanId } = await recorder.run("request_parse", () => params);
    const user = await recorder.run("auth", () => requireAuth());

    const ctx = await resolveAuthorizedExecutionPlan({
      userId: user.id,
      campaignId,
      storyId,
      executionPlanId,
      minRole: "client_viewer",
      observeStage: (stage, operation) => recorder.run(stage, operation),
    });

    const membership = await recorder.run("workspace_authorization", () =>
      getWorkspaceMembership(ctx.workspaceId, user.id)
    );
    const projection = await deriveProductRuntimeProjection({
      executionPlanId: ctx.executionPlanId,
      callerRole: membership?.role ?? null,
      observeStage: (stage, operation) => recorder.run(stage, operation),
    });

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
              observeStage: (stage, operation) => recorder.run(stage, operation),
            }),
            PLAYBACK_SIGNING_TIMEOUT_MS
          );
          return { ...scene, generatedMedia: { ...scene.generatedMedia, ...delivery, deliveryStatus: "READY" as const, safeError: null } };
        } catch {
          return { ...scene, generatedMedia: { ...scene.generatedMedia, deliveryUrl: null, expiresAt: null, deliveryStatus: "UNAVAILABLE" as const, safeError: "Scene media preview is temporarily unavailable." } };
        }
      })
    );
    const deliveredProjection = await recorder.run("response_schema_validation", async () =>
      ProductRuntimeProjectionSchema.parse({ ...projection, generatedSceneReviews })
    );
    assertNoForbiddenKeys(deliveredProjection);
    const response = await recorder.run("response_serialization", async () => apiSuccess(deliveredProjection));
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return { response, storyId, executionPlanId };
  };

  try {
    const result = await Promise.race([
      execute(),
      new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          const timedOutStage = recorder.markTimedOut();
          deadline.abort();
          reject(new RuntimeReadDeadlineError(timedOutStage, recorder.elapsedMs()));
        }, SERVER_RUNTIME_DEADLINE_MS);
      }),
    ]);
    console.info("ai_story_runtime_read_timing", {
      requestCorrelationId,
      storyId: result.storyId,
      executionPlanId: result.executionPlanId,
      totalDurationMs: recorder.elapsedMs(),
      runtime_projection_ms: recorder.duration("runtime_projection_build"),
      private_signing_ms: recorder.duration("media_playback_resolution"),
      total_request_ms: recorder.elapsedMs(),
      lastCompletedStage: recorder.lastCompletedStage(),
      timedOutStage: null,
      stageTimings: recorder.snapshot(),
      outcome: "success",
    });
    return result.response;
  } catch (error) {
    const timedOutStage = error instanceof RuntimeReadDeadlineError ? error.timedOutStage : null;
    console.error("ai_story_runtime_read_timing", {
      requestCorrelationId,
      totalDurationMs: recorder.elapsedMs(),
      runtime_projection_ms: recorder.duration("runtime_projection_build"),
      private_signing_ms: recorder.duration("media_playback_resolution"),
      total_request_ms: recorder.elapsedMs(),
      lastCompletedStage: recorder.lastCompletedStage(),
      timedOutStage,
      stageTimings: recorder.snapshot(),
      outcome: timedOutStage ? "timeout" : "failure",
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    if (error instanceof RuntimeReadDeadlineError) {
      return timingResponse(504, error.code, error.message, error.timedOutStage);
    }
    const response = executionPlanRouteErrorResponse(error) ?? handleApiError(error);
    response.headers.set("x-emberos-request-correlation-id", requestCorrelationId);
    return response;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
  }
}
