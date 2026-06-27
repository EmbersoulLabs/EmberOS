import type { EditPlan } from "@ceo-agent/shared";
import { resolveDrawtextFontFile } from "./subtitle-fonts.js";

export const SUBTITLE_FADE_SEC = 0.2;
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

/** Hook title: bottom-left, SemiBold, fade + slide up — product stays visual hero. */
export function buildHookTitleDrawtextFilters(
  title: string | undefined,
  ctx: DrawtextOverlayContext,
  durationSec = HOOK_TITLE_SEC
): string[] {
  const line = title?.trim().replace(/\s+/g, " ");
  if (!line) return [];

  const scale = ctx.height / 1920;
  const fontSize = Math.round(44 * scale);
  const endSec = Math.min(durationSec, HOOK_TITLE_SEC);
  const marginX = Math.round(48 * scale);
  const marginY = Math.round(120 * scale);
  const y = ctx.height - marginY - fontSize;
  const font = escapeDrawtextPath(ctx.boldFontFile);
  const text = escapeDrawtextText(line.slice(0, 48));

  return [
    `drawtext=fontfile='${font}':text='${text}':fontsize=${fontSize}` +
      `:fontcolor=white@0.95:shadowcolor=black@0.4:shadowx=1:shadowy=2` +
      `:x=${marginX}:y=${y}` +
      `:enable='between(t\\,0\\,${endSec.toFixed(3)})'` +
      `:alpha='${fadeAlphaExpression(0)}'`,
  ];
}

export function buildHookOnlyDrawtextChain(
  _editPlan: EditPlan,
  _ctx: DrawtextOverlayContext
): string[] {
  // Hook title overlay removed — only ASS subtitles are burned in.
  return [];
}

export function buildDrawtextOverlayChain(
  editPlan: EditPlan,
  ctx: DrawtextOverlayContext
): string[] {
  return buildHookOnlyDrawtextChain(editPlan, ctx);
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

/** @deprecated Per-char subtitle drawtext removed — ASS handles body subtitles. */
export function buildAnimatedSubtitleDrawtextFilters(
  _subtitles: EditPlan["subtitles"],
  _ctx: DrawtextOverlayContext
): string[] {
  return [];
}
