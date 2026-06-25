import { describe, expect, it } from "vitest";
import type { CopyVariant, EditPlan } from "@ceo-agent/shared";
import { narrationScriptChanged, syncEditPlanFromCopy } from "@ceo-agent/shared";

const basePlan: EditPlan = {
  aspectRatio: "9:16",
  targetDurationSec: 20,
  outputResolution: { preview: "720x1280", export: "1080x1920" },
  clips: [
    {
      assetId: "a1",
      startSec: 0,
      endSec: 10,
      speed: 1,
      outputDurationSec: 20,
    },
  ],
  subtitles: [{ startSec: 0, endSec: 5, text: "Old hook", style: "hook_en" }],
  cover: { atSec: 1 },
  audio: {
    keepOriginal: false,
    normalize: true,
    voiceover: {
      enabled: true,
      locale: "en",
      voice: "female",
      segments: [{ startSec: 0, endSec: 20, text: "Old hook. Old body. Old cta." }],
    },
  },
  finalScript: "Old hook. Old body. Old cta.",
};

const enVariant: CopyVariant = {
  id: "v-en",
  template: "pain_point",
  hook: "New hook",
  body: "New body line.",
  cta: "Shop now",
  title: "Title",
  tags: ["#test"],
  platform: "tiktok",
  locale: "en",
};

describe("syncEditPlanFromCopy", () => {
  it("updates finalScript and voiceover segment from edited copy", () => {
    const next = syncEditPlanFromCopy(basePlan, enVariant);
    expect(next.finalScript).toBe("New hook. New body line.. Shop now");
    expect(next.audio.voiceover?.segments?.[0]?.text).toBe("New hook. New body line.. Shop now");
    expect(narrationScriptChanged(basePlan, next)).toBe(true);
  });

  it("updates bilingual scripts when pair exists", () => {
    const zhVariant: CopyVariant = {
      ...enVariant,
      id: "v-zh",
      hook: "新开篇",
      body: "新正文。",
      cta: "立即购买",
      platform: "xiaohongshu",
      locale: "zh",
    };
    const next = syncEditPlanFromCopy(basePlan, zhVariant, enVariant);
    expect(next.finalScriptZh).toContain("新开篇");
    expect(next.finalScriptEn).toContain("New hook");
  });
});
