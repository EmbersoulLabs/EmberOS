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

/** Karaoke-style pop: each spoken line scales up then settles, synced to its TTS chunk. */
const LINE_POP_MS = 280;
const LINE_POP_SCALE = 1.16;

/** Looping bounce (no TTS): a periodic scale pulse keeps static subtitles eye-catching. */
const BOUNCE_PERIOD_MS = 900;
const BOUNCE_SCALE = 1.12;
const BOUNCE_MAX_PULSES = 10;

export interface DialogueTextOptions {
  /** ASS &H00BBGGRR brand color for outline + pop emphasis. */
  brandColor?: string | null;
  /** Enable the per-line scale pop animation (TTS-synced emphasis). */
  pop?: boolean;
  /** Looping bounce for no-voiceover clips (keeps static lines lively). */
  bounce?: boolean;
  /** Subtitle on-screen duration (ms) — required to time the looping bounce. */
  durationMs?: number;
}

/** Build a repeating scale-pulse animation across the line's on-screen duration. */
function buildBounceScaleTag(baseScale: number, durationMs: number): string {
  const peak = Math.round(baseScale * BOUNCE_SCALE);
  const pulses = Math.max(1, Math.min(BOUNCE_MAX_PULSES, Math.floor(durationMs / BOUNCE_PERIOD_MS)));
  let tag = `\\fscx${baseScale}\\fscy${baseScale}`;
  for (let i = 0; i < pulses; i++) {
    const start = i * BOUNCE_PERIOD_MS;
    const mid = start + Math.round(BOUNCE_PERIOD_MS * 0.45);
    const end = start + BOUNCE_PERIOD_MS;
    tag +=
      `\\t(${start},${mid},\\fscx${peak}\\fscy${peak})` +
      `\\t(${mid},${end},\\fscx${baseScale}\\fscy${baseScale})`;
  }
  return tag;
}

/** Build ASS dialogue with fade-in + optional pop/bounce; preserves line breaks for bilingual subtitles. */
export function buildAssAnimatedDialogueText(
  text: string,
  _productNames: string[] = [],
  styleConfig?: SubtitleStyleConfig,
  options?: DialogueTextOptions
): string {
  const cfg = styleConfig ?? resolveSubtitleStyle("minimal");
  const brand = options?.brandColor?.trim() || null;
  const bounce = options?.bounce ?? false;
  const pop = options?.pop ?? true;
  const durationMs = options?.durationMs ?? 0;
  const outlineColor = brand ?? ASS_COLOR_BLACK;
  const outlinePx = brand ? Math.max(cfg.outlinePx, 2) : cfg.outlinePx;

  const lines = text.split("\n");
  const animatedLines = lines.map((line, lineIdx) => {
    if (!line) return "";
    const isSecondary = lineIdx > 0 && lines.length > 1;
    const scale = isSecondary ? 70 : 100;
    const bold = isSecondary ? (cfg.secondaryBold ? -1 : 0) : cfg.primaryBold ? -1 : 0;
    const popScale = Math.round(scale * LINE_POP_SCALE);
    let scaleTag: string;
    if (bounce && durationMs > 0) {
      scaleTag = buildBounceScaleTag(scale, durationMs);
    } else if (pop) {
      scaleTag = `\\fscx${popScale}\\fscy${popScale}\\t(0,${LINE_POP_MS},\\fscx${scale}\\fscy${scale})`;
    } else {
      scaleTag = `\\fscx${scale}\\fscy${scale}`;
    }
    const prefix =
      `{\\fad(${SUBTITLE_FADE_MS},0)\\c${cfg.primaryColor}` +
      (outlinePx > 0 ? `\\3c${outlineColor}\\bord${outlinePx}` : "") +
      (cfg.shadowPx > 0 ? `\\shad${cfg.shadowPx}` : "") +
      scaleTag +
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
