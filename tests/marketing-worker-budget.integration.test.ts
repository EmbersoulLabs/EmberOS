import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

process.env.DATABASE_URL = readFileSync(process.env.WORKER_BUDGET_DB_FILE!, "utf8").trim();

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
