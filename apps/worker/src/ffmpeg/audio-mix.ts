import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { getFfmpegPath } from "./ffmpeg-path";
import { mediaHasAudio } from "./probe-audio";

const execFileAsync = promisify(execFile);

export async function mixBackgroundMusic(
  videoPath: string,
  bgmPath: string,
  outputPath: string,
  durationSec: number,
  keepOriginal = true
): Promise<void> {
  await access(bgmPath);
  const dur = Math.max(3, durationSec);
  const hasOrig = keepOriginal && (await mediaHasAudio(videoPath));

  const bgmVol = 0.58;
  const origVol = 0.1;

  const filterComplex = hasOrig
    ? `[0:a]volume=${origVol}[orig];[1:a]atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,volume=${bgmVol}[bgm];[orig][bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[aout]`
    : `[1:a]atrim=0:${dur.toFixed(2)},asetpts=PTS-STARTPTS,volume=${bgmVol}[aout]`;

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
