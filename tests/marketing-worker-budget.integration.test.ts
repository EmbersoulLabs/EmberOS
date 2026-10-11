import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

if (!(process.env.RUN_DB_INTEGRATION_TESTS === "1" && process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = readFileSync(process.env.WORKER_BUDGET_DB_FILE!, "utf8").trim();
}

type DbApi = typeof import("@ceo-agent/db");
type BudgetApi = typeof import("../packages/agents/src/marketing-budget");

let dbApi: DbApi;
let budgetApi: BudgetApi;

beforeAll(async () => {
  dbApi = await import("@ceo-agent/db");
  budgetApi = await import("../packages/agents/src/marketing-budget");
});

async function insertTask(input: { costUsd?: string; budget?: string; progress?: Record<string, unknown> }) {
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const campaignId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const db = dbApi.getDb();
  await db.insert(dbApi.schema.organizations).values({ id: orgId, name: "Org", slug: `org-${orgId.slice(0, 8)}` });
  await db.insert(dbApi.schema.workspaces).values({
    id: workspaceId,
    orgId,
    name: "Workspace",
    slug: `ws-${workspaceId.slice(0, 8)}`,
  });
  await db.insert(dbApi.schema.campaigns).values({
    id: campaignId,
    orgId,
    workspaceId,
    name: "Cafe",
    platforms: ["tiktok"],
  });
  await db.insert(dbApi.schema.tasks).values({
    id: taskId,
    orgId,
    workspaceId,
    campaignId,
    status: "running",
    costUsd: input.costUsd ?? "0",
    costBudgetUsd: input.budget ?? "0.50",
    stepProgress: input.progress ?? {},
  });
  return { orgId, workspaceId, campaignId, taskId };
}

async function loadTask(taskId: string) {
  const [task] = await dbApi.getDb().select().from(dbApi.schema.tasks).where(eq(dbApi.schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error("missing task");
  return task;
}

describe("worker marketing budget contract", () => {
  it("rejects an exhausted budget before the provider runs", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({ costUsd: "0.50", budget: "0.50" });
    let calls = 0;
    await expect(budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      run: async () => {
        calls += 1;
        return { usage: { input: 1, output: 1, costUsd: 0.01 } };
      },
    })).rejects.toThrow("Cost budget exceeded");
    expect(calls).toBe(0);
  });

  it("reserves a unique id before the provider and commits usage once", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({});
    let reservationDuringCall = "";
    const result = await budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      outputOf: (value) => value.output,
      run: async () => {
        const task = await loadTask(taskId);
        const hold = (task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold;
        reservationDuringCall = hold?.reservationId ?? "";
        expect(Number(task.costUsd)).toBeCloseTo(0.5, 5);
        return { output: { caption: "抖音中文" }, usage: { input: 4, output: 2, costUsd: 0.03 } };
      },
    });
    expect(result.output).toEqual({ caption: "抖音中文" });
    expect(reservationDuringCall).toMatch(/^[0-9a-f-]{36}$/i);
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.03, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    expect(Number((task.stepProgress as Record<string, unknown>).marketing_budget_committed)).toBeCloseTo(0.03, 5);
    const logs = await dbApi.getDb().select().from(dbApi.schema.agentLogs).where(eq(dbApi.schema.agentLogs.taskId, taskId));
    expect(logs).toHaveLength(1);
    expect(Number(logs[0]?.costUsd)).toBeCloseTo(0.03, 5);
  });

  it("releases the reservation when the provider fails and does not write usage", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({ costUsd: "0.02" });
    await expect(budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      run: async () => {
        throw new Error("provider down");
      },
    })).rejects.toThrow("provider down");
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.02, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    const logs = await dbApi.getDb().select().from(dbApi.schema.agentLogs).where(eq(dbApi.schema.agentLogs.taskId, taskId));
    expect(logs).toHaveLength(0);
  });

  it("blocks a second caller while a reservation is active", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({});
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      run: async () => {
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { usage: { input: 1, output: 1, costUsd: 0.01 } };
      },
    });
    await started;
    let secondCalls = 0;
    await expect(budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_translate",
      run: async () => {
        secondCalls += 1;
        return { usage: { input: 1, output: 1, costUsd: 0.01 } };
      },
    })).rejects.toThrow("Cost budget exceeded");
    expect(secondCalls).toBe(0);
    release();
    await first;
  });

  it("recovers an expired historical hold that has no reservation id", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({
      costUsd: "0.50",
      budget: "0.50",
      progress: {
        marketing_budget_hold: { spentBefore: 0.1, budget: 0.5, expiresAt: new Date(Date.now() - 1000).toISOString() },
      },
    });
    await budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      run: async () => ({ usage: { input: 2, output: 1, costUsd: 0.04 } }),
    });
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.14, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
  });

  it("does not let an expired call settle or clear a newer reservation", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({});
    let releaseFirst: () => void = () => {};
    let releaseSecond: () => void = () => {};
    let enteredFirst: () => void = () => {};
    let enteredSecond: () => void = () => {};
    const firstStarted = new Promise<void>((resolve) => {
      enteredFirst = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      enteredSecond = resolve;
    });
    const first = budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_content",
      run: async () => {
        enteredFirst();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { usage: { input: 1, output: 1, costUsd: 0.04 } };
      },
    });
    await firstStarted;
    const reserved = await loadTask(taskId);
    const firstHold = (reserved.stepProgress as { marketing_budget_hold: { reservationId: string } }).marketing_budget_hold;
    await dbApi.getDb().update(dbApi.schema.tasks).set({
      stepProgress: {
        ...(reserved.stepProgress as Record<string, unknown>),
        marketing_budget_hold: { ...firstHold, expiresAt: new Date(Date.now() - 1000).toISOString() },
      },
    }).where(eq(dbApi.schema.tasks.id, taskId));
    const second = budgetApi.runPaidMarketingStep({
      taskId,
      orgId,
      workspaceId,
      agent: "marketing_translate",
      run: async () => {
        enteredSecond();
        await new Promise<void>((resolve) => {
          releaseSecond = resolve;
        });
        return { usage: { input: 1, output: 1, costUsd: 0.05 } };
      },
    });
    await secondStarted;
    const duringSecond = await loadTask(taskId);
    const secondHold = (duringSecond.stepProgress as { marketing_budget_hold: { reservationId: string } }).marketing_budget_hold;
    expect(secondHold.reservationId).not.toBe(firstHold.reservationId);
    releaseFirst();
    await first;
    const afterFirst = await loadTask(taskId);
    expect((afterFirst.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId).toBe(secondHold.reservationId);
    expect(Number(afterFirst.costUsd)).toBeCloseTo(0.5, 5);
    releaseSecond();
    await second;
    const settled = await loadTask(taskId);
    expect(Number(settled.costUsd)).toBeCloseTo(0.09, 5);
    expect((settled.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
  });

  it("runs the worker content_generate path once per authorized call and persists the package", async () => {
    const { taskId, orgId, workspaceId } = await insertTask({});
    let contentCalls = 0;
    let translateCalls = 0;
    const generated = await budgetApi.generateInitialMarketingPackage({
      taskId,
      orgId,
      workspaceId,
      generate: async () => {
        const task = await loadTask(taskId);
        expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeTruthy();
        contentCalls += 1;
        return { contentPackage: { caption: "中文包装" }, usage: { input: 3, output: 2, costUsd: 0.02 } };
      },
      translate: async (contentPackage) => {
        const task = await loadTask(taskId);
        expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeTruthy();
        translateCalls += 1;
        return { contentPackage: { ...contentPackage, captionEn: "English pack" }, usage: { input: 2, output: 2, costUsd: 0.01 } };
      },
    });
    expect(contentCalls).toBe(1);
    expect(translateCalls).toBe(1);
    expect(generated.contentPackage).toEqual({ caption: "中文包装", captionEn: "English pack" });
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.03, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    const logs = await dbApi.getDb().select().from(dbApi.schema.agentLogs).where(eq(dbApi.schema.agentLogs.taskId, taskId));
    expect(logs.map((row) => row.agent).sort()).toEqual(["marketing_content", "marketing_translate"]);

    let extraCalls = 0;
    await dbApi.getDb().update(dbApi.schema.tasks).set({ costUsd: "0.50" }).where(eq(dbApi.schema.tasks.id, taskId));
    await expect(budgetApi.generateInitialMarketingPackage({
      taskId,
      orgId,
      workspaceId,
      generate: async () => {
        extraCalls += 1;
        return { contentPackage: { caption: "again" }, usage: { input: 1, output: 1, costUsd: 0.01 } };
      },
      translate: async (contentPackage) => ({ contentPackage, usage: { input: 0, output: 0, costUsd: 0 } }),
    })).rejects.toThrow("Cost budget exceeded");
    expect(extraCalls).toBe(0);
  });
});

