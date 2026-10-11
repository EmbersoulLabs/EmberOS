import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STRATEGY_CONFIDENCE_CATEGORY,
  STRATEGY_JSON_CONTRACT,
  buildMarketingCreativeFactContract,
  contentAllowsTranslation,
  contentIsCommerciallyReady,
  evaluateContentContract,
  evaluateStrategyContract,
  explicitScriptDurationSec,
  isMarketingInstructionLeak,
  normalizeSubtitleTimeline,
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
    broll: [
      "bouquet close-up 10 seconds",
      "hands arranging flowers 10 seconds",
      "ribbon being tied 8 seconds",
    ],
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

const THIRD_E2E_CONTENT = JSON.parse(readFileSync("tests/fixtures/marketing-v1-e2e-03-content.json", "utf8"));
const THIRD_E2E_STRATEGY = JSON.parse(readFileSync("tests/fixtures/marketing-v1-e2e-03-strategy.json", "utf8"));
const FLORIST = { ...FACTS, durationSec: 30 };

describe("subtitle timeline normalization", () => {
  it("preserves canonical cues and does not stretch them", () => {
    const result = evaluateContentContract(content({
      subtitleTimeline: [{ startSec: 0, endSec: 3, text: "Fresh flower bouquet", role: "hook" }],
    }), FLORIST);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.contentPackage?.subtitleTimeline).toEqual([{ startSec: 0, endSec: 3, text: "Fresh flower bouquet", role: "hook" }]);
  });

  it("normalizes legacy seconds, decimals, clock times, and milliseconds up to an explicit duration", () => {
    const timeline = normalizeSubtitleTimeline([
      { time: "0s", text: "Open" },
      { time: "2.5s", text: "Detail" },
      { time: "00:03", text: "Offer" },
      { time: "00:03.500", text: "Close" },
    ], 30);
    expect(timeline.ok).toBe(true);
    if (!timeline.ok) return;
    expect(timeline.timeline.map((cue) => [cue.startSec, cue.endSec, cue.text])).toEqual([
      [0, 2.5, "Open"],
      [2.5, 3, "Detail"],
      [3, 3.5, "Offer"],
      [3.5, 30, "Close"],
    ]);
  });

  it("rejects an open final cue when no authorized duration exists", () => {
    const timeline = normalizeSubtitleTimeline([{ time: "0s", text: "Open" }], undefined);
    expect(timeline.ok).toBe(false);
    if (timeline.ok) return;
    expect(timeline.issues[0]).toMatchObject({ code: "TIMELINE_END_UNBOUNDED", field: "subtitleTimeline[0].endSec", normalizable: false });
  });

  it("rejects non-monotonic, overlapping, zero-length, negative, beyond-duration, empty, and non-finite cues", () => {
    expect(normalizeSubtitleTimeline([{ time: "5s", text: "Later" }, { time: "2s", text: "Earlier" }], 30).ok).toBe(false);
    const overlap = normalizeSubtitleTimeline([{ startSec: 0, endSec: 5, text: "A" }, { startSec: 4, endSec: 8, text: "B" }], 30);
    expect(overlap.ok).toBe(false);
    if (!overlap.ok) expect(overlap.issues.some((issue) => issue.code === "TIMELINE_OVERLAP")).toBe(true);
    const zero = normalizeSubtitleTimeline([{ startSec: 1, endSec: 1, text: "A" }], 30);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.issues[0].code).toBe("TIMELINE_ZERO_DURATION");
    const negative = normalizeSubtitleTimeline([{ time: "-1s", text: "A" }], 30);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.issues[0]).toMatchObject({ code: "TIMELINE_NEGATIVE", field: "subtitleTimeline[0].startSec" });
    const beyond = normalizeSubtitleTimeline([{ startSec: 0, endSec: 31, text: "A" }], 30);
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.issues[0].code).toBe("TIMELINE_BEYOND_DURATION");
    const empty = normalizeSubtitleTimeline([{ time: "0s", text: " " }], 30);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.issues[0]).toMatchObject({ code: "TIMELINE_TEXT_EMPTY", field: "subtitleTimeline[0].text" });
    const infinite = normalizeSubtitleTimeline([{ startSec: Number.POSITIVE_INFINITY, endSec: 2, text: "A" }], 30);
    expect(infinite.ok).toBe(false);
    if (!infinite.ok) expect(infinite.issues[0].code).toBe("TIMELINE_NON_FINITE");
    expect(normalizeSubtitleTimeline([{ time: "soon", text: "A" }], 30).ok).toBe(false);
  });
});

