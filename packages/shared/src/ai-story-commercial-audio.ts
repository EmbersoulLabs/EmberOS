import { COMMERCIAL_BGM_LIBRARY } from "./bgm/commercial-library.generated";
import { recommendBgm, type BgmRecommendation } from "./bgm/recommend";
import type { BgmTrack } from "./bgm/library";

/**
 * Desktop LOCAL_GPU does not yet have a certified native-audio workflow.
 * V2 submit rejects native dialogue, and the V3 submit builder reports e2eCertified false.
 * Callers may pass true only when a certified capability says so.
 */
export const LOCAL_GPU_NATIVE_DIALOGUE_CERTIFIED = false;
export const LOCAL_GPU_NATIVE_AMBIENT_CERTIFIED = false;

export type CommercialGenerationPolicy = "SILENT_GENERATION" | "NATIVE_PRESERVED";
export type CommercialDesktopPolicy = "SILENT_OUTPUT" | "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "UNCHANGED_PACKAGE_AUDIO";
export type CommercialFinalPolicy =
  | "EXPLICIT_SILENCE"
  | "LICENSED_BGM"
  | "PRESERVE_NATIVE"
  | "NATIVE_PLUS_BGM"
  | "BLOCKED";
export type CommercialAudioBlocker =
  | "MISSING_LICENSED_MUSIC"
  | "VOICEOVER_NOT_AUTHORIZED"
  | "NATIVE_AUDIO_NOT_CERTIFIED";

export type CommercialAudioDecision = {
  dialogueRequired: boolean;
  narrationDesired: boolean;
  generationPolicy: CommercialGenerationPolicy;
  desktopGenerationPolicy: CommercialDesktopPolicy;
  finalPolicy: CommercialFinalPolicy;
  blockers: CommercialAudioBlocker[];
};

export function commerciallyLicensedTrack(trackId: string): BgmTrack | null {
  const track = COMMERCIAL_BGM_LIBRARY.find((item) => item.id === trackId);
  if (!track?.fileUrl || !track.licenseUrl) return null;
  if (track.license !== "royalty_free" && track.license !== "licensed") return null;
  const licenseUrl = track.licenseUrl.toLowerCase();
  if (licenseUrl.includes("/by-nc") || licenseUrl.includes("noncommercial")) return null;
  return track;
}

export function commercialMusicAvailable(): boolean {
  return COMMERCIAL_BGM_LIBRARY.some((track) => commerciallyLicensedTrack(track.id) !== null);
}

/**
 * No dialogue is not silence. Generation silence stays a Desktop fact.
 * The final commercial policy is chosen separately from licensed music,
 * certified native audio, or an explicit silence selection.
 */
export function decideCommercialAudio(input: {
  visibleDialogueCount: number;
  narrationDesired: boolean;
  explicitSilence: boolean;
  nativeDialogueCertified: boolean;
  nativeAmbientCertified: boolean;
  licensedMusicAvailable: boolean;
  voiceoverAuthorized: boolean;
}): CommercialAudioDecision {
  const dialogueRequired = input.visibleDialogueCount > 0;
  const speechWanted = dialogueRequired || input.narrationDesired;
  const nativeSpeech = dialogueRequired && input.nativeDialogueCertified;
  const blockers: CommercialAudioBlocker[] = [];
  if (speechWanted && !nativeSpeech && !input.voiceoverAuthorized) {
    if (dialogueRequired) blockers.push("NATIVE_AUDIO_NOT_CERTIFIED");
    blockers.push("VOICEOVER_NOT_AUTHORIZED");
  }
  const withMusic = (preserved: CommercialFinalPolicy): CommercialFinalPolicy =>
    input.licensedMusicAvailable ? "NATIVE_PLUS_BGM" : preserved;
  if (input.explicitSilence) {
    return {
      dialogueRequired, narrationDesired: input.narrationDesired,
      generationPolicy: "SILENT_GENERATION", desktopGenerationPolicy: "SILENT_OUTPUT",
      finalPolicy: "EXPLICIT_SILENCE", blockers: [],
    };
  }
  if (nativeSpeech) {
    return {
      dialogueRequired, narrationDesired: input.narrationDesired,
      generationPolicy: "NATIVE_PRESERVED", desktopGenerationPolicy: "UNCHANGED_PACKAGE_AUDIO",
      finalPolicy: withMusic("PRESERVE_NATIVE"), blockers: [],
    };
  }
  if (!dialogueRequired && input.nativeAmbientCertified) {
    return {
      dialogueRequired, narrationDesired: input.narrationDesired,
      generationPolicy: "NATIVE_PRESERVED", desktopGenerationPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      finalPolicy: withMusic("PRESERVE_NATIVE"),
      blockers: blockers.filter((item) => item !== "NATIVE_AUDIO_NOT_CERTIFIED"),
    };
  }
  if (!input.licensedMusicAvailable) {
    return {
      dialogueRequired, narrationDesired: input.narrationDesired,
      generationPolicy: "SILENT_GENERATION", desktopGenerationPolicy: "SILENT_OUTPUT",
      finalPolicy: "BLOCKED", blockers: [...blockers, "MISSING_LICENSED_MUSIC"],
    };
  }
  return {
    dialogueRequired, narrationDesired: input.narrationDesired,
    generationPolicy: "SILENT_GENERATION", desktopGenerationPolicy: "SILENT_OUTPUT",
    finalPolicy: "LICENSED_BGM", blockers,
  };
}

export function selectCommercialBgm(input: {
  brief: string;
  excludeTrackIds?: string[];
}): { track: BgmTrack | null; recommendation: BgmRecommendation | null; blocker: "MISSING_LICENSED_MUSIC" | null } {
  if (!commercialMusicAvailable()) return { track: null, recommendation: null, blocker: "MISSING_LICENSED_MUSIC" };
  const recommendation = recommendBgm({
    campaignBrief: input.brief,
    videoArchetype: "sales",
    excludeTrackIds: input.excludeTrackIds,
  });
  const track = commerciallyLicensedTrack(recommendation.trackId);
  if (!track) return { track: null, recommendation, blocker: "MISSING_LICENSED_MUSIC" };
  return { track, recommendation, blocker: null };
}
