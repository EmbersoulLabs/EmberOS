/** EmberOS premium ASS subtitle styling — white text, subtle fade-in, no bounce. */

import {
  SUBTITLE_FADE_MS,
  type SubtitleStyleConfig,
  resolveSubtitleStyle,
} from "./subtitle-styles";

export const ASS_COLOR_WHITE = "&H00FFFFFF";
export const ASS_COLOR_BLACK = "&H00000000";

/** @deprecated Use fade animation instead of per-char pop. */
export const ASS_CHAR_STAGGER_MS = 0;
export const ASS_CHAR_POP_MS = 0;
/** @deprecated Gold highlights removed — unified white subtitles. */
export const ASS_COLOR_GOLD = ASS_COLOR_WHITE;

export type HighlightRange = { start: number; end: number };

export function findSubtitleHighlightRanges(_text: string, _productNames: string[] = []): HighlightRange[] {
  return [];
}

export function isIndexHighlighted(_index: number, _ranges: HighlightRange[]): boolean {
  return false;
}

function escapeAssTextChar(char: string): string {
  if (char === "\n") return "\\N";
  if (char === "{") return "\\{";
  if (char === "}") return "\\}";
  return char;
}

/** Subtle fade-in (0.2s) — stable text, no bounce/elastic/spring. */
export function assFadeInTag(fadeMs = SUBTITLE_FADE_MS): string {
  return `{\\fad(${fadeMs},0)\\c${ASS_COLOR_WHITE}\\3c${ASS_COLOR_BLACK}}`;
}

/** Build ASS dialogue with fade-in; preserves line breaks for bilingual subtitles. */
export function buildAssAnimatedDialogueText(
  text: string,
  _productNames: string[] = [],
  styleConfig?: SubtitleStyleConfig
): string {
  const cfg = styleConfig ?? resolveSubtitleStyle("minimal");
  const lines = text.split("\n");
  const animatedLines = lines.map((line, lineIdx) => {
    if (!line) return "";
    const isSecondary = lineIdx > 0 && lines.length > 1;
    const scale = isSecondary ? 70 : 100;
    const bold = isSecondary ? (cfg.secondaryBold ? -1 : 0) : cfg.primaryBold ? -1 : 0;
    const prefix =
      `{\\fad(${SUBTITLE_FADE_MS},0)\\c${cfg.primaryColor}` +
      (cfg.outlinePx > 0 ? `\\3c${ASS_COLOR_BLACK}\\bord${cfg.outlinePx}` : "") +
      (cfg.shadowPx > 0 ? `\\shad${cfg.shadowPx}` : "") +
      `\\fscx${scale}\\fscy${scale}` +
      (bold !== 0 ? `\\b${bold}` : "") +
      "}";
    return prefix + line.split("").map(escapeAssTextChar).join("");
  });
  return animatedLines.join("\\N");
}

/** @deprecated Per-char pop removed. */
export function assCharPopTag(_charIndex: number, _highlighted: boolean): string {
  return assFadeInTag();
}
