import { describe, expect, it } from "vitest";
import {
  STRATEGY_CONFIDENCE_CATEGORY,
  STRATEGY_JSON_CONTRACT,
  contentAllowsTranslation,
  evaluateContentContract,
  evaluateStrategyContract,
  isMarketingInstructionLeak,
  strategyAllowsContent,
} from "@ceo-agent/shared";

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
});

const SECOND_E2E_STRATEGY = {
  industry: "florist",
  businessType: "retail",
  product: "Fresh flower bouquet",
  marketingGoal: "awareness",
  marketingAngle: "Create a high-end feel through layering and color combinations.",
  brandPersonality: ["warm"],
  tone: "friendly",
  videoStyle: "emotional and visually appealing",
  audience: {
    interests: ["gifting", "home decor", "event planning"],
    painPoints: ["struggling to find high-quality flower arrangements"],
    location: "Singapore",
    desiredOutcome: "to receive a beautiful, high-end flower bouquet",
  },
  customerJourney: "awareness",
  platformPriority: ["tiktok"],
  ctaStrategy: ["Direct message for similar arrangements", "Save for future reference during holidays", "Follow for more floral inspiration"],
  keywords: ["flowers", "floral arrangements", "gift ideas"],
  hashtags: {
    industry: ["#florist", "#freshflowers"],
    local: ["#SingaporeFlowers", "#SGFlorist"],
    trending: ["#FlowerBouquet", "#GiftIdeas"],
    seo: ["#FlowerDeliverySG", "#SingaporeGifts"],
  },
  confidence: "high",
};

