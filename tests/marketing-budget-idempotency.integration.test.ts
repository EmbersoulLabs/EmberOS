import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

if (!(process.env.RUN_DB_INTEGRATION_TESTS === "1" && process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = readFileSync(process.env.WEB_BUDGET_DB_FILE!, "utf8").trim();
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

  it("preserves reservation settlement evidence when the final Marketing Package is persisted", async () => {
    const scope = await insertTask({ progress: { content_generate: { status: "running", contentRevision: 0 } } });
    const reservation = await reserve(scope.taskId);
    await finish(scope, reservation, 0.03, "marketing_translate");
    const contentPackage = {
      voiceScripts: { "15s": "Fresh flowers", "30s": "Fresh flower bouquet", "60s": "Fresh flower bouquet" },
      subtitleTimeline: [],
      captions: { tiktok: "Fresh flower bouquet", instagram: "", facebook: "", linkedin: "", xiaohongshu: "", threads: "", youtubeShorts: "", googleBusiness: "" },
      hooks: [{ text: "Fresh flower bouquet", type: "curiosity" }],
      cta: [{ text: "Notice the bouquet" }],
      voiceStyle: {}, broll: [], musicMood: "warm", effects: [],
      postingRecommendation: { bestPostingTime: "", bestPlatform: "TikTok", idealAudience: "", estimatedEngagement: "" },
      consistencyScore: 85, aiSuggestions: [],
    };
    const saved = await dbApi.saveMarketingPackIfCurrent({ taskId: scope.taskId, expectedRevision: 0, contentPackage });
    expect(saved.ok).toBe(true);
    const task = await loadTask(scope.taskId);
    const progress = task.stepProgress as {
      marketing_budget_settlements: Record<string, { costUsd: string }>;
      marketing_budget_committed: number;
      content_generate: { contentRevision: number };
    };
    expect(progress.marketing_budget_settlements[reservation.reservationId]?.costUsd).toBe("0.030000");
    expectMoney(progress.marketing_budget_committed, "0.030000");
    expect(progress.content_generate.contentRevision).toBe(1);
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

  it("settles the web content and translation steps once", async () => {
    const scope = await insertTask({});
    const reservations: string[] = [];
    let calls = 0;
    const generated = await budgetApi.runPaidMarketingStep({
      taskId: scope.taskId,
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent: "marketing_content",
      outputOf: (result: { contentPackage: { caption: string } }) => result.contentPackage,
      run: async () => {
        calls += 1;
        const task = await loadTask(scope.taskId);
        reservations.push((task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId ?? "");
        return { contentPackage: { caption: "中文包装" }, usage: { input: 3, output: 2, costUsd: 0.02 } };
      },
    });
    await budgetApi.runPaidMarketingStep({
      taskId: scope.taskId,
      orgId: scope.orgId,
      workspaceId: scope.workspaceId,
      agent: "marketing_translate",
      outputOf: (result: { contentPackage: { caption: string; captionEn: string } }) => result.contentPackage,
      run: async () => {
        calls += 1;
        const task = await loadTask(scope.taskId);
        reservations.push((task.stepProgress as { marketing_budget_hold?: { reservationId?: string } }).marketing_budget_hold?.reservationId ?? "");
        return { contentPackage: { ...generated.contentPackage, captionEn: "English pack" }, usage: { input: 2, output: 2, costUsd: 0.01 } };
      },
    });
    for (const reservationId of reservations) {
      await dbApi.finishPaidMarketingCall(
        { taskId: scope.taskId, reservationId, spentBefore: 0, budget: 0.5 },
        { orgId: scope.orgId, workspaceId: scope.workspaceId, agent: "marketing_content", usage: { input: 9, output: 9, costUsd: 0.2 } }
      );
    }
    const task = await loadTask(scope.taskId);
    expect(calls).toBe(2);
    expectMoney(task.costUsd, "0.030000");
    expect(await logsFor(scope.taskId)).toHaveLength(2);
  });
});
