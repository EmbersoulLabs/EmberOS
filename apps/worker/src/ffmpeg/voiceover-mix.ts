import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { CopyLocale, EditPlan } from "@ceo-agent/shared";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

export async function mixVideoWithVoiceoverAndBgm(
  videoPath: string,
  outputPath: string,
  editPlan: EditPlan,
  workDir: string,
  synthesize: (text: string, locale: CopyLocale) => Promise<Buffer>
): Promise<void> {
  const vo = editPlan.audio.voiceover;
  if (!vo?.enabled || !vo.segments?.length) {
    throw new Error("Voiceover not configured");
  }

  const locale = vo.locale ?? "zh";
  const totalDur = editPlan.targetDurationSec;
  const inputArgs: string[] = ["-y", "-i", videoPath];
  const filterParts: string[] = [];
  const mixLabels: string[] = [];

  for (let i = 0; i < vo.segments.length; i++) {
    const seg = vo.segments[i]!;
    const mp3Path = join(workDir, `vo_${i}.mp3`);
    const buf = await synthesize(seg.text, locale);
    await writeFile(mp3Path, buf);

    inputArgs.push("-i", mp3Path);
    const delayMs = Math.round(seg.startSec * 1000);
    const slotDur = Math.max(0.5, seg.endSec - seg.startSec);
    const label = `v${i}`;
    filterParts.push(
      `[${i + 1}:a]adelay=${delayMs}|${delayMs},atrim=0:${slotDur.toFixed(3)},asetpts=PTS-STARTPTS,volume=1.1[${label}]`
    );
    mixLabels.push(`[${label}]`);
  }

  const voiceLabel = "voice";
  filterParts.push(
    `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:dropout_transition=2:normalize=0[${voiceLabel}]`
  );

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
      totalDur.toFixed(3),
      "-movflags",
      "+faststart",
      voicedPath,
    ],
    { cwd: workDir, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
  );

  const shouldMixBgm = editPlan.audio.bgm !== "none";
  if (shouldMixBgm) {
    const { resolveBgmFile } = await import("../bgm/resolve");
    const { resolveBgmTrackKey } = await import("@ceo-agent/shared");
    const bgmPath = await resolveBgmFile(resolveBgmTrackKey(editPlan.audio.bgm ?? "default"));
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
        `[0:a]volume=1[vo];[1:a]atrim=0:${totalDur.toFixed(2)},asetpts=PTS-STARTPTS,volume=0.34[bgm];[vo][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
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
        totalDur.toFixed(3),
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
}
