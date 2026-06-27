import { describe, expect, it } from "vitest";
import { alignStrategyWithVision, isCampaignLabel, resolveContentSubject } from "../src/content-subject";
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

describe("resolveContentSubject", () => {
  it("prefers vision product over campaign label", () => {
    expect(
      resolveContentSubject(vision, { campaignName: "Summer Promo 2026", goal: "brand awareness" })
    ).toBe("oat milk latte");
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
