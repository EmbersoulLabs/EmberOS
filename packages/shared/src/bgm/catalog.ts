import type { PresetId } from "../presets/types";
import { getBgmTrackById, LEGACY_BGM_KEY_MAP, type BgmTrack } from "./library";

/** Resolve any legacy key or track id to a library track id. */
export function resolveBgmTrackKey(presetOrKey?: string | null): string {
  if (!presetOrKey || presetOrKey === "none") return "lifestyle_acoustic";
  if (presetOrKey in LEGACY_BGM_KEY_MAP) return LEGACY_BGM_KEY_MAP[presetOrKey]!;
  if (getBgmTrackById(presetOrKey)) return presetOrKey;
  return "lifestyle_acoustic";
}

export function getBgmTrack(presetOrKey?: string | null): { url: string; label: string; id: string } {
  const id = resolveBgmTrackKey(presetOrKey);
  const track = getBgmTrackById(id);
  if (!track) {
    return { id: "lifestyle_acoustic", url: "", label: "Lifestyle Acoustic" };
  }
  return { id: track.id, url: track.fileUrl, label: track.name };
}

export function bgmTrackForPreset(presetId: PresetId): {
  key: string;
  track: { url: string; label: string; id: string };
} {
  const key = resolveBgmTrackKey(presetId);
  return { key, track: getBgmTrack(key) };
}

/** @deprecated use BGM_LIBRARY — kept for creative-audio labels */
export const BGM_TRACKS: Record<string, { url: string; label: string }> = new Proxy(
  {} as Record<string, { url: string; label: string }>,
  {
    get(_t, prop: string) {
      const t = getBgmTrackById(prop);
      if (!t) return undefined;
      return { url: t.fileUrl, label: t.name };
    },
  }
);

export type { BgmTrack };
