import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  attachMarketingPackRevision,
  readMarketingPackRevision,
  type MarketingContentPackage,
  type StepProgress,
} from "@ceo-agent/shared";

export async function saveMarketingPackIfCurrent(input: {
  taskId: string;
  expectedRevision: number;
  contentPackage: MarketingContentPackage;
}): Promise<{ ok: true; revision: number } | { ok: false; revision: number }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, input.taskId))
      .for("update")
      .limit(1);
    if (!locked) return { ok: false as const, revision: input.expectedRevision };

    const progress = (locked.stepProgress as StepProgress) ?? {};
    const stored = readMarketingPackRevision(progress);
    if (stored !== input.expectedRevision) {
      return { ok: false as const, revision: stored };
    }

    const nextRevision = stored + 1;
    const updatedProgress = attachMarketingPackRevision(progress, input.contentPackage, nextRevision);
    await tx
      .update(schema.tasks)
      .set({ stepProgress: updatedProgress })
      .where(eq(schema.tasks.id, input.taskId));
    return { ok: true as const, revision: nextRevision };
  });
}

export async function recordMarketingModelUsage(input: {
  orgId: string;
  workspaceId: string;
  taskId: string;
  agent: string;
  usage: { input: number; output: number; costUsd: number };
}) {
  const db = getDb();
  await db.insert(schema.agentLogs).values({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    agent: input.agent,
    inputTokens: input.usage.input,
    outputTokens: input.usage.output,
    costUsd: String(input.usage.costUsd),
    durationMs: 0,
  });
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId)).limit(1);
  if (!task) return;
  const current = Number(task.costUsd ?? "0");
  const next = (Number.isFinite(current) ? current : 0) + input.usage.costUsd;
  await db
    .update(schema.tasks)
    .set({ costUsd: String(next) })
    .where(eq(schema.tasks.id, input.taskId));
}
