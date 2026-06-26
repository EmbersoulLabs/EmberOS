import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { getFfmpegPath } from "./ffmpeg-path";
import { mediaHasAudio } from "./probe-audio";
import { mixDialogueWithSmartBgm } from "./bgm-mix";

const execFileAsync = promisify(execFile);

export async function mixBackgroundMusic(
  videoPath: string,
  bgmPath: string,
  outputPath: string,
  durationSec: number,
  keepOriginal = true,
  bgmStartOffsetSec = 0
): Promise<void> {
  await access(bgmPath);
  const dur = Math.max(3, durationSec);
  const hasOrig = keepOriginal && (await mediaHasAudio(videoPath));
  const start = Math.max(0, bgmStartOffsetSec);
  const trimEnd = start + dur + 4;

  const filterComplex = hasOrig
    ? mixDialogueWithSmartBgm("0:a", "1:a", "aout", dur, 0.35, undefined, start)
    : [
        `[1:a]atrim=${start.toFixed(2)}:${trimEnd.toFixed(2)},asetpts=PTS-STARTPTS,volume=0.22,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, dur - 0.8).toFixed(2)}:d=0.8[bgm]`,
        `[bgm]loudnorm=I=-14:TP=-1.5:LRA=11[aout]`,
      ].join(";");

  await execFileAsync(
    getFfmpegPath(),
    [
      "-y",
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      bgmPath,
      "-filter_complex",
      filterComplex,
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
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-t",
      dur.toFixed(2),
      outputPath,
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  );
}