describe("content grounding", () => {
  it("removes an unsupported ranking hashtag and keeps a geographic tag", () => {
    const result = evaluateContentContract(content({
      platformAssets: { tiktok: { caption: "Fresh flower bouquet", hashtags: ["#SingaporeGifts", "#bestflowerstore", "#BestFloristSG"], cta: "Follow" } },
    }), FLORIST);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.contentPackage?.platformAssets?.tiktok?.hashtags).toEqual(["#SingaporeGifts"]);
    expect(result.diagnostic.adjustments).toEqual(expect.arrayContaining([
      { field: "platformAssets.tiktok.hashtags", action: "remove", raw: "#bestflowerstore" },
      { field: "platformAssets.tiktok.hashtags", action: "remove", raw: "#BestFloristSG" },
    ]));
  });

  it("keeps ranking, shop, and delivery claims only when the profile authorizes them", () => {
    expect(evaluateStrategyContract(strategyObject({ marketingAngle: "Best florist in Singapore" }), {
      ...FACTS,
      description: "Voted best florist",
    }).diagnostic.ok).toBe(true);
    expect(evaluateContentContract(content({ cta: [{ text: "Visit our shop for exclusive designs." }] }), {
      ...FLORIST,
      address: "12 Orchard Road",
    }).diagnostic.ok).toBe(true);
    expect(evaluateContentContract(content({
      voiceScripts: {
        "15s": "Same-day delivery for this fresh flower bouquet.",
        "30s": "Same-day delivery for this fresh flower bouquet is ready for Singapore gift buyers.",
        "60s": "Same-day delivery for this fresh flower bouquet is ready for Singapore gift buyers who need it today.",
      },
    }), { ...FLORIST, services: ["Fresh flower bouquet", "Same-day delivery"] }).diagnostic.ok).toBe(true);
  });

  it("rejects unsupported shop, delivery, discount, guarantee, and testimonial claims in required copy", () => {
    const shop = evaluateContentContract(content({ cta: [{ text: "Visit our shop for exclusive designs." }] }), FLORIST);
    expect(shop.contentPackage).toBeNull();
    expect(shop.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "cta[0].text", claimCategory: "location", normalizable: false, authorization: "business_profile" }),
    ]));
    expect(contentAllowsTranslation(shop.contentPackage)).toBe(false);
    expect(evaluateContentContract(content({
      voiceScripts: {
        "15s": "Free delivery on this fresh flower bouquet.",
        "30s": "Free delivery on this fresh flower bouquet for Singapore gift buyers today.",
        "60s": "Free delivery on this fresh flower bouquet for Singapore gift buyers today and tomorrow.",
      },
    }), FLORIST).diagnostic.fields).toContain("voiceScripts.15s");
    const discount = evaluateContentContract(content({ hooks: [{ text: "50% off this fresh flower bouquet", type: "offer" }] }), FLORIST);
    expect(discount.diagnostic.issues?.some((issue) => issue.claimCategory === "discount" && issue.field === "hooks[0].text")).toBe(true);
    expect(evaluateContentContract(content({ hooks: [{ text: "Guaranteed results for this bouquet", type: "offer" }] }), FLORIST).diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
    expect(evaluateContentContract(content({ hooks: [{ text: "Customers say this bouquet made their day", type: "proof" }] }), FLORIST).diagnostic.issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ claimCategory: "testimonial", normalizable: false })]));
    expect(evaluateContentContract(content({ hooks: [{ text: "Customers say this bouquet made their day", type: "proof" }] }), {
      ...FLORIST,
      description: "Customers say this bouquet made their day",
    }).diagnostic.ok).toBe(true);
  });

  it("allows geographic audience targeting in English, Chinese, and Malay", () => {
    const result = evaluateContentContract(content({
      voiceScripts: {
        "15s": "For customers in Singapore, this fresh flower bouquet is ready.",
        "30s": "For customers in Singapore, this fresh flower bouquet from Ember Florist Test is ready today.",
        "60s": "For customers in Singapore, this fresh flower bouquet from Ember Florist Test is ready today as a personal gift.",
      },
      voiceScriptsZh: {
        "15s": "适合新加坡送礼的人。",
        "30s": "适合新加坡送礼的人，今天可以选择新鲜花束。",
        "60s": "适合新加坡送礼的人，今天可以选择新鲜花束，作为一份用心的礼物。",
      },
      cta: [{ text: "Untuk pelanggan di Singapura", textMs: "Untuk pelanggan di Singapura" }],
    }), FLORIST);
    expect(result.diagnostic.ok).toBe(true);
    expect(contentAllowsTranslation(result.contentPackage)).toBe(true);
  });

  it("rejects Chinese and Malay physical-location claims without rewriting them", () => {
    const chinese = evaluateContentContract(content({
      voiceScriptsZh: { "30s": "鲜花就在新加坡市中心。" },
    }), FLORIST);
    expect(chinese.contentPackage).toBeNull();
    expect(chinese.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "voiceScriptsZh.30s", claimCategory: "location", excerpt: "市中心" }),
    ]));
    const malay = evaluateContentContract(content({ cta: [{ text: "Lawati kedai kami untuk buket." }] }), FLORIST);
    expect(malay.contentPackage).toBeNull();
    expect(malay.diagnostic.issues?.some((issue) => issue.claimCategory === "location")).toBe(true);
  });
});

