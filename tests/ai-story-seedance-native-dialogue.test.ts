import { describe, expect, it } from "vitest";
import {
  AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION,
  AI_STORY_NATIVE_AV_COMPILED_PROVIDER_REQUEST_VERSION,
  AiStoryGenerationUnitSchema,
  AiStoryScriptVersionSchema,
  SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
  SEEDANCE_V1_AUDIO_SILENCE_COMPATIBILITY,
  VISIBLE_DIALOGUE_DETACHED_TTS_CONFLICT_PROTECTION,
  type AiStoryGenerationUnit,
  type AiStoryScriptVersion,
  type AiStorySpeechSegment,
} from "@ceo-agent/shared";
import {
  AiStoryNativeDialogueAuthorityError,
  assertAiStoryNativeDialogueMatchesFrozenScript,
  assertVisibleDialogueAudioAuthorityExclusive,
  compileAiStoryCharacterDialoguePerformanceAuthority,
  compileAiStoryTtsExecutionRequest,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  buildSeedanceNativeAudioCapability,
  compileImmutableSeedanceNativeAvRequest,
  compileImmutableSeedanceRequestFromSceneCompilation,
  previewAiStorySeedanceWireRequest,
  seedanceCapabilityDetails,
  seedanceSupportsNativeAudio,
  validateAiStoryCompiledRequestFingerprint,
  AiStoryTtsMemoryCache,
  createDeterministicFakeTtsAdapter,
  executeAiStoryTtsRequest,
} from "../packages/agents/src/ai-story";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import {
  compileSeedanceNativeDialogueCertificationRequest,
  estimateSeedanceNativeDialogueCertCostUsd,
  SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC,
  SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD,
} from "./helpers/ai-story-seedance-native-dialogue-cert";

