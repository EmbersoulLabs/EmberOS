import { join } from "node:path";
import type { EditPlan } from "@ceo-agent/shared";
import {
  ASS_COLOR_WHITE,
  ASS_COLOR_BLACK,
  buildAssAnimatedDialogueText,
  resolveSubtitleStyle,
  SUBTITLE_MARGIN_V_PX,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStylePreset,
} from "@ceo-agent/shared";
import { ffmpegAssFontsDir, subtitleFontName } from "./subtitle-fonts.js";

function assStyleLine(
  name: string,
  fontSize: number,
  alignment: number,
  marginV: number,
  outline: number,
  marginH = 48,
  bold = -1,
  shadow = 2
): string {
  const fontName = subtitleFontName();
  return (
    `Style: ${name},${fontName},${fontSize},${ASS_COLOR_WHITE},${ASS_COLOR_BLACK},${ASS_COLOR_BLACK},&H80000000,` +
    `${bold},0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},${marginH},${marginH},${marginV},1`
  );
}

function formatAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** @param localFonts When true, cwd must be workDir and font file is copied beside subs.ass */
export function assVideoFilter(workDir: string, localFonts = false): string {
  if (localFonts) {
    return "ass='subs.ass':fontsdir='.'";
  }
  const assPath = join(workDir, "subs.ass").replace(/\\/g, "/").replace(/:/g, "\\:");
  return `ass='${assPath}':fontsdir='${ffmpegAssFontsDir()}'`;
}

export function collectSubtitleHighlightKeywords(editPlan: EditPlan): string[] {
  const keywords = new Set<string>();
  const overlay = editPlan.cover?.overlayText?.trim();
  if (overlay) keywords.add(overlay);
  const clipTitle = editPlan.clipMeta?.title?.trim();
  if (clipTitle) keywords.add(clipTitle);
  return [...keywords];
}

/** Premium minimal ASS: white SemiBold, subtle shadow, fade-in, safe-area bottom margin. */
export function buildAssSubtitles(
  subtitles: EditPlan["subtitles"],
  playResY: number,
  highlightKeywords: string[] = [],
  stylePreset: SubtitleStylePreset = DEFAULT_SUBTITLE_STYLE
): string {
  const cfg = resolveSubtitleStyle(stylePreset);
  const scale = playResY / 1920;
  const playResX = Math.round((playResY * 9) / 16);
  const font = subtitleFontName();
  const outline = Math.max(0, Math.round(cfg.outlinePx * scale));
  const shadow = Math.max(0, Math.round(cfg.shadowPx * scale));
  const marginV = Math.round(SUBTITLE_MARGIN_V_PX * scale);
  const primarySize = Math.round(cfg.fontSizePrimary * scale);
  const secondarySize = Math.round(cfg.fontSizeSecondary * scale);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("BrandHook", Math.round(48 * scale), 1, Math.round(120 * scale), outline, 56, -1, shadow)}
${assStyleLine("BrandBody", primarySize, 2, marginV, outline, 48, cfg.primaryBold ? -1 : 0, shadow)}
${assStyleLine("BrandBodySecondary", secondarySize, 2, marginV - Math.round(36 * scale), outline, 48, cfg.secondaryBold ? -1 : 0, shadow)}
Style: Default,${font},${primarySize},${ASS_COLOR_WHITE},${ASS_COLOR_BLACK},${ASS_COLOR_BLACK},&H80000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},2,48,48,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const styleMap: Record<string, string> = {
    tiktok_hook_card: "BrandHook",
    hook: "BrandBody",
    hook_zh: "BrandBody",
    hook_en: "BrandBody",
    bold_center: "BrandBody",
    body: "BrandBody",
    body_zh: "BrandBody",
    body_en: "BrandBodySecondary",
    cta: "BrandBody",
    cta_zh: "BrandBody",
    cta_en: "BrandBodySecondary",
  };

  const lines = subtitles.map((s: EditPlan["subtitles"][number]) => {
    if (s.style === "tiktok_hook_card") return null;
    const start = formatAssTime(s.startSec);
    const end = formatAssTime(s.endSec);
    const text = buildAssAnimatedDialogueText(s.text, highlightKeywords, cfg);
    const style = styleMap[s.style] ?? "BrandBody";
    return `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}`;
  });

  return header + lines.filter(Boolean).join("\n");
}