describe("strategy contract compatibility", () => {
  it("describes the canonical strategy schema without an opaque Zod object", () => {
    expect(STRATEGY_JSON_CONTRACT).toContain("ctaStrategy: string");
    expect(STRATEGY_JSON_CONTRACT).toContain("confidence: number from 0 to 1");
    expect(STRATEGY_JSON_CONTRACT).not.toContain("ZodObject");
    expect(STRATEGY_JSON_CONTRACT).toContain("Do not add delivery");
  });

  it("keeps a historical string CTA and numeric-string confidence", () => {
    const result = evaluateStrategyContract(strategy(), FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.ctaStrategy).toBe("Come see the bouquets");
    expect(result.plan?.confidence).toBe(0.8);
  });

  it("accepts a CTA array with one item", () => {
    const result = evaluateStrategyContract(strategyObject({ ctaStrategy: ["  Come see the bouquets  "] }), FACTS);
    expect(result.plan?.ctaStrategy).toBe("Come see the bouquets");
  });

  it("joins compatible CTA suggestions without adding a new promise", () => {
    const result = evaluateStrategyContract(strategyObject({
      ctaStrategy: ["Show the bouquet", "Invite viewers to enquire"],
    }), FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.ctaStrategy).toBe("Show the bouquet and invite viewers to enquire.");
  });

  it("rejects CTA options that make contradictory promises", () => {
    const result = evaluateStrategyContract(strategyObject({
      ctaStrategy: ["Buy now with 50% discount", "No promotion available"],
    }), FACTS);
    expect(result.diagnostic.codes).toContain("CTA_CONFLICT");
    expect(result.diagnostic.fields).toContain("ctaStrategy");
    expect(result.plan).toBeNull();
    expect(strategyAllowsContent(result)).toBe(false);
  });

  it("rejects an empty CTA array", () => {
    const result = evaluateStrategyContract(strategyObject({ ctaStrategy: [" ", ""] }), FACTS);
    expect(result.diagnostic.codes).toContain("CTA_MISSING");
    expect(result.diagnostic.fields).toContain("ctaStrategy");
    expect(result.plan).toBeNull();
  });

  it("maps high, medium, and low confidence categories", () => {
    expect(evaluateStrategyContract(strategyObject({ confidence: "high" }), FACTS).plan?.confidence).toBe(STRATEGY_CONFIDENCE_CATEGORY.high);
    expect(evaluateStrategyContract(strategyObject({ confidence: "Medium" }), FACTS).plan?.confidence).toBe(STRATEGY_CONFIDENCE_CATEGORY.medium);
    expect(evaluateStrategyContract(strategyObject({ confidence: "low" }), FACTS).plan?.confidence).toBe(STRATEGY_CONFIDENCE_CATEGORY.low);
    const high = evaluateStrategyContract(strategyObject({ confidence: "high" }), FACTS);
    expect(high.diagnostic.adjustments).toContainEqual({ field: "confidence", action: "map", raw: "high", result: 0.8 });
  });

  it("accepts an in-range numeric confidence", () => {
    expect(evaluateStrategyContract(strategyObject({ confidence: 0.42 }), FACTS).plan?.confidence).toBe(0.42);
  });

  it("rejects an unknown confidence label instead of defaulting high", () => {
    const result = evaluateStrategyContract(strategyObject({ confidence: "very high" }), FACTS);
    expect(result.diagnostic.codes).toContain("CONFIDENCE_UNKNOWN");
    expect(result.diagnostic.fields).toContain("confidence");
    expect(result.plan).toBeNull();
  });

  it("rejects confidence outside 0 to 1 and contradictory representations", () => {
    expect(evaluateStrategyContract(strategyObject({ confidence: -0.2 }), FACTS).diagnostic.codes).toContain("CONFIDENCE_OUT_OF_RANGE");
    expect(evaluateStrategyContract(strategyObject({ confidence: 1.5 }), FACTS).diagnostic.codes).toContain("CONFIDENCE_OUT_OF_RANGE");
    expect(evaluateStrategyContract(strategyObject({ confidence: 101 }), FACTS).diagnostic.codes).toContain("CONFIDENCE_OUT_OF_RANGE");
    const mixed = evaluateStrategyContract(strategyObject({ confidence: { label: "high", value: 0.2 } }), FACTS);
    expect(mixed.diagnostic.codes).toContain("CONFIDENCE_CONTRADICTORY");
    expect(mixed.plan).toBeNull();
    expect(evaluateStrategyContract(strategyObject({ confidence: "high or low" }), FACTS).diagnostic.codes).toContain("CONFIDENCE_CONTRADICTORY");
  });

  it("keeps an authorized delivery claim and a geographic hashtag", () => {
    const authorized = evaluateStrategyContract(strategyObject({
      hashtags: { industry: [], local: ["#SGFlorist"], trending: [], seo: ["#FlowerDeliverySG", "#SingaporeGifts"] },
    }), { ...FACTS, services: ["Fresh flower bouquet", "Same-day delivery"] });
    expect(authorized.diagnostic.ok).toBe(true);
    expect(authorized.plan?.hashtags.seo).toEqual(["#FlowerDeliverySG", "#SingaporeGifts"]);
    expect(authorized.plan?.hashtags.local).toEqual(["#SGFlorist"]);
  });

  it("removes an unsupported delivery hashtag and keeps geographic tags", () => {
    const result = evaluateStrategyContract(strategyObject({
      hashtags: { industry: [], local: ["#SingaporeFlowers"], trending: [], seo: ["#FlowerDeliverySG", "#SingaporeGifts"] },
    }), FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.hashtags.seo).toEqual(["#SingaporeGifts"]);
    expect(result.plan?.hashtags.local).toEqual(["#SingaporeFlowers"]);
    expect(JSON.stringify(result.plan)).not.toContain("FlowerDeliverySG");
    expect(result.diagnostic.adjustments).toContainEqual({ field: "hashtags.seo", action: "remove", raw: "#FlowerDeliverySG" });
  });

  it("rejects unsupported delivery, discount, guarantee, and ranking claims in required copy", () => {
    expect(evaluateStrategyContract(strategyObject({ ctaStrategy: "Free delivery" }), FACTS).diagnostic).toMatchObject({
      codes: ["UNSUPPORTED_CLAIM"],
      fields: ["ctaStrategy"],
    });
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "Same-day delivery" }), FACTS).diagnostic.fields).toContain("marketingAngle");
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "Guaranteed delivery" }), FACTS).diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "50% off" }), FACTS).diagnostic.fields).toContain("marketingAngle");
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "Best florist in Singapore" }), FACTS).diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "50% off" }), FACTS).plan).toBeNull();
  });

  it("replays the sanitized second real strategy response without another provider call", () => {
    const result = evaluateStrategyContract(SECOND_E2E_STRATEGY, FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.product).toBe("Fresh flower bouquet");
    expect(result.plan?.industry).toBe("florist");
    expect(result.plan?.audience.location).toBe("Singapore");
    expect(result.plan?.ctaStrategy).toBe("Direct message for similar arrangements, save for future reference during holidays, and follow for more floral inspiration.");
    expect(result.plan?.confidence).toBe(STRATEGY_CONFIDENCE_CATEGORY.high);
    expect(result.plan?.hashtags.seo).toEqual(["#SingaporeGifts"]);
    expect(JSON.stringify(result.plan)).not.toContain("FlowerDeliverySG");
    expect(JSON.stringify(result.plan)).not.toContain(FACTS.brief);
    expect(strategyAllowsContent(result)).toBe(true);
    expect(strategyAllowsContent(evaluateStrategyContract(strategyObject({ confidence: "very high" }), FACTS))).toBe(false);
  });
});

function strategyObject(overrides: Record<string, unknown>) {
  return { ...strategy(), hashtags: { industry: ["flowers"], local: [], trending: [], seo: [] }, ...overrides };
}
