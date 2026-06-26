import { join } from "node:path";
import type { EditPlan } from "@ceo-agent/shared";
import {
  ASS_COLOR_WHITE,
  ASS_COLOR_BLACK,
  ASS_OUTLINE_PX,
  buildAssAnimatedDialogueText,
} from "@ceo-agent/shared";
import { ffmpegAssFontsDir, subtitleFontName } from "./subtitle-fonts.js";

function assStyleLine(
  name: string,
  fontSize: number,
  alignment: number,
  marginV: number,
  outline: number,
  marginH = 48,
  bold = -1
): string {
  const fontName = subtitleFontName();
  const shadow = 0;
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

/** Brand dynamic ASS: white + 2px outline, gold keywords, 0.1s char pop; text unchanged (incl. 中英). */
export function buildAssSubtitles(
  subtitles: EditPlan["subtitles"],
  playResY: number,
  highlightKeywords: string[] = []
): string {
  const scale = playResY / 1920;
  const playResX = Math.round((playResY * 9) / 16);
  const font = subtitleFontName();
  const outline = Math.max(1, Math.round(ASS_OUTLINE_PX * scale));

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("BrandHook", Math.round(72 * scale), 5, Math.round(80 * scale), outline, 56)}
${assStyleLine("BrandBody", Math.round(54 * scale), 2, Math.round(200 * scale), outline, 48)}
${assStyleLine("HookZh", Math.round(58 * scale), 5, Math.round(340 * scale), outline)}
${assStyleLine("HookEn", Math.round(44 * scale), 5, Math.round(280 * scale), outline, 48, 0)}
${assStyleLine("BodyZh", Math.round(54 * scale), 2, Math.round(200 * scale), outline)}
${assStyleLine("BodyEn", Math.round(46 * scale), 2, Math.round(200 * scale), outline, 48, 0)}
${assStyleLine("CtaZh", Math.round(56 * scale), 2, Math.round(160 * scale), outline)}
${assStyleLine("CtaEn", Math.round(48 * scale), 2, Math.round(150 * scale), outline, 48, 0)}
Style: Default,${font},${Math.round(54 * scale)},${ASS_COLOR_WHITE},${ASS_COLOR_BLACK},${ASS_COLOR_BLACK},&H80000000,-1,0,0,0,100,100,0,0,1,${outline},0,2,48,48,${Math.round(200 * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const styleMap: Record<string, string> = {
    tiktok_hook_card: "BrandHook",
    hook: "BrandHook",
    hook_zh: "BrandBody",
    hook_en: "BrandBody",
    bold_center: "BrandHook",
    body: "BrandBody",
    body_zh: "BrandBody",
    body_en: "BrandBody",
    cta: "BrandBody",
    cta_zh: "BrandBody",
    cta_en: "BrandBody",
  };

  const lines = subtitles.map((s: EditPlan["subtitles"][number]) => {
    if (s.style === "tiktok_hook_card") return null;
    const start = formatAssTime(s.startSec);
    const end = formatAssTime(s.endSec);
    const text = buildAssAnimatedDialogueText(s.text, highlightKeywords);
    const style = styleMap[s.style] ?? "BrandBody";
    return `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}`;
  });

  return header + lines.filter(Boolean).join("\n");
}
