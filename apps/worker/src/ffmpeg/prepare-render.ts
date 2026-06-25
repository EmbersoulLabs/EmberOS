import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CopyLocale, EditPlan } from "@ceo-agent/shared";
import {
  resolveFinalDurationSec,
  splitScriptChunks,
  subtitlesFromBilingualChunkTimings,
  subtitlesFromChunkTimings,
  type SubtitleChunkTiming,
  validateTtsDuration,
} from "@ceo-agent/shared";
import { probeAudioDuration } from "./audio-probe";
import { concatMp3Files } from "./concat-audio";

export interface PreparedRenderPlan {
  editPlan: EditPlan;
  ttsDurationSec?: number;
  finalDurationSec: number;
  assPath?: string;
}

const TTS_MAX_RETRIES = 2;

async function synthesizeChunkWithRetry(
  text: string,
  locale: CopyLocale,
  gender: "female" | "male",
  outputPath: string,
  synthesize: (text: string, locale: CopyLocale, gender?: "female" | "male") => Promise<Buffer>
): Promise<number> {
  let lastErr: Error | undefined;

  for (let attempt = 0; attempt <= TTS_MAX_RETRIES; attempt++) {
    try {
      const buf = await synthesize(text, locale, gender);
      await writeFile(outputPath, buf);
      return await probeAudioDuration(outputPath);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === TTS_MAX_RETRIES) {
        throw new Error(`TTS chunk failed after ${TTS_MAX_RETRIES + 1} attempts: ${lastErr.message}`);
      }
      console.warn(`[render] TTS chunk attempt ${attempt + 1} failed, retrying:`, lastErr.message);
    }
  }

  throw lastErr ?? new Error("TTS chunk failed");
}

/** Synthesize TTS per phrase, concat audio, rebuild subtitles from measured chunk durations. */
export async function prepareRenderPlan(
  editPlan: EditPlan,
  workDir: string,
  synthesize: (text: string, locale: CopyLocale, gender?: "female" | "male") => Promise<Buffer>,
  assPath?: string
): Promise<PreparedRenderPlan> {
  const vo = editPlan.audio.voiceover;
  const useVoiceover = vo?.enabled && (vo.segments?.length ?? 0) > 0;

  if (!useVoiceover) {
    return {
      editPlan,
      finalDurationSec: editPlan.targetDurationSec,
      assPath,
    };
  }

  const locale = vo.locale ?? "zh";
  const gender = vo.voice ?? "female";
  const segmentJoiner = locale === "zh" ? "。" : ". ";
  const finalScript =
    editPlan.finalScript?.trim() ||
    vo
      .segments!.map((s) => s.text.trim())
      .filter(Boolean)
      .join(segmentJoiner)
      .trim();
  if (!finalScript) {
    throw new Error("finalScript is empty — cannot generate TTS");
  }

  const spokenChunks = splitScriptChunks(finalScript, locale);
  const chunks = spokenChunks.length > 0 ? spokenChunks : [finalScript];

  const chunkPaths: string[] = [];
  const timings: SubtitleChunkTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i]!.trim();
    if (!chunkText) continue;

    const chunkPath = join(workDir, `tts_chunk_${i}.mp3`);
    const durationSec = await synthesizeChunkWithRetry(chunkText, locale, gender, chunkPath, synthesize);
    chunkPaths.push(chunkPath);
    timings.push({ startSec: cursor, endSec: cursor + durationSec });
    cursor += durationSec;
  }

  if (chunkPaths.length === 0) {
    throw new Error("No TTS chunks generated");
  }

  const mp3Path = join(workDir, "tts_primary.mp3");
  await concatMp3Files(chunkPaths, mp3Path, workDir);
  const ttsDurationSec = await probeAudioDuration(mp3Path);
  validateTtsDuration(finalScript, ttsDurationSec, locale);

  if (timings.length > 0) {
    const drift = ttsDurationSec - timings[timings.length - 1]!.endSec;
    if (Math.abs(drift) > 0.05) {
      timings[timings.length - 1]!.endSec = ttsDurationSec;
    }
  }

  const hasBilingual = Boolean(editPlan.finalScriptZh?.trim() && editPlan.finalScriptEn?.trim());
  const zhChunks =
    locale === "zh" ? chunks : splitScriptChunks(editPlan.finalScriptZh!, "zh");
  const enChunks =
    locale === "en" ? chunks : splitScriptChunks(editPlan.finalScriptEn!, "en");
  const subtitles = hasBilingual
    ? subtitlesFromBilingualChunkTimings(zhChunks, enChunks, timings)
    : subtitlesFromChunkTimings(chunks, timings, locale);

  const finalDurationSec = resolveFinalDurationSec({
    clipDurationSec: editPlan.targetDurationSec,
    ttsDurationSec,
    subtitles,
  });

  const prepared: EditPlan = {
    ...editPlan,
    finalScript,
    finalScriptZh: editPlan.finalScriptZh,
    finalScriptEn: editPlan.finalScriptEn,
    targetDurationSec: finalDurationSec,
    subtitles,
    audio: {
      ...editPlan.audio,
      voiceover: {
        ...vo,
        enabled: true,
        locale,
        voice: gender,
        segments: [{ startSec: 0, endSec: finalDurationSec, text: finalScript }],
      },
    },
    clips: editPlan.clips.map((c) => ({
      ...c,
      outputDurationSec: finalDurationSec,
    })),
  };

  console.log(
    `[render] voice-synced subtitles: ${timings.length} chunks, tts=${ttsDurationSec.toFixed(2)}s`
  );

  return {
    editPlan: prepared,
    ttsDurationSec,
    finalDurationSec,
    assPath,
  };
}
