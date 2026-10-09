import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MarketingContentPackage, PlatformMarketingAsset } from "@ceo-agent/shared";

const authState = vi.hoisted(() => ({ userId: "" }));
const { callJsonModel } = vi.hoisted(() => ({ callJsonModel: vi.fn() }));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    requireAuth: async () => ({ id: authState.userId }),
  };
});

vi.mock("../packages/agents/src/llm", () => ({ callJsonModel }));

process.env.DATABASE_URL = readFileSync(process.env.MARKETING_CERT_DB_FILE!, "utf8").trim();

type Routes = {
  patchPack: typeof import("../apps/web/src/app/api/tasks/[id]/marketing-pack/route").PATCH;
  regenerate: typeof import("../apps/web/src/app/api/tasks/[id]/marketing-pack/regenerate/route").POST;
  translate: typeof import("../apps/web/src/app/api/tasks/[id]/marketing-pack/translate/route").POST;
  download: typeof import("../apps/web/src/app/api/tasks/[id]/marketing-pack/download/route").GET;
  exportPost: typeof import("../apps/web/src/app/api/tasks/[id]/export/route").POST;
};

let routes: Routes;
let dbApi: typeof import("@ceo-agent/db");
let saveMarketingPackIfCurrent: typeof import("../apps/web/src/lib/marketing-pack-persistence").saveMarketingPackIfCurrent;

const editorId = crypto.randomUUID();
const viewerId = crypto.randomUUID();
const orgId = crypto.randomUUID();
const workspaceId = crypto.randomUUID();
const campaignId = crypto.randomUUID();

function asset(caption: string): PlatformMarketingAsset {
  return { caption, cta: "Buy", hashtags: ["local"] };
}

function needsModelTranslation(content: MarketingContentPackage): MarketingContentPackage {
  return {
    ...content,
    hooks: content.hooks.map((hook) => ({ ...hook, textEn: undefined, textMs: undefined })),
    cta: content.cta.map((item) => ({ ...item, textEn: undefined, textMs: undefined })),
    captionsEn: undefined,
    captionsMs: undefined,
    voiceScriptsEn: undefined,
  };
}

function pack(): MarketingContentPackage {
  return {
    voiceScripts: { "15s": "十五秒脚本", "30s": "三十秒脚本", "60s": "六十秒脚本" },
    voiceScriptsZh: { "15s": "中文口播", "30s": "中文三十秒", "60s": "中文六十秒" },
    voiceScriptsEn: { "15s": "English voice", "30s": "English thirty", "60s": "English sixty" },
    subtitleTimeline: [{ startSec: 0, endSec: 3, text: "开场", role: "hook" }],
    captions: {
      tiktok: "抖音中文",
      instagram: "IG中文",
      facebook: "",
      linkedin: "",
      xiaohongshu: "小红书原文",
      youtubeShorts: "",
      googleBusiness: "",
    },
    captionsEn: {
      tiktok: "TikTok English",
      instagram: "IG English",
      facebook: "",
      linkedin: "",
      xiaohongshu: "",
      youtubeShorts: "",
      googleBusiness: "",
    },
    captionsMs: {
      tiktok: "TikTok Melayu",
      instagram: "IG Melayu",
      facebook: "",
      linkedin: "",
      xiaohongshu: "",
      youtubeShorts: "",
      googleBusiness: "",
    },
    hooks: [{ text: "开场钩子", textEn: "Opening hook", textMs: "Cangkuk pembuka", type: "curiosity" }],
    cta: [{ text: "立即了解", textEn: "Learn more", textMs: "Ketahui lagi" }],
    musicMood: "Upbeat",
    broll: ["Product close-up"],
    effects: ["Zoom"],
    postingRecommendation: {
      bestPostingTime: "Weekdays 7pm",
      bestPlatform: "TikTok",
      idealAudience: "office workers",
      estimatedEngagement: "",
    },
    platformAssets: {
      tiktok: asset("抖音中文"),
      instagram: asset("IG中文"),
      xiaohongshu: asset("小红书原文"),
    },
    contentOrigin: "model",
  } as MarketingContentPackage;
}

