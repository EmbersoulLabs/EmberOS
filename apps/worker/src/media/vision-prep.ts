import { execFile } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { SOURCE_END_TRIM_SEC, VISION_MAX_FRAMES } from "@ceo-agent/shared";
import { getFfmpegPath } from "../ffmpeg/ffmpeg-path";
import { downloadStorageFile } from "../storage";
import { mediaHasAudio } from "../ffmpeg/probe-audio";

const execFileAsync = promisify(execFile);

export interface VisionFrame {
  atSec: number;
  dataUrl: string;
}

export interface PreparedVisionMedia {
  frames: VisionFrame[];
  transcriptSummary?: string;
}

function mimeFromPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function toDataUrl(localPath: string): Promise<string> {
  const buffer = await readFile(localPath);
  return `data:${mimeFromPath(localPath)};base64,${buffer.toString("base64")}`;
}

function frameTimestamps(durationSec: number, count: number): number[] {
  const usable = Math.max(2, durationSec - SOURCE_END_TRIM_SEC);
  const n = Math.min(count, VISION_MAX_FRAMES);
  return Array.from({ length: n }, (_, i) => (usable * (i + 1)) / (n + 1));
}

async function extractFrameAt(
  videoPath: string,
  atSec: number,
  outputPath: string
): Promise<void> {
  await execFileAsync(
    getFfmpegPath(),
    [
      "-y",
      "-ss",
      String(Math.max(0, atSec)),
      "-i",
      videoPath,
      "-vframes",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
  );
}

async function extractAudioMp3(videoPath: string, outputPath: string, maxSec = 60): Promise<boolean> {
  try {
    await execFileAsync(
      getFfmpegPath(),
      [
        "-y",
        "-i",
        videoPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-t",
        String(maxSec),
        outputPath,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );
    return true;
  } catch {
    return false;
  }
}

export async function prepareVisionFromStorage(input: {
  storagePath: string;
  mediaType: "video" | "image";
  durationSec?: number;
}): Promise<PreparedVisionMedia> {
  const workDir = join(tmpdir(), `vision-prep-${Date.now()}`);
  await mkdir(workDir, { recursive: true });

  try {
    const ext = input.storagePath.split(".").pop() ?? "bin";
    const localPath = join(workDir, `source.${ext}`);
    await downloadStorageFile(input.storagePath, localPath);

    if (input.mediaType === "image") {
      return {
        frames: [{ atSec: 0, dataUrl: await toDataUrl(localPath) }],
      };
    }

    const duration = input.durationSec && input.durationSec > 0 ? input.durationSec : 15;
    const times = frameTimestamps(duration, VISION_MAX_FRAMES);
    const frames: VisionFrame[] = [];

    for (let i = 0; i < times.length; i++) {
      const framePath = join(workDir, `frame_${i}.jpg`);
      await extractFrameAt(localPath, times[i]!, framePath);
      frames.push({ atSec: times[i]!, dataUrl: await toDataUrl(framePath) });
    }

    let transcriptSummary: string | undefined;
    if (duration >= 4 && (await mediaHasAudio(localPath))) {
      const audioPath = join(workDir, "audio.mp3");
      const extracted = await extractAudioMp3(localPath, audioPath);
      if (extracted) {
        try {
          const { transcribeAudio } = await import("@ceo-agent/agents");
          const text = await transcribeAudio(await readFile(audioPath));
          const trimmed = text.trim();
          if (trimmed.length > 0) {
            transcriptSummary =
              trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…` : trimmed;
          }
        } catch (err) {
          console.warn("[vision-prep] Whisper transcription failed:", err);
        }
      }
    }

    return { frames, transcriptSummary };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
