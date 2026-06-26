import { BGM_LIBRARY, getBgmTrackById, LEGACY_BGM_KEY_MAP, listDistinctBgmTracks } from "./bgm/library";

import type { CopyLocale } from "./copy-mix";

import type { EditPlan } from "./types/index";
export const CLIP_BGM_KEYS = BGM_LIBRARY.map((t) => t.id) as readonly string[];

export type ClipBgmKey = (typeof CLIP_BGM_KEYS)[number] | "none";

export const CLIP_VOICE_PRESETS = ["female", "male", "none"] as const;

export type ClipVoicePreset = (typeof CLIP_VOICE_PRESETS)[number];

export type ExternalBgm = NonNullable<EditPlan["audio"]["bgmExternal"]>;

export interface CreativeAudioSettings {
  bgm: ClipBgmKey;
  voicePreset: ClipVoicePreset;
  ttsLocale?: CopyLocale;
  hasBilingualScripts: boolean;
  bgmRecommendation?: EditPlan["audio"]["bgmRecommendation"];
  externalBgm?: ExternalBgm;
  /** Seconds into the BGM file where the bed starts in the rendered clip. */
  bgmStartOffsetSec: number;
  clipDurationSec: number;
  bgmPreviewUrl: string | null;
  bgmTrackDurationSec: number;
}

export function getCreativeBgmPreviewMeta(plan: EditPlan | null | undefined): {
  previewUrl: string | null;
  durationSec: number;
} {
  if (!plan) return { previewUrl: null, durationSec: 120 };

  const external = plan.audio.bgmExternal;
  if (external?.audioUrl) {
    return { previewUrl: external.audioUrl, durationSec: 180 };
  }

  const bgmRaw = plan.audio.bgm;
  if (!bgmRaw || bgmRaw === "none" || bgmRaw === "external") {
    return { previewUrl: null, durationSec: 0 };
  }

  const track = getBgmTrackById(resolveBgmKey(bgmRaw));
  return {
    previewUrl: track?.fileUrl ?? null,
    durationSec: track?.durationSec ?? 120,
  };
}

export function readCreativeAudioSettings(plan: EditPlan | null | undefined): CreativeAudioSettings {
  const bgmMeta = getCreativeBgmPreviewMeta(plan);
  if (!plan) {
    return {
      bgm: "calm_ambient",
      voicePreset: "female",
      hasBilingualScripts: false,
      bgmStartOffsetSec: 0,
      clipDurationSec: 15,
      bgmPreviewUrl: bgmMeta.previewUrl,
      bgmTrackDurationSec: bgmMeta.durationSec,
    };
  }

  const vo = plan.audio.voiceover;
  const external = plan.audio.bgmExternal ?? undefined;
  const bgmRaw = plan.audio.bgm;
  const resolved = external
    ? ("external" as ClipBgmKey)
    : !bgmRaw || bgmRaw === "none"
      ? "none"
      : getBgmTrackById(bgmRaw)
        ? (resolveBgmKey(bgmRaw) as ClipBgmKey)
        : "calm_ambient";

  let voicePreset: ClipVoicePreset = "female";
  if (!vo?.enabled) {
    voicePreset = "none";
  } else if (vo.voice === "male") {
    voicePreset = "male";
  }

  return {
    bgm: resolved,
    voicePreset,
    ttsLocale: vo?.locale,
    hasBilingualScripts: Boolean(plan.finalScriptZh?.trim() && plan.finalScriptEn?.trim()),
    bgmRecommendation: plan.audio.bgmRecommendation,
    externalBgm: external,
    bgmStartOffsetSec: plan.audio.bgmStartOffsetSec ?? 0,
    clipDurationSec: plan.targetDurationSec,
    bgmPreviewUrl: external?.audioUrl ?? getBgmTrackById(resolveBgmKey(bgmRaw ?? ""))?.fileUrl ?? null,
    bgmTrackDurationSec: bgmMeta.durationSec,
  };
}

function resolveBgmKey(raw: string): string {
  if (raw in LEGACY_BGM_KEY_MAP) return LEGACY_BGM_KEY_MAP[raw]!;
  return raw;
}

export function bgmOptionLabel(key: ClipBgmKey): string {
  if (key === "none") return "No BGM";
  return getBgmTrackById(key)?.name ?? key;
}

/** Distinct BGM choices for clip audio settings UI (with previewable source URL). */
export function getBgmPickerOptions(): Array<{
  trackId: string;
  trackName: string;
  previewUrl: string;
  category: string;
  mood: string;
}> {
  return listDistinctBgmTracks().map((track) => ({
    trackId: track.id,
    trackName: track.name,
    previewUrl: track.fileUrl,
    category: track.category,
    mood: track.mood,
  }));
}

/** Full preview rerender when voice is newly enabled or clip duration changes materially. */
export function needsFullAudioRerender(before: EditPlan, after: EditPlan): boolean {
  const beforeVo = Boolean(before.audio.voiceover?.enabled);
  const afterVo = Boolean(after.audio.voiceover?.enabled);
  if (!beforeVo && afterVo) return true;
  if (beforeVo !== afterVo) return true;
  if ((before.audio.voiceover?.voice ?? "female") !== (after.audio.voiceover?.voice ?? "female")) {
    return true;
  }
  if (Math.abs(before.targetDurationSec - after.targetDurationSec) > 0.35) return true;
  return false;
}

export function isClipBgmKey(value: unknown): value is ClipBgmKey {
  return value === "none" || (typeof value === "string" && CLIP_BGM_KEYS.includes(value));
}

export function isClipVoicePreset(value: unknown): value is ClipVoicePreset {
  return typeof value === "string" && (CLIP_VOICE_PRESETS as readonly string[]).includes(value);
}