function micros(value: string | number | null | undefined): bigint {
  const text = String(value ?? "0");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.slice(negative ? 1 : 0).split(".");
  const padded = `${fraction.replace(/\D/g, "")}000000`.slice(0, 6);
  const amount = BigInt(whole || "0") * 1_000_000n + BigInt(padded || "0");
  return negative ? -amount : amount;
}

function expectMoney(actual: string | number | null | undefined, expected: string) {
  expect(micros(actual)).toBe(micros(expected));
}

describe("marketing budget settlement idempotency", () => {
  async function reserve(taskId: string) {
    const gate = await dbApi.beginPaidMarketingCall(taskId);
    if (!gate.ok) throw new Error(gate.reason);
    return gate.reservation;
  }

  async function finish(
    scope: { taskId: string; orgId: string; workspaceId: string },
    reservation: Awaited<ReturnType<typeof reserve>>,
    costUsd: number,
    agent = "marketing_content"
  ) {
    await dbApi.finishPaidMarketingCall(reservation, {
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent,
      usage: { input: 2, output: 1, costUsd },
      outputJson: { caption: "settled" },
    });
  }

  async function logsFor(taskId: string) {
    return dbApi.getDb().select().from(dbApi.schema.agentLogs).where(eq(dbApi.schema.agentLogs.taskId, taskId));
  }

  it("settles a reservation once and ignores identical or conflicting repeats", async () => {
    const scope = await insertTask({ progress: { locale: "zh-CN", content_generate: { status: "running" } } });
    const reservation = await reserve(scope.taskId);
    await finish(scope, reservation, 0.03);
    await finish(scope, reservation, 0.03);
    await finish(scope, reservation, 0.07);
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.030000");
    expectMoney((task.stepProgress as { marketing_budget_committed?: number }).marketing_budget_committed, "0.030000");
    const settlements = (task.stepProgress as { marketing_budget_settlements: Record<string, { costUsd: string }> }).marketing_budget_settlements;
    expect(settlements[reservation.reservationId]?.costUsd).toBe("0.030000");
    expect((task.stepProgress as { locale?: string }).locale).toBe("zh-CN");
    expect((task.stepProgress as { content_generate?: { status?: string } }).content_generate?.status).toBe("running");
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    expect(await logsFor(scope.taskId)).toHaveLength(1);
  });

  it("keeps cancellation idempotent and blocks settlement afterwards", async () => {
    const scope = await insertTask({ costUsd: "0.020000" });
    const reservation = await reserve(scope.taskId);
    await dbApi.cancelPaidMarketingCall(reservation);
    await dbApi.cancelPaidMarketingCall(reservation);
    await finish(scope, reservation, 0.04);
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.020000");
    expect((task.stepProgress as { marketing_budget_cancellations?: string[] }).marketing_budget_cancellations).toEqual([
      reservation.reservationId,
    ]);
    expect(await logsFor(scope.taskId)).toHaveLength(0);
  });

  it("does not reverse spend when cancellation follows settlement", async () => {
    const scope = await insertTask({});
    const reservation = await reserve(scope.taskId);
    await finish(scope, reservation, 0.03);
    await dbApi.cancelPaidMarketingCall(reservation);
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.030000");
    expect((task.stepProgress as { marketing_budget_cancellations?: string[] }).marketing_budget_cancellations).toBeUndefined();
    expect(await logsFor(scope.taskId)).toHaveLength(1);
  });

  it("applies only one settlement when duplicate finishes race", async () => {
    const scope = await insertTask({});
    const reservation = await reserve(scope.taskId);
    await Promise.all([finish(scope, reservation, 0.02), finish(scope, reservation, 0.07)]);
    const task = await loadTask(scope.taskId);
    const spent = micros(task.costUsd);
    expect(spent === micros("0.020000") || spent === micros("0.070000")).toBe(true);
    expectMoney((task.stepProgress as { marketing_budget_committed?: number }).marketing_budget_committed, task.costUsd);
    expect(Object.keys((task.stepProgress as { marketing_budget_settlements: object }).marketing_budget_settlements)).toEqual([
      reservation.reservationId,
    ]);
    expect(await logsFor(scope.taskId)).toHaveLength(1);
  });

  it("records late usage for an expired reservation without clearing the newer hold", async () => {
    const scope = await insertTask({});
    const first = await reserve(scope.taskId);
    const reserved = await loadTask(scope.taskId);
    const firstHold = (reserved.stepProgress as { marketing_budget_hold: { reservationId: string } }).marketing_budget_hold;
    await dbApi.getDb().update(dbApi.schema.tasks).set({
      stepProgress: {
        ...(reserved.stepProgress as Record<string, unknown>),
        marketing_budget_hold: { ...firstHold, expiresAt: new Date(Date.now() - 1000).toISOString() },
      },
    }).where(eq(dbApi.schema.tasks.id, scope.taskId));
    const second = await reserve(scope.taskId);
    await finish(scope, first, 0.04);
    await finish(scope, first, 0.11);
    const duringSecond = await loadTask(scope.taskId);
    expect((duringSecond.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId).toBe(second.reservationId);
    expectMoney((duringSecond.stepProgress as { marketing_budget_committed?: number }).marketing_budget_committed, "0.040000");
    await finish(scope, second, 0.05);
    await finish(scope, second, 0.08);
    const settled = await loadTask(scope.taskId);
    expectMoney(settled.costUsd, "0.090000");
    expectMoney((settled.stepProgress as { marketing_budget_committed?: number }).marketing_budget_committed, "0.090000");
    expect((settled.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    expect(await logsFor(scope.taskId)).toHaveLength(2);
  });

  it("recovers an interrupted reservation and still settles its late usage once", async () => {
    const scope = await insertTask({});
    const first = await reserve(scope.taskId);
    const reserved = await loadTask(scope.taskId);
    const firstHold = (reserved.stepProgress as { marketing_budget_hold: Record<string, unknown> }).marketing_budget_hold;
    await dbApi.getDb().update(dbApi.schema.tasks).set({
      stepProgress: {
        ...(reserved.stepProgress as Record<string, unknown>),
        marketing_budget_hold: { ...firstHold, expiresAt: new Date(Date.now() - 1000).toISOString() },
      },
    }).where(eq(dbApi.schema.tasks.id, scope.taskId));
    const second = await reserve(scope.taskId);
    const recovered = await loadTask(scope.taskId);
    expect((recovered.stepProgress as { marketing_budget_settlements?: object }).marketing_budget_settlements).toBeUndefined();
    await finish(scope, first, 0.02);
    await finish(scope, second, 0.03);
    await finish(scope, first, 0.02);
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.050000");
    expect(await logsFor(scope.taskId)).toHaveLength(2);
  });

  it("accepts a historical hold without a reservation id", async () => {
    const scope = await insertTask({
      costUsd: "0.500000",
      budget: "0.500000",
      progress: {
        marketing_budget_hold: { spentBefore: 0.1, budget: 0.5, expiresAt: new Date(Date.now() - 1000).toISOString() },
        locale: "zh-CN",
      },
    });
    const reservation = await reserve(scope.taskId);
    await finish(scope, reservation, 0.04);
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.140000");
    expect((task.stepProgress as { locale?: string }).locale).toBe("zh-CN");
    expect(reservation.reservationId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("records incurred cost above the budget and blocks another provider call", async () => {
    const scope = await insertTask({ budget: "0.100000" });
    const reservation = await reserve(scope.taskId);
    let calls = 0;
    await finish(scope, reservation, 0.25);
    const again = await dbApi.beginPaidMarketingCall(scope.taskId);
    if (again.ok) calls += 1;
    const task = await loadTask(scope.taskId);
    expectMoney(task.costUsd, "0.250000");
    expect((task.stepProgress as { marketing_budget_over_budget?: boolean }).marketing_budget_over_budget).toBe(true);
    expect(again.ok).toBe(false);
    expect(calls).toBe(0);
  });

  it("cancels a failed provider call before any usage log and rejects a later settlement", async () => {
    const scope = await insertTask({});
    let reservationId = "";
    let calls = 0;
    await expect(budgetApi.runPaidMarketingStep({
      taskId: scope.taskId,
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent: "marketing_content",
      run: async () => {
        calls += 1;
        const task = await loadTask(scope.taskId);
        reservationId = (task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId ?? "";
        throw new Error("provider down");
      },
    })).rejects.toThrow("provider down");
    const reservation = { taskId: scope.taskId, reservationId, spentBefore: 0, budget: 0.5 };
    await dbApi.finishPaidMarketingCall(reservation, {
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent: "marketing_content",
      usage: { input: 2, output: 1, costUsd: 0.04 },
    });
    const task = await loadTask(scope.taskId);
    expect(calls).toBe(1);
    expectMoney(task.costUsd, "0.000000");
    expect(await logsFor(scope.taskId)).toHaveLength(0);
  });

  it("does not call the provider when the budget is already exhausted", async () => {
    const scope = await insertTask({ costUsd: "0.500000", budget: "0.500000" });
    let calls = 0;
    await expect(budgetApi.runPaidMarketingStep({
      taskId: scope.taskId,
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent: "marketing_content",
      run: async () => {
        calls += 1;
        return { usage: { input: 1, output: 1, costUsd: 0.01 } };
      },
    })).rejects.toThrow("Cost budget exceeded");
    expect(calls).toBe(0);
    const gate = await dbApi.beginPaidMarketingCall(scope.taskId);
    expect(gate.ok).toBe(false);
  });

  it("settles each worker content_generate call once", async () => {
    const scope = await insertTask({});
    const reservations: string[] = [];
    let contentCalls = 0;
    let translateCalls = 0;
    await budgetApi.generateInitialMarketingPackage({
      taskId: scope.taskId,
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      generate: async () => {
        const task = await loadTask(scope.taskId);
        reservations.push((task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId ?? "");
        contentCalls += 1;
        return { contentPackage: { caption: "中文包装" }, usage: { input: 3, output: 2, costUsd: 0.02 } };
      },
      translate: async (contentPackage) => {
        const task = await loadTask(scope.taskId);
        reservations.push((task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId ?? "");
        translateCalls += 1;
        return { contentPackage: { ...contentPackage, captionEn: "English pack" }, usage: { input: 2, output: 2, costUsd: 0.01 } };
      },
    });
    for (const reservationId of reservations) {
      await dbApi.finishPaidMarketingCall(
        { taskId: scope.taskId, reservationId, spentBefore: 0, budget: 0.5 },
        {
          orgId: scope.orgId,
          workspaceId: scope.workspaceId,
          agent: "marketing_content",
          usage: { input: 9, output: 9, costUsd: 0.2 },
        }
      );
    }
    const task = await loadTask(scope.taskId);
    expect(contentCalls).toBe(1);
    expect(translateCalls).toBe(1);
    expectMoney(task.costUsd, "0.030000");
    expect(await logsFor(scope.taskId)).toHaveLength(2);
  });
});
