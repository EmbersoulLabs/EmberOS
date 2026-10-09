import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  attachMarketingPackRevision,
  readMarketingPackRevision,
  type MarketingContentPackage,
  type StepProgress,
} from "@ceo-agent/shared";

export type MarketingBudgetReservation = {
  taskId: string;
  spentBefore: number;
  budget: number;
};

function money(value: number): string {
  return value.toFixed(6);
}

function asMoney(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/** A crashed request cannot clear its own reservation. The next call recovers it after this TTL. */
const MARKETING_BUDGET_HOLD_MS = 120_000;
const MARKETING_BUDGET_HOLD_KEY = "marketing_budget_hold";

type MarketingBudgetHold = {
  spentBefore: number;
  budget: number;
  expiresAt: string;
};

function progressRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

function readBudgetHold(value: unknown): MarketingBudgetHold | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const spentBefore = asMoney(record.spentBefore as number | string | null | undefined);
  const budget = asMoney(record.budget as number | string | null | undefined);
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : "";
  if (!Number.isFinite(spentBefore) || !Number.isFinite(budget) || Number.isNaN(Date.parse(expiresAt))) {
    return null;
  }
  return { spentBefore, budget, expiresAt };
}

function withoutBudgetHold(progress: Record<string, unknown>): Record<string, unknown> {
  const next = { ...progress };
  delete next[MARKETING_BUDGET_HOLD_KEY];
  return next;
}

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

/**
 * Hold the task row and reserve the remaining budget before a paid model call.
 * A second caller waits on the row lock, then sees the reservation and does not start another call.
 * If the process dies before finish or cancel, the hold expires and the next call restores the prior spend.
 */
export async function beginPaidMarketingCall(taskId: string): Promise<
  | { ok: true; reservation: MarketingBudgetReservation }
  | { ok: false; reason: "not_found" | "budget" }
> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .for("update")
      .limit(1);
    if (!locked) return { ok: false as const, reason: "not_found" as const };

    const progress = progressRecord(locked.stepProgress);
    const hold = readBudgetHold(progress[MARKETING_BUDGET_HOLD_KEY]);
    let spent = asMoney(locked.costUsd);
    const budget = asMoney(locked.costBudgetUsd);
    if (hold && Math.abs(spent - hold.budget) < 1e-9 && Date.parse(hold.expiresAt) <= Date.now()) {
      spent = hold.spentBefore;
    }
    if (!Number.isFinite(spent) || !Number.isFinite(budget) || spent >= budget) {
      return { ok: false as const, reason: "budget" as const };
    }

    const nextHold: MarketingBudgetHold = {
      spentBefore: spent,
      budget,
      expiresAt: new Date(Date.now() + MARKETING_BUDGET_HOLD_MS).toISOString(),
    };
    await tx
      .update(schema.tasks)
      .set({
        costUsd: money(budget),
        stepProgress: { ...progress, [MARKETING_BUDGET_HOLD_KEY]: nextHold },
      })
      .where(eq(schema.tasks.id, taskId));
    return { ok: true as const, reservation: { taskId, spentBefore: spent, budget } };
  });
}

export async function finishPaidMarketingCall(
  reservation: MarketingBudgetReservation,
  input: {
    orgId: string;
    workspaceId: string;
    agent: string;
    usage: { input: number; output: number; costUsd: number };
  }
) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, reservation.taskId))
      .for("update")
      .limit(1);
    if (!locked) return;
    const next = reservation.spentBefore + input.usage.costUsd;
    await tx
      .update(schema.tasks)
      .set({
        costUsd: money(next),
        stepProgress: withoutBudgetHold(progressRecord(locked.stepProgress)),
      })
      .where(eq(schema.tasks.id, reservation.taskId));
    if (input.usage.costUsd > 0 || input.usage.input > 0 || input.usage.output > 0) {
      await tx.insert(schema.agentLogs).values({
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        taskId: reservation.taskId,
        agent: input.agent,
        inputTokens: input.usage.input,
        outputTokens: input.usage.output,
        costUsd: money(input.usage.costUsd),
        durationMs: 0,
      });
    }
  });
}

/** Release a reservation when the model call fails before any usage is recorded. */
export async function cancelPaidMarketingCall(reservation: MarketingBudgetReservation) {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, reservation.taskId))
      .for("update")
      .limit(1);
    if (!locked) return;
    const progress = withoutBudgetHold(progressRecord(locked.stepProgress));
    const stillReserved = Math.abs(asMoney(locked.costUsd) - reservation.budget) < 1e-9;
    await tx
      .update(schema.tasks)
      .set({
        ...(stillReserved ? { costUsd: money(reservation.spentBefore) } : {}),
        stepProgress: progress,
      })
      .where(eq(schema.tasks.id, reservation.taskId));
  });
}
