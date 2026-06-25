import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { EditPlan } from "@ceo-agent/shared";
import { subtitleEndTime } from "@ceo-agent/shared";
import { probeVideo } from "./pipeline";
import { mediaHasAudioStream, probeAudioDuration } from "./audio-probe";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

export class RenderValidationError extends Error {
  constructor(message: string) {
    super(`Render validation failed: ${message}`);
    this.name = "RenderValidationError";
  }
}

export async function validateRenderOutput(input: {
  outputPath: string;
  editPlan: EditPlan;
  assPath?: string;
  ttsDurationSec?: number;
}): Promise<void> {
  const { outputPath, editPlan, assPath, ttsDurationSec } = input;
  const fileStat = await stat(outputPath);
  if (fileStat.size <= 0) {
    throw new RenderValidationError("output file is empty");
  }

  const videoProbe = await probeVideo(outputPath);
  const hasAudio = await mediaHasAudioStream(outputPath);
  const voEnabled = editPlan.audio.voiceover?.enabled && (editPlan.audio.voiceover.segments?.length ?? 0) > 0;

  if (voEnabled && !hasAudio) {
    throw new RenderValidationError("voiceover or subtitles incomplete — no audio stream");
  }

  const subEnd = subtitleEndTime(editPlan.subtitles);
  const ttsDur = ttsDurationSec ?? 0;

  if (ttsDur > 0 && videoProbe.durationSec < ttsDur - 0.5) {
    throw new RenderValidationError(
      `voiceover or subtitles incomplete — video ${videoProbe.durationSec.toFixed(1)}s < TTS ${ttsDur.toFixed(1)}s`
    );
  }

  if (subEnd > 0 && videoProbe.durationSec < subEnd - 0.5) {
    throw new RenderValidationError(
      `voiceover or subtitles incomplete — video shorter than subtitles (${subEnd.toFixed(1)}s)`
    );
  }

  if (editPlan.subtitles.length === 0 && editPlan.finalScript?.trim()) {
    throw new RenderValidationError("subtitle file missing lines for finalScript");
  }

  if (assPath) {
    const ass = await readFile(assPath, "utf8");
    const dialogueLines = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    if (dialogueLines.length === 0) {
      throw new RenderValidationError("subtitle file has no dialogue lines");
    }
  }
}

export async function extendVideoToDuration(
  inputPath: string,
  outputPath: string,
  targetSec: number,
  profile?: { preset: string; crf: string; videoBitrate: string; audioBitrate: string }
): Promise<void> {
  const probe = await probeVideo(inputPath);
  if (probe.durationSec >= targetSec - 0.15) {
    await execFileAsync(getFfmpegPath(), [
      "-y",
      "-i",
      inputPath,
      "-t",
      targetSec.toFixed(3),
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      outputPath,
    ]);
    return;
  }

  const p = profile ?? {
    preset: "ultrafast",
    crf: "28",
    videoBitrate: "1200k",
    audioBitrate: "96k",
  };

  await execFileAsync(
    getFfmpegPath(),
    [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      inputPath,
      "-t",
      targetSec.toFixed(3),
      "-c:v",
      "libx264",
      "-preset",
      p.preset,
      "-crf",
      p.crf,
      "-b:v",
      p.videoBitrate,
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );
}
