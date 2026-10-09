import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  applyPlatformLocaleEdit,
  applyPlatformRegeneration,
  buildMarketingPackText,
  commitMarketingPackRevision,
  deriveAnalysisFromPackage,
  displayPerformanceEstimate,
  isTaskBudgetExhausted,
  normalizeMarketingContentPackage,
  readMarketingPackRevision,
  selectBusinessFacts,
  type MarketingContentPackage,
  type PlatformMarketingAsset,
} from "@ceo-agent/shared";

const { callJsonModel } = vi.hoisted(() => ({ callJsonModel: vi.fn() }));
vi.mock("../packages/agents/src/llm", () => ({ callJsonModel }));

function asset(caption: string): PlatformMarketingAsset {
  return { caption, cta: "Buy", hashtags: ["local"] };
}

function pack(): MarketingContentPackage {
  const normalized = normalizeMarketingContentPackage({
    voiceScripts: { "15s": "十五秒", "30s": "三十秒", "60s": "六十秒" },
    voiceScriptsZh: { "15s": "中文口播", "30s": "", "60s": "" },
    voiceScriptsEn: { "15s": "English voice", "30s": "", "60s": "" },
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
    hooks: [{ text: "开场钩子", type: "curiosity" }],
    cta: [{ text: "立即了解" }],
    musicMood: "Upbeat",
    broll: ["Product close-up"],
    effects: ["Zoom"],
    platformAssets: {
      tiktok: asset("抖音中文"),
      instagram: asset("IG中文"),
      xiaohongshu: asset("小红书原文"),
    },
  });
  if (!normalized) throw new Error("fixture package failed to normalize");
  return normalized;
}

describe("marketing studio locale integrity", () => {
  it("editing English TikTok preserves Chinese and Malay TikTok", () => {
    const base = pack();
    const next = applyPlatformLocaleEdit(base, "tiktok", asset("Updated English"), "en");
    expect(next.captions.tiktok).toBe(base.captions.tiktok);
    expect(next.captionsMs?.tiktok).toBe(base.captionsMs?.tiktok);
    expect(next.captionsEn?.tiktok).toContain("Updated English");
    expect(next.platformAssets?.tiktok?.caption).toBe(base.platformAssets?.tiktok?.caption);
    expect(next.captions.instagram).toBe(base.captions.instagram);
  });

  it("keeps a stored Chinese caption when the platform asset also has a hook and CTA", () => {
    const normalized = normalizeMarketingContentPackage({
      voiceScripts: { "15s": "十五秒", "30s": "三十秒", "60s": "六十秒" },
      captions: {
        tiktok: "抖音中文",
        instagram: "",
        facebook: "",
        linkedin: "",
        xiaohongshu: "",
        youtubeShorts: "",
        googleBusiness: "",
      },
      hooks: [{ text: "钩子", type: "curiosity" }],
      cta: [{ text: "了解" }],
      platformAssets: {
        tiktok: { caption: "抖音中文", hook: "十秒钩子", cta: "立即了解", hashtags: ["cafe"] },
      },
    });
    expect(normalized?.captions.tiktok).toBe("抖音中文");
  });

  it("does not fold hook and CTA into the Chinese caption when English is saved", () => {
    const base = pack();
    base.captions = { ...base.captions, tiktok: "抖音中文" };
    base.platformAssets = {
      ...base.platformAssets,
      tiktok: { caption: "抖音中文", hook: "十秒钩子", cta: "立即了解", hashtags: ["cafe"] },
    };
    const next = applyPlatformLocaleEdit(
      base,
      "tiktok",
      { caption: "Updated English", hook: "十秒钩子", cta: "立即了解", hashtags: ["cafe"] },
      "en"
    );
    expect(next.captions.tiktok).toBe("抖音中文");
    expect(next.captionsEn?.tiktok).toBe("Updated English");
    expect(next.platformAssets?.tiktok?.caption).toBe("抖音中文");
  });

  it("editing Malay Instagram preserves Chinese and English Instagram", () => {
    const base = pack();
    const next = applyPlatformLocaleEdit(base, "instagram", asset("IG Melayu baru"), "ms");
    expect(next.captions.instagram).toBe(base.captions.instagram);
    expect(next.captionsEn?.instagram).toBe(base.captionsEn?.instagram);
    expect(next.captionsMs?.instagram).toContain("IG Melayu baru");
    expect(next.captions.tiktok).toBe(base.captions.tiktok);
  });

  it("regenerating TikTok does not modify Instagram", () => {
    const base = pack();
    const next = applyPlatformRegeneration(base, "tiktok", asset("新的抖音"), "zh");
    expect(next.captions.tiktok).toContain("新的抖音");
    expect(next.captions.instagram).toBe(base.captions.instagram);
    expect(next.captionsEn?.instagram).toBe(base.captionsEn?.instagram);
    expect(next.captionsMs?.tiktok).toBe(base.captionsMs?.tiktok);
  });

  it("keeps Xiaohongshu on the Chinese caption slot", () => {
    const base = pack();
    const next = applyPlatformLocaleEdit(base, "xiaohongshu", asset("小红书更新"), "en");
    expect(next.captions.xiaohongshu).toContain("小红书更新");
    expect(next.captionsEn?.xiaohongshu ?? "").toBe(base.captionsEn?.xiaohongshu ?? "");
    expect(next.platformAssets?.xiaohongshu?.caption).toContain("小红书更新");
  });

  it("reads a historical package that has no locale maps or origin", () => {
    const historical = normalizeMarketingContentPackage({
      voiceScripts: { "15s": "old", "30s": "", "60s": "" },
      captions: { tiktok: "old caption" },
      hooks: [{ text: "old hook", type: "direct" }],
      cta: [{ text: "old cta" }],
      musicMood: "",
    });
    expect(historical?.captions.tiktok).toBe("old caption");
    expect(historical?.contentOrigin).toBeUndefined();
    expect(readMarketingPackRevision({})).toBe(0);
  });
});

