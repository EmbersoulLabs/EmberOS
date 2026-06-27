import { describe, expect, it } from "vitest";
import {
  alignStrategyWithVision,
  hasSubstantiveVision,
  isCampaignLabel,
  isMarketingObjective,
  isTemplatedVisionFallback,
  resolveContentSubject,
} from "../src/content-subject";
import type { StrategyPlan } from "../src/types/marketing-os";
import type { VisionAnalysis } from "../src/types";

const vision: VisionAnalysis = {
  assetId: "a1",
  mediaType: "video",
  durationSec: 30,
  subjects: ["latte art", "barista"],
  scenes: [{ startSec: 0, endSec: 5, description: "Barista pouring oat milk latte", emotion: "cozy" }],
  products: [{ name: "oat milk latte", attributes: ["creamy", "handcrafted"] }],
  hooks: ["slow pour", "first sip"],
  suggestedMoments: [],
  primarySubject: { x: 0.5, y: 0.4, label: "latte" },
  transcriptSummary: "We use single-origin beans and oat milk for every cup.",
};

const emptyVision: VisionAnalysis = {
  assetId: "a2",
  mediaType: "video",
  durationSec: 10,
  subjects: ["营销素材", "产品展示"],
  scenes: [{ startSec: 0, endSec: 3, description: "营销素材实拍画面，产品与环境展示" }],
  products: [{ name: "营销素材" }],
  hooks: [],
  suggestedMoments: [],
};

describe("resolveContentSubject", () => {
  it("prefers vision product over campaign label", () => {
    expect(
      resolveContentSubject(vision, { campaignName: "Summer Promo 2026", goal: "brand awareness" })
    ).toBe("oat milk latte");
  });

  it("prefers description over campaign label when vision is generic", () => {
    expect(
      resolveContentSubject(emptyVision, {
        campaignName: "作品集",
        campaignBrief: "Handmade leather wallets for daily carry",
      })
    ).toBe("Handmade leather wallets for daily carry");
    expect(hasSubstantiveVision(emptyVision)).toBe(false);
  });

  it("uses campaign label only when no description and no asset signal", () => {
    expect(
      resolveContentSubject(emptyVision, { campaignName: "作品集" })
    ).toBe("作品集");
  });

  it("never returns a marketing objective as the subject", () => {
    // "Brand awareness" is a goal, not a product → fall back to campaign label.
    expect(
      resolveContentSubject(emptyVision, { campaignName: "作品集", goal: "Brand awareness" })
    ).toBe("作品集");
    // With no campaign label either, drop to a neutral generic subject, never the objective.
    expect(resolveContentSubject(emptyVision, { goal: "种草" })).toBe("这款产品");
    expect(isMarketingObjective("Brand awareness")).toBe(true);
    expect(isMarketingObjective("oat milk latte")).toBe(false);
  });

  it("uses a real product goal as subject when not an objective", () => {
    expect(
      resolveContentSubject(emptyVision, { goal: "Handmade leather wallets" })
    ).toBe("Handmade leather wallets");
  });

  it("detects templated vision fallback so it is not treated as real asset signal", () => {
    expect(
      isTemplatedVisionFallback({
        confidence: 0.65,
        subjects: ["Flower Bouquet", "product showcase", "brand scene"],
        products: [{ name: "Flower Bouquet" }],
        scenes: [],
      })
    ).toBe(true);
    expect(hasSubstantiveVision({
      confidence: 0.65,
      subjects: ["Flower Bouquet", "product showcase", "brand scene"],
      products: [{ name: "Flower Bouquet" }],
      scenes: [],
    }, "Flower Bouquet")).toBe(false);
    expect(
      isTemplatedVisionFallback({
        confidence: 0.82,
        subjects: ["blue rose bouquet", "gift wrap"],
        products: [{ name: "blue rose bouquet" }],
        scenes: [{ startSec: 0, endSec: 3, description: "Wrapped bouquet on table" }],
      })
    ).toBe(false);
    expect(
      hasSubstantiveVision(
        {
          confidence: 0.82,
          subjects: ["blue rose bouquet", "gift wrap"],
          products: [{ name: "blue rose bouquet" }],
          scenes: [{ startSec: 0, endSec: 3, description: "Wrapped bouquet on table" }],
        },
        "Flower Bouquet"
      )
    ).toBe(true);
  });

  it("detects when strategy product is just the campaign label", () => {
    expect(isCampaignLabel("Summer Promo 2026", "Summer Promo 2026")).toBe(true);
    expect(isCampaignLabel("oat milk latte", "Summer Promo 2026")).toBe(false);
  });

  it("replaces strategy.product when it matches campaign label", () => {
    const strategy: StrategyPlan = {
      industry: "restaurant",
      businessType: "Cafe",
      product: "Summer Promo 2026",
      marketingGoal: "Traffic",
      marketingAngle: "Show the pour",
      brandPersonality: ["Friendly"],
      tone: "Warm",
      videoStyle: "Product Showcase",
      audience: { painPoints: [], desiredOutcome: "", interests: [] },
      customerJourney: "Awareness",
      platformPriority: ["TikTok"],
      ctaStrategy: "Visit today",
      keywords: ["Summer Promo 2026"],
      hashtags: { industry: [], local: [], trending: [], seo: [] },
      confidence: 0.8,
    };

    const aligned = alignStrategyWithVision(strategy, vision, {
      campaignName: "Summer Promo 2026",
      goal: "drive foot traffic",
    });

    expect(aligned.product).toBe("oat milk latte");
    expect(aligned.keywords[0]).toBe("oat milk latte");
  });
});
