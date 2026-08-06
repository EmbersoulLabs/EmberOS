/**
 * Sprint 3 Phase 2B PR 2B.5 — browser client for approved PR 2B.4 Review & Assembly APIs.
 * Never calls repositories. Never unlocks execution.
 */
import type {
  ExecutionPlanReviewAssemblyReadModel,
  HumanReviewDecision,
  ReviewHistoryReadModel,
} from "@ceo-agent/shared";

export type ReviewAssemblyApiError = {
  readonly error: string;
  readonly code: string;
  readonly status: number;
};

export class ReviewAssemblyClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ReviewAssemblyClientError";
    this.code = code;
    this.status = status;
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

async function requestJson<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);
  const body = await parseJson(res);
  if (!res.ok) {
    throw new ReviewAssemblyClientError(
      typeof body.error === "string" ? body.error : "Request failed",
      typeof body.code === "string" ? body.code : "UNKNOWN",
      res.status
    );
  }
  return body as T;
}

export async function getReviewReadModel(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<ExecutionPlanReviewAssemblyReadModel> {
  return requestJson(plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/review");
}

export async function openReview(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<ExecutionPlanReviewAssemblyReadModel & { opened?: unknown }> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/review",
    { method: "POST" }
  );
}

export async function postSceneDecision(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  sceneExecutionId: string;
  decision: HumanReviewDecision;
  comment?: string;
}): Promise<Record<string, unknown>> {
  return requestJson(
    `${plansBase(input.campaignId, input.storyId, input.executionPlanId)}/review/scenes/${input.sceneExecutionId}/decisions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: input.decision,
        ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
      }),
    }
  );
}

export async function postStoryDecision(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
  decision: HumanReviewDecision;
  comment?: string;
}): Promise<Record<string, unknown>> {
  return requestJson(
    `${plansBase(input.campaignId, input.storyId, input.executionPlanId)}/review/decisions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: input.decision,
        ...(input.comment?.trim() ? { comment: input.comment.trim() } : {}),
      }),
    }
  );
}

export async function getReviewHistory(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<ReviewHistoryReadModel> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/review/history"
  );
}

export async function getAssemblyDefinition(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<Record<string, unknown>> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/assembly-definition"
  );
}

export async function postAssemblyDefinition(input: {
  campaignId: string;
  storyId: string;
  executionPlanId: string;
}): Promise<Record<string, unknown>> {
  return requestJson(
    plansBase(input.campaignId, input.storyId, input.executionPlanId) + "/assembly-definition",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }
  );
}
