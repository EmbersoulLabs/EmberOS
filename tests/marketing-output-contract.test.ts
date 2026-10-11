import { describe, expect, it, vi } from "vitest";
import {
  contentAllowsTranslation,
  evaluateContentContract,
  evaluateStrategyContract,
  isMarketingInstructionLeak,
} from "@ceo-agent/shared";

vi.mock("@ceo-agent/db", () => ({
  beginPaidMarketingCall: vi.fn(async () => ({ ok: true, reservation: { taskId: "t", reservationId: "r", spentBefore: 0, budget: 0.5 } })),
  finishPaidMarketingCall: vi.fn(async () => undefined),
  cancelPaidMarketingCall: vi.fn(async () => undefined),
}));

const BRIEF = "Request: 帮我的花店生成一个30秒短视频广告。\nPromote only these authorized facts: Fresh flower bouquet.\nBusiness name: Ember Florist Test.\nDo not add prices.";
const FACTS = { services: ["Fresh flower bouquet"], companyName: "Ember Florist Test", brief: BRIEF };

function strategy(product = "Fresh flower bouquet") {
  return {
    industry: "florist",
    businessType: "Florist",
    product,
    marketingGoal: "Brand awareness",
    marketingAngle: "A personal gift",
    brandPersonality: ["warm"],
    tone: "warm",
    videoStyle: "product",
    audience: { interests: ["gifts"], painPoints: ["need a gift"], location: "Singapore" },
    customerJourney: "Awareness",
    platformPriority: ["TikTok"],
    ctaStrategy: "Come see the bouquets",
    keywords: ["bouquet"],
    hashtags: ["flowers"],
    confidence: "0.8",
  };
}

function content(overrides: Record<string, unknown> = {}) {
  return {
    voiceScripts: {
      "15s": "See this fresh flower bouquet.",
      "30s": "Singapore gift buyers can choose a fresh flower bouquet from Ember Florist Test today.",
      "60s": "Singapore gift buyers can choose a fresh flower bouquet from Ember Florist Test today, then take it home for someone they care about.",
    },
    hooks: [{ text: "A fresh flower bouquet is ready", type: "curiosity" }],
    cta: [{ text: "Come see today's bouquets" }],
    musicMood: "warm acoustic",
    captions: { tiktok: "Fresh flower bouquet" },
    ...overrides,
  };
}

describe("marketing output contract", () => {
  it("accepts a complete grounded strategy and equivalent field shapes", () => {
    const result = evaluateStrategyContract(strategy(), FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.product).toBe("Fresh flower bouquet");
    expect(result.plan?.hashtags.industry).toEqual(["flowers"]);
  });

  it("rejects a product that is the entire brief", () => {
    const result = evaluateStrategyContract(strategy(BRIEF), FACTS);
    expect(result.diagnostic.codes).toContain("PRODUCT_IS_BRIEF");
    expect(result.plan).toBeNull();
    expect(isMarketingInstructionLeak(BRIEF)).toBe(true);
  });

  it("rejects a missing product", () => {
    const result = evaluateStrategyContract(strategy("   "), FACTS);
    expect(result.diagnostic.codes).toContain("PRODUCT_MISSING");
  });

  it("accepts a complete content package and a nested alias shape", () => {
    expect(evaluateContentContract(content()).diagnostic.ok).toBe(true);
    const nested = evaluateContentContract({
      contentPackage: content({ hooks: undefined, hookList: [{ text: "A fresh flower bouquet is ready" }] }),
    });
    expect(nested.diagnostic.ok).toBe(true);
  });

  it("rejects missing hooks, cta, and music without fabricating them", () => {
    expect(evaluateContentContract(content({ hooks: undefined, voiceScripts: { "15s": "", "30s": "", "60s": "" } })).diagnostic.codes).toContain("HOOKS_MISSING");
    expect(evaluateContentContract(content({ cta: undefined })).diagnostic.codes).toContain("CTA_MISSING");
    expect(evaluateContentContract(content({ musicMood: undefined })).diagnostic.codes).toContain("MUSIC_MOOD_MISSING");
  });

  it("maps equivalent field names and accepts a package without optional analysis fields", () => {
    const aliased = evaluateContentContract(content({ musicMood: undefined, music_mood: "warm acoustic" }));
    expect(aliased.diagnostic.ok).toBe(true);
    expect(aliased.contentPackage?.musicMood).toBe("warm acoustic");
    expect(evaluateContentContract(content()).diagnostic.ok).toBe(true);
  });

  it("rejects an ungrounded product and an unsupported strategy claim", () => {
    expect(evaluateStrategyContract(strategy("Coffee beans"), FACTS).diagnostic.codes).toContain("PRODUCT_UNGROUNDED");
    const claimed = strategy();
    claimed.marketingAngle = "Guaranteed conversion";
    expect(evaluateStrategyContract(claimed, FACTS).diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
  });

  it("rejects template fallback and multilingual brief leakage before translation", () => {
    const fallback = evaluateContentContract(content({ contentOrigin: "template_fallback" }));
    expect(fallback.diagnostic.codes).toContain("TEMPLATE_FALLBACK");
    expect(contentAllowsTranslation(fallback.contentPackage)).toBe(false);
    const corrupted = evaluateContentContract(content({
      voiceScriptsEn: { "15s": BRIEF, "30s": `${BRIEF} translated leakage`, "60s": `${BRIEF} translated leakage continues` },
    }));
    expect(corrupted.diagnostic.codes).toContain("BRIEF_LEAKAGE");
  });

  it("rejects truncated JSON, brief leakage, unsupported claims, and blocks translation", () => {
    expect(evaluateContentContract("{").diagnostic.codes).toContain("CONTENT_JSON_TRUNCATED");
    const leaked = evaluateContentContract(content({
      voiceScripts: { "15s": BRIEF, "30s": `${BRIEF} and more words for the longer cut`, "60s": `${BRIEF} and more words for the longest cut of all` },
    }));
    expect(leaked.diagnostic.codes).toContain("BRIEF_LEAKAGE");
    expect(contentAllowsTranslation(leaked.contentPackage)).toBe(false);
    const claim = evaluateContentContract(content({
      voiceScripts: {
        "15s": "Guaranteed conversion on this fresh flower bouquet.",
        "30s": "Guaranteed conversion on this fresh flower bouquet for Singapore gift buyers today.",
        "60s": "Guaranteed conversion on this fresh flower bouquet for Singapore gift buyers today and tomorrow.",
      },
    }));
    expect(claim.diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
  });

  it("does not call translation after a failed content contract", async () => {
    const translate = vi.fn();
    const { generateInitialMarketingPackage } = await import("../packages/agents/src/marketing-budget.ts");
    const result = await generateInitialMarketingPackage({
      taskId: "t",
      orgId: "o",
      workspaceId: "w",
      generate: async () => ({
        contentPackage: null,
        usage: { input: 10, output: 5, costUsd: 0.01 },
        validation: { ok: false, stage: "content" as const, schemaVersion: "marketing-output-v1" as const, codes: ["HOOKS_MISSING"], fields: ["hooks"], fallback: "none" as const },
      }),
      translate,
    });
    expect(result.validation.ok).toBe(false);
    expect(result.translateUsage.costUsd).toBe(0);
    expect(translate).not.toHaveBeenCalled();
    const db = await import("@ceo-agent/db");
    expect(db.finishPaidMarketingCall).toHaveBeenCalledOnce();
    expect(db.cancelPaidMarketingCall).not.toHaveBeenCalled();
  });
});
