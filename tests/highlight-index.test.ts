import { describe, it, expect } from "vitest";
import {
  buildHighlightIndex,
  pickSegmentsFromHighlightIndex,
} from "../packages/agents/src/highlight-index";
import type { VisionAnalysis } from "@ceo-agent/shared";

const baseVision: VisionAnalysis = {
  assetId: "asset-1",
  mediaType: "video",
  durationSec: 120,
  subjects: ["speaker"],
  scenes: [],
  products: ["product"],
  hooks: ["hook a", "hook b", "hook c"],
  suggestedMoments: [
    { startSec: 10, endSec: 45, reason: "Strong opening" },
    { startSec: 55, endSec: 90, reason: "Key insight" },
    { startSec: 95, endSec: 115, reason: "Product reveal" },
  ],
};

describe("buildHighlightIndex", () => {
  it("scores vision moments with five dimensions", () => {
    const index = buildHighlightIndex({
      vision: baseVision,
      sourceDurationSec: 120,
      keywords: ["product"],
    });
    expect(index.length).toBeGreaterThan(0);
    const top = index[0]!;
    expect(top.attentionScore).toBeGreaterThan(0);
    expect(top.engagementScore).toBeGreaterThan(0);
    expect(top.conversionScore).toBeGreaterThan(0);
    expect(top.educationalScore).toBeGreaterThan(0);
    expect(top.brandScore).toBeGreaterThan(0);
  });

  it("uses transcript segments for scoring", () => {
    const index = buildHighlightIndex({
      vision: baseVision,
      sourceDurationSec: 120,
      transcriptSegments: [
        { startSec: 12, endSec: 40, text: "product showcase and benefits" },
      ],
      keywords: ["product"],
    });
    expect(index.some((s) => s.conversionScore >= 30)).toBe(true);
  });
});

describe("pickSegmentsFromHighlightIndex", () => {
  it("returns 3 non-overlapping segments from scored index", () => {
    const index = buildHighlightIndex({
      vision: baseVision,
      sourceDurationSec: 120,
    });
    const segments = pickSegmentsFromHighlightIndex(index, 120, 3);
    expect(segments).toHaveLength(3);
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i]!;
        const b = segments[j]!;
        expect(a.endSec <= b.startSec || b.endSec <= a.startSec).toBe(true);
      }
    }
  });
});