describe("third real content response replay", () => {
  it("normalizes the subtitle timeline, removes the ranking tag, and still blocks translation", () => {
    const raw = structuredClone(THIRD_E2E_CONTENT);
    const hooks = JSON.stringify(raw.hooks);
    const cta = JSON.stringify(raw.cta);
    const scripts = JSON.stringify({
      voiceScripts: raw.voiceScripts,
      voiceScriptsEn: raw.voiceScriptsEn,
      voiceScriptsZh: raw.voiceScriptsZh,
    });
    const result = evaluateContentContract(raw, {
      ...FLORIST,
      providerRequestId: "chatcmpl-EXnKFxdeteqdqGeiCt94V6vqXUerM",
    });
    expect(explicitScriptDurationSec("Duration: 30 seconds.\nRequest: bouquet")).toBe(30);
    expect(explicitScriptDurationSec("about 30 seconds")).toBeUndefined();
    const normalized = normalizeSubtitleTimeline(THIRD_E2E_CONTENT.subtitleTimeline, 30);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.timeline.map((cue) => [cue.startSec, cue.endSec])).toEqual([[0, 5], [5, 10], [10, 15], [15, 30]]);
      expect(normalized.timeline.map((cue) => cue.text)).toEqual(THIRD_E2E_CONTENT.subtitleTimeline.map((cue: { text: string }) => cue.text));
    }
    expect(result.diagnostic.codes).not.toContain("CONTENT_SCHEMA_INVALID");
    expect(result.diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
    expect(JSON.stringify(raw.hooks)).toBe(hooks);
    expect(JSON.stringify(raw.cta)).toBe(cta);
    expect(raw.musicMood).toBe("elegant and inspiring");
    expect(JSON.stringify({
      voiceScripts: raw.voiceScripts,
      voiceScriptsEn: raw.voiceScriptsEn,
      voiceScriptsZh: raw.voiceScriptsZh,
    })).toBe(scripts);
    expect(result.diagnostic.ok).toBe(false);
    expect(result.diagnostic.stage).toBe("content");
    expect(result.diagnostic.schemaVersion).toBe("marketing-output-v1");
    expect(result.diagnostic.providerRequestId).toBe("chatcmpl-EXnKFxdeteqdqGeiCt94V6vqXUerM");
    expect(result.diagnostic.adjustments).toContainEqual({ field: "platformAssets.facebook.hashtags", action: "remove", raw: "#bestflowerstore" });
    expect(result.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "voiceScripts.30s", claimCategory: "location", excerpt: "right in the heart of" }),
      expect.objectContaining({ field: "cta[4].text", claimCategory: "location" }),
    ]));
    expect(result.contentPackage).toBeNull();
    expect(contentAllowsTranslation(result.contentPackage)).toBe(false);
    expect(JSON.stringify(result.diagnostic)).not.toContain(FACTS.brief);
  });

  it("removes the unsupported strategy ranking tag and keeps Singapore audience tags", () => {
    const result = evaluateStrategyContract(structuredClone(THIRD_E2E_STRATEGY), FACTS);
    expect(result.diagnostic.ok).toBe(true);
    expect(result.plan?.product).toBe("Fresh flower bouquet");
    expect(result.plan?.hashtags.local).toEqual(["#Singapore", "#SGgifts"]);
    expect(result.plan?.hashtags.seo).toEqual(["#floristSingapore"]);
    expect(result.diagnostic.adjustments).toContainEqual({ field: "hashtags.seo", action: "remove", raw: "#bestflowerstore" });
    expect(strategyAllowsContent(result)).toBe(true);
  });
});

