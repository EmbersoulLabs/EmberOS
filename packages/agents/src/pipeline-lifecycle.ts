/**
 * Shared Campaign pipeline lifecycle helpers.
 * OPS-002: recoverable Retrying vs terminal Failed after retries exhausted.
 */
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { CEO_MAX_RETRIES, type StepProgress } from "@ceo-agent/shared";

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

export type PipelineFailureOutcome = "retrying" | "failed";

/**
 * Persist stage failure. Terminal Failed only when retries are exhausted
 * (OPS-002 Rule 3). Otherwise task enters recoverable `retrying`.
 */
export async function failPipelineExecution(params: {
  taskId: string;
  campaignId: string;
  message: string;
  /** Force terminal Failed regardless of retryCount. */
  forceTerminal?: boolean;
}): Promise<PipelineFailureOutcome> {
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

  const retryCount = task?.retryCount ?? 0;
  const terminal =
    params.forceTerminal === true || retryCount >= CEO_MAX_RETRIES;

  if (!terminal) {
    await db
      .update(schema.tasks)
      .set({
        status: "retrying",
        errorMessage: params.message,
        completedAt: null,
        stepProgress: progress,
        ...(failedStepId ? { currentStep: failedStepId } : {}),
      })
      .where(eq(schema.tasks.id, params.taskId));

    // Campaign stays processing — recoverable, not terminal Failed.
    await db
      .update(schema.campaigns)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(schema.campaigns.id, params.campaignId));

    console.warn(
      JSON.stringify({
        event: "pipeline.recoverable_failure",
        taskId: params.taskId,
        campaignId: params.campaignId,
        step: failedStepId,
        retryCount,
        maxRetries: CEO_MAX_RETRIES,
        message: params.message.slice(0, 200),
      })
    );
    return "retrying";
  }

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

  console.error(
    JSON.stringify({
      event: "pipeline.terminal_failure",
      taskId: params.taskId,
      campaignId: params.campaignId,
      step: failedStepId,
      retryCount,
      maxRetries: CEO_MAX_RETRIES,
      message: params.message.slice(0, 200),
    })
  );
  return "failed";
}
