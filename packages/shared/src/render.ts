import type { EditPlan } from "./types/index";

/** MVP upload / source limits */
export const RENDER_MVP_LIMITS = {
  MAX_SOURCE_VIDEOS: 1,
  MAX_IMAGES: 8,
  MAX_DURATION_SEC: 15,
} as const;

export type RenderMode = "preview" | "final" | "subtitles_only";

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

/** Fingerprint of video processing excluding subtitles (for cache invalidation). */
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
    })),
    targetDurationSec: editPlan.targetDurationSec,
    effects: editPlan.effects ?? [],
    audio: {
      keepOriginal: editPlan.audio.keepOriginal,
      bgm: editPlan.audio.bgm ?? null,
      normalize: editPlan.audio.normalize,
      voiceover: editPlan.audio.voiceover ?? null,
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

export function getRenderProfile(mode: RenderMode): RenderProfile {
  if (mode === "final") {
    return {
      mode: "final",
      width: 1080,
      height: 1920,
      preset: "veryfast",
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
    preset: "ultrafast",
    crf: "28",
    videoBitrate: use480 ? "900k" : "1200k",
    audioBitrate: "96k",
    label: use480 ? "480p" : "720p",
  };
}

export function renderStatusForMode(mode: RenderMode, running: boolean): RenderStatus {
  if (mode === "final") return running ? "final_rendering" : "final_ready";
  return running ? "preview_rendering" : "preview_ready";
}