function progressFor(content: MarketingContentPackage, revision?: number) {
  return {
    vision_analyze: {
      status: "completed",
      output: {
        transcriptSummary: "kept",
        subjects: ["coffee"],
        products: [{ name: "coffee" }],
        scenes: [],
        hooks: [],
        durationSec: 15,
      },
    },
    content_generate: {
      status: "completed",
      output: content,
      ...(revision === undefined ? {} : { contentRevision: revision }),
    },
  };
}

const strategy = {
  industry: "restaurant",
  businessType: "cafe",
  product: "coffee",
  marketingGoal: "awareness",
  marketingAngle: "morning coffee",
  brandPersonality: ["warm"],
  tone: "warm",
  videoStyle: "lifestyle",
  audience: { interests: ["coffee"], painPoints: [] },
  customerJourney: "discover",
  keywords: ["coffee"],
  hashtags: { trending: [], seo: [], local: [], industry: [] },
  platformPriority: ["tiktok"],
  ctaStrategy: "visit",
  confidence: 0.8,
};

const vision = {
  subjects: ["coffee"],
  products: [{ name: "coffee" }],
  scenes: [],
  hooks: [],
  transcriptSummary: "A cup of coffee",
  durationSec: 15,
};

async function insertTask(input: {
  content: MarketingContentPackage;
  revision?: number;
  costUsd?: string;
  budget?: string;
  historical?: boolean;
  budgetHold?: { spentBefore: number; budget: number; expiresAt: string };
}) {
  const taskId = crypto.randomUUID();
  const stepProgress = progressFor(input.content, input.historical ? undefined : input.revision ?? 0) as Record<
    string,
    unknown
  >;
  if (input.budgetHold) stepProgress.marketing_budget_hold = input.budgetHold;
  await dbApi.getDb().insert(dbApi.schema.tasks).values({
    id: taskId,
    orgId,
    workspaceId,
    campaignId,
    status: "completed",
    strategyJson: strategy,
    stepProgress,
    costUsd: input.costUsd ?? "0",
    costBudgetUsd: input.budget ?? "0.50",
  });
  return taskId;
}

async function loadTask(taskId: string) {
  const tasks = await dbApi.getDb().select().from(dbApi.schema.tasks);
  const task = tasks.find((row) => row.id === taskId);
  if (!task) throw new Error("task missing");
  return task;
}

function storedPack(task: { stepProgress: unknown }) {
  const progress = task.stepProgress as {
    vision_analyze?: { output?: { transcriptSummary?: string } };
    content_generate?: { output?: MarketingContentPackage; contentRevision?: number };
  };
  return progress;
}

async function jsonOf(response: Response) {
  return (await response.json()) as { code?: string; contentPackage?: MarketingContentPackage; contentRevision?: number };
}

