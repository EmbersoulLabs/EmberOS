import { describe, expect, it } from "vitest";
import { resolveStoryAssetSemanticDecision } from "../apps/web/src/lib/ai-story-asset-semantic-grounding";

const base = {
  assetId: "10000000-0000-4000-8000-000000000001",
  analysisSnapshotId: "20000000-0000-4000-8000-000000000002",
  canonicalStoryText: "a clean tabletop advertisement",
  productCandidateNames: ["handheld appliance"],
  observedSummary: "pink handheld object",
};

describe("automatic generation strategy authority", () => {
  it("preserves confirmed Product mapping even when analyzer wording differs from Story wording", () => {
    expect(resolveStoryAssetSemanticDecision({
      ...base,
      usageType: "product_source",
      confirmedVariant: "Pink",
    })).toMatchObject({
      intent: "PRODUCT_IDENTITY",
      required: true,
      source: "HUMAN_SELECTION",
    });
  });

  it("does not force image conditioning merely because an unrelated Asset exists", () => {
    expect(resolveStoryAssetSemanticDecision({
      ...base,
      usageType: "generic_reference",
      confirmedVariant: null,
    })).toMatchObject({
      intent: "SUPPORTING",
      required: false,
      source: "CANONICAL_AUTHORITY",
    });
  });

  it("retains legacy semantic-name matching for an unconfirmed Product source", () => {
    expect(resolveStoryAssetSemanticDecision({
      ...base,
      usageType: "product_source",
      confirmedVariant: null,
      canonicalStoryText: "feature the handheld appliance",
    })).toMatchObject({
      intent: "PRODUCT_IDENTITY",
      required: true,
    });
  });
});
