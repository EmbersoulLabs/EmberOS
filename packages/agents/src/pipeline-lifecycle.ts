/**
 * Shared Campaign pipeline lifecycle helpers.
 * OPS-002: recoverable Retrying vs terminal Failed after retries exhausted.
 */
import { and, eq, notInArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { CEO_MAX_RETRIES, emitVideoStudioOpsEvent, type StepProgress } from "@ceo-agent/shared";

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

export type AutomaticPipelineFailureAuthority = {
  attemptsMade: number;
  maxAttempts: number;
  outcome: PipelineFailureOutcome;
  anotherAttemptRemains: boolean;
};

export async function withTaskFailureTransitionAuthority(params: {
  transitionTask: () => Promise<boolean>;
  propagateCampaignFailure: () => Promise<void>;
}): Promise<boolean> {
  const acquired = await params.transitionTask();
  if (!acquired) return false;
  await params.propagateCampaignFailure();
  return true;
}

/**
 * Interpret BullMQ's failed-event counters. `attemptsMade` includes the attempt
 * that just failed; `maxAttempts` includes the initial execution.
 */
export function automaticPipelineFailureAuthority(params: {
  attemptsMade: number;
  maxAttempts: number;
}): AutomaticPipelineFailureAuthority {
  if (!Number.isInteger(params.attemptsMade) || params.attemptsMade < 1) {
    throw new Error("BullMQ attemptsMade must be a positive integer after failure");
  }
  if (!Number.isInteger(params.maxAttempts) || params.maxAttempts < 1) {
    throw new Error("BullMQ maxAttempts must be a positive integer");
  }
  const anotherAttemptRemains = params.attemptsMade < params.maxAttempts;
  return {
    attemptsMade: params.attemptsMade,
    maxAttempts: params.maxAttempts,
    outcome: anotherAttemptRemains ? "retrying" : "failed",
    anotherAttemptRemains,
  };
}

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

  // A delayed/duplicate queue failure must never regress terminal success or
  // rewrite an already-recorded terminal failure.
  if (task?.status === "completed" || task?.status === "failed") {
    return "failed";
  }
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
    const acquired = await db.transaction(async (tx) =>
      withTaskFailureTransitionAuthority({
        transitionTask: async () => {
          const transitioned = await tx
            .update(schema.tasks)
            .set({
              status: "retrying",
              errorMessage: params.message,
              completedAt: null,
              stepProgress: progress,
              ...(failedStepId ? { currentStep: failedStepId } : {}),
            })
            .where(
              and(
                eq(schema.tasks.id, params.taskId),
                notInArray(schema.tasks.status, ["completed", "failed"])
              )
            )
            .returning({ id: schema.tasks.id });
          return transitioned.length === 1;
        },
        propagateCampaignFailure: async () => {
          await tx
            .update(schema.campaigns)
            .set({ status: "processing", updatedAt: new Date() })
            .where(eq(schema.campaigns.id, params.campaignId));
        },
      })
    );
    if (!acquired) return "retrying";

    emitVideoStudioOpsEvent({
      event: "pipeline.recoverable_failure",
      stage: "agent.pipeline",
      outcome: "retrying",
      orgId: task?.orgId,
      workspaceId: task?.workspaceId,
      campaignId: params.campaignId,
      taskId: params.taskId,
      step: failedStepId ?? undefined,
      retryCount,
      failureClass: "PIPELINE_FAILURE",
      recoveryKind: "queue_attempt",
      message: params.message,
    });
    return "retrying";
  }

  const acquired = await db.transaction(async (tx) =>
    withTaskFailureTransitionAuthority({
      transitionTask: async () => {
        const transitioned = await tx
          .update(schema.tasks)
          .set({
            status: "failed",
            errorMessage: params.message,
            completedAt: new Date(),
            stepProgress: progress,
            ...(failedStepId ? { currentStep: failedStepId } : {}),
          })
          .where(
            and(
              eq(schema.tasks.id, params.taskId),
              notInArray(schema.tasks.status, ["completed", "failed"])
            )
          )
          .returning({ id: schema.tasks.id });
        return transitioned.length === 1;
      },
      propagateCampaignFailure: async () => {
        await tx
          .update(schema.campaigns)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(schema.campaigns.id, params.campaignId));
      },
    })
  );
  if (!acquired) return "failed";

  emitVideoStudioOpsEvent({
    event: "pipeline.terminal_failure",
    stage: "agent.pipeline",
    outcome: "failed",
    orgId: task?.orgId,
    workspaceId: task?.workspaceId,
    campaignId: params.campaignId,
    taskId: params.taskId,
    step: failedStepId ?? undefined,
    retryCount,
    failureClass: "PIPELINE_FAILURE",
    message: params.message,
  });
  return "failed";
}
