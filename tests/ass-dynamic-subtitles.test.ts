import { describe, expect, it } from "vitest";
import {
  ASS_COLOR_GOLD,
  ASS_CHAR_STAGGER_MS,
  buildAssAnimatedDialogueText,
  findSubtitleHighlightRanges,
  isIndexHighlighted,
} from "@ceo-agent/shared";

describe("findSubtitleHighlightRanges", () => {
  it("highlights prices and numbers", () => {
    const ranges = findSubtitleHighlightRanges("限时 $19.99 仅3天");
    expect(ranges.length).toBeGreaterThan(0);
    expect(isIndexHighlighted(4, ranges)).toBe(true);
  });

  it("highlights product names from keyword list", () => {
    const text = "EmberOS 让营销更简单";
    const ranges = findSubtitleHighlightRanges(text, ["EmberOS"]);
    expect(isIndexHighlighted(0, ranges)).toBe(true);
    expect(isIndexHighlighted(6, ranges)).toBe(true);
  });

  it("preserves full bilingual text in animated output", () => {
    const raw = "限时优惠99元\nFlash sale $9.99 only";
    const ass = buildAssAnimatedDialogueText(raw, ["Flash sale"]);
    const visible = ass.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n");
    expect(visible).toBe(raw);
    expect(ass).toContain("\\N");
    expect(ass).toContain(ASS_COLOR_GOLD);
    expect(ass).toContain("\\fscx130");
  });

  it("uses 0.1s stagger between characters", () => {
    const ass = buildAssAnimatedDialogueText("AB", []);
    expect(ass).toContain("\\t(0,");
    expect(ass).toContain(`\\t(${ASS_CHAR_STAGGER_MS},`);
  });
});

describe("buildAssAnimatedDialogueText", () => {
  it("does not alter visible characters", () => {
    const input = "你好 Hello 2024";
    const stripped = buildAssAnimatedDialogueText(input, [])
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/g, "\n");
    expect(stripped).toBe(input);
  });
});
