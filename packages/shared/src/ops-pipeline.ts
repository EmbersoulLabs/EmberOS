import { z } from "zod";
import type { StepProgress } from "./types/index";

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
