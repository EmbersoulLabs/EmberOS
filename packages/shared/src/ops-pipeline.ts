import { z } from "zod";
import type { StepProgress } from "./types/index";

export const PIPELINE_STATES = [
  "NOT_REQUIRED",
  "WAITING_FOR_DEPENDENCY",
  "QUEUED",
  "RUNNING",
  "PARTIALLY_COMPLETE",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL",
  "SKIPPED",
  "CANCELLED",
] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];

const PIPELINE_STATE_TRANSITIONS: Readonly<Record<PipelineState, readonly PipelineState[]>> = {
  NOT_REQUIRED: [],
  WAITING_FOR_DEPENDENCY: ["QUEUED", "FAILED_TERMINAL", "CANCELLED", "SKIPPED"],
  QUEUED: ["RUNNING", "CANCELLED", "SKIPPED"],
  RUNNING: [
    "PARTIALLY_COMPLETE",
    "COMPLETED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL",
    "CANCELLED",
  ],
  PARTIALLY_COMPLETE: ["RUNNING", "COMPLETED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "CANCELLED"],
  COMPLETED: [],
  FAILED_RETRYABLE: ["QUEUED", "RUNNING", "FAILED_TERMINAL", "CANCELLED"],
  FAILED_TERMINAL: [],
  SKIPPED: [],
  CANCELLED: [],
};

export function canTransitionPipelineState(
  from: PipelineState,
  to: PipelineState
): boolean {
  return PIPELINE_STATE_TRANSITIONS[from].includes(to);
}

export function assertPipelineStateTransition(
  from: PipelineState,
  to: PipelineState
): void {
  if (!canTransitionPipelineState(from, to)) {
    throw new Error(`Illegal pipeline state transition: ${from} -> ${to}`);
  }
}

/** OPS-002 Rule 1 — active execution states (one per Campaign). */
export const ACTIVE_CAMPAIGN_TASK_STATUSES = [
  "queued",
  "running",
  "retrying",
  "resume",
] as const;

export type ActiveCampaignTaskStatus = (typeof ACTIVE_CAMPAIGN_TASK_STATUSES)[number];

export function isActiveCampaignTaskStatus(
  status: string | null | undefined
): status is ActiveCampaignTaskStatus {
  return (
    status === "queued" ||
    status === "running" ||
    status === "retrying" ||
    status === "resume"
  );
}

/** OPS-002 Rule 4 — final Review decision request body. */
export const ReviewDecideBodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().max(4000).optional(),
});
export type ReviewDecideBody = z.infer<typeof ReviewDecideBodySchema>;

/** Stage is finished and must not re-run on resume (OPS-002 Rule 2). */
export function isPipelineStageComplete(
  progress: StepProgress | Record<string, { status?: string } | undefined> | null | undefined,
  stepId: string
): boolean {
  const status = progress?.[stepId]?.status;
  return status === "completed" || status === "skipped";
}

export function getPipelineStageOutput<T = unknown>(
  progress: StepProgress | Record<string, { output?: unknown } | undefined> | null | undefined,
  stepId: string
): T | undefined {
  return progress?.[stepId]?.output as T | undefined;
}
