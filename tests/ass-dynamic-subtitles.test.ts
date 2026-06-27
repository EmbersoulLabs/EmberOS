import { describe, expect, it } from "vitest";
import {
  ASS_COLOR_WHITE,
  buildAssAnimatedDialogueText,
  findSubtitleHighlightRanges,
  isIndexHighlighted,
  assFadeInTag,
} from "@ceo-agent/shared";

describe("findSubtitleHighlightRanges", () => {
  it("returns no highlight ranges (unified white subtitles)", () => {
    const ranges = findSubtitleHighlightRanges("限时 $19.99 仅3天");
    expect(ranges).toHaveLength(0);
    expect(isIndexHighlighted(4, ranges)).toBe(false);
  });
});

describe("buildAssAnimatedDialogueText", () => {
  it("preserves full bilingual text with fade-in tags", () => {
    const raw = "限时优惠99元\nFlash sale $9.99 only";
    const ass = buildAssAnimatedDialogueText(raw);
    const visible = ass.replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n");
    expect(visible).toBe(raw);
    expect(ass).toContain("\\N");
    expect(ass).toContain("\\fad(");
    expect(ass).not.toContain("\\fscx130");
    expect(ass).toContain(ASS_COLOR_WHITE);
  });

  it("uses fade animation, not per-char pop", () => {
    const ass = buildAssAnimatedDialogueText("AB", []);
    expect(ass).toContain("\\fad(");
    expect(ass).not.toMatch(/\\t\(\d+,/);
  });

  it("does not alter visible characters", () => {
    const input = "你好 Hello 2024";
    const stripped = buildAssAnimatedDialogueText(input, [])
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/g, "\n");
    expect(stripped).toBe(input);
  });

  it("assFadeInTag uses 200ms fade", () => {
    expect(assFadeInTag()).toContain("\\fad(200,0)");
  });
});