beforeAll(async () => {
  dbApi = await import("@ceo-agent/db");
  const persistence = await import("../apps/web/src/lib/marketing-pack-persistence");
  saveMarketingPackIfCurrent = persistence.saveMarketingPackIfCurrent;
  const packRoute = await import("../apps/web/src/app/api/tasks/[id]/marketing-pack/route");
  const regenerateRoute = await import("../apps/web/src/app/api/tasks/[id]/marketing-pack/regenerate/route");
  const translateRoute = await import("../apps/web/src/app/api/tasks/[id]/marketing-pack/translate/route");
  const downloadRoute = await import("../apps/web/src/app/api/tasks/[id]/marketing-pack/download/route");
  const exportRoute = await import("../apps/web/src/app/api/tasks/[id]/export/route");
  routes = {
    patchPack: packRoute.PATCH,
    regenerate: regenerateRoute.POST,
    translate: translateRoute.POST,
    download: downloadRoute.GET,
    exportPost: exportRoute.POST,
  };

  const db = dbApi.getDb();
  await db.insert(dbApi.schema.organizations).values({ id: orgId, name: "Cert Org", slug: `cert-${orgId.slice(0, 8)}` });
  await db.insert(dbApi.schema.workspaces).values({
    id: workspaceId,
    orgId,
    name: "Cert Workspace",
    slug: `ws-${workspaceId.slice(0, 8)}`,
    brandProfile: { tone: "warm", industry: "F&B", targetAudience: "office workers", bannedWords: [], cta: "Visit" },
  });
  await db.insert(dbApi.schema.workspaceMembers).values([
    { orgId, workspaceId, userId: editorId, role: "editor" },
    { orgId, workspaceId, userId: viewerId, role: "client_viewer" },
  ]);
  await db.insert(dbApi.schema.campaigns).values({
    id: campaignId,
    orgId,
    workspaceId,
    name: "Cafe",
    platforms: ["tiktok", "instagram"],
    status: "ready",
  });
  await db.insert(dbApi.schema.businessProfiles).values({
    orgId,
    workspaceId,
    companyName: "Ember Cafe",
    city: "Kuala Lumpur",
    services: ["Coffee"],
    businessDescription: "Roastery",
  });
  authState.userId = editorId;
});

