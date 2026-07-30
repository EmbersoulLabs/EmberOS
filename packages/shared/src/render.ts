import type { EditPlan } from "./types/index";
import type { Platform } from "./types/index";
import { MARKETING_OUTPUT_STRATEGY } from "./marketing-output-strategy";

/** MVP upload / source limits */
export const RENDER_MVP_LIMITS = {
  /** Quick Mode: multiple source clips per campaign. */
  MAX_SOURCE_VIDEOS: 8,
  MAX_IMAGES: 8,
  /** Max length for any single uploaded source clip (seconds). */
  MAX_UPLOAD_DURATION_SEC: 600,
  /** Quick Mode: combined duration of all source videos (seconds). */
  MAX_COMBINED_SOURCE_DURATION_SEC: 600,
  /** Legacy agency montage max output length (seconds). */
  MAX_MONTAGE_OUTPUT_SEC: 15,
} as const;

/** Auto Clip V1 — long video → N standalone shorts (PD-054 / PD-055). */
export const AUTO_CLIP = {
  /**
   * @deprecated Prefer DEFAULT_OUTPUT_COUNT / MARKETING_OUTPUT_STRATEGY.
   * Alias of the PD-054/055 default target (not a hardcoded architecture constant).
   */
  CLIP_COUNT: MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS,
  DEFAULT_OUTPUT_COUNT: MARKETING_OUTPUT_STRATEGY.DEFAULT_TARGET_OUTPUTS,
  MIN_OUTPUT_COUNT: MARKETING_OUTPUT_STRATEGY.MINIMUM_OUTPUTS,
  MAX_OUTPUT_COUNT: MARKETING_OUTPUT_STRATEGY.MAXIMUM_OUTPUTS,
  OUTPUT_DURATION_SEC: 35,
  MIN_SEGMENT_SEC: 12,
  MAX_SEGMENT_SEC: 45,
  /** Whisper chunk size when transcribing long sources (seconds). */
  WHISPER_CHUNK_SEC: 480,
  /** Clips shorter than this use BGM + subtitles only (no TTS). */
  TTS_MIN_CLIP_SEC: 10,
} as const;

/** Default clip variants for V1 (target 5; quality-first may keep 3–5). */
export const AUTO_CLIP_VARIANTS = [
  {
    index: 0,
    title: "Best Overall",
    variant: "overall" as const,
    hookType: "overall",
    videoArchetype: "story" as const,
    focus: "best overall marketing performance and balanced message",
    voiceLocale: "en" as const,
  },
  {
    index: 1,
    title: "Strong Hook",
    variant: "hook" as const,
    hookType: "hook",
    videoArchetype: "engagement" as const,
    focus: "strong opening hook in the first 3 seconds",
    voiceLocale: "en" as const,
  },
  {
    index: 2,
    title: "Problem / Pain Point",
    variant: "problem" as const,
    hookType: "problem",
    videoArchetype: "story" as const,
    focus: "customer pain point and emotional tension",
    voiceLocale: "en" as const,
  },
  {
    index: 3,
    title: "Product Highlight",
    variant: "product" as const,
    hookType: "product",
    videoArchetype: "sales" as const,
    focus: "product visibility, features, and benefits",
    voiceLocale: "zh" as const,
  },
  {
    index: 4,
    title: "Promotion / CTA",
    variant: "cta" as const,
    hookType: "cta",
    videoArchetype: "sales" as const,
    focus: "clear call to action and conversion prompt",
    voiceLocale: "en" as const,
  },
] as const;

/** Map campaign platforms → one target platform per auto clip. */
export function resolveAutoClipPlatforms(platforms: Platform[]): Platform[] {
  const list = platforms.length ? platforms : (["tiktok"] as Platform[]);
  const count = AUTO_CLIP.DEFAULT_OUTPUT_COUNT;
  return Array.from({ length: count }, (_, i) => list[i] ?? list[i % list.length]!);
}

export type RenderMode = "preview" | "final" | "subtitles_only";

/** Profile selector — includes 2k export (1440×2560 vertical). */
export type RenderProfileKey = RenderMode | "2k";

export type ClipDownloadResolution = "720p" | "1080p" | "2k";

export const CLIP_DOWNLOAD_RESOLUTIONS = ["720p", "1080p", "2k"] as const;

export type RenderStatus =
  | "none"
  | "preview_rendering"
  | "preview_ready"
  | "final_rendering"
  | "final_ready";

export type RenderPhase =
  | "queued"
  | "downloading"
  | "base_clip"
  | "subtitles"
  | "upload"
  | "done";

export interface RenderProgress {
  percent: number;
  phase: RenderPhase;
  mode?: RenderMode;
  updatedAt?: string;
  error?: string;
}

export interface RenderProfile {
  mode: RenderMode;
  width: number;
  height: number;
  preset: string;
  crf: string;
  videoBitrate: string;
  audioBitrate: string;
  label: string;
}

function previewHeightFromEnv(): number {
  const env =
    typeof globalThis !== "undefined" &&
    "process" in globalThis &&
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env
      ?.PREVIEW_RENDER_HEIGHT;
  return Number(env ?? "720");
}

/** Fingerprint of video/base-clip processing (excludes subtitles, BGM, and TTS). */
export function baseClipFingerprint(editPlan: EditPlan): string {
  const payload = JSON.stringify({
    clips: editPlan.clips.map((c) => ({
      assetId: c.assetId,
      startSec: c.startSec,
      endSec: c.endSec,
      speed: c.speed,
      motion: c.motion,
      role: c.role,
      outputDurationSec: c.outputDurationSec,
      focusX: c.focusX,
      focusY: c.focusY,
    })),
    targetDurationSec: editPlan.targetDurationSec,
    effects: editPlan.effects ?? [],
    audio: {
      keepOriginal: editPlan.audio.keepOriginal,
      normalize: editPlan.audio.normalize,
    },
    coverAt: editPlan.cover.atSec,
  });
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash << 5) - hash + payload.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export function getRenderProfile(mode: RenderProfileKey): RenderProfile {
  if (mode === "2k") {
    return {
      mode: "final",
      width: 1440,
      height: 2560,
      preset: "slow",
      crf: "18",
      videoBitrate: "8000k",
      audioBitrate: "192k",
      label: "2k",
    };
  }
  if (mode === "final") {
    return {
      mode: "final",
      width: 1080,
      height: 1920,
      preset: "medium",
      crf: "20",
      videoBitrate: "4500k",
      audioBitrate: "192k",
      label: "1080p",
    };
  }
  const use480 = previewHeightFromEnv() <= 480;
  const width = use480 ? 480 : 720;
  const height = use480 ? 854 : 1280;
  return {
    mode: mode === "subtitles_only" ? "subtitles_only" : "preview",
    width,
    height,
    preset: "fast",
    crf: "25",
    videoBitrate: use480 ? "900k" : "1200k",
    audioBitrate: "96k",
    label: use480 ? "480p" : "720p",
  };
}

export function profileKeyForDownloadResolution(res: ClipDownloadResolution): RenderProfileKey {
  if (res === "2k") return "2k";
  if (res === "1080p") return "final";
  return "preview";
}

export function parseClipDownloadResolution(value: unknown): ClipDownloadResolution | null {
  if (value === "720p" || value === "1080p" || value === "2k") return value;
  return null;
}

export function renderStatusForMode(mode: RenderMode, running: boolean): RenderStatus {
  if (mode === "final") return running ? "final_rendering" : "final_ready";
  return running ? "preview_rendering" : "preview_ready";
}
