import {
  beginPaidMarketingCall,
  cancelPaidMarketingCall,
  finishPaidMarketingCall,
} from "@ceo-agent/db";

type Usage = { input: number; output: number; costUsd: number };

/**
 * Reserve the task budget before a paid marketing model call.
 * Finish records usage on the caller's own reservation. Cancel is a no-op
 * once a newer reservation owns the hold. A provider charge that never
 * returns usage cannot be reconstructed from the database.
 */
export async function runPaidMarketingStep<T extends { usage: Usage }>(input: {
  taskId: string;
  orgId: string;
  workspaceId: string;
  agent: string;
  run: () => Promise<T>;
  outputOf?: (result: T) => unknown;
}): Promise<T> {
  const gate = await beginPaidMarketingCall(input.taskId);
  if (!gate.ok) {
    throw new Error(gate.reason === "not_found" ? "Task not found" : "Cost budget exceeded");
  }
  try {
    const result = await input.run();
    await finishPaidMarketingCall(gate.reservation, {
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      agent: input.agent,
      usage: result.usage,
      outputJson: input.outputOf?.(result),
    });
    return result;
  } catch (error) {
    await cancelPaidMarketingCall(gate.reservation);
    throw error;
  }
}

/** Initial Worker content_generate: one reservation per billable content and translation call. */
export async function generateInitialMarketingPackage<T>(input: {
  taskId: string;
  orgId: string;
  workspaceId: string;
  generate: () => Promise<{ contentPackage: T; usage: Usage }>;
  translate: (contentPackage: T) => Promise<{ contentPackage: T; usage: Usage }>;
}): Promise<{ contentPackage: T; contentUsage: Usage; translateUsage: Usage }> {
  const generated = await runPaidMarketingStep({
    taskId: input.taskId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    agent: "marketing_content",
    outputOf: (result) => result.contentPackage,
    run: input.generate,
  });
  const translated = await runPaidMarketingStep({
    taskId: input.taskId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    agent: "marketing_translate",
    outputOf: (result) => result.contentPackage,
    run: () => input.translate(generated.contentPackage),
  });
  return {
    contentPackage: translated.contentPackage,
    contentUsage: generated.usage,
    translateUsage: translated.usage,
  };
}