const FOURTH_E2E_CONTENT = JSON.parse(readFileSync("tests/fixtures/marketing-v1-e2e-04-content.json", "utf8"));
const FOURTH_E2E_STRATEGY = JSON.parse(readFileSync("tests/fixtures/marketing-v1-e2e-04-strategy.json", "utf8"));
const CERTIFIED_FLORIST = {
  services: ["Fresh flower bouquet"],
  companyName: "Ember Florist Test",
  audience: "Singapore gift buyers",
  city: "Singapore",
  country: "Singapore",
  platforms: ["tiktok"],
};

describe("creative fact contract and CTA authority", () => {
  it("does not treat a Singapore market or a flower product as a shop or a delivery service", () => {
    const contract = buildMarketingCreativeFactContract({
      companyName: "Ember Florist Test",
      industry: "Florist",
      services: ["Fresh flower bouquet"],
      audience: "Singapore gift buyers",
      city: "Singapore",
      country: "Singapore",
    }, ["tiktok"]);
    expect(contract.authorizedProducts).toEqual(["Fresh flower bouquet"]);
    expect(contract.targetMarket).toBe("Singapore, Singapore");
    expect(contract.verifiedLocation).toBeNull();
    expect(contract.verifiedDelivery).toBe(false);
    expect(contract.verifiedPromotions).toBe(false);
    expect(contract.verifiedRankings).toBe(false);
    expect(contract.approvedCtaChannels).toEqual(["awareness", "follow"]);
    expect(contract.unavailable).toEqual(expect.arrayContaining(["physical shop", "delivery", "website ordering", "contact channel"]));
  });

  it("rejects an unauthorized website order and allows one when a website is verified", () => {
    const blocked = evaluateContentContract(content({ cta: [{ text: "Order this bouquet on our website" }] }), CERTIFIED_FLORIST);
    expect(blocked.contentPackage).toBeNull();
    expect(blocked.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "cta[0].text", claimCategory: "channel", normalizable: false }),
    ]));
    const allowed = evaluateContentContract(content({ cta: [{ text: "Order this bouquet on our website" }] }), {
      ...CERTIFIED_FLORIST,
      website: "https://emberflorist.example",
    });
    expect(allowed.diagnostic.ok).toBe(true);
    expect(contentIsCommerciallyReady(allowed)).toBe(true);
  });

  it("allows a storefront CTA only with a verified address", () => {
    const blocked = evaluateContentContract(content({ cta: [{ text: "Visit our store" }] }), CERTIFIED_FLORIST);
    expect(blocked.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ claimCategory: "location", excerpt: "Visit our store" }),
    ]));
    const allowed = evaluateContentContract(content({ cta: [{ text: "Visit our store" }] }), {
      ...CERTIFIED_FLORIST,
      address: "12 Orchard Road, Singapore",
    });
    expect(allowed.diagnostic.ok).toBe(true);
  });

  it("accepts a non-transactional awareness CTA when no contact channel exists", () => {
    const result = evaluateContentContract(content({
      cta: [{ text: "Follow for floral inspiration" }],
    }), { ...CERTIFIED_FLORIST, durationSec: 30 });
    expect(result.diagnostic.ok).toBe(true);
    expect(result.diagnostic.quality?.status).toBe("PASS");
    expect(contentAllowsTranslation(result.contentPackage)).toBe(true);
  });
});

