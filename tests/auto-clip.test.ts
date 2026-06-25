import { describe, it, expect } from "vitest";
import { pickAutoClipSegments } from "../packages/agents/src/auto-clip";
import type { VisionAnalysis } from "@ceo-agent/shared";

const baseVision: VisionAnalysis = {
  assetId: "asset-1",
  mediaType: "video",
  durationSec: 120,
  subjects: ["speaker"],
  scenes: [],
  products: [],
  hooks: ["hook a", "hook b", "hook c"],
  suggestedMoments: [
    { startSec: 10, endSec: 45, reason: "Strong opening" },
    { startSec: 55, endSec: 90, reason: "Key insight" },
    { startSec: 95, endSec: 115, reason: "Call to action moment" },
  ],
};

describe("pickAutoClipSegments", () => {
  it("returns 3 non-overlapping segments", () => {
    const segments = pickAutoClipSegments(baseVision, 120, 3);
    expect(segments).toHaveLength(3);
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const a = segments[i]!;
        const b = segments[j]!;
        expect(a.endSec <= b.startSec || b.endSec <= a.startSec).toBe(true);
      }
    }
  });

  it("falls back to evenly spaced windows when vision has no moments", () => {
    const vision: VisionAnalysis = { ...baseVision, suggestedMoments: [], scenes: [] };
    const segments = pickAutoClipSegments(vision, 90, 3);
    expect(segments).toHaveLength(3);
    expect(segments[0]!.startSec).toBeGreaterThanOrEqual(0);
  });
});
