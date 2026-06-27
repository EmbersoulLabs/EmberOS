import { describe, expect, it } from "vitest";
import {
  assessContentGrounding,
  applyGroundingToAnalysisScores,
} from "../src/content-grounding";

describe("content grounding scores", () => {
  it("heavily penalizes template vision fallback and internal strategy prompt", () => {
    const g = assessContentGrounding({
      vision: {
        confidence: 0.65,
        subjects: ["Flower Bouquet", "product showcase", "brand scene"],
        products: [{ name: "Flower Bouquet" }],
        scenes: [],
      },
      campaignName: "Flower Bouquet",
      strategyAngle: "Show real value for VIDEO ANALYSIS User Brief: (not provided — use automatic analysis) Background",
    });
    expect(g.isUngrounded).toBe(true);
    expect(g.scorePenalty).toBeGreaterThanOrEqual(28);

    const adjusted = applyGroundingToAnalysisScores(
      { marketingScore: 78, hookScore: 82, seoScore: 74, emotionalScore: 80, conversionScore: 76 },
      g.scorePenalty
    );
    expect(adjusted.marketingScore).toBeLessThanOrEqual(45);
    expect(adjusted.hookScore).toBeLessThanOrEqual(45);
  });
});
