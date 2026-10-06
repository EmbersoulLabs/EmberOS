import { describe, expect, it } from "vitest";
import {
  AiStoryCharacterVoiceDnaError,
  AiStoryEpisodeCharacterBindingSchema,
  assertDialogueVoiceDnaBinding,
  assertReferenceAudioIdentity,
  assertSpeakerOwnsVoiceDna,
  assertVoiceContinuityPinned,
  assertVoiceDnaCapabilityMatch,
  assertVoiceDnaDialogueLocale,
  assertVoiceDnaMatchesCharacterVersion,
  describeVoiceIdentity,
  projectVoiceDnaNativePerformanceInstruction,
  resolvePinnedVoiceDna,
  type AiStorySpeechSegment,
  type AiStoryVoiceCapability,
  type VoiceDnaBuildInput,
} from "@ceo-agent/shared";
import {
  buildAiStoryCharacterVoiceDna,
  recomputeAiStoryCharacterVoiceDnaFingerprint,
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  compileAiStoryTtsExecutionRequest,
} from "@ceo-agent/shared/server";

const id = (n: number) =>
  `81000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (seed: string) =>
  `sha256:${seed.repeat(64).slice(0, 64).padEnd(64, "a")}`;

const ORG = id(1);
const WORKSPACE = id(2);
const OTHER_WORKSPACE = id(3);
const CHARACTER = id(4);
const CHARACTER_VERSION = id(5);
const OTHER_VERSION = id(6);
const BOSS = id(7);
const CAPABILITY = id(8);
const OTHER_CAPABILITY = id(9);
const ASSET = id(10);
const IDENTITY = hash("c");

function voice(overrides: Partial<VoiceDnaBuildInput> = {}): VoiceDnaBuildInput {
  return {
    status: "FROZEN",
    orgId: ORG,
    workspaceId: WORKSPACE,
    reusableCharacterId: CHARACTER,
    reusableCharacterVersionId: CHARACTER_VERSION,
    characterIdentityFingerprint: IDENTITY,
    primaryLocale: "zh-MY",
    allowedSecondaryLocales: ["en-MY"],
    codeSwitchPolicy: { mode: "SCRIPT_AUTHORIZED", allowedLocales: ["zh-MY", "en-MY"] },
    voicePresentation: { genderPresentation: "FEMININE", ageRangePresentation: "YOUNG_ADULT" },
    acousticProfile: {
      register: "MID",
      pitchIntent: "MEDIUM",
      resonance: "WARM",
      brightness: "BRIGHT",
      breathiness: "NATURAL",
      texture: "natural conversational texture",
    },
    speechProfile: {
      cadence: "natural Malaysian Mandarin cadence",
      defaultPace: "NATURAL",
      pauseStyle: "NATURAL",
      emphasisStyle: "EXPRESSIVE",
      articulation: "CLEAR",
      energy: "NATURAL",
    },
    accentProfile: {
      locale: "zh-MY",
      regionalIntent: "Malaysian Mandarin",
      prohibitedStylizations: ["announcer voice", "exaggerated accent"],
    },
    defaultDeliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
    mustPreserve: ["Malaysian Mandarin cadence"],
    mustAvoid: ["announcer voice", "exaggerated accent"],
    consistencyMode: "DESCRIPTIVE_VOICE_DNA",
    ...overrides,
  };
}

function capability(
  overrides: Partial<AiStoryVoiceCapability> = {}
): AiStoryVoiceCapability {
  return {
    voiceCapabilityId: CAPABILITY,
    providerCapabilityRef: "fixture-voice",
    providerId: "fixture",
    providerModel: "fixture-model",
    providerVoiceRef: "fixture-voice-ref",
    supportedLocales: ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"],
    supportedDeliveryStyles: ["MANDARIN_MY_CONVERSATIONAL", "CALM_NARRATION"],
    supportedCodeSwitchPairs: [{ primaryLocale: "zh-MY", secondaryLocale: "en-MY" }],
    supportsSSML: false,
    supportsProsodyControl: true,
    supportsEmotionControl: true,
    supportsSpeedControl: true,
    supportsPitchControl: true,
    supportedGenderPresentations: ["FEMININE"],
    supportedAgeRangePresentations: ["YOUNG_ADULT"],
    supportedBrandTones: ["Local SME warmth"],
    maxCharacters: 1000,
    audioFormats: ["mp3"],
    certificationStatus: "CAPABILITY_CERTIFIED",
    version: 1,
    ...overrides,
  };
}

function speech(role: AiStorySpeechSegment["speechRole"] = "DIALOGUE"): AiStorySpeechSegment {
  return {
    speechSegmentId: id(20),
    sourceScriptEntryId: id(21),
    speakerAuthorityId: id(22),
    speechRole: role,
    text: "Continue exactly.",
    primaryLocale: "zh-MY",
    secondaryLocales: [],
    codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
    deliveryStyle: role === "NARRATION" ? "CALM_NARRATION" : "MANDARIN_MY_CONVERSATIONAL",
    emotionIntent: "Warm",
    paceIntent: "NATURAL",
    voiceSelection: {
      voiceCapabilityId: CAPABILITY,
      providerVoiceRef: "fixture-voice-ref",
      genderPresentation: null,
      ageRangePresentation: null,
      brandTone: "Local SME warmth",
    },
    timelineAnchor: { timelineEntryId: id(23), relation: "SHOT_START", offsetMs: 0 },
    startIntent: "AT_ANCHOR",
    endIntent: "NATURAL_END",
    jCutIntent: { enabled: false, overlapMs: 0, semanticRationale: null, allowCrossScene: false },
    lCutIntent: { enabled: false, overlapMs: 0, semanticRationale: null, allowCrossScene: false },
    allowSpeechOverlap: false,
    subtitleBinding: { enabled: false, exactText: "Continue exactly." },
    mustPreserve: ["Exact text"],
    mustAvoid: ["Invented dialect"],
  };
}

function characterVersion() {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: CHARACTER,
    orgId: ORG,
    workspaceId: WORKSPACE,
    name: "Host",
    identityCore: {
      identityDescription: "A synthetic host.",
      faceIdentityDescription: "Oval face and dark eyes.",
      bodyIdentityDescription: "Average adult proportions.",
      distinctiveVisualFacts: ["small beauty mark"],
      mustPreserve: ["face identity"],
      mustNeverChange: ["canonical face identity"],
    },
    defaultLook: {
      wardrobe: "white outfit",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: true,
      hairColorAllowed: false,
    },
    canonicalAssets: [{
      assetId: ASSET,
      contentHash: hash("d"),
      role: "IDENTITY_MASTER",
      source: "USER_APPROVED",
    }],
    status: "ACTIVE",
    version: 1,
    supersedesReusableCharacterVersionId: null,
    createdBy: id(30),
    createdAt: "2026-10-06T00:00:00.000Z",
  });
}

describe("Character Voice DNA V1", () => {
  it("repeats the same fingerprint for the same immutable inputs", () => {
    const first = buildAiStoryCharacterVoiceDna(voice());
    const second = buildAiStoryCharacterVoiceDna(voice());
    expect(first.contractVersion).toBe("ai-story-character-voice-dna.v1");
    expect(first.voiceDnaFingerprint).toBe(second.voiceDnaFingerprint);
    expect(first.voiceDnaId).toBe(second.voiceDnaId);
    expect(recomputeAiStoryCharacterVoiceDnaFingerprint(first)).toBe(first.voiceDnaFingerprint);
  });

  it("refuses a Voice DNA built for another character version", () => {
    const dna = buildAiStoryCharacterVoiceDna(voice());
    expect(() =>
      assertVoiceDnaMatchesCharacterVersion(dna, {
        reusableCharacterId: CHARACTER,
        reusableCharacterVersionId: OTHER_VERSION,
        identityFingerprint: IDENTITY,
      })
    ).toThrow(AiStoryCharacterVoiceDnaError);
  });

  it("pins semantic continuity without claiming exact acoustic identity", () => {
    const dna = buildAiStoryCharacterVoiceDna(voice());
    expect(dna.voiceCapabilityId).toBeUndefined();
    expect(dna.referenceAudioAssetId).toBeUndefined();
    expect(dna.semanticVoiceContinuity).toBe("PINNED");
    expect(dna.exactAcousticVoiceContinuity).toBe("NOT_CLAIMED");
    expect(describeVoiceIdentity(dna).continuityStatement).toContain(
      "Exact acoustic continuity not guaranteed"
    );
  });

  it("requires the bound capability and rejects a different TTS voice", () => {
    const dna = buildAiStoryCharacterVoiceDna(
      voice({ consistencyMode: "CAPABILITY_VOICE_BINDING", voiceCapabilityId: CAPABILITY })
    );
    expect(dna.voiceCapabilityId).toBe(CAPABILITY);
    const request = compileAiStoryTtsExecutionRequest({
      segment: speech(),
      capability: capability(),
      outputFormat: "mp3",
      voiceDna: dna,
    });
    expect(request.voiceCapabilityId).toBe(dna.voiceCapabilityId);
    const otherSegment = speech();
    otherSegment.voiceSelection = {
      ...otherSegment.voiceSelection,
      voiceCapabilityId: OTHER_CAPABILITY,
    };
    expect(() =>
      compileAiStoryTtsExecutionRequest({
        segment: otherSegment,
        capability: capability({ voiceCapabilityId: OTHER_CAPABILITY }),
        outputFormat: "mp3",
        voiceDna: dna,
      })
    ).toThrow(AiStoryCharacterVoiceDnaError);
  });

  it("rejects reference audio from another workspace or with another hash", () => {
    const dna = buildAiStoryCharacterVoiceDna(
      voice({
        consistencyMode: "REFERENCE_AUDIO_IDENTITY",
        referenceAudioAssetId: ASSET,
        referenceAudioContentHash: hash("e"),
      })
    );
    const ready = {
      assetId: ASSET,
      orgId: ORG,
      workspaceId: WORKSPACE,
      mediaType: "audio/wav",
      status: "ready",
      contentHash: hash("e"),
      deleted: false,
    };
    expect(() => assertReferenceAudioIdentity(dna, ready)).not.toThrow();
    expect(() =>
      assertReferenceAudioIdentity(dna, { ...ready, workspaceId: OTHER_WORKSPACE })
    ).toThrow(AiStoryCharacterVoiceDnaError);
    expect(() =>
      assertReferenceAudioIdentity(dna, { ...ready, contentHash: hash("f") })
    ).toThrow(AiStoryCharacterVoiceDnaError);
    expect(() => assertReferenceAudioIdentity(dna, null)).toThrow(
      AiStoryCharacterVoiceDnaError
    );
  });

  it("fails closed when dialogue is bound to a different Voice DNA", () => {
    const dna = buildAiStoryCharacterVoiceDna(voice());
    const other = buildAiStoryCharacterVoiceDna(
      voice({ acousticProfile: { ...voice().acousticProfile, texture: "different texture" } })
    );
    expect(() =>
      assertDialogueVoiceDnaBinding({
        voiceDna: dna,
        voiceDnaId: other.voiceDnaId,
        voiceDnaFingerprint: other.voiceDnaFingerprint,
      })
    ).toThrow(AiStoryCharacterVoiceDnaError);
    expect(() =>
      assertDialogueVoiceDnaBinding({
        voiceDna: dna,
        voiceDnaId: dna.voiceDnaId,
        voiceDnaFingerprint: dna.voiceDnaFingerprint,
      })
    ).not.toThrow();
  });

  it("reuses the pinned Episode Voice DNA instead of a later authority", () => {
    const version = characterVersion();
    const pinned = buildAiStoryCharacterVoiceDna(
      voice({
        reusableCharacterVersionId: version.reusableCharacterVersionId,
        characterIdentityFingerprint: version.identityFingerprint,
      })
    );
    const later = buildAiStoryCharacterVoiceDna(
      voice({
        reusableCharacterVersionId: version.reusableCharacterVersionId,
        characterIdentityFingerprint: version.identityFingerprint,
        accentProfile: { ...voice().accentProfile, regionalIntent: "different regional intent" },
      })
    );
    const projection = buildCampaignProjectionFromReusableCharacter({
      reusable: version,
      campaignId: id(40),
      campaignCharacterId: id(41),
      createdBy: id(30),
      createdAt: "2026-10-06T00:01:00.000Z",
    });
    const historical = buildEpisodeCharacterBinding({
      storyId: id(42),
      reusable: version,
      projection: projection.projection,
      createdBy: id(30),
      createdAt: "2026-10-06T00:02:00.000Z",
    });
    expect(historical.voiceDnaId).toBeUndefined();
    expect(AiStoryEpisodeCharacterBindingSchema.parse(historical).voiceDnaId).toBeUndefined();
    const bound = buildEpisodeCharacterBinding({
      storyId: id(43),
      reusable: version,
      projection: projection.projection,
      voiceDna: pinned,
      createdBy: id(30),
      createdAt: "2026-10-06T00:03:00.000Z",
    });
    expect(resolvePinnedVoiceDna(bound, [later, pinned])?.voiceDnaId).toBe(pinned.voiceDnaId);
    expect(bound.voiceDnaFingerprint).toBe(pinned.voiceDnaFingerprint);
    expect(() => assertVoiceContinuityPinned(historical)).toThrow(AiStoryCharacterVoiceDnaError);
  });

  it("creates a new Voice DNA when core identity changes and leaves the original unchanged", () => {
    const original = buildAiStoryCharacterVoiceDna(voice());
    const fingerprint = original.voiceDnaFingerprint;
    const revised = buildAiStoryCharacterVoiceDna(
      voice({ accentProfile: { ...voice().accentProfile, regionalIntent: "Singapore Mandarin" } })
    );
    expect(revised.voiceDnaFingerprint).not.toBe(fingerprint);
    expect(original.voiceDnaFingerprint).toBe(fingerprint);
    expect(original.accentProfile.regionalIntent).toBe("Malaysian Mandarin");
  });

  it("rejects an unauthorized locale or code-switch", () => {
    const dna = buildAiStoryCharacterVoiceDna(voice());
    expect(() =>
      assertVoiceDnaDialogueLocale({
        voiceDna: dna,
        primaryLocale: "ms-MY",
        secondaryLocales: [],
        codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
      })
    ).toThrow(AiStoryCharacterVoiceDnaError);
    expect(() =>
      assertVoiceDnaDialogueLocale({
        voiceDna: dna,
        primaryLocale: "zh-MY",
        secondaryLocales: ["en-MY"],
        codeSwitchPolicy: { mode: "SCRIPT_AUTHORIZED", allowedLocales: ["zh-MY", "ms-MY"] },
      })
    ).toThrow(AiStoryCharacterVoiceDnaError);
  });

  it("rejects feminine Voice DNA on a masculine-only capability and an age mismatch", () => {
    const dna = buildAiStoryCharacterVoiceDna(
      voice({ consistencyMode: "CAPABILITY_VOICE_BINDING", voiceCapabilityId: CAPABILITY })
    );
    expect(() =>
      assertVoiceDnaCapabilityMatch(dna, capability({ supportedGenderPresentations: ["MASCULINE"] }))
    ).toThrow(AiStoryCharacterVoiceDnaError);
    expect(() =>
      assertVoiceDnaCapabilityMatch(
        dna,
        capability({ supportedAgeRangePresentations: ["MATURE"] })
      )
    ).toThrow(AiStoryCharacterVoiceDnaError);
  });

  it("does not let a supporting speaker inherit the protagonist voice", () => {
    const protagonist = buildAiStoryCharacterVoiceDna(voice());
    expect(() => assertSpeakerOwnsVoiceDna(BOSS, protagonist)).toThrow(
      AiStoryCharacterVoiceDnaError
    );
    expect(() => assertSpeakerOwnsVoiceDna(CHARACTER, protagonist)).not.toThrow();
  });

  it("projects provider-neutral native performance instructions", () => {
    const dna = buildAiStoryCharacterVoiceDna(voice());
    const instruction = projectVoiceDnaNativePerformanceInstruction(dna);
    expect(instruction).toContain("Character voice identity:");
    expect(instruction).toContain("Semantic voice continuity is pinned");
    expect(instruction.toLowerCase()).not.toContain("seedance");
    expect(instruction.toLowerCase()).not.toContain("minimax");
    expect(JSON.stringify(dna).toLowerCase()).not.toMatch(
      /minimax|seedance|runway|providerid|modelid|providervoiceref/
    );
  });

  it("lets narration compile through the existing TTS path without Character Voice DNA", () => {
    const narration = speech("NARRATION");
    narration.voiceSelection.voiceCapabilityId = CAPABILITY;
    const request = compileAiStoryTtsExecutionRequest({
      segment: narration,
      capability: capability({
        supportedDeliveryStyles: ["CALM_NARRATION", "MANDARIN_MY_CONVERSATIONAL"],
      }),
      outputFormat: "mp3",
    });
    expect(request.voiceCapabilityId).toBe(CAPABILITY);
    expect(request.providerId).toBe("fixture");
  });
});
