import { describe, expect, it } from "vitest";
import {
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
  ORIGINAL_IDEA_USED_AS_AUTHORITY,
  TAPAO_JOM_VISUAL_TEXT_FIXTURE,
  acceptAiStoryEpisodeIntent,
  buildCommercialEpisodeGenerateReviewDiagnostics,
  buildVisualTextProviderConstraint,
  classifyVisualTextScripts,
  commercialEpisodeRepairGateEvidence,
  evaluateCharacterContinuity,
  evaluateNativeDialogueIntent,
  evaluateVisualTextLanguageGate,
  evaluateVisualTextPolicy,
  productI2vCharacterReferenceComposition,
  recurringCharacterIds,
  resolveMovingSurfaceTextTracking,
  type AiStoryEpisodeIntentInput,
} from "@ceo-agent/shared";
import { AiStoryProviderRuntimeError, assemblyV2SegmentAudioTreatment } from "@ceo-agent/agents";
import { compileImmutableSeedanceRequestFromSceneCompilation } from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import { readFileSync } from "node:fs";

const acceptedAt = "2026-09-28T00:00:00.000Z";

function intent(overrides: Partial<AiStoryEpisodeIntentInput> = {}) {
  return acceptAiStoryEpisodeIntent({
    episodeType: "COMMERCIAL_STORY",
    requestedDurationSec: 45,
    aspectRatio: "9:16",
    spokenLanguage: "ms-MY",
    dialogueStyle: "Malaysian conversational",
    nativeCharacterDialogue: true,
    pacing: "NATURAL",
    cta: "Order Tapao Jom",
    visualTextLanguages: ["en", "ms", "zh-Hans"],
    visualTextPolicy: { criticalSurfacePolicy: "PROVIDER_NON_LEGIBLE" },
    ...overrides,
  }, acceptedAt);
}

const protagonist = "10000000-0000-4000-8000-000000000041";
const dna = `sha256:${"a".repeat(64)}`;

function scene(order: number, characterIds: string[], fingerprint: string | null, backgroundOnly = false) {
  return {
    sceneId: `10000000-0000-4000-8000-00000000000${order}`,
    characterIds,
    backgroundOnly,
    characterDnaFingerprint: fingerprint,
    reusableCharacterId: fingerprint ? protagonist : null,
    reusableCharacterVersionId: fingerprint ? protagonist : null,
    campaignCharacterId: fingerprint ? protagonist : null,
    campaignCharacterVersionId: fingerprint ? protagonist : null,
    identityFingerprint: fingerprint,
  };
}

