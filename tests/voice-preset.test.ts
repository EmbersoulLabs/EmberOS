import { describe, it, expect } from "vitest";
import { applyVoicePreset } from "../packages/agents/src/voice-preset";
import type { EditPlan } from "../packages/shared/src/types/index";

function basePlan(): EditPlan {
  return {
    aspectRatio: "9:16",
    targetDurationSec: 35,
    outputResolution: { preview: "720x1280", export: "1080x1920" },
    finalScript: "Fresh roses for every special moment.",
    finalScriptZh: "新鲜玫瑰，献给每一个特别时刻。",
    finalScriptEn: "Fresh roses for every special moment.",
    clips: [
      {
        assetId: "asset-1",
        sourceStartSec: 0,
        sourceEndSec: 35,
        outputDurationSec: 35,
      },
    ],
    subtitles: [],
    cover: { atSec: 0.4, overlayText: "Roses" },
    audio: {
      keepOriginal: false,
      bgm: "florist_soft",
      voiceover: { enabled: false, locale: "en" },
    },
    effects: [],
  };
}

describe("applyVoicePreset", () => {
  it("enables TTS segments when user selects female on a BGM-only clip", () => {
    const next = applyVoicePreset(basePlan(), "female");
    expect(next.audio.voiceover?.enabled).toBe(true);
    expect(next.audio.voiceover?.voice).toBe("female");
    expect(next.audio.voiceover?.segments?.[0]?.text).toContain("Fresh roses");
    expect(next.targetDurationSec).toBeGreaterThanOrEqual(35);
  });

  it("disables voiceover when user selects none", () => {
    const enabled = applyVoicePreset(applyVoicePreset(basePlan(), "female"), "none");
    expect(enabled.audio.voiceover?.enabled).toBe(false);
  });
});
