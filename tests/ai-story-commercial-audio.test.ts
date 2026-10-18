import { describe, expect, it } from "vitest";
import {
  LOCAL_GPU_NATIVE_AMBIENT_CERTIFIED,
  LOCAL_GPU_NATIVE_DIALOGUE_CERTIFIED,
  commerciallyLicensedTrack,
  decideCommercialAudio,
  selectCommercialBgm,
} from "@ceo-agent/shared";

const licensed = { licensedMusicAvailable: true, voiceoverAuthorized: false, explicitSilence: false, narrationDesired: false, nativeDialogueCertified: false, nativeAmbientCertified: false };

describe("commercial audio strategy", () => {
  it("keeps Desktop native audio uncertified until a capability says otherwise", () => {
    expect(LOCAL_GPU_NATIVE_DIALOGUE_CERTIFIED).toBe(false);
    expect(LOCAL_GPU_NATIVE_AMBIENT_CERTIFIED).toBe(false);
  });

  it("gives a no-dialogue product video licensed music instead of a silent deliverable", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0 })).toMatchObject({
      dialogueRequired: false, generationPolicy: "SILENT_GENERATION", desktopGenerationPolicy: "SILENT_OUTPUT", finalPolicy: "LICENSED_BGM", blockers: [],
    });
  });

  it("treats ZERO_ASSET and brand-story pictures the same way", () => {
    for (const workflow of ["ZERO_ASSET", "BRAND_STORY"]) {
      expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0 }), workflow).toMatchObject({ finalPolicy: "LICENSED_BGM", desktopGenerationPolicy: "SILENT_OUTPUT" });
    }
  });

  it("does not invent speech for a character or restaurant scene when native audio and voiceover are not authorized", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 1 })).toMatchObject({
      finalPolicy: "LICENSED_BGM", blockers: ["NATIVE_AUDIO_NOT_CERTIFIED", "VOICEOVER_NOT_AUTHORIZED"],
    });
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0, narrationDesired: true })).toMatchObject({
      finalPolicy: "LICENSED_BGM", blockers: ["VOICEOVER_NOT_AUTHORIZED"],
    });
  });

  it("preserves certified native dialogue and adds music beside it", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 2, nativeDialogueCertified: true })).toMatchObject({
      generationPolicy: "NATIVE_PRESERVED", desktopGenerationPolicy: "UNCHANGED_PACKAGE_AUDIO", finalPolicy: "NATIVE_PLUS_BGM", blockers: [],
    });
  });

  it("uses certified ambient generation without treating the picture as silent", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0, nativeAmbientCertified: true })).toMatchObject({
      generationPolicy: "NATIVE_PRESERVED", desktopGenerationPolicy: "NO_DIALOGUE_WITH_AMBIENT_AUDIO", finalPolicy: "NATIVE_PLUS_BGM",
    });
  });

  it("keeps explicit silence only when it is selected", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0, explicitSilence: true }).finalPolicy).toBe("EXPLICIT_SILENCE");
  });

  it("blocks a commercial deliverable when no licensed music exists", () => {
    expect(decideCommercialAudio({ ...licensed, visibleDialogueCount: 0, licensedMusicAvailable: false })).toMatchObject({
      finalPolicy: "BLOCKED", blockers: ["MISSING_LICENSED_MUSIC"],
    });
  });

  it("selects a commercially licensed Video Studio track and rejects the non-commercial fallback", () => {
    const selected = selectCommercialBgm({ brief: "bright clean product commercial for a pink handheld fan" });
    expect(selected.blocker).toBeNull();
    expect(selected.track?.license).toBe("royalty_free");
    expect(selected.track?.licenseUrl).toContain("publicdomain/zero");
    expect(commerciallyLicensedTrack("not-a-real-track")).toBeNull();
  });
});
