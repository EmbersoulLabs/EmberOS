import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFfmpegPath } from "./ffmpeg-path";

const execFileAsync = promisify(execFile);

export async function probeAudioDuration(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    inputPath,
  ]);
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; duration?: string }>;
  };
  const audio = data.streams?.find((s) => s.codec_type === "audio");
  const dur = parseFloat(audio?.duration ?? data.format?.duration ?? "0");
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`Could not probe audio duration for ${inputPath}`);
  }
  return dur;
}

export async function mediaHasAudioStream(inputPath: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-select_streams",
    "a",
    "-show_entries",
    "stream=codec_type",
    "-of",
    "csv=p=0",
    inputPath,
  ]);
  return stdout.trim().length > 0;
}
