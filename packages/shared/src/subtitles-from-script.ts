import type { CopyLocale } from "./copy-mix";
import type { EditPlan } from "./types/index";
import { detectScriptLocale } from "./final-script";

const MIN_SEG_SEC = 1.5;
const MAX_SEG_SEC = 3.5;

export type SubtitleChunkTiming = { startSec: number; endSec: number };

/** Split narration into phrase-sized chunks for per-segment TTS + subtitle timing. */
export function splitScriptChunks(script: string, locale: CopyLocale): string[] {
  const normalized = script.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  if (locale === "zh") {
    const phrases = normalized
      .split(/[。！？!?；;，、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const chunks: string[] = [];
    for (const phrase of phrases) {
      if (phrase.length <= 16) {
        chunks.push(phrase);
        continue;
      }
      for (let i = 0; i < phrase.length; i += 12) {
        chunks.push(phrase.slice(i, i + 12).trim());
      }
    }
    return chunks.filter(Boolean);
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let buf: string[] = [];
  for (const word of words) {
    buf.push(word);
    if (buf.length >= 6) {
      chunks.push(buf.join(" "));
      buf = [];
    }
  }
  if (buf.length > 0) {
    if (chunks.length > 0 && buf.length < 4) {
      chunks[chunks.length - 1] = `${chunks[chunks.length - 1]} ${buf.join(" ")}`;
    } else {
      chunks.push(buf.join(" "));
    }
  }
  return chunks;
}

function beatStyles(
  index: number,
  total: number
): { zh: EditPlan["subtitles"][number]["style"]; en: EditPlan["subtitles"][number]["style"] } {
  if (index === 0) return { zh: "hook_zh", en: "hook_en" };
  if (index === total - 1) return { zh: "cta_zh", en: "cta_en" };
  return { zh: "body_zh", en: "body_en" };
}

function styleForChunk(index: number, total: number, locale: CopyLocale): EditPlan["subtitles"][number]["style"] {
  if (index === 0) return locale === "zh" ? "hook_zh" : "hook_en";
  if (index === total - 1) return locale === "zh" ? "cta_zh" : "cta_en";
  return locale === "zh" ? "body_zh" : "body_en";
}

/** Subtitles timed from measured per-chunk TTS durations (voice-synced). */
export function subtitlesFromChunkTimings(
  chunks: string[],
  timings: SubtitleChunkTiming[],
  locale: CopyLocale
): EditPlan["subtitles"] {
  const count = Math.min(chunks.length, timings.length);
  if (count === 0) return [];

  const subtitles: EditPlan["subtitles"] = [];
  for (let i = 0; i < count; i++) {
    const text = chunks[i]!.trim();
    if (!text) continue;
    const { startSec, endSec } = timings[i]!;
    subtitles.push({
      startSec,
      endSec,
      text,
      style: styleForChunk(i, count, locale),
    });
  }
  return subtitles;
}

/** Bilingual lines sharing the same measured chunk timings as the spoken voice track. */
export function subtitlesFromBilingualChunkTimings(
  zhChunks: string[],
  enChunks: string[],
  timings: SubtitleChunkTiming[]
): EditPlan["subtitles"] {
  const count = timings.length;
  if (count === 0) return [];

  const subtitles: EditPlan["subtitles"] = [];
  for (let i = 0; i < count; i++) {
    const { startSec, endSec } = timings[i]!;
    const styles = beatStyles(i, count);
    const zhText = (zhChunks[i] ?? zhChunks.at(-1) ?? "").trim();
    const enText = (enChunks[i] ?? enChunks.at(-1) ?? "").trim();

    if (zhText) {
      subtitles.push({ startSec, endSec, text: zhText, style: styles.zh });
    }
    if (enText && enText !== zhText) {
      subtitles.push({ startSec, endSec, text: enText, style: styles.en });
    } else if (!zhText && enText) {
      subtitles.push({ startSec, endSec, text: enText, style: styles.en });
    }
  }
  return subtitles;
}

/** Build timed subtitles from full finalScript — evenly split (estimate only, not voice-synced). */
export function subtitlesFromFinalScript(
  finalScript: string,
  totalDurationSec: number,
  locale?: CopyLocale
): EditPlan["subtitles"] {
  const loc = locale ?? detectScriptLocale(finalScript);
  const chunks = splitScriptChunks(finalScript, loc);
  if (chunks.length === 0 || totalDurationSec <= 0) return [];

  const idealSeg = Math.min(MAX_SEG_SEC, Math.max(MIN_SEG_SEC, totalDurationSec / chunks.length));
  const timings: SubtitleChunkTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < chunks.length; i++) {
    const remaining = totalDurationSec - cursor;
    const isLast = i === chunks.length - 1;
    const segDur = isLast ? remaining : Math.min(idealSeg, remaining - MIN_SEG_SEC * (chunks.length - i - 1));
    const end = isLast ? totalDurationSec : cursor + Math.max(MIN_SEG_SEC, segDur);
    timings.push({ startSec: cursor, endSec: Math.min(totalDurationSec, end) });
    cursor = end;
    if (cursor >= totalDurationSec - 0.05) break;
  }

  if (timings.length > 0) {
    timings[timings.length - 1]!.endSec = totalDurationSec;
  }

  return subtitlesFromChunkTimings(chunks.slice(0, timings.length), timings, loc);
}

/** Bilingual on-screen lines — evenly split (estimate only, not voice-synced). */
export function subtitlesFromBilingualScripts(
  zhScript: string,
  enScript: string,
  totalDurationSec: number
): EditPlan["subtitles"] {
  const zhChunks = splitScriptChunks(zhScript, "zh");
  const enChunks = splitScriptChunks(enScript, "en");
  const count = Math.max(zhChunks.length, enChunks.length, 1);
  if (totalDurationSec <= 0) return [];

  const idealSeg = Math.min(MAX_SEG_SEC, Math.max(MIN_SEG_SEC, totalDurationSec / count));
  const timings: SubtitleChunkTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < count; i++) {
    const remaining = totalDurationSec - cursor;
    const isLast = i === count - 1;
    const segDur = isLast ? remaining : Math.min(idealSeg, remaining - MIN_SEG_SEC * (count - i - 1));
    const end = isLast ? totalDurationSec : cursor + Math.max(MIN_SEG_SEC, segDur);
    timings.push({ startSec: cursor, endSec: Math.min(totalDurationSec, end) });
    cursor = end;
    if (cursor >= totalDurationSec - 0.05) break;
  }

  if (timings.length > 0) {
    timings[timings.length - 1]!.endSec = totalDurationSec;
  }

  return subtitlesFromBilingualChunkTimings(zhChunks, enChunks, timings);
}