describe("postgres marketing pack concurrency", () => {
  it("serializes different platforms and keeps the saved edit", async () => {
    const { applyPlatformLocaleEdit } = await import("@ceo-agent/shared");
    const taskId = await insertTask({ content: pack(), revision: 0 });
    const base = pack();
    const tiktok = applyPlatformLocaleEdit(base, "tiktok", asset("Updated English"), "en");
    const instagram = applyPlatformLocaleEdit(base, "instagram", asset("IG Melayu baru"), "ms");
    const [first, second] = await Promise.all([
      saveMarketingPackIfCurrent({ taskId, expectedRevision: 0, contentPackage: tiktok }),
      saveMarketingPackIfCurrent({ taskId, expectedRevision: 0, contentPackage: instagram }),
    ]);
    const outcomes = [first, second].sort((a, b) => Number(b.ok) - Number(a.ok));
    expect(outcomes[0]?.ok).toBe(true);
    expect(outcomes[1]?.ok).toBe(false);
    const task = await loadTask(taskId);
    const stored = storedPack(task);
    expect(stored.vision_analyze?.output?.transcriptSummary).toBe("kept");
    expect(stored.content_generate?.contentRevision).toBe(1);
    const saved = stored.content_generate?.output;
    const winnerIsTiktok = saved?.captionsEn?.tiktok?.includes("Updated English");
    const winnerIsInstagram = saved?.captionsMs?.instagram?.includes("IG Melayu baru");
    expect(winnerIsTiktok || winnerIsInstagram).toBe(true);
    expect(winnerIsTiktok && winnerIsInstagram).toBe(false);
  });

  it("rejects a second edit of the same platform and locale", async () => {
    const { applyPlatformLocaleEdit } = await import("@ceo-agent/shared");
    const taskId = await insertTask({ content: pack(), revision: 0 });
    const base = pack();
    const a = applyPlatformLocaleEdit(base, "tiktok", asset("English A"), "en");
    const b = applyPlatformLocaleEdit(base, "tiktok", asset("English B"), "en");
    const [first, second] = await Promise.all([
      saveMarketingPackIfCurrent({ taskId, expectedRevision: 0, contentPackage: a }),
      saveMarketingPackIfCurrent({ taskId, expectedRevision: 0, contentPackage: b }),
    ]);
    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1);
    const saved = storedPack(await loadTask(taskId)).content_generate?.output?.captionsEn?.tiktok ?? "";
    expect(saved.includes("English A") || saved.includes("English B")).toBe(true);
    expect(saved.includes("English A") && saved.includes("English B")).toBe(false);
  });

  it("returns HTTP 409 for a stale revision and keeps the first caption", async () => {
    const taskId = await insertTask({ content: pack(), revision: 0 });
    const ok = await routes.patchPack(
      new Request("http://127.0.0.1/marketing-pack", {
        method: "PATCH",
        body: JSON.stringify({ platformId: "tiktok", locale: "en", contentRevision: 0, asset: asset("English saved") }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(ok.status).toBe(200);
    const stale = await routes.patchPack(
      new Request("http://127.0.0.1/marketing-pack", {
        method: "PATCH",
        body: JSON.stringify({ platformId: "tiktok", locale: "en", contentRevision: 0, asset: asset("English stale") }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(stale.status).toBe(409);
    expect((await jsonOf(stale)).code).toBe("CONFLICT");
    const saved = storedPack(await loadTask(taskId)).content_generate?.output;
    expect(saved?.captionsEn?.tiktok).toContain("English saved");
    expect(saved?.captionsEn?.tiktok).not.toContain("English stale");
    expect(saved?.captions.tiktok).toContain("抖音中文");
  });

  it("accepts a historical package that has no contentRevision", async () => {
    const taskId = await insertTask({ content: pack(), historical: true });
    const response = await routes.patchPack(
      new Request("http://127.0.0.1/marketing-pack", {
        method: "PATCH",
        body: JSON.stringify({ platformId: "instagram", locale: "zh", contentRevision: 0, asset: asset("IG更新") }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(200);
    const stored = storedPack(await loadTask(taskId));
    expect(stored.content_generate?.contentRevision).toBe(1);
    expect(stored.vision_analyze?.output?.transcriptSummary).toBe("kept");
    expect(stored.content_generate?.output?.captions.instagram).toContain("IG更新");
  });
});

describe("postgres marketing budget and authorization", () => {
  it("blocks client_viewer before any model call", async () => {
    authState.userId = viewerId;
    callJsonModel.mockReset();
    const taskId = await insertTask({ content: pack() });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(403);
    expect(callJsonModel).not.toHaveBeenCalled();
    authState.userId = editorId;
  });

  it("does not call the model again when the requested locale is already stored", async () => {
    callJsonModel.mockReset();
    const taskId = await insertTask({ content: pack(), revision: 0 });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(200);
    expect((await jsonOf(response)).usage).toEqual({ input: 0, output: 0, costUsd: 0 });
    expect(callJsonModel).not.toHaveBeenCalled();
    expect(Number((await loadTask(taskId)).costUsd)).toBe(0);
  });

  it("returns 402 and does not call the model when the budget is already spent", async () => {
    callJsonModel.mockReset();
    const taskId = await insertTask({ content: needsModelTranslation(pack()), costUsd: "0.50", budget: "0.50" });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(402);
    expect((await jsonOf(response)).code).toBe("BUDGET_EXCEEDED");
    expect(callJsonModel).not.toHaveBeenCalled();
  });

  it("lets only one concurrent paid translation through the shared budget", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockImplementation(async () => ({
      result: {
        hooksEn: ["Opening hook"],
        hooksMs: ["Cangkuk"],
        ctaEn: ["Learn more"],
        ctaMs: ["Ketahui"],
        captionsEn: { tiktok: "TikTok English", instagram: "IG English" },
        captionsMs: { tiktok: "TikTok Melayu", instagram: "IG Melayu" },
      },
      usage: { input: 20, output: 10, costUsd: 0.04 },
    }));
    const bare = pack();
    bare.hooks = [{ text: "开场钩子", type: "curiosity" }];
    bare.cta = [{ text: "立即了解" }];
    bare.captionsEn = undefined;
    bare.captionsMs = undefined;
    const taskId = await insertTask({ content: bare, costUsd: "0", budget: "0.05" });
    const [a, b] = await Promise.all([
      routes.translate(
        new Request("http://127.0.0.1/translate", {
          method: "POST",
          body: JSON.stringify({ locale: "en", contentRevision: 0 }),
        }),
        { params: Promise.resolve({ id: taskId }) }
      ),
      routes.translate(
        new Request("http://127.0.0.1/translate", {
          method: "POST",
          body: JSON.stringify({ locale: "en", contentRevision: 0 }),
        }),
        { params: Promise.resolve({ id: taskId }) }
      ),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 402]);
    expect(callJsonModel).toHaveBeenCalledTimes(1);
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.04, 5);
    const logs = (await dbApi.getDb().select().from(dbApi.schema.agentLogs)).filter((row) => row.taskId === taskId);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.agent).toBe("marketing_translate");
    expect(Number(logs[0]?.costUsd)).toBeCloseTo(0.04, 5);
  });

  it("does not overwrite content when translation is incomplete, and records the spent usage", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({
      result: { hooksEn: ["你好"], hooksMs: [], ctaEn: [], ctaMs: [], captionsEn: {}, captionsMs: {} },
      usage: { input: 5, output: 1, costUsd: 0.01 },
    });
    const taskId = await insertTask({ content: needsModelTranslation(pack()) });
    const before = storedPack(await loadTask(taskId)).content_generate?.output?.captions.tiktok;
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(422);
    expect((await jsonOf(response)).code).toBe("TRANSLATION_INCOMPLETE");
    const after = await loadTask(taskId);
    expect(storedPack(after).content_generate?.output?.captions.tiktok).toBe(before);
    expect(storedPack(after).content_generate?.contentRevision ?? 0).toBe(0);
    expect(Number(after.costUsd)).toBeCloseTo(0.01, 5);
  });

  it("does not charge or persist when the model call throws", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockRejectedValue(new Error("provider down"));
    const taskId = await insertTask({ content: pack(), costUsd: "0.02", budget: "0.50" });
    const response = await routes.regenerate(
      new Request("http://127.0.0.1/regenerate", {
        method: "POST",
        body: JSON.stringify({ platformId: "tiktok", locale: "zh", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.02, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
    expect(storedPack(task).content_generate?.output?.captions.tiktok).toContain("抖音中文");
    const logs = (await dbApi.getDb().select().from(dbApi.schema.agentLogs)).filter((row) => row.taskId === taskId);
    expect(logs).toHaveLength(0);
  });

  it("keeps an unexpired reservation from starting another paid call", async () => {
    callJsonModel.mockReset();
    const taskId = await insertTask({
      content: needsModelTranslation(pack()),
      costUsd: "0.50",
      budget: "0.50",
      budgetHold: {
        spentBefore: 0,
        budget: 0.5,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(402);
    expect((await jsonOf(response)).code).toBe("BUDGET_EXCEEDED");
    expect(callJsonModel).not.toHaveBeenCalled();
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.5, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeTruthy();
  });

  it("recovers a budget reservation left by an interrupted request after the hold expires", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({
      result: {
        hooksEn: ["Opening hook"],
        hooksMs: ["Cangkuk"],
        ctaEn: ["Learn more"],
        ctaMs: ["Ketahui"],
        captionsEn: { tiktok: "TikTok English", instagram: "IG English" },
        captionsMs: { tiktok: "TikTok Melayu", instagram: "IG Melayu" },
      },
      usage: { input: 20, output: 10, costUsd: 0.04 },
    });
    const taskId = await insertTask({
      content: needsModelTranslation(pack()),
      costUsd: "0.50",
      budget: "0.50",
      budgetHold: {
        spentBefore: 0,
        budget: 0.5,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(200);
    expect(callJsonModel).toHaveBeenCalledTimes(1);
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.04, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
  });

  it("does not rewind a recorded spend when an expired hold no longer matches the reserved amount", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({
      result: {
        hooksEn: ["Opening hook"],
        hooksMs: ["Cangkuk"],
        ctaEn: ["Learn more"],
        ctaMs: ["Ketahui"],
        captionsEn: { tiktok: "TikTok English", instagram: "IG English" },
        captionsMs: { tiktok: "TikTok Melayu", instagram: "IG Melayu" },
      },
      usage: { input: 4, output: 2, costUsd: 0.01 },
    });
    const taskId = await insertTask({
      content: needsModelTranslation(pack()),
      costUsd: "0.04",
      budget: "0.50",
      budgetHold: {
        spentBefore: 0,
        budget: 0.5,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    const response = await routes.translate(
      new Request("http://127.0.0.1/translate", {
        method: "POST",
        body: JSON.stringify({ locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(200);
    const task = await loadTask(taskId);
    expect(Number(task.costUsd)).toBeCloseTo(0.05, 5);
    expect((task.stepProgress as Record<string, unknown>).marketing_budget_hold).toBeUndefined();
  });

  it("does not mint a local test session in a production process", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.E2E_LOCAL_AUTH;
    const previousSecret = process.env.E2E_LOCAL_AUTH_SECRET;
    process.env.E2E_LOCAL_AUTH = "1";
    process.env.E2E_LOCAL_AUTH_SECRET = "cert-secret";
    try {
      process.env.NODE_ENV = "production";
      const route = await import("../apps/web/src/app/api/e2e/session/route");
      expect((await route.GET()).status).toBe(404);
      process.env.NODE_ENV = "development";
      expect((await route.GET()).status).toBe(200);
      const denied = await route.POST(
        new Request("http://127.0.0.1/api/e2e/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: editorId }),
        })
      );
      expect(denied.status).toBe(403);
      const minted = await route.POST(
        new Request("http://127.0.0.1/api/e2e/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-e2e-auth-secret": "cert-secret" },
          body: JSON.stringify({ userId: editorId }),
        })
      );
      expect(minted.status).toBe(200);
      expect(minted.headers.get("set-cookie") ?? "").toContain("emberos_e2e_session");
      const stranger = await route.POST(
        new Request("http://127.0.0.1/api/e2e/session", {
          method: "POST",
          headers: { "content-type": "application/json", "x-e2e-auth-secret": "cert-secret" },
          body: JSON.stringify({ userId: crypto.randomUUID() }),
        })
      );
      expect(stranger.status).toBe(403);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) delete process.env.E2E_LOCAL_AUTH;
      else process.env.E2E_LOCAL_AUTH = previousFlag;
      if (previousSecret === undefined) delete process.env.E2E_LOCAL_AUTH_SECRET;
      else process.env.E2E_LOCAL_AUTH_SECRET = previousSecret;
    }
  });

  it("does not save template copy when regeneration output is unusable", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({ result: { not: "an asset" }, usage: { input: 3, output: 1, costUsd: 0.01 } });
    const taskId = await insertTask({ content: pack() });
    const response = await routes.regenerate(
      new Request("http://127.0.0.1/regenerate", {
        method: "POST",
        body: JSON.stringify({ platformId: "tiktok", locale: "en", contentRevision: 0 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(response.status).toBe(422);
    expect((await jsonOf(response)).code).toBe("REGENERATION_FAILED");
    const task = await loadTask(taskId);
    expect(storedPack(task).content_generate?.output?.captionsEn?.tiktok).toBe("TikTok English");
    expect(Number(task.costUsd)).toBeCloseTo(0.01, 5);
  });
});

describe("postgres multilingual marketing persistence", () => {
  it("reloads locale-scoped edits, regeneration, and Xiaohongshu from the database", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({
      result: { caption: "新的抖音", cta: "来", hashtags: ["咖啡"] },
      usage: { input: 8, output: 4, costUsd: 0.02 },
    });
    const taskId = await insertTask({ content: pack(), revision: 0 });

    const english = await routes.patchPack(
      new Request("http://127.0.0.1/marketing-pack", {
        method: "PATCH",
        body: JSON.stringify({ platformId: "tiktok", locale: "en", contentRevision: 0, asset: asset("Updated English") }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(english.status).toBe(200);
    let stored = storedPack(await loadTask(taskId)).content_generate?.output;
    expect(stored?.captions.tiktok).toContain("抖音中文");
    expect(stored?.captionsMs?.tiktok).toContain("TikTok Melayu");
    expect(stored?.captionsEn?.tiktok).toContain("Updated English");

    const malay = await routes.patchPack(
      new Request("http://127.0.0.1/marketing-pack", {
        method: "PATCH",
        body: JSON.stringify({ platformId: "instagram", locale: "ms", contentRevision: 1, asset: asset("IG Melayu baru") }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(malay.status).toBe(200);
    stored = storedPack(await loadTask(taskId)).content_generate?.output;
    expect(stored?.captions.instagram).toContain("IG中文");
    expect(stored?.captionsEn?.instagram).toContain("IG English");
    expect(stored?.captionsMs?.instagram).toContain("IG Melayu baru");

    const regenerated = await routes.regenerate(
      new Request("http://127.0.0.1/regenerate", {
        method: "POST",
        body: JSON.stringify({ platformId: "tiktok", locale: "zh", contentRevision: 2 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(regenerated.status).toBe(200);
    expect(JSON.stringify(callJsonModel.mock.calls)).toContain("Ember Cafe");
    stored = storedPack(await loadTask(taskId)).content_generate?.output;
    expect(stored?.captions.tiktok).toContain("新的抖音");
    expect(stored?.captions.instagram).toContain("IG中文");
    expect(stored?.captionsEn?.tiktok).toContain("Updated English");
    expect(stored?.captionsMs?.instagram).toContain("IG Melayu baru");

    callJsonModel.mockResolvedValue({
      result: { caption: "小红书更新", cta: "收藏", hashtags: ["咖啡"] },
      usage: { input: 4, output: 2, costUsd: 0.01 },
    });
    const xhs = await routes.regenerate(
      new Request("http://127.0.0.1/regenerate", {
        method: "POST",
        body: JSON.stringify({ platformId: "xiaohongshu", locale: "en", contentRevision: 3 }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(xhs.status).toBe(200);
    stored = storedPack(await loadTask(taskId)).content_generate?.output;
    expect(stored?.captions.xiaohongshu).toContain("小红书更新");
    expect(stored?.captionsEn?.xiaohongshu ?? "").not.toContain("小红书更新");
    expect(stored?.voiceScripts["15s"]).toContain("十五秒脚本");
  });
});

describe("mocked marketing package flow", () => {
  it("persists fallback content, exports text without videos, and keeps the video gate", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({ result: { not: "a package" }, usage: { input: 1, output: 1, costUsd: 0 } });
    const { runMarketingContentAgent } = await import("../packages/agents/src/marketing-content");
    const { buildMarketingPackText } = await import("@ceo-agent/shared");
    const generated = await runMarketingContentAgent({
      campaignContext: {
        businessProfile: { tone: "warm", industry: "F&B", targetAudience: "locals", bannedWords: [], cta: "Visit" },
      } as never,
      strategy: strategy as never,
      vision: vision as never,
      campaignName: "Cafe",
      businessInformation: { companyName: "Ember Cafe", city: "Kuala Lumpur" },
    });
    expect(generated.contentPackage.contentOrigin).toBe("template_fallback");
    expect(generated.contentPackage.analysis?.estimatedCtr ?? "").toBe("");
    expect(callJsonModel).toHaveBeenCalledTimes(1);

    const taskId = await insertTask({ content: generated.contentPackage, revision: 0 });
    const downloaded = await routes.download(new Request("http://127.0.0.1/download"), {
      params: Promise.resolve({ id: taskId }),
    });
    expect(downloaded.status).toBe(200);
    const text = await downloaded.text();
    expect(text).toContain("template fallback");
    expect(text.toLowerCase()).not.toContain("system prompt");
    const direct = buildMarketingPackText(generated.contentPackage, "Cafe");
    expect(direct).toContain(generated.contentPackage.voiceScripts["15s"]);

    const video = await routes.exportPost(
      new Request("http://127.0.0.1/export", {
        method: "POST",
        body: JSON.stringify({ platforms: ["tiktok"], resolution: "720p" }),
      }),
      { params: Promise.resolve({ id: taskId }) }
    );
    expect(video.status).toBe(409);
    expect((await jsonOf(video)).code).toBe("VALIDATION_ERROR");
  });
});
