import type { PresetId } from "../presets/types";

/** Royalty-free ambient beds (FMA ccCommunity — Chad Crouch, CC BY-NC). Cached by worker. */
const FMA = "https://files.freemusicarchive.org/storage-freemusicarchive-org/music/ccCommunity/Chad_Crouch";

export const BGM_TRACKS: Record<string, { url: string; label: string }> = {
  wedding: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Tuscan_Sun.mp3`,
    label: "Tuscan Sun (romantic ambient)",
  },
  florist: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Coral.mp3`,
    label: "Coral (soft floral)",
  },
  marketing: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Taut.mp3`,
    label: "Taut (upbeat)",
  },
  restaurant: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Ruby.mp3`,
    label: "Ruby (warm lounge)",
  },
  beauty: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Coral.mp3`,
    label: "Coral (soft glow)",
  },
  property: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Charcoal.mp3`,
    label: "Charcoal (steady)",
  },
  education: {
    url: `${FMA}/Arps/Chad_Crouch_-_Algorithms.mp3`,
    label: "Algorithms (focus)",
  },
  story: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Tuscan_Sun.mp3`,
    label: "Tuscan Sun (narrative)",
  },
  podcast: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Charcoal.mp3`,
    label: "Charcoal (calm talk)",
  },
  corporate: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Charcoal.mp3`,
    label: "Charcoal (corporate)",
  },
  default: {
    url: `${FMA}/Ambient_Atmospheres/Chad_Crouch_-_Charcoal.mp3`,
    label: "Charcoal (default)",
  },
};

export function resolveBgmTrackKey(presetOrKey?: string | null): string {
  if (!presetOrKey || presetOrKey === "none") return "default";
  if (presetOrKey in BGM_TRACKS) return presetOrKey;
  return "default";
}

export function getBgmTrack(presetOrKey?: string | null) {
  const key = resolveBgmTrackKey(presetOrKey);
  return BGM_TRACKS[key] ?? BGM_TRACKS.default!;
}

export function bgmTrackForPreset(presetId: PresetId): { key: string; track: (typeof BGM_TRACKS)[string] } {
  const key = resolveBgmTrackKey(presetId);
  return { key, track: getBgmTrack(key) };
}