describe("marketing studio concurrency and cost guards", () => {
  it("rejects a stale revision and keeps the first writer's package", () => {
    let state = { revision: 1, value: "tiktok-a" };
    const first = commitMarketingPackRevision(state, 1, "tiktok-b");
    expect(first.conflict).toBe(false);
    if (!first.conflict) state = first.state;
    const second = commitMarketingPackRevision(state, 1, "instagram-c");
    expect(second.conflict).toBe(true);
    expect(second.state.value).toBe("tiktok-b");
    const otherPlatform = commitMarketingPackRevision(state, state.revision, "instagram-d");
    expect(otherPlatform.conflict).toBe(false);
  });

  it("treats a spent budget as exhausted and an incomplete spend as still allowed", () => {
    expect(isTaskBudgetExhausted("0.50", "0.50")).toBe(true);
    expect(isTaskBudgetExhausted("0.10", "0.50")).toBe(false);
    expect(isTaskBudgetExhausted("not-a-number", "0.50")).toBe(true);
  });
});

describe("marketing studio presentation and export", () => {
  it("does not present hardcoded pseudo estimates as analytics", () => {
    expect(displayPerformanceEstimate("2.4% – 4.1%")).toBe("");
    expect(displayPerformanceEstimate("Medium–High")).toBe("");
    expect(displayPerformanceEstimate("1.2% – 2.8%")).toBe("");
    const analysis = deriveAnalysisFromPackage({
      ...pack(),
      analysis: {
        marketingScore: 70,
        hookScore: 70,
        seoScore: 70,
        emotionalScore: 70,
        conversionScore: 70,
        estimatedCtr: "2.4% – 4.1%",
        estimatedEngagement: "Medium–High",
        estimatedConversion: "1.2% – 2.8%",
      },
    });
    expect(analysis.estimatedCtr).toBe("");
    expect(analysis.estimatedEngagement).toBe("");
    expect(analysis.estimatedConversion).toBe("");
    expect(analysis.marketingScore).toBeLessThanOrEqual(70);
  });

  it("exports scripts and captions without internal prompts", () => {
    const text = buildMarketingPackText(pack(), "Cafe");
    expect(text).toContain("十五秒");
    expect(text).toContain("中文口播");
    expect(text).toContain("English voice");
    expect(text).toContain("抖音中文");
    expect(text).toContain("TikTok English");
    expect(text).toContain("TikTok Melayu");
    expect(text).toContain("开场钩子");
    expect(text.toLowerCase()).not.toContain("system prompt");
    expect(text).not.toContain("OPENAI");
  });

  it("keeps only allowlisted business facts", () => {
    const facts = selectBusinessFacts(
      {
        companyName: "Ember Cafe",
        city: "Kuala Lumpur",
        services: ["Coffee"],
        businessDescription: "Roastery",
      },
      { tone: "warm", industry: "F&B", targetAudience: "office workers", bannedWords: [], cta: "Visit" }
    );
    expect(facts.companyName).toBe("Ember Cafe");
    expect(facts.city).toBe("Kuala Lumpur");
    expect(facts.approvedCta).toBe("Visit");
    expect(JSON.stringify(facts)).not.toContain("testimonial");
  });
});