const id = (n: number) =>
  `da000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: unknown) => sha256CanonicalIntegrityHash(value);

function baseRequest(mode: "T2V" | "I2V" = "T2V") {
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const sourceIntent = compilation.intents[0]!;
  const sourceInstructions =
    compilation.instructionsBySceneExecutionId[
      sourceIntent.identity.sceneExecutionId
    ]!;
  const firstFrameAssetId = sourceIntent.referencedAssetIds[0]!;
  const generationAuthority =
    mode === "T2V"
      ? {
          strategy: "TEXT_TO_VIDEO" as const,
          referenceSource: "REFERENCE_FREE_T2V" as const,
          effectiveReferenceIds: [],
          firstFrameAssetId: null,
          productVisualIdentityRequirement: "NONE" as const,
        }
      : {
          strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
          referenceSource: "SCENE_EXPLICIT" as const,
          effectiveReferenceIds: [firstFrameAssetId],
          firstFrameAssetId,
          productVisualIdentityRequirement: "REQUIRED" as const,
        };
  const referencedAssetIds =
    mode === "T2V" ? [] : [firstFrameAssetId];
  return compileImmutableSeedanceRequestFromSceneCompilation({
    intent: {
      ...sourceIntent,
      referencedAssetIds,
      generationAuthority,
    },
    instructions: {
      ...sourceInstructions,
      referencedAssetIds,
      generationAuthority,
    },
    authority: {
      qcEvaluationId: id(1),
      qcFingerprint: hash("qc"),
      qcCapabilityVersion: "seedance-qc-test.v1",
      directorFingerprint: hash("director"),
      motionFingerprint: hash("motion"),
    },
    adapterVersion: "seedance-canonical-runtime.v1",
    compiledAt: "2026-09-21T10:00:00.000Z",
    resolution: "480p",
    referenceAssets:
      mode === "I2V"
        ? [
            {
              assetId: firstFrameAssetId,
              mediaType: "image/jpeg",
              storagePath: `private/${firstFrameAssetId}.jpg`,
            },
          ]
        : [],
  });
}

function frozenAuthorityFixture(
  base = baseRequest(),
  options: {
    readonly line?: string;
    readonly language?: "en-MY" | "zh-MY" | "en-SG" | "zh-SG" | "ms-MY";
  } = {}
): {
  script: AiStoryScriptVersion;
  unit: AiStoryGenerationUnit;
  entryId: string;
} {
  const scriptVersionId = id(2);
  const sceneId = id(3);
  const characterId = id(4);
  const locationId = id(5);
  const entryId = id(6);
  const directorPlanId = id(7);
  const directorShotId = id(8);
  const unit = AiStoryGenerationUnitSchema.parse({
    generationUnitId: id(9),
    storyId: base.storyId,
    storyVersionId: base.storyVersionId,
    sceneId,
    sceneVersionId: id(10),
    directorPlanId,
    directorShotId,
    directorShotIds: [directorShotId],
    order: 0,
    unitType: "PROVIDER_VIDEO",
    sourceAuthority: {
      lineage: [
        "FROZEN_SCRIPT",
        "FROZEN_SCENE",
        "FROZEN_DIRECTOR_PLAN",
        "EXACT_DIRECTOR_SHOT",
      ],
      scriptVersionId,
      sceneFingerprint: hash("scene"),
      directorPlanId,
      directorShotId,
      productAuthorityIds: [],
      productSourceAssetIds: [],
      productContentHashes: [],
      locationId,
      characterIds: [characterId],
    },
    executionRequirement: {
      materialSubjectAction: true,
      characterPerformance: true,
      physicalInteraction: false,
      complexEnvironmentalMotion: false,
      generatedWorldMotion: true,
      cameraMovementAlone: false,
      productPresenceAlone: false,
    },
    necessity: "REQUIRED_GENERATIVE_VIDEO",
    necessityEvidence: [
      {
        code: "VISIBLE_CHARACTER_DIALOGUE",
        dimension: "CHARACTER_PERFORMANCE",
        present: true,
        safeEvidence:
          "Visible on-screen speaker performs frozen dialogue natively",
      },
    ],
    supportedActionEntryIds: [id(11)],
    supportedActionPhaseIds: [],
    supportedStateDeltaIndexes: [],
    servedAudienceInformation: ["Character recommendation"],
    inheritedContinuity: {
      locationId,
      characterIds: [characterId],
      productAuthorityIds: [],
    },
    nativeAvMode: "NATIVE_AUDIO_VIDEO",
    nativeDialogueEntryIds: [entryId],
    retryOwnership: {
      retryScope: "GENERATION_UNIT",
      siblingUnitsRemainValid: true,
      sceneRetryDoesNotRegenerateEveryShot: true,
    },
    fingerprint: hash("unit"),
  });
  const scriptWithoutHash = {
    scriptVersionId,
    storyId: base.storyId,
    storyVersionId: base.storyVersionId,
    outlineVersionId: id(12),
    orgId: base.orgId,
    workspaceId: base.workspaceId,
    version: 1,
    contractVersion: "ai-story-script.v1" as const,
    profileId: "COMMERCIAL_STORY" as const,
    profileVersion: 1 as const,
    outlineSourceHash: hash("outline"),
    scenes: [
      {
        scriptSceneId: sceneId,
        order: 0,
        outlineBeatClaims: [{ outlineBeatId: id(13), claim: "Discovery" }],
        sceneFunction: "INTRODUCE" as const,
        sceneFunctionRegistryVersion: 1 as const,
        sceneStateIn: [],
        sceneStateDeltas: [],
        sceneStateOut: [],
        entries: [
          {
            entryId: id(11),
            order: 0,
            durationRange: { minSeconds: 1, maxSeconds: 2 },
            type: "ACTION" as const,
            subjectId: characterId,
            action: "The host notices the food.",
            storyEffect: "Motivates the spoken reaction.",
          },
          {
            entryId,
            order: 1,
            durationRange: { minSeconds: 2, maxSeconds: 5 },
            type: "DIALOGUE" as const,
            speakerId: characterId,
            line: options.line ?? "Eh, this one looks quite good.",
            deliveryOrSubtext: "Friendly spontaneous discovery",
            language: options.language ?? "en-MY",
          },
        ],
        characterIds: [characterId],
        locationIds: [locationId],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [],
        targetDurationRange: { minSeconds: 4, maxSeconds: 8 },
        mustKeep: ["Exact dialogue"],
        mustAvoid: ["Detached narration"],
        newInformation: ["The food looks appealing"],
        newEvidence: [],
        newActionOutcomes: ["Host reacts"],
        productEvidence: [],
      },
    ],
    authorityReferences: [
      { authorityType: "CHARACTER" as const, authorityId: characterId },
      { authorityType: "LOCATION" as const, authorityId: locationId },
    ],
    status: "FROZEN" as const,
    supersedesScriptVersionId: null,
    createdBy: id(14),
    createdAt: "2026-09-21T09:00:00.000Z",
    approvedBy: id(14),
    approvedAt: "2026-09-21T09:01:00.000Z",
    frozenAt: "2026-09-21T09:02:00.000Z",
  };
  const sourceHash = hash(scriptWithoutHash);
  const script = AiStoryScriptVersionSchema.parse({
    ...scriptWithoutHash,
    sourceHash,
  });
  return { script, unit, entryId };
}

function dialogueAuthority() {
  const base = baseRequest();
  const fixture = frozenAuthorityFixture(base);
  const authority =
    compileAiStoryCharacterDialoguePerformanceAuthority({
      script: fixture.script,
      generationUnit: fixture.unit,
      scriptSceneId: fixture.unit.sceneId,
      dialogueEntryId: fixture.entryId,
      primaryLocale: "en-MY",
      secondaryLocales: [],
      codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
      deliveryStyle: "MALAYSIAN_CONVERSATIONAL",
      performanceIntent:
        "Friendly spontaneous discovery with natural eye and body movement",
      emotionIntent: "Pleasantly surprised",
      speechIntensity: "NATURAL",
      paceIntent: "NATURAL",
    });
  return { base, fixture, authority };
}

function detachedTtsSegment(
  authority: ReturnType<typeof compileAiStoryCharacterDialoguePerformanceAuthority>
): AiStorySpeechSegment {
  return {
    speechSegmentId: id(40),
    sourceScriptEntryId: authority.dialogueEntryId,
    speakerAuthorityId: authority.characterId,
    speechRole: "DIALOGUE",
    text: authority.exactText,
    primaryLocale: authority.primaryLocale,
    secondaryLocales: [...authority.secondaryLocales],
    codeSwitchPolicy: authority.codeSwitchPolicy,
    deliveryStyle: authority.deliveryStyle,
    emotionIntent: authority.emotionIntent,
    paceIntent: authority.paceIntent,
    voiceSelection: {
      voiceCapabilityId: id(41),
      providerVoiceRef: "local-sg-my",
      genderPresentation: null,
      ageRangePresentation: null,
      brandTone: "Local SME warmth",
    },
    timelineAnchor: {
      timelineEntryId: id(42),
      relation: "SHOT_START",
      offsetMs: 0,
    },
    startIntent: "AT_ANCHOR",
    endIntent: "NATURAL_END",
    jCutIntent: {
      enabled: false,
      overlapMs: 0,
      semanticRationale: null,
      allowCrossScene: true,
    },
    lCutIntent: {
      enabled: false,
      overlapMs: 0,
      semanticRationale: null,
      allowCrossScene: true,
    },
    allowSpeechOverlap: false,
    subtitleBinding: { enabled: true, exactText: authority.exactText },
    mustPreserve: ["Exact frozen Script text"],
    mustAvoid: ["Detached TTS"],
  };
}

function fakeVoiceCapability() {
  return {
    voiceCapabilityId: id(41),
    providerCapabilityRef: "fake-local/sg-my-v1",
    providerId: "fake-local",
    providerModel: "fixture-voice-v1",
    providerVoiceRef: "local-sg-my",
    supportedLocales: ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"] as const,
    supportedDeliveryStyles: [
      "STANDARD_NEUTRAL",
      "MALAYSIAN_CONVERSATIONAL",
      "MANDARIN_MY_CONVERSATIONAL",
    ] as const,
    supportedCodeSwitchPairs: [
      { primaryLocale: "zh-MY" as const, secondaryLocale: "en-MY" as const },
    ],
    supportsSSML: false,
    supportsProsodyControl: true,
    supportsEmotionControl: false,
    supportsSpeedControl: true,
    supportsPitchControl: false,
    supportedGenderPresentations: ["NEUTRAL"] as const,
    supportedAgeRangePresentations: ["ADULT"] as const,
    supportedBrandTones: ["Local SME warmth"],
    maxCharacters: 4096,
    audioFormats: ["wav"] as const,
    certificationStatus: "CAPABILITY_CERTIFIED" as const,
    version: 1,
  };
}

describe("Seedance native audiovisual character dialogue", () => {
  it("records exact ModelArk API capability without certifying human performance", () => {
    const capability = buildSeedanceNativeAudioCapability();
    expect(seedanceSupportsNativeAudio(capability.modelId)).toBe(true);
    expect(seedanceSupportsNativeAudio("seedance-1-0-pro-250528")).toBe(false);
    expect(capability.nativeAudioSupport).toBe(true);
    expect(capability.nativeDialogueSupport).toBe(true);
    expect(capability.referenceImageWithAudioSupport).toBe(true);
    expect(capability.dialogueLipSyncSupport).toBe(
      "HUMAN_REVIEW_REQUIRED"
    );
    expect(capability.realProviderCertification).toBe(
      "TECHNICAL_PASS_HUMAN_REVIEW_REQUIRED"
    );
    expect(seedanceCapabilityDetails().legacyVideoOnlyGenerateAudio).toBe(false);
    expect(seedanceCapabilityDetails().audioSupport).toBe(false);
    expect(SEEDANCE_V1_AUDIO_SILENCE_COMPATIBILITY).toBe("CERTIFIED");
  });

  it("keeps historical V1 Seedance requests silent and fingerprint-stable", async () => {
    const base = baseRequest();
    const historicalFingerprint = base.requestFingerprint;
    expect(base.contractVersion).toBe(
      AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION
    );
    expect(base.structuredRequest.generateAudio).toBe(false);
    expect(base.blockedCapabilities).toContain("AUDIO");
    expect("nativeAvRequest" in base).toBe(false);
    expect(base.requestFingerprint).toBe(historicalFingerprint);
    const wire = await previewAiStorySeedanceWireRequest({
      request: base,
      assetAccess: {
        async resolveHttpsAsset() {
          throw new Error("T2V fixture has no image");
        },
      },
    });
    expect(wire.generate_audio).toBe(false);
    expect(wire.model).toBe("dreamina-seedance-2-0-260128");
    expect(seedanceCapabilityDetails().audioSupport).toBe(false);
    expect(seedanceCapabilityDetails().legacyVideoOnlyGenerateAudio).toBe(
      false
    );
  });

  it("binds exact frozen Script, Character, Shot, and Generation Unit authority", () => {
    const { fixture, authority } = dialogueAuthority();
    expect(authority.exactText).toBe("Eh, this one looks quite good.");
    expect(authority.characterId).toBe(
      fixture.unit.sourceAuthority.characterIds[0]
    );
    expect(authority.detachedTtsPermitted).toBe(false);
    expect(() =>
      assertAiStoryNativeDialogueMatchesFrozenScript({
        authority,
        script: fixture.script,
        generationUnit: fixture.unit,
      })
    ).not.toThrow();
  });

  it("preserves the exact certification Script text without dialect invention", () => {
    const fixture = frozenAuthorityFixture(baseRequest(), {
      line: SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT,
      language: "zh-MY",
    });
    const authority = compileAiStoryCharacterDialoguePerformanceAuthority({
      script: fixture.script,
      generationUnit: fixture.unit,
      scriptSceneId: fixture.unit.sceneId,
      dialogueEntryId: fixture.entryId,
      primaryLocale: "zh-MY",
      secondaryLocales: ["en-MY"],
      codeSwitchPolicy: {
        mode: "SCRIPT_AUTHORIZED",
        allowedLocales: ["zh-MY", "en-MY"],
      },
      deliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
      performanceIntent: "MALAYSIAN_CHINESE_CONVERSATIONAL",
      emotionIntent: "Pleasantly surprised",
      speechIntensity: "NATURAL",
      paceIntent: "NATURAL",
    });
    expect(authority.exactText).toBe(
      SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
    );
    expect(authority.exactText).not.toMatch(/\b(lah|lor|leh|ah|wah)\b/i);
    expect(authority.primaryLocale).toBe("zh-MY");
    expect(authority.secondaryLocales).toEqual(["en-MY"]);
    expect(authority.codeSwitchPolicy.mode).toBe("SCRIPT_AUTHORIZED");
    expect(authority.deliveryStyle).toBe("MANDARIN_MY_CONVERSATIONAL");
    expect(() =>
      compileAiStoryCharacterDialoguePerformanceAuthority({
        script: fixture.script,
        generationUnit: fixture.unit,
        scriptSceneId: fixture.unit.sceneId,
        dialogueEntryId: fixture.entryId,
        primaryLocale: "zh-MY",
        secondaryLocales: ["en-MY"],
        codeSwitchPolicy: {
          mode: "SCRIPT_AUTHORIZED",
          allowedLocales: ["zh-MY", "en-MY"],
        },
        deliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
        performanceIntent: "MALAYSIAN_CHINESE_CONVERSATIONAL",
        emotionIntent: "Pleasantly surprised",
        speechIntensity: "NATURAL",
        paceIntent: "NATURAL",
      })
    ).not.toThrow();
  });

  it("compiles additive V2 NATIVE_AV authority and preserves historical V1 fingerprints", async () => {
    const { base, authority } = dialogueAuthority();
    const historicalFingerprint = base.requestFingerprint;
    const request = compileImmutableSeedanceNativeAvRequest({
      baseRequest: base,
      dialogueAuthority: authority,
      capability: buildSeedanceNativeAudioCapability(),
    });
    expect(base.contractVersion).toBe(
      AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION
    );
    expect(base.structuredRequest.generateAudio).toBe(false);
    expect(base.blockedCapabilities).toContain("AUDIO");
    expect(base.requestFingerprint).toBe(historicalFingerprint);
    expect(request.contractVersion).toBe(
      AI_STORY_NATIVE_AV_COMPILED_PROVIDER_REQUEST_VERSION
    );
    expect(request.structuredRequest.generateAudio).toBe(true);
    expect(validateAiStoryCompiledRequestFingerprint(request)).toBe(true);
    const wire = await previewAiStorySeedanceWireRequest({
      request,
      assetAccess: {
        async resolveHttpsAsset() {
          throw new Error("T2V fixture has no image");
        },
      },
    });
    expect(wire.generate_audio).toBe(true);
    expect(wire.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining(authority.exactText),
    });
  });

  it("blocks Script rewrites and detached-TTS substitution", () => {
    const { fixture, authority } = dialogueAuthority();
    const rewritten = {
      ...authority,
      exactText: "Eh, this one looks quite good lah.",
    };
    expect(() =>
      assertAiStoryNativeDialogueMatchesFrozenScript({
        authority: rewritten,
        script: fixture.script,
        generationUnit: fixture.unit,
      })
    ).toThrow(/differs from frozen Script/i);
    expect(() =>
      compileImmutableSeedanceNativeAvRequest({
        baseRequest: baseRequest(),
        dialogueAuthority: {
          ...authority,
          detachedTtsPermitted: true,
        } as never,
        capability: buildSeedanceNativeAudioCapability(),
      })
    ).toThrow();
  });

  it("blocks detached TTS for the same visible native-AV dialogue before Provider submission", async () => {
    const { authority } = dialogueAuthority();
    const segment = detachedTtsSegment(authority);
    const capability = fakeVoiceCapability();
    let providerCalled = false;
    expect(VISIBLE_DIALOGUE_DETACHED_TTS_CONFLICT_PROTECTION).toBe(
      "CERTIFIED"
    );
    expect(() =>
      assertVisibleDialogueAudioAuthorityExclusive({
        nativeDialogueAuthorities: [authority],
        detachedTtsBindings: [{ dialogueEntryId: authority.dialogueEntryId }],
      })
    ).toThrow(AiStoryNativeDialogueAuthorityError);
    try {
      assertVisibleDialogueAudioAuthorityExclusive({
        nativeDialogueAuthorities: [authority],
        detachedTtsBindings: [{ dialogueEntryId: authority.dialogueEntryId }],
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: "VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT",
      });
    }
    expect(() =>
      compileAiStoryTtsExecutionRequest({
        segment,
        capability,
        outputFormat: "wav",
        nativeDialogueAuthorities: [authority],
      })
    ).toThrow(/VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT|cannot also bind detached TTS/i);
    expect(() =>
      compileImmutableSeedanceNativeAvRequest({
        baseRequest: baseRequest(),
        dialogueAuthority: authority,
        capability: buildSeedanceNativeAudioCapability(),
        detachedTtsBindings: [{ dialogueEntryId: authority.dialogueEntryId }],
      })
    ).toThrow(/VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT|cannot also bind detached TTS/i);
    await expect(
      executeAiStoryTtsRequest({
        request: compileAiStoryTtsExecutionRequest({
          segment,
          capability,
          outputFormat: "wav",
        }),
        capability,
        adapter: createDeterministicFakeTtsAdapter({
          bytesForRequest: async () => {
            providerCalled = true;
            return {
              bytes: Buffer.from("tts"),
              durationMs: 1000,
              sampleRate: 48000,
              channelCount: 2,
            };
          },
          onExecute: () => {
            providerCalled = true;
          },
        }),
        cache: new AiStoryTtsMemoryCache(),
        nativeDialogueAuthorities: [authority],
      })
    ).rejects.toMatchObject({
      code: "VISIBLE_DIALOGUE_AUDIO_AUTHORITY_CONFLICT",
    });
    expect(providerCalled).toBe(false);
  });

  it("supports one authorized reference image together with native audio", async () => {
    const imageBase = baseRequest("I2V");
    const fixture = frozenAuthorityFixture(imageBase);
    const authority =
      compileAiStoryCharacterDialoguePerformanceAuthority({
        script: fixture.script,
        generationUnit: fixture.unit,
        scriptSceneId: fixture.unit.sceneId,
        dialogueEntryId: fixture.entryId,
        primaryLocale: "en-MY",
        secondaryLocales: [],
        codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
        deliveryStyle: "MALAYSIAN_CONVERSATIONAL",
        performanceIntent: "Natural visible-character discovery",
        emotionIntent: "Friendly",
        speechIntensity: "NATURAL",
        paceIntent: "NATURAL",
      });
    const request = compileImmutableSeedanceNativeAvRequest({
      baseRequest: imageBase,
      dialogueAuthority: authority,
      capability: buildSeedanceNativeAudioCapability(),
    });
    const wire = await previewAiStorySeedanceWireRequest({
      request,
      assetAccess: {
        async resolveHttpsAsset({ assetId }) {
          return `https://assets.example.invalid/${assetId}.jpg`;
        },
      },
    });
    expect(wire.generate_audio).toBe(true);
    expect(wire.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image_url",
          role: "first_frame",
        }),
      ])
    );
  });

  it("blocks native dialogue on capability/model mismatch", () => {
    const capability = seedanceCapabilityDetails({
      defaultModel: "seedance-1-0-pro-250528",
    });
    expect(capability.nativeAudioSupport).toBe(false);
    expect(capability.nativeDialogueSupport).toBe(false);
    expect(capability.visibleCharacterDialogueSupport).toBe(false);
    expect(capability.dialogueLipSyncSupport).toBe("UNSUPPORTED");
    expect(capability.supportedAudioLocales).toEqual([]);
  });

  it("blocks Generation Units that detach native dialogue from audiovisual execution", () => {
    const { unit } = frozenAuthorityFixture();
    expect(
      AiStoryGenerationUnitSchema.safeParse({
        ...unit,
        nativeDialogueEntryIds: [],
      }).success
    ).toBe(false);
    expect(
      AiStoryGenerationUnitSchema.safeParse({
        ...unit,
        nativeAvMode: "VIDEO_ONLY",
      }).success
    ).toBe(false);
  });

  it("compiles the bounded paid-certification native AV request without a Provider call", async () => {
    const compiled = compileSeedanceNativeDialogueCertificationRequest();
    expect(compiled.exactText).toBe(
      SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
    );
    expect(compiled.baseRequest.structuredRequest.generateAudio).toBe(false);
    expect(compiled.baseRequest.blockedCapabilities).toContain("AUDIO");
    expect(compiled.request.structuredRequest.generateAudio).toBe(true);
    expect(compiled.request.structuredRequest.duration).toBe(
      SEEDANCE_NATIVE_DIALOGUE_CERT_DURATION_SEC
    );
    expect(compiled.request.contractVersion).toBe(
      AI_STORY_NATIVE_AV_COMPILED_PROVIDER_REQUEST_VERSION
    );
    if (
      compiled.request.contractVersion ===
      AI_STORY_NATIVE_AV_COMPILED_PROVIDER_REQUEST_VERSION
    ) {
      expect(compiled.request.structuredRequest.audioMode).toBe("NATIVE_AV");
    }
    expect(
      Number(estimateSeedanceNativeDialogueCertCostUsd(8))
    ).toBeLessThanOrEqual(Number(SEEDANCE_NATIVE_DIALOGUE_CERT_MAX_SPEND_USD));
    const wire = await previewAiStorySeedanceWireRequest({
      request: compiled.request,
      assetAccess: {
        async resolveHttpsAsset() {
          throw new Error("T2V fixture has no image");
        },
      },
    });
    expect(wire.generate_audio).toBe(true);
    expect(wire.model).toBe("dreamina-seedance-2-0-260128");
    expect(wire.duration).toBe(8);
    expect(JSON.stringify(wire.content)).toContain(
      SEEDANCE_NATIVE_DIALOGUE_CERTIFICATION_EXACT_TEXT
    );
  });
});
