import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CopyLocale, EditPlan } from "@ceo-agent/shared";
import { validateTtsDuration } from "@ceo-agent/shared";
import { getFfmpegPath } from "./ffmpeg-path";
import { probeAudioDuration } from "./audio-probe";
import { mixVoiceWithSmartBgm } from "./bgm-mix";

const execFileAsync = promisify(execFile);

export interface VoiceoverMixResult {
  ttsDurationSec: number;
  finalDurationSec: number;
}

export async function mixVideoWithVoiceoverAndBgm(
  videoPath: string,
  outputPath: string,
  editPlan: EditPlan,
  workDir: string,
  synthesize: (text: string, locale: CopyLocale, gender?: "female" | "male") => Promise<Buffer>,
  options?: { cachedTtsPath?: string }
): Promise<VoiceoverMixResult> {
  const vo = editPlan.audio.voiceover;
  if (!vo?.enabled || !vo.segments?.length) {
    throw new Error("Voiceover not configured");
  }

  const locale = vo.locale ?? "zh";
  const gender = vo.voice ?? "female";
  const finalDurationSec = editPlan.targetDurationSec;
  const segmentJoiner = locale === "zh" ? "。" : ". ";
  const finalScript =
    editPlan.finalScript?.trim() ||
    vo.segments
      .map((s) => s.text.trim())
      .filter(Boolean)
      .join(segmentJoiner)
      .trim();
  if (!finalScript) throw new Error("finalScript is empty");

  const mp3Path = options?.cachedTtsPath ?? join(workDir, "vo_0.mp3");
  let ttsDurationSec: number;

  try {
    await access(mp3Path);
    ttsDurationSec = await probeAudioDuration(mp3Path);
    validateTtsDuration(finalScript, ttsDurationSec, locale);
  } catch {
    const buf = await synthesize(finalScript, locale, gender);
    await writeFile(mp3Path, buf);
    ttsDurationSec = await probeAudioDuration(mp3Path);
    validateTtsDuration(finalScript, ttsDurationSec, locale);
  }

  const inputArgs: string[] = ["-y", "-i", videoPath, "-i", mp3Path];
  const delayMs = Math.round((vo.segments[0]?.startSec ?? 0) * 1000);
  const voiceLabel = "voice";

  const filterParts = [
    `[1:a]adelay=${delayMs}|${delayMs},asetpts=PTS-STARTPTS,volume=1.15,apad=pad_dur=${Math.max(0, finalDurationSec + 1)}[${voiceLabel}]`,
  ];

  const voicedPath = join(workDir, "voiced.mp4");
  await execFileAsync(
    getFfmpegPath(),
    [
      ...inputArgs,
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "0:v:0",
      "-map",
      `[${voiceLabel}]`,
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-t",
      finalDurationSec.toFixed(3),
      "-movflags",
      "+faststart",
      voicedPath,
    ],
    { cwd: workDir, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );

  const shouldMixBgm = Boolean(editPlan.audio.bgmExternal?.audioUrl) || editPlan.audio.bgm !== "none";
  if (shouldMixBgm) {
    const { resolveBgmFileForPlan } = await import("../bgm/resolve");
    const bgmPath = await resolveBgmFileForPlan(editPlan.audio);
    const mixFilter = mixVoiceWithSmartBgm("vo", "1:a", "aout", {
      durationSec: finalDurationSec,
      duckUnderVoice: true,
      bgmStartOffsetSec: editPlan.audio.bgmStartOffsetSec ?? 0,
    });
    await execFileAsync(
      getFfmpegPath(),
      [
        "-y",
        "-i",
        voicedPath,
        "-stream_loop",
        "-1",
        "-i",
        bgmPath,
        "-filter_complex",
        `[0:a]volume=1.0[vo];${mixFilter}`,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        finalDurationSec.toFixed(3),
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { cwd: workDir, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
    );
  } else {
    const { copyFile } = await import("node:fs/promises");
    await copyFile(voicedPath, outputPath);
  }

  return { ttsDurationSec, finalDurationSec };
}
