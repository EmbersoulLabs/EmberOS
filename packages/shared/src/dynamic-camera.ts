import type { ClipMotion } from "./presets/types";
import type { EditPlan, VisionAnalysis } from "./types/index";

/** TikTok-style dynamic camera — virtual cuts every 2–3s with alternating Ken Burns motion. */
export const DYNAMIC_CAMERA = {
  MIN_VISUAL_BEATS: 4,
  BEAT_INTERVAL_SEC: 2.5,
  MAX_BEATS: 8,
  ZOOM_MIN: 1.0,
  ZOOM_MAX: 1.15,
  CROSSFADE_SEC: 0.12,
  HOOK_CARD_SEC: 3.0,
} as const;

export interface SubjectFocus {
  /** Normalized horizontal center 0–1 (0.5 = frame center). */
  x: number;
  /** Normalized vertical center 0–1 (0.5 = frame center). */
  y: number;
  label?: string;
}

const MOTION_CYCLE: ClipMotion[] = ["slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right"];

export function inferSubjectFocus(vision?: VisionAnalysis | null): SubjectFocus {
  if (vision?.primarySubject) {
    return {
      x: clamp01(vision.primarySubject.x),
      y: clamp01(vision.primarySubject.y),
      label: vision.primarySubject.label,
    };
  }

  const subjects = (vision?.subjects ?? []).join(" ").toLowerCase();
  const hasProduct =
    (vision?.products?.length ?? 0) > 0 ||
    /product|bouquet|flower|item|package|food|dish|phone|device|sku/.test(subjects);

  if (hasProduct) {
    return { x: 0.5, y: 0.42, label: vision?.products?.[0]?.name ?? "product" };
  }

  if (/person|speaker|host|face|model/.test(subjects)) {
    return { x: 0.5, y: 0.38, label: "speaker" };
  }

  return { x: 0.5, y: 0.5, label: "center" };
}

export function countVirtualBeats(outputDurationSec: number): number {
  const raw = Math.ceil(outputDurationSec / DYNAMIC_CAMERA.BEAT_INTERVAL_SEC);
  return Math.min(
    DYNAMIC_CAMERA.MAX_BEATS,
    Math.max(DYNAMIC_CAMERA.MIN_VISUAL_BEATS, raw)
  );
}

/** Split one source window into virtual cuts with alternating Ken Burns / pan motion. */
export function buildVirtualCuts(input: {
  assetId: string;
  sourceStartSec: number;
  sourceEndSec: number;
  outputDurationSec: number;
  focus?: SubjectFocus;
}): EditPlan["clips"] {
  const { assetId, sourceStartSec, sourceEndSec, outputDurationSec, focus } = input;
  const sourceSpan = Math.max(0.5, sourceEndSec - sourceStartSec);
  const beatCount = countVirtualBeats(outputDurationSec);
  const outputBeatSec = outputDurationSec / beatCount;
  const sourceBeatSec = sourceSpan / beatCount;
  const fx = focus?.x ?? 0.5;
  const fy = focus?.y ?? 0.5;

  return Array.from({ length: beatCount }, (_, i) => ({
    assetId,
    startSec: sourceStartSec + i * sourceBeatSec,
    endSec: sourceStartSec + (i + 1) * sourceBeatSec,
    outputDurationSec: outputBeatSec,
    speed: 1,
    motion: MOTION_CYCLE[i % MOTION_CYCLE.length],
    role: (i === 0 ? "hook" : "product") as EditPlan["clips"][number]["role"],
    focusX: fx,
    focusY: fy,
  }));
}

/** Large hook title card for the first second (TikTok pattern interrupt). */
export function buildHookTitleSubtitle(
  text: string,
  durationSec: number
): EditPlan["subtitles"][number] | null {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return null;
  const hookEnd = Math.min(DYNAMIC_CAMERA.HOOK_CARD_SEC, durationSec);
  if (hookEnd <= 0.05) return null;
  return {
    startSec: 0,
    endSec: hookEnd,
    text: limitCaptionLines(line, 2),
    style: "tiktok_hook_card",
  };
}

export function limitCaptionLines(text: string, maxLines: number): string {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n");
}

function clamp01(n: number): number {
  return Math.max(0.05, Math.min(0.95, n));
}
