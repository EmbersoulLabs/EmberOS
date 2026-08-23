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

  constructor(message: string, code: string, status: number, requestCorrelationId: string | null = null) {
    super(message);
    this.name = "StoryRuntimeClientError";
    this.code = code;
    this.status = status;
    this.requestCorrelationId = requestCorrelationId;
  }
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
    throw new StoryRuntimeClientError(
      typeof body.error === "string" ? body.error : "Request failed",
      typeof body.code === "string" ? body.code : "UNKNOWN",
      res.status,
      responseCorrelationId
    );
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
