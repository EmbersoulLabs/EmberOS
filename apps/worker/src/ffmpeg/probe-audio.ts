import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

function ffprobePath() {
  const ffmpeg = getFfmpegPath();
  if (ffmpeg.toLowerCase().includes("ffmpeg")) {
    return ffmpeg.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1");
  }
  return "ffprobe";
}

export async function mediaHasAudio(filePath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath(),
      [
        "-v",
        "quiet",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        filePath,
      ],
      { windowsHide: true }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
