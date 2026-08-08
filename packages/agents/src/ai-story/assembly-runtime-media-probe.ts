/**
 * Sprint 3 PR 3.6 — FFprobe-based assembly media probe.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import {
  AssemblyMediaProbeSchema,
  type AssemblyMediaProbe,
  type AssemblyRuntimeFailureClassification,
} from "@ceo-agent/shared/server";
import { hashFileSha256 } from "./assembly-runtime-media-access";

const execFileAsync = promisify(execFile);

export class AssemblyMediaProbeError extends Error {
  constructor(
    readonly classification: AssemblyRuntimeFailureClassification,
    message: string
  ) {
    super(message);
    this.name = "AssemblyMediaProbeError";
  }
}

function getFfprobePath(): string {
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  if (ffmpeg.toLowerCase().endsWith("ffmpeg.exe")) {
    return ffmpeg.slice(0, -"ffmpeg.exe".length) + "ffprobe.exe";
  }
  if (ffmpeg.toLowerCase().endsWith("ffmpeg")) {
    return `${ffmpeg.slice(0, -"ffmpeg".length)}ffprobe`;
  }
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate || rate === "0/0") return null;
  if (rate.includes("/")) {
    const [a, b] = rate.split("/").map(Number);
    if (!a || !b) return null;
    return a / b;
  }
  const value = Number(rate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function probeAssemblyMedia(input: {
  readonly sceneResultId: string;
  readonly localPath: string;
  readonly expectedContentHash?: string;
}): Promise<AssemblyMediaProbe> {
  try {
    const { stdout } = await execFileAsync(
      getFfprobePath(),
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        input.localPath,
      ],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string; format_name?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
        r_frame_rate?: string;
        time_base?: string;
      }>;
    };
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    if (!video?.width || !video.height) {
      throw new AssemblyMediaProbeError(
        "ASSEMBLY_MEDIA_PROBE_FAILED",
        "Video stream missing from Scene media"
      );
    }
    const durationSec = Number.parseFloat(data.format?.duration ?? "0");
    if (!(durationSec > 0)) {
      throw new AssemblyMediaProbeError(
        "ASSEMBLY_MEDIA_PROBE_FAILED",
        "Scene media duration is invalid"
      );
    }
    const fileHash = await hashFileSha256(input.localPath);
    if (input.expectedContentHash && input.expectedContentHash !== fileHash) {
      throw new AssemblyMediaProbeError(
        "ASSEMBLY_MEDIA_HASH_MISMATCH",
        "Scene media content hash mismatch"
      );
    }
    const byteSize = Number.parseInt(data.format?.size ?? "", 10);
    const stats = await stat(input.localPath);
    return AssemblyMediaProbeSchema.parse({
      sceneResultId: input.sceneResultId,
      mediaType: "video/mp4",
      durationMs: Math.round(durationSec * 1000),
      width: video.width,
      height: video.height,
      frameRate: parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate),
      videoCodec: video.codec_name ?? "unknown",
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec_name ?? null,
      timeBase: video.time_base ?? null,
      byteSize: Number.isFinite(byteSize) ? byteSize : stats.size,
      contentHash: fileHash,
    });
  } catch (error) {
    if (error instanceof AssemblyMediaProbeError) throw error;
    throw new AssemblyMediaProbeError(
      "ASSEMBLY_MEDIA_PROBE_FAILED",
      "Scene media probe failed"
    );
  }
}
