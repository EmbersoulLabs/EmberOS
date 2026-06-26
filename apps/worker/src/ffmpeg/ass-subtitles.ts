import { join } from "node:path";
import type { EditPlan } from "@ceo-agent/shared";
import { limitCaptionLines } from "@ceo-agent/shared";
import { ffmpegAssFontsDir, subtitleFontName } from "./subtitle-fonts.js";

function assStyleLine(
  name: string,
  fontSize: number,
  colour: string,
  alignment: number,
  marginV: number,
  outline = 4,
  marginH = 48,
  bold = -1,
  shadow = 2
): string {
  const fontName = subtitleFontName();
  return `Style: ${name},${fontName},${fontSize},${colour},&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,${outline},${shadow},${alignment},${marginH},${marginH},${marginV},1`;
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

export function buildAssSubtitles(subtitles: EditPlan["subtitles"], playResY: number): string {
  const scale = playResY / 1920;
  const playResX = Math.round((playResY * 9) / 16);
  const font = subtitleFontName();

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${assStyleLine("TikTokHook", Math.round(72 * scale), "&H00FFFFFF", 5, Math.round(80 * scale), 6, 56, -1, 3)}
${assStyleLine("TikTokBody", Math.round(54 * scale), "&H00FFFFFF", 2, Math.round(200 * scale), 5, 48, -1, 3)}
${assStyleLine("HookZh", Math.round(58 * scale), "&H00FFFFFF", 5, Math.round(340 * scale), 5)}
${assStyleLine("HookEn", Math.round(44 * scale), "&H00FFFFFF", 5, Math.round(280 * scale), 4)}
${assStyleLine("BodyZh", Math.round(54 * scale), "&H00FFFFFF", 2, Math.round(200 * scale), 5)}
${assStyleLine("BodyEn", Math.round(46 * scale), "&H00FFFFFF", 2, Math.round(200 * scale), 4)}
${assStyleLine("CtaZh", Math.round(56 * scale), "&H00FFFFFF", 2, Math.round(160 * scale), 5)}
${assStyleLine("CtaEn", Math.round(48 * scale), "&H00FFFFFF", 2, Math.round(150 * scale), 4)}
Style: Default,${font},${Math.round(54 * scale)},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,48,48,${Math.round(200 * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const styleMap: Record<string, string> = {
    tiktok_hook_card: "TikTokHook",
    hook: "TikTokHook",
    hook_zh: "TikTokBody",
    hook_en: "TikTokBody",
    bold_center: "TikTokHook",
    body: "TikTokBody",
    body_zh: "TikTokBody",
    body_en: "TikTokBody",
    cta: "TikTokBody",
    cta_zh: "TikTokBody",
    cta_en: "TikTokBody",
  };

  const lines = subtitles.map((s: EditPlan["subtitles"][number]) => {
    const start = formatAssTime(s.startSec);
    const end = formatAssTime(s.endSec);
    const capped = limitCaptionLines(s.text, s.text.includes("\n") ? 3 : 2);
    const text = `{\\q2\\b1}${capped.replace(/\n/g, "\\N")}`;
    const style = styleMap[s.style] ?? "TikTokBody";
    return `Dialogue: 0,${start},${end},${style},,0,0,0,,${text}`;
  });

  return header + lines.join("\n");
}