describe("commercial episode repair", () => {
  it("1 accepts structured episode intent separately from prose", () => {
    const value = intent();
    expect(value.contractVersion).toBe("ai-story-episode-intent.v1");
    expect(value.requestedDurationSec).toBe(45);
    expect(value.nativeCharacterDialogue).toBe(true);
    expect(ORIGINAL_IDEA_USED_AS_AUTHORITY).toBe(false);
  });

  it("2 defaults visual text languages to English, Bahasa Melayu, and Simplified Chinese", () => {
    const value = acceptAiStoryEpisodeIntent({
      episodeType: "FOOD_STORY",
      requestedDurationSec: 30,
      aspectRatio: "9:16",
      spokenLanguage: "en-MY",
      dialogueStyle: "natural",
      nativeCharacterDialogue: false,
      pacing: "NATURAL",
      cta: null,
    }, acceptedAt);
    expect(value.visualTextLanguages).toEqual(["en", "ms", "zh-Hans"]);
  });

  it("3 rejects provider execution fields on episode intent", () => {
    expect(() => acceptAiStoryEpisodeIntent({
      ...intent(),
      generateAudio: true,
    } as AiStoryEpisodeIntentInput, acceptedAt)).toThrow();
  });

  it("4 keeps spoken locales separate from visual text languages", () => {
    const value = intent({ spokenLanguage: "zh-MY" });
    expect(value.spokenLanguage).toBe("zh-MY");
    expect(value.visualTextLanguages).toEqual(["en", "ms", "zh-Hans"]);
  });

  it("5 does not parse native dialogue from original idea prose", () => {
    const source = readFileSync("packages/shared/src/ai-story-episode-intent.ts", "utf8");
    expect(source).not.toMatch(/parse\([^\n]*originalIdea/);
    expect(ORIGINAL_IDEA_USED_AS_AUTHORITY).toBe(false);
    expect(evaluateNativeDialogueIntent({
      requested: false,
      entries: [],
    }).status).toBe("PASS");
  });

  it("6 requires one DNA authority when a character recurs across scenes", () => {
    const result = evaluateCharacterContinuity({
      scenes: [scene(1, [protagonist], null), scene(2, [protagonist], null)],
    });
    expect(result.status).toBe("BLOCK");
    expect(result.reasonCode).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
  });

  it("7 accepts the same DNA fingerprint for the recurring protagonist", () => {
    const result = evaluateCharacterContinuity({
      scenes: [scene(1, [protagonist], dna), scene(2, [protagonist], dna), scene(3, [protagonist], dna)],
    });
    expect(result.status).toBe("PASS");
    expect(recurringCharacterIds([scene(1, [protagonist], dna), scene(2, [protagonist], dna)])).toEqual([protagonist]);
  });

  it("8 blocks a scene that changes the recurring DNA fingerprint", () => {
    const result = evaluateCharacterContinuity({
      scenes: [scene(1, [protagonist], dna), scene(2, [protagonist], `sha256:${"b".repeat(64)}`)],
    });
    expect(result.reasonCode).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
  });

  it("9 does not force identity onto anonymous background people", () => {
    const result = evaluateCharacterContinuity({
      scenes: [
        scene(1, ["20000000-0000-4000-8000-000000000099"], null, true),
        scene(2, ["20000000-0000-4000-8000-000000000099"], null, true),
      ],
    });
    expect(result.status).toBe("PASS");
    expect(result.requiredCharacterIds).toEqual([]);
  });

  it("10 requires identity when native dialogue has a visible speaker", () => {
    const result = evaluateCharacterContinuity({
      scenes: [scene(1, [protagonist], null)],
      nativeDialogueRequiresVisibleSpeaker: true,
      speakingCharacterIds: [protagonist],
    });
    expect(result.reasonCode).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
  });

  it("11 keeps product first frame and description DNA on the allowed composition", () => {
    expect(productI2vCharacterReferenceComposition({
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      characterConsistencyMode: "SOFT_DESCRIPTION_BASED",
    })).toBe("ALLOW_DESCRIPTION");
  });

  it("12 blocks product first frame plus a synthetic character reference image", () => {
    expect(productI2vCharacterReferenceComposition({
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      characterConsistencyMode: "DNA_PLUS_SYNTHETIC_ANCHOR",
    })).toBe("PRODUCT_I2V_CHARACTER_REFERENCE_COMPOSITION_BLOCKER");
  });

  it("13 allows a synthetic anchor only on reference-free text to video", () => {
    expect(productI2vCharacterReferenceComposition({
      generationMode: "TEXT_TO_VIDEO",
      characterConsistencyMode: "DNA_PLUS_SYNTHETIC_ANCHOR",
    })).toBe("ALLOW_REFERENCE_FREE");
  });

  it("14 blocks native dialogue when the frozen script has zero dialogue", () => {
    expect(evaluateNativeDialogueIntent({
      requested: true,
      entries: [{ type: "ACTION" }, { type: "VO", speakerId: protagonist }],
    }).reasonCode).toBe("NATIVE_DIALOGUE_REQUEST_UNSATISFIED");
  });

  it("15 passes native dialogue when one visible dialogue exists", () => {
    expect(evaluateNativeDialogueIntent({
      requested: true,
      entries: [
        { type: "ACTION" },
        { type: "DIALOGUE", speakerId: protagonist, line: "Ini sedap.", language: "ms-MY" },
      ],
    }).status).toBe("PASS");
  });

  it("16 does not require dialogue when native character dialogue is false", () => {
    expect(evaluateNativeDialogueIntent({ requested: false, entries: [] }).status).toBe("PASS");
  });

  it("17 blocks a dialogue scene whose speaker is unbound", () => {
    expect(evaluateNativeDialogueIntent({
      requested: true,
      entries: [{ type: "DIALOGUE", line: "Hello", language: "en-MY" }],
      speakerBound: false,
    }).reasonCode).toBe("NATIVE_DIALOGUE_REQUEST_UNSATISFIED");
  });

  it("18 blocks a speaking scene that is not a native AV unit", () => {
    expect(evaluateNativeDialogueIntent({
      requested: true,
      entries: [{ type: "DIALOGUE", speakerId: protagonist, line: "Hello", language: "en-MY" }],
      nativeAvUnitValid: false,
    }).status).toBe("BLOCK");
  });

  it("19 allows Latin, Han, digits, and punctuation", () => {
    expect(classifyVisualTextScripts("Nasi Lemak RM12 椰浆饭").allowed).toBe(true);
  });

  it("20 rejects Thai, Devanagari, Tamil, Arabic, Khmer, Bengali, and Cyrillic", () => {
    for (const sample of ["สวัสดี", "नमस्ते", "வணக்கம்", "مرحبا", "សួស្តី", "নমস্কার", "Привет"]) {
      expect(classifyVisualTextScripts(sample).allowed).toBe(false);
    }
  });

  it("21 rejects a script outside the named examples", () => {
    expect(classifyVisualTextScripts("안녕하세요").unauthorizedScripts).toContain("HANGUL");
  });

  it("22 does not classify an unauthorized script as a specific language guess", () => {
    const result = classifyVisualTextScripts("สวัสดี");
    expect(result.unauthorizedScripts).toEqual(["THAI"]);
    expect(result.allowed).toBe(false);
  });

  it("23 blocks critical readable text that has no authority", () => {
    expect(evaluateVisualTextPolicy({
      surfaceRequired: true,
      authorityPresent: false,
      criticalReadableWithoutAuthority: true,
    }).reasonCode).toBe("VISUAL_TEXT_AUTHORITY_REQUIRED");
  });

  it("24 passes a non-legible decorative surface", () => {
    expect(evaluateVisualTextLanguageGate({
      readable: false,
      text: "",
      criticalSurface: false,
      renderPolicy: "PROVIDER_NON_LEGIBLE",
      origin: "PROVIDER_GENERATED",
    }).status).toBe("PASS");
  });

  it("25 blocks a clearly readable unauthorized script", () => {
    expect(evaluateVisualTextLanguageGate({
      readable: true,
      text: "สวัสดี",
      criticalSurface: true,
      renderPolicy: "PROVIDER_CONSTRAINED",
      origin: "PROVIDER_GENERATED",
    }).reasonCode).toBe("UNAUTHORIZED_VISUAL_TEXT_SCRIPT");
  });

  it("26 warns when authorized text is too unclear to judge and policy is not non-legible", () => {
    expect(evaluateVisualTextLanguageGate({
      readable: false,
      text: "",
      criticalSurface: true,
      renderPolicy: "PROVIDER_CONSTRAINED",
      origin: "PROVIDER_GENERATED",
    }).status).toBe("WARN");
  });

  it("27 keeps the Tapao menu copy as test-only fixture text", () => {
    expect(TAPAO_JOM_VISUAL_TEXT_FIXTURE["zh-Hans"]).toEqual(["椰浆饭", "公司餐", "饮料"]);
    expect(classifyVisualTextScripts(TAPAO_JOM_VISUAL_TEXT_FIXTURE.ms.join(" ")).allowed).toBe(true);
  });

  it("28 puts the script restriction in the provider prompt without treating the prompt as enforcement", () => {
    const prompt = buildVisualTextProviderConstraint(intent());
    expect(prompt).toContain("en, ms, zh-Hans");
    expect(prompt).toContain("non-legible");
    expect(evaluateVisualTextLanguageGate({
      readable: true,
      text: "مرحبا",
      criticalSurface: true,
      renderPolicy: "PROVIDER_NON_LEGIBLE",
      origin: "PROVIDER_GENERATED",
    }).status).toBe("BLOCK");
  });

  it("29 reports moving-surface tracking as not required for non-legible policy", () => {
    expect(resolveMovingSurfaceTextTracking("PROVIDER_NON_LEGIBLE")).toBe("NOT_REQUIRED");
  });

  it("30 reports moving-surface tracking as a blocker when deterministic overlay is requested", () => {
    expect(resolveMovingSurfaceTextTracking("DETERMINISTIC_OVERLAY")).toBe("BLOCKER");
  });

  it("31 adds the commercial episode gates to the current pre-generation set", () => {
    expect(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION).toBe(4);
    const gates = commercialEpisodeRepairGateEvidence({
      characterContinuityRequired: true,
      characterDnaAuthorityPresent: false,
      characterIdentityMismatch: false,
      nativeCharacterDialogue: true,
      frozenDialogueCount: 0,
      nativeDialogueSpeakerValid: false,
      nativeAvUnitValid: false,
      dialogueAuthorityValid: false,
      sceneAudioModeValid: false,
      visualTextSurfaceRequired: true,
      visualTextAuthorityPresent: false,
      criticalReadableTextWithoutAuthority: true,
    });
    expect(gates.character[0]?.code).toBe("CHARACTER_CONTINUITY_AUTHORITY_REQUIRED");
    expect(gates.nativeDialogue[0]?.code).toBe("NATIVE_DIALOGUE_REQUEST_UNSATISFIED");
    expect(gates.visualText[0]?.code).toBe("VISUAL_TEXT_AUTHORITY_REQUIRED");
  });

  it("32 hides internal ids from normal generate-review diagnostics", () => {
    const diagnostics = buildCommercialEpisodeGenerateReviewDiagnostics({
      episodeIntent: intent(),
      characters: [{
        characterId: protagonist,
        versionId: protagonist,
        dnaFingerprint: dna,
        consistencyMode: "SOFT_DESCRIPTION_BASED",
      }],
      scenes: [{
        order: 0,
        generationMode: "TEXT_TO_VIDEO",
        characterPresent: true,
        characterId: protagonist,
        characterDnaFingerprint: dna,
        productAuthorityPresent: false,
        productFirstFramePresent: false,
        audioMode: "NATIVE_AUDIO_VIDEO",
        dialogueEntryIds: [protagonist],
        generateAudio: true,
        visualTextSurfaces: ["MENU"],
        visualTextLanguages: ["en", "ms", "zh-Hans"],
        visualTextPolicy: "PROVIDER_NON_LEGIBLE",
        visualTextCritical: true,
      }],
      includeInternalIds: false,
    });
    expect(diagnostics.nativeCharacterDialogue).toBe(true);
    expect(diagnostics.recurringCharacterCount).toBe(1);
    expect(JSON.stringify(diagnostics)).not.toContain(protagonist);
    expect(diagnostics.originalIdeaUsedAsAuthority).toBe(false);
  });

  it("33 preserves native audio and fills only silent segments", () => {
    expect(assemblyV2SegmentAudioTreatment({ preserveAudio: true, sourceHasAudio: false })).toBe("INSERT_SILENCE");
    expect(assemblyV2SegmentAudioTreatment({ preserveAudio: true, sourceHasAudio: true })).toBe("PRESERVE_SOURCE_AUDIO");
    expect(assemblyV2SegmentAudioTreatment({ preserveAudio: true, sourceHasAudio: false })).toBe("INSERT_SILENCE");
  });

  it("34 blocks compilation before reservation when required DNA is missing", () => {
    const compilation = makePhase2aCompilation({ sceneOrder: [0] });
    const baseIntent = compilation.intents[0]!;
    const baseInstructions = compilation.instructionsBySceneExecutionId[baseIntent.identity.sceneExecutionId]!;
    const generationAuthority = {
      strategy: "TEXT_TO_VIDEO" as const,
      referenceSource: "REFERENCE_FREE_T2V" as const,
      effectiveReferenceIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE" as const,
    };
    expect(() => compileImmutableSeedanceRequestFromSceneCompilation({
      intent: { ...baseIntent, referencedAssetIds: [], generationAuthority },
      instructions: { ...baseInstructions, referencedAssetIds: [], generationAuthority },
      authority: {
        qcEvaluationId: "30000000-0000-4000-8000-000000000001",
        qcFingerprint: `sha256:${"a".repeat(64)}`,
        qcCapabilityVersion: "seedance-modelark-test.v1",
        directorFingerprint: `sha256:${"b".repeat(64)}`,
        motionFingerprint: `sha256:${"c".repeat(64)}`,
      },
      adapterVersion: "1.0.0",
      compiledAt: acceptedAt,
      characterContinuityRequired: true,
    })).toThrow(AiStoryProviderRuntimeError);
  });

  it("35 leaves a silent scene without audio and records the visual text constraint only when supplied", () => {
    const compilation = makePhase2aCompilation({ sceneOrder: [0] });
    const baseIntent = compilation.intents[0]!;
    const baseInstructions = compilation.instructionsBySceneExecutionId[baseIntent.identity.sceneExecutionId]!;
    const generationAuthority = {
      strategy: "TEXT_TO_VIDEO" as const,
      referenceSource: "REFERENCE_FREE_T2V" as const,
      effectiveReferenceIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE" as const,
    };
    const silent = compileImmutableSeedanceRequestFromSceneCompilation({
      intent: { ...baseIntent, referencedAssetIds: [], generationAuthority },
      instructions: { ...baseInstructions, referencedAssetIds: [], generationAuthority },
      authority: {
        qcEvaluationId: "30000000-0000-4000-8000-000000000001",
        qcFingerprint: `sha256:${"a".repeat(64)}`,
        qcCapabilityVersion: "seedance-modelark-test.v1",
        directorFingerprint: `sha256:${"b".repeat(64)}`,
        motionFingerprint: `sha256:${"c".repeat(64)}`,
      },
      adapterVersion: "1.0.0",
      compiledAt: acceptedAt,
    });
    const constrained = compileImmutableSeedanceRequestFromSceneCompilation({
      intent: { ...baseIntent, referencedAssetIds: [], generationAuthority },
      instructions: { ...baseInstructions, referencedAssetIds: [], generationAuthority },
      authority: {
        qcEvaluationId: "30000000-0000-4000-8000-000000000001",
        qcFingerprint: `sha256:${"a".repeat(64)}`,
        qcCapabilityVersion: "seedance-modelark-test.v1",
        directorFingerprint: `sha256:${"b".repeat(64)}`,
        motionFingerprint: `sha256:${"c".repeat(64)}`,
      },
      adapterVersion: "1.0.0",
      compiledAt: acceptedAt,
      visualTextConstraint: buildVisualTextProviderConstraint(intent()),
    });
    expect(silent.structuredRequest.generateAudio).toBe(false);
    expect(constrained.structuredRequest.generateAudio).toBe(false);
    expect(constrained.compiledPrompt).toContain("Visual text restriction");
    expect(silent.compiledPrompt).not.toContain("Visual text restriction");
  });
});
