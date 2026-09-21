import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import {
  AI_STORY_NATIVE_AV_RESULT_CONTRACT_VERSION,
  AiStoryNativeAvResultEvidenceSchema,
  type AiStoryNativeAvHumanPerformanceReviewSchema,
  type AiStoryNativeAvResultEvidence,
  type AiStoryNativeDialogueFailureCode,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import { hashFileSha256 } from "./assembly-runtime-media-access";
import type { z } from "zod";

const execFileAsync = promisify(execFile);

export class AiStoryNativeAvResultError extends Error {
  constructor(
    readonly code: AiStoryNativeDialogueFailureCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryNativeAvResultError";
  }
}

function ffmpegPath(): string {
  return process.env.FFMPEG_PATH ?? "ffmpeg";
}

function ffprobePath(): string {
  const ffmpeg = ffmpegPath();
  if (ffmpeg.toLowerCase().endsWith("ffmpeg.exe")) {
    return ffmpeg.slice(0, -"ffmpeg.exe".length) + "ffprobe.exe";
  }
  return process.env.FFPROBE_PATH ?? "ffprobe";
}

function durationMs(
  value: string | undefined,
  fallback: number
): number {
  const seconds = Number.parseFloat(value ?? "");
  return Number.isFinite(seconds) && seconds > 0
    ? Math.round(seconds * 1000)
    : fallback;
}

function frameRate(value: string | undefined): number {
  if (!value) return 0;
  if (value.includes("/")) {
    const [numerator, denominator] = value.split("/").map(Number);
    return numerator && denominator ? numerator / denominator : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function validateAiStoryNativeAvResult(input: {
  readonly localPath: string;
  readonly providerTaskId: string;
  readonly requestFingerprint: string;
  readonly dialogueAuthorityId: string;
  readonly expectedContentHash?: string;
  readonly inspectedAt?: string;
  readonly humanPerformanceReview?: z.infer<
    typeof AiStoryNativeAvHumanPerformanceReviewSchema
  >;
}): Promise<AiStoryNativeAvResultEvidence> {
  const [{ stdout }, file, mediaContentHash] = await Promise.all([
    execFileAsync(
      ffprobePath(),
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
    ).catch(() => {
      throw new AiStoryNativeAvResultError(
        "NATIVE_AV_DECODE_FAILED",
        "Native audiovisual result could not be probed"
      );
    }),
    stat(input.localPath),
    hashFileSha256(input.localPath),
  ]);
  if (
    input.expectedContentHash &&
    input.expectedContentHash !== mediaContentHash
  ) {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_CONTENT_HASH_MISMATCH",
      "Native audiovisual result content hash changed"
    );
  }
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      duration?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      sample_rate?: string;
      channels?: number;
    }>;
  };
  const formatDurationMs = durationMs(parsed.format?.duration, 0);
  const video = parsed.streams?.find(
    (stream) => stream.codec_type === "video"
  );
  const audio = parsed.streams?.find(
    (stream) => stream.codec_type === "audio"
  );
  if (!video?.width || !video.height) {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_VIDEO_STREAM_MISSING",
      "Provider result has no valid video stream"
    );
  }
  if (!audio) {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_AUDIO_STREAM_MISSING",
      "Provider result has no native audio stream"
    );
  }
  const videoDurationMs = durationMs(video.duration, formatDurationMs);
  const audioDurationMs = durationMs(audio.duration, formatDurationMs);
  if (videoDurationMs <= 0 || audioDurationMs <= 0) {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_DURATION_INVALID",
      "Provider audiovisual stream duration is invalid"
    );
  }
  const durationToleranceMs = 250;
  if (
    Math.abs(videoDurationMs - audioDurationMs) > durationToleranceMs
  ) {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_DURATION_MISMATCH",
      "Provider audio/video stream durations are incompatible"
    );
  }
  try {
    await execFileAsync(
      ffmpegPath(),
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        input.localPath,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      }
    );
  } catch {
    throw new AiStoryNativeAvResultError(
      "NATIVE_AV_DECODE_FAILED",
      "Provider audiovisual streams failed decode validation"
    );
  }
  const review = input.humanPerformanceReview ?? {
    dialogueIsSpokenNotRead: "HUMAN_REVIEW_REQUIRED",
    lipSync: "HUMAN_REVIEW_REQUIRED",
    facialPerformance: "HUMAN_REVIEW_REQUIRED",
    bodyPerformance: "HUMAN_REVIEW_REQUIRED",
    conversationalTiming: "HUMAN_REVIEW_REQUIRED",
    emotion: "HUMAN_REVIEW_REQUIRED",
    phraseEmphasis: "HUMAN_REVIEW_REQUIRED",
    microPauses: "HUMAN_REVIEW_REQUIRED",
    speechActionCoordination: "HUMAN_REVIEW_REQUIRED",
    codeSwitchContinuity: "NOT_RUN",
  } as const;
  return AiStoryNativeAvResultEvidenceSchema.parse({
    resultEvidenceId: deterministicPersistenceUuid(
      "ai-story-native-av-result-evidence",
      {
        providerTaskId: input.providerTaskId,
        requestFingerprint: input.requestFingerprint,
        mediaContentHash,
      }
    ),
    contractVersion: AI_STORY_NATIVE_AV_RESULT_CONTRACT_VERSION,
    providerId: "seedance",
    modelId: "dreamina-seedance-2-0-260128",
    providerTaskId: input.providerTaskId,
    requestFingerprint: input.requestFingerprint,
    dialogueAuthorityId: input.dialogueAuthorityId,
    mediaContentHash,
    mediaType: "video/mp4",
    byteSize: file.size,
    videoCodec: video.codec_name ?? "unknown",
    audioCodec: audio.codec_name ?? "unknown",
    videoDurationMs,
    audioDurationMs,
    width: video.width,
    height: video.height,
    frameRate: frameRate(
      video.avg_frame_rate ?? video.r_frame_rate
    ),
    sampleRate: Number(audio.sample_rate ?? 0),
    channelCount: Number(audio.channels ?? 0),
    decodable: true,
    durationToleranceMs,
    technicalNativeAudio: "PASS",
    humanPerformanceReview: review,
    inspectedAt: input.inspectedAt ?? new Date().toISOString(),
  });
}