describe("script duration and visual guidance", () => {
  it("rejects a short 30-second voiceover that does not allocate the remaining time", () => {
    const result = evaluateContentContract(content({
      broll: ["slow motion shots of vibrant flower bouquets being arranged"],
      voiceScripts: {
        ...content().voiceScripts,
        "30s": "At Ember Florist Test, we craft stunning flower bouquets that layer color and elegance, perfect for any occasion.",
      },
    }), { ...CERTIFIED_FLORIST, durationSec: 30 });
    expect(result.diagnostic.codes).toContain("SCRIPT_DURATION_SHORT");
    expect(result.contentPackage).toBeNull();
    const weak = evaluateContentContract(content({
      broll: ["slow motion shots of vibrant flower bouquets being arranged"],
    }), CERTIFIED_FLORIST);
    expect(weak.diagnostic.ok).toBe(true);
    expect(weak.diagnostic.quality?.status).toBe("FAIL");
    expect(contentIsCommerciallyReady(weak)).toBe(false);
    expect(contentAllowsTranslation(weak.contentPackage)).toBe(true);
    expect(result.diagnostic.quality?.dimensions.find((item) => item.name === "visualExecutability")?.score).toBe(2);
  });

  it("accepts a shorter voiceover when explicit visual beats cover the slot", () => {
    const result = evaluateContentContract(content({
      voiceScripts: {
        ...content().voiceScripts,
        "30s": "Singapore gift buyers can pause on a fresh flower bouquet from Ember Florist Test. The colors stay clear in the hand. One bouquet is enough for the occasion.",
      },
    }), { ...CERTIFIED_FLORIST, durationSec: 30 });
    expect(result.diagnostic.codes).not.toContain("SCRIPT_DURATION_SHORT");
    expect(result.diagnostic.ok).toBe(true);
  });
});

const FIFTEEN_SCRIPT = "Singapore gift buyers, look at this fresh flower bouquet. The colors are already together. Keep the idea for a later occasion.";
const THIRTY_SCRIPT = "A fresh flower bouquet sits in frame for Singapore gift buyers. Hands turn the stems until the colors read clearly. The ribbon finishes the shape. Ember Florist Test keeps the bouquet as the whole idea.";
const SIXTY_SCRIPT = "Start on a fresh flower bouquet, close enough to see the petals. Singapore gift buyers often need one clear gift, and this bouquet is that gift. Hands place one stem, then another, until the shape holds. The ribbon is tied, the paper is folded, and the bouquet is turned once toward the light. Ember Florist Test shows the finished flowers and nothing beyond that product. There is no extra promise, only the bouquet and the person it is for. The last shot holds the bouquet still so the colors can be read. Follow along if floral ideas are useful later.";

function groundedFlorist(duration: 15 | 30 | 60) {
  return content({
    voiceScripts: { "15s": FIFTEEN_SCRIPT, "30s": THIRTY_SCRIPT, "60s": SIXTY_SCRIPT },
    subtitleTimeline: [{ startSec: 0, endSec: duration, text: "Fresh flower bouquet" }],
  });
}

