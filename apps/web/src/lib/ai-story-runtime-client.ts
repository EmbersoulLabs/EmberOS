/**
 * Sprint 3 PR 3.7 Phase E — browser client for runtime status + FSR + canonical Execute.
 * Calls only approved HTTP APIs. Never imports agents/db runtime modules.
 */
import type {
  CanonicalExecuteResponse,
  FinalStoryResultReadModel,
  ProductRuntimeProjection,
} from "@ceo-agent/shared";

export class StoryRuntimeClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestCorrelationId: string | null;
  readonly timeoutTrace: AiStoryRuntimeReadTimeoutTrace | null;

  constructor(message: string, code: string, status: number, requestCorrelationId: string | null = null, timeoutTrace: AiStoryRuntimeReadTimeoutTrace | null = null) {
    super(message);
    this.name = "StoryRuntimeClientError";
    this.code = code;
    this.status = status;
    this.requestCorrelationId = requestCorrelationId;
    this.timeoutTrace = timeoutTrace;
  }
}

export type AiStoryRuntimeReadStageTiming = {
  readonly stage: string;
  readonly startedAt: number | null;
  readonly durationMs: number | null;
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
};

export type AiStoryRuntimeReadTimeoutTrace = {
  readonly errorCode: "AI_STORY_RUNTIME_READ_TIMEOUT";
  readonly correlationId: string | null;
  readonly elapsedMs: number;
  readonly lastCompletedStage: string | null;
  readonly timedOutStage: string | null;
  readonly stageTimings: readonly AiStoryRuntimeReadStageTiming[];
  readonly executionPlanReviewTraceVersion: string | null;
  readonly generatedSceneReviewStageTimings: readonly AiStoryRuntimeReadSubstageTiming[];
  readonly executionPlanReviewStageTimings: readonly AiStoryRuntimeReadSubstageTiming[];
  readonly storyLoadStageTimings: readonly AiStoryRuntimeReadSubstageTiming[];
  readonly executionPlanLoadStageTimings: readonly AiStoryRuntimeReadSubstageTiming[];
  readonly routeOwnershipValidationStageTimings: readonly AiStoryRuntimeReadSubstageTiming[];
  readonly generatedSceneReviewPathTrace: readonly AiStoryRuntimeReviewPathMarker[];
};

export type AiStoryRuntimeReviewPathMarker = {
  readonly marker: string;
  readonly correlationId: string;
  readonly executionPlanId: string | null;
  readonly releaseRevision: string;
  readonly elapsedMs: number;
  readonly sourceModule: string;
  readonly sourceFunction: string;
  readonly traceVersion: string;
};

export type AiStoryRuntimeReadSubstageTiming = {
  readonly stage: string;
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: number;
  readonly roundTripCount: number;
  readonly rowCount: number | null;
  readonly planReadPhaseTiming?: {
    readonly remainingRuntimeBudgetMsAtEntry: number | null;
    readonly poolWaitMs: number | null;
    readonly dbExecutionMs: number | null;
    readonly appWallMs: number | null;
    readonly responseBytesApprox: number | null;
  };
  readonly ownershipQueryPhaseTiming?: {
    readonly remainingRuntimeBudgetMsAtEntry: number | null;
    readonly connectionAcquireMs: number | null;
    readonly poolWaitMs: number | null;
    readonly queryDispatchMs: number | null;
    readonly dbExecutionMs: number | null;
    readonly networkReturnMs: number | null;
    readonly dbExecutionAndNetworkMs: number | null;
    readonly rowDecodeMs: number | null;
    readonly totalWallMs: number | null;
  };
};

