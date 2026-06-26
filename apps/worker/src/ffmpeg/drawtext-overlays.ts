import type { EditPlan } from "@ceo-agent/shared";
import { resolveDrawtextFontFile } from "./subtitle-fonts.js";

export const SUBTITLE_FADE_SEC = 0.3;
export const HOOK_TITLE_SEC = 3;

export interface DrawtextOverlayContext {
  width: number;
  height: number;
  fontFile: string;
  boldFontFile: string;
}

export function createDrawtextOverlayContext(width: number, height: number): DrawtextOverlayContext {
  return {
    width,
    height,
    fontFile: resolveDrawtextFontFile(false),
    boldFontFile: resolveDrawtextFontFile(true),
  };
}

function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/%/g, "\\%");
}

function escapeDrawtextPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function fadeAlphaExpression(revealSec: number): string {
  const end = revealSec + SUBTITLE_FADE_SEC;
  return `if(lt(t\\,${end.toFixed(3)})\\,(t-${revealSec.toFixed(3)})/${SUBTITLE_FADE_SEC}\\,1)`;
}

function estimateCharWidth(fontSize: number, char: string): number {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uff00-\uffef]/.test(char)
    ? fontSize * 0.92
    : fontSize * 0.55;
}

function subtitleFontSize(style: string, height: number): number {
  const scale = height / 1920;
  if (style.startsWith("cta")) return Math.round(56 * scale);
  if (style.includes("hook")) return Math.round(58 * scale);
  return Math.round(54 * scale);
}

function subtitleBaseY(style: string, height: number, lineIndex: number): number {
  const scale = height / 1920;
  const lineHeight = Math.round(58 * scale);
  if (style.startsWith("cta")) {
    return height - Math.round(160 * scale) - lineHeight * (lineIndex + 1);
  }
  return height - Math.round(200 * scale) - lineHeight * (lineIndex + 1);
}

function charDrawtextFilter(input: {
  char: string;
  x: number;
  y: number;
  fontSize: number;
  revealSec: number;
  endSec: number;
  ctx: DrawtextOverlayContext;
  bold?: boolean;
}): string {
  const { char, x, y, fontSize, revealSec, endSec, ctx, bold } = input;
  const font = escapeDrawtextPath(bold ? ctx.boldFontFile : ctx.fontFile);
  const text = escapeDrawtextText(char);
  return (
    `drawtext=fontfile='${font}':text='${text}':fontsize=${fontSize}` +
    `:fontcolor=white:borderw=3:bordercolor=black@0.95` +
    `:x=${Math.round(x)}:y=${Math.round(y)}` +
    `:enable='between(t\\,${revealSec.toFixed(3)}\\,${endSec.toFixed(3)})'` +
    `:alpha='${fadeAlphaExpression(revealSec)}'`
  );
}

function buildLineCharDrawtexts(
  line: string,
  startSec: number,
  endSec: number,
  style: string,
  ctx: DrawtextOverlayContext,
  y: number
): string[] {
  const chars = [...line.trim()];
  if (chars.length === 0) return [];

  const fontSize = subtitleFontSize(style, ctx.height);
  const totalWidth = chars.reduce((w, c) => w + (c === " " ? fontSize * 0.35 : estimateCharWidth(fontSize, c)), 0);
  let x = (ctx.width - totalWidth) / 2;

  const duration = Math.max(0.5, endSec - startSec);
  const stagger = Math.min(0.08, Math.max(0.04, (duration - SUBTITLE_FADE_SEC) / Math.max(chars.length, 1)));

  const filters: string[] = [];
  chars.forEach((char, i) => {
    if (char === " ") {
      x += fontSize * 0.35;
      return;
    }
    const revealSec = startSec + i * stagger;
    const cw = estimateCharWidth(fontSize, char);
    filters.push(
      charDrawtextFilter({
        char,
        x,
        y,
        fontSize,
        revealSec,
        endSec,
        ctx,
      })
    );
    x += cw;
  });
  return filters;
}

/** Per-character pop-in with 0.3s fade for each subtitle segment. */
export function buildAnimatedSubtitleDrawtextFilters(
  subtitles: EditPlan["subtitles"],
  ctx: DrawtextOverlayContext
): string[] {
  const filters: string[] = [];
  for (const sub of subtitles) {
    if (sub.style === "tiktok_hook_card") continue;
    const lines = sub.text.split("\n").filter((l: string) => l.trim());
    lines.forEach((line: string, lineIdx: number) => {
      const y = subtitleBaseY(sub.style, ctx.height, lineIdx);
      filters.push(...buildLineCharDrawtexts(line, sub.startSec, sub.endSec, sub.style, ctx, y));
    });
  }
  return filters;
}

/** Large centered hook title for the first 3 seconds (from copy_variants.title). */
export function buildHookTitleDrawtextFilters(
  title: string | undefined,
  ctx: DrawtextOverlayContext,
  durationSec = HOOK_TITLE_SEC
): string[] {
  const line = title?.trim().replace(/\s+/g, " ");
  if (!line) return [];

  const scale = ctx.height / 1920;
  const fontSize = Math.round(72 * scale);
  const endSec = Math.min(durationSec, HOOK_TITLE_SEC);
  const y = Math.round(ctx.height * 0.32);
  const chars = [...line.slice(0, 36)];
  const totalWidth = chars.reduce(
    (w, c) => w + (c === " " ? fontSize * 0.35 : estimateCharWidth(fontSize, c)),
    0
  );
  let x = (ctx.width - totalWidth) / 2;
  const stagger = 0.07;

  const filters: string[] = [];
  chars.forEach((char, i) => {
    if (char === " ") {
      x += fontSize * 0.35;
      return;
    }
    const revealSec = i * stagger;
    const cw = estimateCharWidth(fontSize, char);
    filters.push(
      charDrawtextFilter({
        char,
        x,
        y,
        fontSize,
        revealSec,
        endSec,
        ctx,
        bold: true,
      })
    );
    x += cw;
  });
  return filters;
}

export function buildDrawtextOverlayChain(
  editPlan: EditPlan,
  ctx: DrawtextOverlayContext
): string[] {
  return [
    ...buildHookTitleDrawtextFilters(editPlan.cover?.overlayText, ctx),
    ...buildAnimatedSubtitleDrawtextFilters(editPlan.subtitles, ctx),
  ];
}

/** Bottom-right logo overlay at 70% opacity, 20px inset. */
export function buildLogoOverlayFilterComplex(
  drawtextChain: string,
  logoInputIndex = 1
): { filterComplex: string; outputLabel: string } {
  const filterComplex =
    `[0:v]${drawtextChain}[vtxt];` +
    `[${logoInputIndex}:v]scale=120:-1,format=rgba,colorchannelmixer=aa=0.7[logo];` +
    `[vtxt][logo]overlay=W-w-20:H-h-20[vout]`;
  return { filterComplex, outputLabel: "vout" };
}

export function buildLogoOnlyFilterComplex(logoInputIndex = 1): {
  filterComplex: string;
  outputLabel: string;
} {
  return {
    filterComplex:
      `[0:v]copy[vtxt];` +
      `[${logoInputIndex}:v]scale=120:-1,format=rgba,colorchannelmixer=aa=0.7[logo];` +
      `[vtxt][logo]overlay=W-w-20:H-h-20[vout]`,
    outputLabel: "vout",
  };
}