describe("positive florist creative fixtures", () => {
  it("accepts 15, 30, and 60 second grounded florist advertisements", () => {
    const fifteen = evaluateContentContract(groundedFlorist(15), { ...CERTIFIED_FLORIST, durationSec: 15 });
    const thirty = evaluateContentContract(groundedFlorist(30), { ...CERTIFIED_FLORIST, durationSec: 30 });
    const sixty = evaluateContentContract(groundedFlorist(60), { ...CERTIFIED_FLORIST, durationSec: 60 });
    expect(fifteen.diagnostic.ok).toBe(true);
    expect(thirty.diagnostic.ok).toBe(true);
    expect(sixty.diagnostic.ok).toBe(true);
    expect(contentIsCommerciallyReady(fifteen)).toBe(true);
    expect(contentIsCommerciallyReady(thirty)).toBe(true);
    expect(contentIsCommerciallyReady(sixty)).toBe(true);
  });

  it("accepts ordinary creative language and audience tags in English, Chinese, and Malay", () => {
    const result = evaluateContentContract(content({
      voiceScripts: {
        "15s": "新鲜花束给新加坡送礼的人。",
        "30s": "这束新鲜花束色彩清楚，适合新加坡送礼的人。花瓣靠近镜头。丝带收好之后，花束就是完整的礼物。",
        "60s": "镜头先停在新鲜花束上。新加坡送礼的人可以看到花瓣、包装和最后的完整花束。没有额外承诺，只有这束花。",
      },
      voiceScriptsZh: {
        "30s": "适合新加坡送礼的人，今天可以看看这束新鲜花束。",
      },
      cta: [{ text: "Follow for floral inspiration", textMs: "Ikuti untuk inspirasi bunga" }],
      captions: { tiktok: "Flowers for special occasions #SingaporeGifts" },
    }), { ...CERTIFIED_FLORIST, durationSec: 30 });
    expect(result.diagnostic.ok).toBe(true);
    const malay = evaluateContentContract(content({
      voiceScripts: {
        ...content().voiceScripts,
        "30s": "Bunga segar ini untuk pembeli hadiah di Singapura. Lihat kelopak, reben, dan bentuk akhir buket.",
      },
    }), { ...CERTIFIED_FLORIST, durationSec: 30 });
    expect(malay.diagnostic.ok).toBe(true);
    const tone = evaluateContentContract(content({
      hooks: [{ text: "A stunning fresh flower bouquet", type: "emotion" }],
      captions: { tiktok: "Elegant fresh flowers for a gift" },
    }), CERTIFIED_FLORIST);
    expect(tone.diagnostic.ok).toBe(true);
    expect(JSON.stringify(tone.diagnostic.issues ?? [])).not.toContain("stunning");
  });
});

describe("fourth real content response replay", () => {
  it("keeps the strategy valid and rejects the original content with fuller diagnostics", () => {
    const strategy = evaluateStrategyContract(structuredClone(FOURTH_E2E_STRATEGY), FACTS);
    expect(strategy.diagnostic.ok).toBe(true);
    expect(strategy.plan?.product).toBe("Fresh flower bouquet");
    const raw = structuredClone(FOURTH_E2E_CONTENT);
    const scripts = JSON.stringify(raw.voiceScripts);
    const result = evaluateContentContract(raw, {
      ...CERTIFIED_FLORIST,
      durationSec: 30,
      providerRequestId: "chatcmpl-EXoVAJLZYgBWp3bsR3Epr0ie9joEe",
    });
    expect(result.diagnostic.codes).not.toContain("CONTENT_SCHEMA_INVALID");
    expect(result.diagnostic.codes).toContain("UNSUPPORTED_CLAIM");
    expect(result.diagnostic.codes).toContain("SCRIPT_DURATION_SHORT");
    expect(result.diagnostic.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "voiceScripts.30s", excerpt: "Visit us in Singapore" }),
      expect.objectContaining({ field: "voiceScripts.30s", excerpt: "finest" }),
      expect.objectContaining({ field: "voiceScriptsZh.30s", excerpt: "最优质" }),
      expect.objectContaining({ field: "voiceScriptsZh.30s", excerpt: "欢迎来到" }),
      expect.objectContaining({ excerpt: "Visit our store" }),
      expect.objectContaining({ excerpt: "Visit us today" }),
    ]));
    expect(result.diagnostic.quality?.status).toBe("FAIL");
    expect(result.diagnostic.quality?.dimensions.find((item) => item.name === "visualExecutability")?.score).toBeLessThan(3);
    expect(result.contentPackage).toBeNull();
    expect(contentAllowsTranslation(result.contentPackage)).toBe(false);
    expect(contentIsCommerciallyReady(result)).toBe(false);
    expect(JSON.stringify(raw.voiceScripts)).toBe(scripts);
  });
});
