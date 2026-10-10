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
  reservationId: string;
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

/**
 * A crashed request cannot clear its own reservation. The next call may recover it after this TTL.
 * Recovery restores committed spend. It does not refund a provider call that already happened
 * but never reported usage back to this process.
 */
const MARKETING_BUDGET_HOLD_MS = 120_000;
const MARKETING_BUDGET_HOLD_KEY = "marketing_budget_hold";
const MARKETING_BUDGET_COMMITTED_KEY = "marketing_budget_committed";

type MarketingBudgetHold = {
  reservationId?: string;
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
  const reservationId = typeof record.reservationId === "string" ? record.reservationId : undefined;
  return { reservationId, spentBefore, budget, expiresAt };
}

function readCommittedSpend(progress: Record<string, unknown>): number | null {
  if (!(MARKETING_BUDGET_COMMITTED_KEY in progress)) return null;
  const committed = asMoney(progress[MARKETING_BUDGET_COMMITTED_KEY] as number | string | null | undefined);
  return Number.isFinite(committed) ? committed : null;
}

function holdIsActive(hold: MarketingBudgetHold): boolean {
  return Date.parse(hold.expiresAt) > Date.now();
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
    const budget = asMoney(locked.costBudgetUsd);
    const committed = readCommittedSpend(progress);
    let spent = asMoney(locked.costUsd);
    if (hold && holdIsActive(hold)) {
      return { ok: false as const, reason: "budget" as const };
    }
    if (hold && Math.abs(spent - hold.budget) < 1e-9) {
      const recovered = Math.max(hold.spentBefore, committed ?? hold.spentBefore);
      if (!Number.isFinite(budget) || recovered >= budget) {
        return { ok: false as const, reason: "budget" as const };
      }
      spent = recovered;
    } else if (committed !== null) {
      spent = Math.max(spent, committed);
    }
    if (!Number.isFinite(spent) || !Number.isFinite(budget) || spent >= budget) {
      return { ok: false as const, reason: "budget" as const };
    }

    const reservationId = crypto.randomUUID();
    const nextHold: MarketingBudgetHold = {
      reservationId,
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
    return { ok: true as const, reservation: { taskId, reservationId, spentBefore: spent, budget } };
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
    const progress = progressRecord(locked.stepProgress);
    const hold = readBudgetHold(progress[MARKETING_BUDGET_HOLD_KEY]);
    const ownsHold = hold?.reservationId === reservation.reservationId;
    const committed = readCommittedSpend(progress);
    const nextCommitted = (committed ?? reservation.spentBefore) + input.usage.costUsd;
    progress[MARKETING_BUDGET_COMMITTED_KEY] = nextCommitted;
    if (ownsHold) delete progress[MARKETING_BUDGET_HOLD_KEY];
    const costUsd = ownsHold || !hold ? money(nextCommitted) : undefined;
    await tx
      .update(schema.tasks)
      .set({
        ...(costUsd ? { costUsd } : {}),
        stepProgress: progress,
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
    const progress = progressRecord(locked.stepProgress);
    const hold = readBudgetHold(progress[MARKETING_BUDGET_HOLD_KEY]);
    if (hold?.reservationId !== reservation.reservationId) return;
    delete progress[MARKETING_BUDGET_HOLD_KEY];
    const committed = readCommittedSpend(progress) ?? reservation.spentBefore;
    await tx
      .update(schema.tasks)
      .set({
        costUsd: money(committed),
        stepProgress: progress,
      })
      .where(eq(schema.tasks.id, reservation.taskId));
  });
}
