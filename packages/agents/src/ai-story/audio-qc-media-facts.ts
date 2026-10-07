import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AiStoryAudioQcMediaFacts } from "@ceo-agent/shared";
import { hashFileSha256 } from "./assembly-runtime-media-access";

const execFileAsync = promisify(execFile);

function ffprobePath(): string {
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  if (ffmpeg.toLowerCase().endsWith("ffmpeg.exe")) {
    return ffmpeg.slice(0, -"ffmpeg.exe".length) + "ffprobe.exe";
  }
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

function positiveMs(value: string | undefined): number | null {
  const seconds = Number.parseFloat(value ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round(seconds * 1000);
}

/** Provider-neutral stream facts from the existing ffprobe path. */
export async function inspectAiStoryAudioQcMediaFacts(localPath: string): Promise<AiStoryAudioQcMediaFacts> {
  const mediaContentHash = await hashFileSha256(localPath);
  const empty: AiStoryAudioQcMediaFacts = {
    hasVideoStream: false,
    hasAudioStream: false,
    videoDurationMs: null,
    audioDurationMs: null,
    audioCodec: null,
    sampleRate: null,
    channelCount: null,
    decodable: false,
    mediaContentHash,
  };
  try {
    const { stdout } = await execFileAsync(
      ffprobePath(),
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", localPath],
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; codec_name?: string; duration?: string; sample_rate?: string; channels?: number }>;
    };
    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
    const formatDuration = positiveMs(parsed.format?.duration);
    return {
      hasVideoStream: Boolean(video),
      hasAudioStream: Boolean(audio),
      videoDurationMs: video ? positiveMs(video.duration) ?? formatDuration : null,
      audioDurationMs: audio ? positiveMs(audio.duration) ?? formatDuration : null,
      audioCodec: audio?.codec_name ?? null,
      sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null,
      channelCount: audio?.channels ?? null,
      decodable: Boolean(video || audio),
      mediaContentHash,
    };
  } catch {
    return empty;
  }
}