export function parseRuntimeTimeoutTrace(body: Record<string, unknown>, correlationId: string | null): AiStoryRuntimeReadTimeoutTrace | null {
  if (body.errorCode !== "AI_STORY_RUNTIME_READ_TIMEOUT" || typeof body.elapsedMs !== "number" || !Array.isArray(body.stageTimings)) return null;
  const stageTimings = body.stageTimings.filter((row): row is AiStoryRuntimeReadStageTiming => {
    if (!row || typeof row !== "object") return false;
    const value = row as Record<string, unknown>;
    return typeof value.stage === "string" && ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status));
  });
  const generatedSceneReviewStageTimings = Array.isArray(body.generatedSceneReviewStageTimings)
    ? body.generatedSceneReviewStageTimings.filter((row): row is AiStoryRuntimeReadSubstageTiming => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.stage === "string" &&
          ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status)) &&
          typeof value.queryCount === "number" &&
          typeof value.roundTripCount === "number";
      })
    : [];
  const executionPlanReviewStageTimings = Array.isArray(body.executionPlanReviewStageTimings)
    ? body.executionPlanReviewStageTimings.filter((row): row is AiStoryRuntimeReadSubstageTiming => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.stage === "string" &&
          ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status)) &&
          typeof value.queryCount === "number" &&
          typeof value.roundTripCount === "number";
      })
    : [];
  const executionPlanLoadStageTimings = Array.isArray(body.executionPlanLoadStageTimings)
    ? body.executionPlanLoadStageTimings.filter((row): row is AiStoryRuntimeReadSubstageTiming => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.stage === "string" &&
          ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status)) &&
          typeof value.queryCount === "number" && typeof value.roundTripCount === "number";
      })
    : [];
  const storyLoadStageTimings = Array.isArray(body.storyLoadStageTimings)
    ? body.storyLoadStageTimings.filter((row): row is AiStoryRuntimeReadSubstageTiming => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.stage === "string" &&
          ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status)) &&
          typeof value.queryCount === "number" && typeof value.roundTripCount === "number";
      })
    : [];
  const routeOwnershipValidationStageTimings = Array.isArray(body.routeOwnershipValidationStageTimings)
    ? body.routeOwnershipValidationStageTimings.filter((row): row is AiStoryRuntimeReadSubstageTiming => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.stage === "string" &&
          ["COMPLETED", "TIMED_OUT", "FAILED", "NOT_REACHED"].includes(String(value.status)) &&
          typeof value.queryCount === "number" && typeof value.roundTripCount === "number";
      })
    : [];
  const generatedSceneReviewPathTrace = Array.isArray(body.generatedSceneReviewPathTrace)
    ? body.generatedSceneReviewPathTrace.filter((row): row is AiStoryRuntimeReviewPathMarker => {
        if (!row || typeof row !== "object") return false;
        const value = row as Record<string, unknown>;
        return typeof value.marker === "string" &&
          typeof value.correlationId === "string" &&
          typeof value.releaseRevision === "string" &&
          typeof value.elapsedMs === "number" &&
          typeof value.sourceModule === "string" &&
          typeof value.sourceFunction === "string" &&
          typeof value.traceVersion === "string";
      })
    : [];
  return {
    errorCode: "AI_STORY_RUNTIME_READ_TIMEOUT",
    correlationId,
    elapsedMs: body.elapsedMs,
    lastCompletedStage: typeof body.lastCompletedStage === "string" ? body.lastCompletedStage : null,
    timedOutStage: typeof body.timedOutStage === "string" ? body.timedOutStage : null,
    stageTimings,
    executionPlanReviewTraceVersion:
      typeof body.executionPlanReviewTraceVersion === "string"
        ? body.executionPlanReviewTraceVersion
        : null,
    generatedSceneReviewStageTimings,
    executionPlanReviewStageTimings,
    storyLoadStageTimings,
    executionPlanLoadStageTimings,
    routeOwnershipValidationStageTimings,
    generatedSceneReviewPathTrace,
  };
}

function plansBase(campaignId: string, storyId: string, executionPlanId: string): string {
  return `/api/campaigns/${campaignId}/ai-stories/${storyId}/execution-plans/${executionPlanId}`;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const RUNTIME_READ_TIMEOUT_MS = 20_000;

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  const body = await parseJson(res);
  const requestCorrelationId =
    res.headers.get("x-emberos-request-correlation-id") ??
    (typeof body.requestCorrelationId === "string" ? body.requestCorrelationId : null);
  if (!res.ok) {
    throw new StoryRuntimeClientError(
      typeof body.error === "string" ? body.error : "Request failed",
      typeof body.code === "string" ? body.code : "UNKNOWN",
      res.status,
      requestCorrelationId
    );
  }
  return body as T;
}

