import { describe, it, expect } from "vitest";
import { recommendBgm, recommendBgmBatch } from "../packages/shared/src/bgm/recommend";
import { bgmAudioSourceKey, getBgmTrackById } from "../packages/shared/src/bgm/library";

describe("AI BGM engine", () => {
  it("recommends warm marketing music for florist sales", () => {
    const rec = recommendBgm({
      campaignBrief: "Luxury rose bouquet for Valentine's",
      videoArchetype: "sales",
      clipVariant: "product",
    });
    expect(rec.analysis.industry).toBe("florist");
    expect(rec.analysis.contentType).toBe("sales");
    expect(["retail_upbeat", "luxury_soft_piano", "emotional_warm"]).toContain(rec.trackId);
    expect(rec.license).toBe("royalty_free");
  });

  it("recommends cafe lifestyle tracks for coffee shop", () => {
    const rec = recommendBgm({
      campaignBrief: "Specialty coffee latte art cafe promotion",
      videoArchetype: "sales",
    });
    expect(rec.analysis.industry).toBe("cafe");
    expect(["cafe_upbeat", "retail_upbeat", "lifestyle_acoustic", "coffeehouse_calm"]).toContain(
      rec.trackId
    );
  });

  it("assigns unique tracks across batch (content multiplication)", () => {
    const batch = recommendBgmBatch(
      { campaignBrief: "Beauty salon premium treatment", industry: "beauty" },
      ["sales", "story", "engagement"]
    );
    const ids = batch.map((r) => r.trackId);
    expect(new Set(ids).size).toBe(3);
    expect(batch[0]!.analysis.contentType).toBe("sales");
    expect(batch[1]!.analysis.contentType).toBe("story");
    expect(batch[2]!.analysis.contentType).toBe("engagement");
  });

  it("does not repeat the same underlying mp3 across a 3-pack", () => {
    const batch = recommendBgmBatch(
      { campaignBrief: "Luxury rose bouquet for TikTok promotion", industry: "florist" },
      ["sales", "story", "engagement"]
    );
    const sourceKeys = batch.map((rec) => {
      const track = getBgmTrackById(rec.trackId);
      expect(track).toBeTruthy();
      return bgmAudioSourceKey(track!);
    });
    expect(new Set(sourceKeys).size).toBe(3);
  });
});