describe("marketing content fallback origin", () => {
  it("marks an unusable model response as template fallback and does not call the model again", async () => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({ data: { not: "a package" }, usage: { input: 1, output: 1, costUsd: 0 } });
    const { runMarketingContentAgent } = await import("../packages/agents/src/marketing-content");
    const result = await runMarketingContentAgent({
      campaignContext: {
        businessProfile: { tone: "warm", industry: "F&B", targetAudience: "locals", bannedWords: [], cta: "Visit" },
        campaign: { name: "Cafe", objective: "awareness", platforms: ["tiktok"] },
      } as never,
      strategy: {
        industry: "restaurant",
        businessType: "cafe",
        product: "coffee",
        marketingGoal: "awareness",
        marketingAngle: "morning coffee",
        brandPersonality: ["warm"],
        tone: "warm",
        videoStyle: "lifestyle",
        audience: { interests: [], painPoints: [] },
        customerJourney: "discover",
        keywords: ["coffee"],
        hashtags: { trending: [], seo: [], local: [], industry: [] },
        platformPriority: ["tiktok"],
        ctaStrategy: "visit",
        confidence: 0.8,
      } as never,
      vision: {
        transcriptSummary: "A cup of coffee",
        scenes: [],
        subjects: [],
        products: [],
        hooks: [],
      } as never,
      campaignName: "Cafe",
      businessInformation: { companyName: "Ember Cafe", city: "Kuala Lumpur" },
    });
    expect(result.contentPackage.contentOrigin).toBe("template_fallback");
    expect(result.contentPackage.analysis?.estimatedCtr ?? "").toBe("");
    expect(callJsonModel).toHaveBeenCalledTimes(1);
  });
});

describe("marketing route contracts", () => {
  const patch = readFileSync("apps/web/src/app/api/tasks/[id]/marketing-pack/route.ts", "utf8");
  const regen = readFileSync("apps/web/src/app/api/tasks/[id]/marketing-pack/regenerate/route.ts", "utf8");
  const translate = readFileSync("apps/web/src/app/api/tasks/[id]/marketing-pack/translate/route.ts", "utf8");
  const download = readFileSync("apps/web/src/app/api/tasks/[id]/marketing-pack/download/route.ts", "utf8");
  const panel = readFileSync("apps/web/src/components/pipeline/MarketingPackagePanel.tsx", "utf8");
  const dashboard = readFileSync("apps/web/src/components/marketing-dashboard/MarketingDashboard.tsx", "utf8");
  const exportRoute = readFileSync("apps/web/src/app/api/tasks/[id]/export/route.ts", "utf8");

  it("scopes writes by locale and revision", () => {
    expect(patch).toContain("applyPlatformLocaleEdit");
    expect(patch).toContain('"CONFLICT"');
    expect(patch).toContain('"editor"');
    expect(regen).toContain("applyPlatformRegeneration");
    expect(regen).toContain("beginPaidMarketingCall");
    expect(translate).toContain("beginPaidMarketingCall");
    expect(translate).toContain('"editor"');
    expect(translate).not.toContain("client_viewer");
    expect(translate).toContain("TRANSLATION_INCOMPLETE");
    expect(download).toContain("client_viewer");
    expect(download).toContain("buildMarketingPackText");
    expect(exportRoute).toContain("AUTO_CLIP");
  });

  it("asks the client for one translation attempt and keeps drafts on conflict", () => {
    expect(panel).toContain("translateAttempts");
    expect(panel).toContain("[packLocale, taskId]");
    expect(panel).toContain("locale: packLocale");
    expect(panel).toContain('throw new Error("conflict")');
    expect(dashboard).toContain("marketing.action.conflict");
    expect(dashboard).toContain("marketing.origin.fallback");
    expect(dashboard).toContain("marketing.scripts.title");
    expect(dashboard).toContain("marketing.metric.unavailable");
  });
});

describe("local e2e auth gate", () => {
  it("stays disabled in production even when the flag and secret are set", async () => {
    const { e2eLocalAuthEnabled, readE2ESessionUser } = await import("../apps/web/src/lib/e2e-local-auth");
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.E2E_LOCAL_AUTH;
    const previousSecret = process.env.E2E_LOCAL_AUTH_SECRET;
    process.env.E2E_LOCAL_AUTH = "1";
    process.env.E2E_LOCAL_AUTH_SECRET = "unit-secret";
    try {
      process.env.NODE_ENV = "production";
      expect(e2eLocalAuthEnabled()).toBe(false);
      expect(await readE2ESessionUser("not-a-session")).toBeNull();
      process.env.NODE_ENV = "development";
      expect(e2eLocalAuthEnabled()).toBe(true);
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) delete process.env.E2E_LOCAL_AUTH;
      else process.env.E2E_LOCAL_AUTH = previousFlag;
      if (previousSecret === undefined) delete process.env.E2E_LOCAL_AUTH_SECRET;
      else process.env.E2E_LOCAL_AUTH_SECRET = previousSecret;
    }
  });
});
