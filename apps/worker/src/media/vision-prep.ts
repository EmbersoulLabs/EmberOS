import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { SOURCE_END_TRIM_SEC, VISION_MAX_FRAMES } from "@ceo-agent/shared";
import { getFfmpegPath } from "../ffmpeg/ffmpeg-path";
import { probeVideo } from "../ffmpeg/pipeline";
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
  transcriptSegments?: Array<{ startSec: number; endSec: number; text: string }>;
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

/** Downscale large uploads so gpt-4o vision gets reliable JPEG payloads (multi-MB phone photos break analysis). */
async function compressImageForVision(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync(
    getFfmpegPath(),
    [
      "-y",
      "-i",
      inputPath,
      "-vf",
      "scale=1024:1024:force_original_aspect_ratio=decrease",
      "-frames:v",
      "1",
      "-q:v",
      "5",
      outputPath,
    ],
    { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
  );
}

async function imageToVisionDataUrl(localPath: string, workDir: string): Promise<string> {
  const size = (await stat(localPath)).size;
  if (size <= 400_000) return toDataUrl(localPath);
  const compressed = join(workDir, `vision_${Date.now()}.jpg`);
  await compressImageForVision(localPath, compressed);
  const compressedSize = (await stat(compressed)).size;
  console.log(
    `[vision-prep] compressed image ${(size / 1024 / 1024).toFixed(1)}MB → ${(compressedSize / 1024).toFixed(0)}KB`
  );
  return toDataUrl(compressed);
}

function frameTimestamps(durationSec: number, count: number): number[] {
  const n = Math.min(count, VISION_MAX_FRAMES);
  // Skip opening logos/title cards: 10% of duration, capped at 5 s.
  const startSec = Math.max(0.5, Math.min(durationSec * 0.10, 5.0));
  // Skip closing fades/credits: whichever is larger — 10% of duration or SOURCE_END_TRIM_SEC.
  const endSec = Math.max(
    startSec + 1.0,
    durationSec - Math.max(durationSec * 0.10, SOURCE_END_TRIM_SEC)
  );
  const span = Math.max(0.1, endSec - startSec);
  // Uniformly place frames at bucket centers (i+0.5)/n within [startSec, endSec].
  return Array.from({ length: n }, (_, i) =>
    Math.min(startSec + (span * (i + 0.5)) / n, durationSec - 0.25)
  );
}

async function frameFileReady(outputPath: string): Promise<boolean> {
  try {
    await access(outputPath);
    return (await stat(outputPath)).size > 64;
  } catch {
    return false;
  }
}

async function extractFrameAt(
  videoPath: string,
  atSec: number,
  outputPath: string
): Promise<void> {
  const seek = String(Math.max(0, atSec));
  const strategies = [
    ["-y", "-ss", seek, "-i", videoPath, "-frames:v", "1", "-q:v", "2", outputPath],
    ["-y", "-i", videoPath, "-ss", seek, "-frames:v", "1", "-q:v", "2", outputPath],
    ["-y", "-i", videoPath, "-ss", seek, "-vframes", "1", "-q:v", "2", "-update", "1", outputPath],
  ];

  for (const args of strategies) {
    await rm(outputPath, { force: true }).catch(() => undefined);
    try {
      await execFileAsync(getFfmpegPath(), args, {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (await frameFileReady(outputPath)) return;
    } catch {
      // try next seek strategy
    }
  }

  throw new Error(`Failed to extract frame at ${atSec}s`);
}

async function extractAudioMp3(
  videoPath: string,
  outputPath: string,
  options?: { startSec?: number; maxSec?: number }
): Promise<boolean> {
  try {
    const args = ["-y"];
    if (options?.startSec != null && options.startSec > 0) {
      args.push("-ss", String(options.startSec));
    }
    args.push("-i", videoPath, "-vn", "-ac", "1", "-ar", "16000");
    if (options?.maxSec != null) {
      args.push("-t", String(options.maxSec));
    }
    args.push(outputPath);
    await execFileAsync(getFfmpegPath(), args, {
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

async function transcribeLongVideo(
  localPath: string,
  durationSec: number
): Promise<{ summary?: string; segments: Array<{ startSec: number; endSec: number; text: string }> }> {
  const { transcribeAudioDetailed } = await import("@ceo-agent/agents");
  const { AUTO_CLIP, RENDER_MVP_LIMITS } = await import("@ceo-agent/shared");
  const maxDuration = Math.min(durationSec, RENDER_MVP_LIMITS.MAX_UPLOAD_DURATION_SEC);
  const chunkSec = AUTO_CLIP.WHISPER_CHUNK_SEC;
  const parts: string[] = [];
  const segments: Array<{ startSec: number; endSec: number; text: string }> = [];

  for (let start = 0; start < maxDuration; start += chunkSec) {
    const len = Math.min(chunkSec, maxDuration - start);
    const audioPath = join(tmpdir(), `whisper-chunk-${Date.now()}-${start}.mp3`);
    const extracted = await extractAudioMp3(localPath, audioPath, { startSec: start, maxSec: len });
    if (!extracted) continue;
    try {
      const result = await transcribeAudioDetailed(await readFile(audioPath));
      if (result.text) parts.push(result.text);
      for (const seg of result.segments) {
        segments.push({
          startSec: seg.startSec + start,
          endSec: seg.endSec + start,
          text: seg.text,
        });
      }
    } catch (err) {
      console.warn(`[vision-prep] Whisper chunk @${start}s failed:`, err);
    } finally {
      await rm(audioPath, { force: true }).catch(() => undefined);
    }
  }

  const combined = parts.join(" ").trim();
  const summary =
    combined.length > 4000 ? `${combined.slice(0, 4000)}…` : combined || undefined;
  return { summary, segments };
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
      const dataUrl = await imageToVisionDataUrl(localPath, workDir);
      console.log(`[vision-prep] image ready chars=${dataUrl.length}`);
      return {
        frames: [{ atSec: 0, dataUrl }],
      };
    }

    let duration = input.durationSec && input.durationSec > 0 ? input.durationSec : 15;
    try {
      const probed = await probeVideo(localPath);
      if (probed.durationSec > 0) duration = probed.durationSec;
    } catch {
      // keep metadata / fallback estimate
    }

    const times = frameTimestamps(duration, VISION_MAX_FRAMES);
    const frames: VisionFrame[] = [];

    for (let i = 0; i < times.length; i++) {
      const framePath = join(workDir, `frame_${i}.jpg`);
      try {
        await extractFrameAt(localPath, times[i]!, framePath);
        const dataUrl = await imageToVisionDataUrl(framePath, workDir);
        frames.push({ atSec: times[i]!, dataUrl });
      } catch (err) {
        console.warn(`[vision-prep] frame ${i} @${times[i]?.toFixed(2)}s failed:`, err);
      }
    }

    if (frames.length === 0) {
      const fallbackSec = Math.min(Math.max(0.5, duration * 0.10), duration - 0.25);
      const fallbackPath = join(workDir, "frame_fallback.jpg");
      await extractFrameAt(localPath, fallbackSec, fallbackPath);
      frames.push({ atSec: fallbackSec, dataUrl: await imageToVisionDataUrl(fallbackPath, workDir) });
    }

    let transcriptSummary: string | undefined;
    let transcriptSegments: PreparedVisionMedia["transcriptSegments"];
    if (duration >= 4 && (await mediaHasAudio(localPath))) {
      try {
        const transcribed = await transcribeLongVideo(localPath, duration);
        transcriptSummary = transcribed.summary;
        transcriptSegments = transcribed.segments.length ? transcribed.segments : undefined;
      } catch (err) {
        console.warn("[vision-prep] Whisper transcription failed:", err);
      }
    }

    return { frames, transcriptSummary, transcriptSegments };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
