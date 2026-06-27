import type { CopyLocale } from "./copy-mix";
import type { CopyVariant, EditPlan } from "./types/index";
import { AUTO_CLIP } from "./render";
import { isChineseText } from "./subtitle-text";

/** Single source of truth for TTS, subtitles, preview, and marketing analysis. */
export function buildFinalScript(variant: CopyVariant, locale?: CopyLocale): string {
  const loc = locale ?? variant.locale;
  const sep = loc === "zh" ? "。" : ". ";
  return [variant.hook, variant.body, variant.cta]
    .map((t) => t?.trim())
    .filter(Boolean)
    .join(sep)
    .trim();
}

/**
 * English voice script — hook + body + CTA, but drops CTA when it leaked to Chinese
 * (common when the en variant has no translated CTA yet).
 */
export function buildEnglishFinalScript(variant: CopyVariant): string {
  const sep = ". ";
  const parts = [variant.hook?.trim(), variant.body?.trim()].filter(Boolean);
  const cta = variant.cta?.trim();
  if (cta && !isChineseText(cta)) parts.push(cta);
  return parts.join(sep).trim() || buildFinalScript(variant, "en");
}

export function detectScriptLocale(script: string): CopyLocale {
  return /[\u4e00-\u9fff]/.test(script) ? "zh" : "en";
}

/** Estimate spoken duration (seconds) — ~130–160 WPM for English, ~4 chars/sec for Chinese. */
export function estimateSpeechDurationSec(script: string, locale?: CopyLocale): number {
  const loc = locale ?? detectScriptLocale(script);
  if (loc === "zh") {
    const chars = script.replace(/\s/g, "").length;
    return Math.max(4, chars / 3.8);
  }
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  return Math.max(4, (wordCount / 150) * 60);
}

/** Minimum acceptable TTS duration (70% of estimate). */
export function expectedMinTtsDurationSec(script: string, locale?: CopyLocale): number {
  const loc = locale ?? detectScriptLocale(script);
  if (loc === "zh") {
    const chars = script.replace(/\s/g, "").length;
    return Math.max(4, (chars / 4) * 0.7);
  }
  const wordCount = script.split(/\s+/).filter(Boolean).length;
  return Math.max(4, (wordCount / 160) * 60 * 0.7);
}

export function validateTtsDuration(
  finalScript: string,
  ttsDurationSec: number,
  locale?: CopyLocale
): void {
  const min = expectedMinTtsDurationSec(finalScript, locale);
  if (ttsDurationSec < min) {
    throw new Error(
      `TTS incomplete: ${ttsDurationSec.toFixed(1)}s < expected min ${min.toFixed(1)}s for script length`
    );
  }
}

/** Short clips or cramped narration → subtitles + BGM instead of TTS. */
export function shouldUseVoiceoverForClip(
  clipDurationSec: number,
  script: string,
  locale?: CopyLocale
): boolean {
  const trimmed = script.trim();
  if (!trimmed) return false;

  if (clipDurationSec < AUTO_CLIP.TTS_MIN_CLIP_SEC) return false;

  const speechDur = estimateSpeechDurationSec(trimmed, locale);
  if (speechDur > clipDurationSec * 0.85) return false;

  return true;
}

export function subtitleEndTime(subtitles: EditPlan["subtitles"]): number {
  if (subtitles.length === 0) return 0;
  return Math.max(...subtitles.map((s) => s.endSec));
}

export function resolveFinalDurationSec(input: {
  clipDurationSec: number;
  ttsDurationSec?: number;
  subtitles: EditPlan["subtitles"];
}): number {
  const subEnd = subtitleEndTime(input.subtitles);
  const tts = input.ttsDurationSec ?? 0;
  return Math.max(input.clipDurationSec, tts + 0.25, subEnd);
}
