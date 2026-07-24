/**
 * Shared Campaign pipeline lifecycle helpers.
 * Ensures running steps never stay "running" after failure, and task/campaign
 * status stay consistent: pending → running → completed | failed.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import type { StepProgress } from "@ceo-agent/shared";

/** Mark every currently-running step as failed (pure). */
export function markRunningStepsFailed(
  progress: StepProgress | Record<string, { status?: string } | undefined> | null | undefined,
  message: string,
  completedAt: string = new Date().toISOString()
): StepProgress {
  const next: StepProgress = { ...((progress as StepProgress) ?? {}) };
  for (const [stepId, step] of Object.entries(next)) {
    if (step && typeof step === "object" && step.status === "running") {
      next[stepId] = {
        ...step,
        status: "failed",
        error: message,
        completedAt,
      };
    }
  }
  return next;
}

/** Persist task + campaign failure and flip any running step to failed. */
export async function failPipelineExecution(params: {
  taskId: string;
  campaignId: string;
  message: string;
}): Promise<void> {
  const db = getDb();
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(eq(schema.tasks.id, params.taskId))
    .limit(1);

  const prior = (task?.stepProgress as StepProgress) ?? {};
  const completedAt = new Date().toISOString();
  const progress = markRunningStepsFailed(prior, params.message, completedAt);

  const failedStepId =
    Object.entries(prior).find(([, step]) => step?.status === "running")?.[0] ??
    task?.currentStep ??
    null;

  await db
    .update(schema.tasks)
    .set({
      status: "failed",
      errorMessage: params.message,
      completedAt: new Date(),
      stepProgress: progress,
      ...(failedStepId ? { currentStep: failedStepId } : {}),
    })
    .where(eq(schema.tasks.id, params.taskId));

  await db
    .update(schema.campaigns)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(schema.campaigns.id, params.campaignId));
}
