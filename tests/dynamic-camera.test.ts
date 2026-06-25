import { describe, it, expect } from "vitest";
import {
  buildVirtualCuts,
  countVirtualBeats,
  inferSubjectFocus,
  buildHookTitleSubtitle,
} from "../packages/shared/src/dynamic-camera";
import type { VisionAnalysis } from "@ceo-agent/shared";

describe("dynamic-camera", () => {
  it("creates at least 4 virtual beats for a 12s clip", () => {
    expect(countVirtualBeats(12)).toBeGreaterThanOrEqual(4);
    const clips = buildVirtualCuts({
      assetId: "a1",
      sourceStartSec: 10,
      sourceEndSec: 30,
      outputDurationSec: 12,
      focus: { x: 0.5, y: 0.42 },
    });
    expect(clips.length).toBeGreaterThanOrEqual(4);
    expect(clips[0]!.motion).toBe("slow_zoom_in");
    expect(clips[1]!.motion).toBe("slow_zoom_out");
    expect(clips[2]!.motion).toBe("pan_left");
    expect(clips[3]!.motion).toBe("pan_right");
  });

  it("infers product-focused framing from vision", () => {
    const vision: VisionAnalysis = {
      assetId: "a1",
      mediaType: "video",
      subjects: ["bouquet"],
      scenes: [],
      products: [{ name: "Rose bouquet" }],
      hooks: [],
      suggestedMoments: [],
    };
    const focus = inferSubjectFocus(vision);
    expect(focus.y).toBeLessThan(0.5);
    expect(focus.x).toBe(0.5);
  });

  it("builds hook title card for first second", () => {
    const sub = buildHookTitleSubtitle("Stop scrolling — new drop", 12);
    expect(sub).not.toBeNull();
    expect(sub!.endSec).toBe(1);
    expect(sub!.style).toBe("tiktok_hook_card");
  });
});