async function requestRuntimeRead<T>(input: string): Promise<T> {
  const requestCorrelationId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_READ_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(input, {
      credentials: "same-origin",
      signal: controller.signal,
      headers: {
        "x-emberos-request-correlation-id": requestCorrelationId,
      },
    });
  } catch (error) {
    const timedOut = controller.signal.aborted;
    throw new StoryRuntimeClientError(
      timedOut
        ? "Story review is taking too long to load. Retry this read-only request."
        : "Story review could not be loaded. Check the connection and retry.",
      timedOut ? "RUNTIME_READ_TIMEOUT" : "RUNTIME_READ_NETWORK_ERROR",
      0,
      requestCorrelationId
    );
  } finally {
    clearTimeout(timeout);
  }
  const body = await parseJson(res);
  const responseCorrelationId =
    res.headers.get("x-emberos-request-correlation-id") ??
    (typeof body.requestCorrelationId === "string" ? body.requestCorrelationId : requestCorrelationId);
  if (!res.ok) {
    const timeoutTrace = parseRuntimeTimeoutTrace(body, responseCorrelationId);
    if (timeoutTrace) {
      console.info("ai_story_runtime_read_timeout", JSON.stringify(timeoutTrace));
    }
    throw new StoryRuntimeClientError(
      typeof body.error === "string" ? body.error : "Request failed",
      typeof body.errorCode === "string"
        ? body.errorCode
        : typeof body.code === "string" ? body.code : "UNKNOWN",
      res.status,
      responseCorrelationId,
      timeoutTrace
    );
  }
  const reviewProjectionTiming = res.headers.get("x-emberos-review-projection-timing");
  if (reviewProjectionTiming) {
    console.info("ai_story_generated_scene_review_read_timing", reviewProjectionTiming);
  }
  return body as T;
}

export async function getProductRuntimeProjection(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<ProductRuntimeProjection> {
  return requestRuntimeRead(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/runtime"
  );
}

export async function postCanonicalExecute(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<CanonicalExecuteResponse & { readonly httpStatus?: number }> {
  const res = await fetch(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/execute",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  const body = await parseJson(res);
  if (!res.ok) {
    throw new StoryRuntimeClientError(
      typeof body.error === "string" ? body.error : "Execute failed",
      typeof body.code === "string" ? body.code : "UNKNOWN",
      res.status
    );
  }
  return { ...(body as CanonicalExecuteResponse), httpStatus: res.status };
}

export async function postReleaseRemainingScenes(input: {
  campaignId: string; storyId: string; executionPlanId: string;
}): Promise<void> {
  await requestJson(plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/release-remaining-scenes", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
}

export async function postReleaseNextEligibleScene(input: {
  campaignId: string; storyId: string; executionPlanId: string;
}): Promise<{
  selectedSceneExecutionId: string;
  selectedSceneOrder: number;
  correlationId: string;
}> {
  return requestJson(plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/release-next-scene", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
  });
}

export async function postGeneratedSceneReviewDecision(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  sceneExecutionId: string;
  action: "approve" | "retry" | "reject";
  attemptId?: string;
}): Promise<void> {
  const base = `${plansBase(input.campaignId, input.storyId, input.executionPlanId)}/scenes/${input.sceneExecutionId}`;
  const path =
    input.action === "approve"
      ? `${base}/attempts/${input.attemptId}/approve`
      : `${base}/${input.action}`;
  const requestCorrelationId = crypto.randomUUID();
  await requestJson(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-emberos-request-correlation-id": requestCorrelationId,
    },
    body: JSON.stringify({}),
  });
}

export async function getFinalStoryResultReadModel(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<FinalStoryResultReadModel> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) +
      "/final-story-result"
  );
}

export async function createFinalStoryDownload(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<import("@ceo-agent/shared").FinalStoryResultDeliveryModel> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/final-story-result/download",
    { method: "POST" }
  );
}
