import { describe, expect, it } from "vitest";
import {
  AI_STORY_AUDIO_PLAN,
  AI_STORY_AUDIO_PLAN_CONTRACT_VERSION,
  AI_STORY_AUDIO_POLICY_VERSION,
  AI_STORY_TTS_EXECUTION,
  AiStoryAudioPlanSchema,
  selectAiStoryAssemblyV2AudioMode,
  type AiStoryAudioPlan,
  type AiStorySpeechSegment,
  type AiStoryTtsExecutionResult,
  type AiStoryVoiceCapability,
} from "@ceo-agent/shared";
import {
  AiStoryAudioAuthorityError,
  compileAiStoryAudioMixExecutionPlan,
  compileAiStoryTtsExecutionRequest,
  computeAiStoryAudioPlanSourceHash,
  finalizeAiStoryAudioPlan,
  selectAiStoryVoiceCapability,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  AiStoryTtsMemoryCache,
  createDeterministicFakeTtsAdapter,
  createOpenAiNeutralVoiceCapability,
  createOpenAiStoryTtsAdapter,
  executeAiStoryTtsRequest,
  retryAiStoryTtsSegment,
} from "@ceo-agent/agents";
import { buildAssemblyV2Fixture } from "./helpers/ai-story-assembly-v2-fixture";

const id = (n: number) =>
  `a7000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (value: unknown) => sha256CanonicalIntegrityHash(value);

function assembly(base = 100) {
  return buildAssemblyV2Fixture({
    base,
    sources: [0, 1, 2].map((index) => ({
      path: `source-${index}.mp4`,
      hash: hash({ source: index }),
      durationMs: 3000,
    })),
    entries: [
      { sourceIndex: 0, role: "DISCOVERY", durationSeconds: 2, sceneIndex: 0 },
      { sourceIndex: 1, role: "REACTION", durationSeconds: 2, sceneIndex: 0 },
      { sourceIndex: 2, role: "CTA", durationSeconds: 2, sceneIndex: 0 },
    ],
  }).compile();
}

function capability(
  overrides: Partial<AiStoryVoiceCapability> = {}
): AiStoryVoiceCapability {
  return {
    voiceCapabilityId: id(1),
    providerCapabilityRef: "fake-local/sg-my-v1",
    providerId: "fake-local",
    providerModel: "fixture-voice-v1",
    providerVoiceRef: "local-sg-my",
    supportedLocales: ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"],
    supportedDeliveryStyles: [
      "STANDARD_NEUTRAL",
      "SINGAPORE_CONVERSATIONAL",
      "SINGAPORE_PROFESSIONAL",
      "MALAYSIAN_CONVERSATIONAL",
      "MALAYSIAN_PROFESSIONAL",
      "MANDARIN_SG_CONVERSATIONAL",
      "MANDARIN_MY_CONVERSATIONAL",
      "MALAYSIAN_MALAY_CONVERSATIONAL",
      "MALAYSIAN_MALAY_PROFESSIONAL",
      "EMOTIONAL_SOFT",
      "ENERGETIC_AD",
      "CALM_NARRATION",
      "PREMIUM_BRAND",
    ],
    supportedCodeSwitchPairs: [
      { primaryLocale: "en-SG", secondaryLocale: "zh-SG" },
      { primaryLocale: "zh-SG", secondaryLocale: "en-SG" },
      { primaryLocale: "en-SG", secondaryLocale: "ms-MY" },
      { primaryLocale: "en-MY", secondaryLocale: "ms-MY" },
      { primaryLocale: "en-MY", secondaryLocale: "zh-MY" },
      { primaryLocale: "zh-MY", secondaryLocale: "en-MY" },
    ],
    supportsSSML: false,
    supportsProsodyControl: true,
    supportsEmotionControl: true,
    supportsSpeedControl: true,
    supportsPitchControl: true,
    supportedGenderPresentations: ["FEMININE", "MASCULINE", "NEUTRAL"],
    supportedAgeRangePresentations: ["YOUNG_ADULT", "ADULT", "MATURE"],
    supportedBrandTones: ["Local SME warmth"],
    maxCharacters: 4096,
    audioFormats: ["wav", "mp3"],
    certificationStatus: "HUMAN_LISTENING_REVIEW_REQUIRED",
    version: 1,
    ...overrides,
  };
}

function segment(input: {
  text: string;
  primaryLocale: AiStorySpeechSegment["primaryLocale"];
  secondaryLocales?: AiStorySpeechSegment["secondaryLocales"];
  deliveryStyle: AiStorySpeechSegment["deliveryStyle"];
  timelineEntryId?: string;
  offsetMs?: number;
  jCutMs?: number;
  lCutMs?: number;
  n?: number;
}): AiStorySpeechSegment {
  const secondaryLocales = input.secondaryLocales ?? [];
  const n = input.n ?? 10;
  return {
    speechSegmentId: id(n),
    sourceScriptEntryId: id(n + 100),
    speakerAuthorityId: id(n + 200),
    speechRole: "VOICE_OVER",
    text: input.text,
    primaryLocale: input.primaryLocale,
    secondaryLocales,
    codeSwitchPolicy: {
      mode: secondaryLocales.length ? "REQUIRED" : "SCRIPT_AUTHORIZED",
      allowedLocales: secondaryLocales,
    },
    deliveryStyle: input.deliveryStyle,
    emotionIntent: "Warm and truthful",
    paceIntent: "NATURAL",
    voiceSelection: {
      voiceCapabilityId: id(1),
      providerVoiceRef: "local-sg-my",
      genderPresentation: null,
      ageRangePresentation: null,
      brandTone: "Local SME warmth",
    },
    timelineAnchor: {
      timelineEntryId: input.timelineEntryId ?? id(700),
      relation: "SHOT_START",
      offsetMs: input.offsetMs ?? 0,
    },
    startIntent: input.jCutMs ? "J_CUT_BEFORE_ANCHOR" : "AT_ANCHOR",
    endIntent: input.lCutMs ? "L_CUT_AFTER_VISUAL" : "NATURAL_END",
    jCutIntent: {
      enabled: Boolean(input.jCutMs),
      overlapMs: input.jCutMs ?? 0,
      semanticRationale: input.jCutMs ? "Anticipate the authorized next beat" : null,
      allowCrossScene: true,
    },
    lCutIntent: {
      enabled: Boolean(input.lCutMs),
      overlapMs: input.lCutMs ?? 0,
      semanticRationale: input.lCutMs ? "Carry the authorized line over the cut" : null,
      allowCrossScene: true,
    },
    allowSpeechOverlap: false,
    subtitleBinding: { enabled: true, exactText: input.text },
    mustPreserve: [input.text],
    mustAvoid: ["No invented dialogue", "No invented dialect particles"],
  };
}

function frozenPlan(input: {
  speech?: AiStorySpeechSegment[];
  assemblyPlan?: ReturnType<typeof assembly>;
  music?: boolean;
  ambience?: boolean;
  sfx?: boolean;
  musicGainDb?: number;
  ducking?: boolean;
  base?: number;
} = {}) {
  const assemblyPlan = input.assemblyPlan ?? assembly(input.base);
  const speechTracks = input.speech ?? [];
  const frozenScriptEntries = speechTracks.map((item) => ({
    sourceScriptEntryId: item.sourceScriptEntryId,
    speakerAuthorityId: item.speakerAuthorityId,
    exactText: item.text,
  }));
  const sourceHash = computeAiStoryAudioPlanSourceHash({
    storyId: assemblyPlan.storyId,
    storyVersionId: assemblyPlan.storyVersionId,
    scriptVersionId: id(900),
    editorialPlanId: assemblyPlan.editorialPlanId,
    editorialFingerprint: assemblyPlan.editorialFingerprint,
    assemblyV2PlanId: assemblyPlan.assemblyV2PlanId,
    assemblyV2Fingerprint: assemblyPlan.assemblyFingerprint,
    frozenScriptEntries,
  });
  const first = assemblyPlan.resolvedTimeline[0]!;
  const last = assemblyPlan.resolvedTimeline.at(-1)!;
  const musicAssetId = id(800);
  const ambienceAssetId = id(801);
  const sfxAssetId = id(802);
  const planWithoutFingerprint: Omit<AiStoryAudioPlan, "audioPlanFingerprint"> = {
    audioPlanId: id(700),
    storyId: assemblyPlan.storyId,
    storyVersionId: assemblyPlan.storyVersionId,
    scriptVersionId: id(900),
    editorialPlanId: assemblyPlan.editorialPlanId,
    editorialFingerprint: assemblyPlan.editorialFingerprint,
    assemblyV2PlanId: assemblyPlan.assemblyV2PlanId,
    assemblyV2Fingerprint: assemblyPlan.assemblyFingerprint,
    contractVersion: AI_STORY_AUDIO_PLAN_CONTRACT_VERSION,
    policyVersion: AI_STORY_AUDIO_POLICY_VERSION,
    speechTracks,
    musicTracks: input.music
      ? [{
          musicTrackId: id(810),
          sourceAssetId: musicAssetId,
          sourceKind: "OWNED",
          musicRole: "UNDERSCORE",
          moodIntent: "Warm",
          energyIntent: "Gentle lift",
          startAnchor: { timelineEntryId: first.timelineEntryId, offsetMs: 0 },
          endAnchor: { timelineEntryId: last.timelineEntryId, offsetMs: 0 },
          fadeInMs: 200,
          fadeOutMs: 300,
          baseGainDb: input.musicGainDb ?? -18,
          loopPolicy: "LOOP_TO_END",
          trimPolicy: "TRIM_TO_ANCHORS",
          contentHash: hash("music"),
        }]
      : [],
    ambienceTracks: input.ambience
      ? [{
          ambienceTrackId: id(811),
          sourceAssetId: ambienceAssetId,
          ambienceRole: "ROOM_TONE",
          startAnchor: { timelineEntryId: first.timelineEntryId, offsetMs: 0 },
          endAnchor: { timelineEntryId: last.timelineEntryId, offsetMs: 0 },
          baseGainDb: -28,
          loopPolicy: "LOOP_TO_END",
          contentHash: hash("ambience"),
        }]
      : [],
    sfxTracks: input.sfx
      ? [{
          sfxTrackId: id(812),
          sourceAssetId: sfxAssetId,
          actionAuthorityId: id(813),
          sfxRole: "CARD_PICKUP",
          anchor: { timelineEntryId: first.timelineEntryId, offsetMs: 700 },
          baseGainDb: -12,
          contentHash: hash("sfx"),
        }]
      : [],
    duckingRules:
      input.music && speechTracks.length && input.ducking !== false
        ? [{
            duckingRuleId: id(820),
            speechSegmentIds: speechTracks.map((item) => item.speechSegmentId),
            targetMusicTrackIds: [id(810)],
            duckingAmountDb: 12,
            attackMs: 30,
            releaseMs: 400,
          }]
        : [],
    mixPolicy: {
      speechTargetDb: -3,
      musicTargetDb: -18,
      ambienceTargetDb: -28,
      sfxTargetDb: -12,
      duckingRequiredWhenSpeechAndMusic: true,
      peakCeilingDbfs: -1,
      loudnessTargetLufs: -14,
      truePeakTargetDbtp: -1.5,
      channelLayout: "stereo",
      sampleRate: 48000,
    },
    status: "FROZEN",
    sourceHash,
    supersedesAudioPlanId: null,
    createdBy: id(990),
    createdAt: "2026-09-21T00:00:00.000Z",
    approvedBy: id(991),
    approvedAt: "2026-09-21T00:01:00.000Z",
    frozenAt: "2026-09-21T00:02:00.000Z",
  };
  return {
    plan: finalizeAiStoryAudioPlan({ plan: planWithoutFingerprint, frozenScriptEntries }),
    assemblyPlan,
    frozenScriptEntries,
    sources: [
      ...(input.music ? [{ sourceAssetId: musicAssetId, contentHash: hash("music"), mediaType: "audio/wav" as const, durationMs: 6000, sampleRate: 48000, channelCount: 2 }] : []),
      ...(input.ambience ? [{ sourceAssetId: ambienceAssetId, contentHash: hash("ambience"), mediaType: "audio/wav" as const, durationMs: 6000, sampleRate: 48000, channelCount: 2 }] : []),
      ...(input.sfx ? [{ sourceAssetId: sfxAssetId, contentHash: hash("sfx"), mediaType: "audio/wav" as const, durationMs: 300, sampleRate: 48000, channelCount: 2 }] : []),
    ],
  };
}

function resultFor(
  item: AiStorySpeechSegment,
  durationMs: number
): AiStoryTtsExecutionResult {
  const request = requestFor(item);
  return {
    ttsResultId: id(300),
    speechSegmentId: item.speechSegmentId,
    requestFingerprint: request.fingerprint,
    voiceCapabilityId: item.voiceSelection.voiceCapabilityId,
    contentHash: hash({ audio: item.speechSegmentId }),
    durationMs,
    mediaType: "audio/wav",
    sampleRate: 48000,
    channelCount: 2,
    providerExecutionIdentity: "fake-local:fixture",
    audioAssetId: id(301),
    usage: {
      characters: item.text.length,
      provider: "fake-local",
      model: "fixture-voice-v1",
      voice: "local-sg-my",
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    },
  };
}

function requestFor(item: AiStorySpeechSegment) {
  return compileAiStoryTtsExecutionRequest({
    segment: item,
    capability: capability(),
    outputFormat: "wav",
  });
}

describe("AI Story Audio Plan authority", () => {
  it("AUDIO_PLAN_SCHEMA and AUDIO_PLAN_FINGERPRINT DETERMINISM PASS", () => {
    const fixture = frozenPlan({ music: true });
    expect(AiStoryAudioPlanSchema.parse(fixture.plan)).toEqual(fixture.plan);
    expect(frozenPlan({ music: true }).plan.audioPlanFingerprint).toBe(
      fixture.plan.audioPlanFingerprint
    );
    expect(AI_STORY_AUDIO_PLAN).toBe("CERTIFIED");
    expect(AI_STORY_TTS_EXECUTION).toBe("CERTIFIED");
    expect(selectAiStoryAssemblyV2AudioMode(null)).toBe("VIDEO_ONLY");
    expect(selectAiStoryAssemblyV2AudioMode(fixture.plan)).toBe("AUDIO_MIX_V1");
    expect(
      AiStoryAudioPlanSchema.safeParse({
        ...fixture.plan,
        status: "DRAFT",
      }).success
    ).toBe(false);
  });

  it.each([
    ["Wah, today really busy lah.", "en-SG", [], "SINGAPORE_CONVERSATIONAL"],
    ["今天真的很累 lah, but then I saw the flowers.", "zh-SG", ["en-SG"], "MANDARIN_SG_CONVERSATIONAL"],
    ["Can settle today or not?", "en-MY", [], "MALAYSIAN_CONVERSATIONAL"],
    ["Tak apa, later I settle.", "en-MY", ["ms-MY"], "MALAYSIAN_CONVERSATIONAL"],
    ["Hadiah kecil, makna yang besar.", "ms-MY", [], "MALAYSIAN_MALAY_CONVERSATIONAL"],
    ["今天没空准备？没关系，我们帮你送到。", "zh-MY", [], "MANDARIN_MY_CONVERSATIONAL"],
  ] as const)(
    "SG/MY locale fixture preserves exact Script: %s",
    (text, primaryLocale, secondaryLocales, deliveryStyle) => {
      const item = segment({ text, primaryLocale, secondaryLocales: [...secondaryLocales], deliveryStyle });
      const request = compileAiStoryTtsExecutionRequest({
        segment: item,
        capability: capability(),
        outputFormat: "wav",
      });
      expect(request.exactText).toBe(text);
      expect(request.primaryLocale).toBe(primaryLocale);
      expect(request.secondaryLocales).toEqual(secondaryLocales);
    }
  );

  it("NO_AUTOMATIC_DIALECT_INVENTION and SCRIPT_TEXT_IMMUTABILITY PASS", () => {
    const text = "I'll send it later.";
    const item = segment({
      text,
      primaryLocale: "en-SG",
      deliveryStyle: "SINGAPORE_CONVERSATIONAL",
    });
    expect(
      compileAiStoryTtsExecutionRequest({
        segment: item,
        capability: capability(),
        outputFormat: "wav",
      }).exactText
    ).toBe(text);
    const fixture = frozenPlan({ speech: [item] });
    const changed = { ...fixture.plan, speechTracks: [{ ...item, text: "I send later lah." }] };
    expect(() =>
      finalizeAiStoryAudioPlan({
        plan: { ...changed, audioPlanFingerprint: undefined } as never,
        frozenScriptEntries: fixture.frozenScriptEntries,
      })
    ).toThrow();
  });

  it("VOICE_CAPABILITY_UNSUPPORTED and CODE_SWITCH_UNSUPPORTED BLOCK", () => {
    const local = segment({
      text: "Wah, today really busy lah.",
      primaryLocale: "en-SG",
      deliveryStyle: "SINGAPORE_CONVERSATIONAL",
    });
    expect(() =>
      compileAiStoryTtsExecutionRequest({
        segment: local,
        capability: capability({ supportedLocales: ["en-MY"] }),
        outputFormat: "wav",
      })
    ).toThrowError(AiStoryAudioAuthorityError);
    const switched = segment({
      text: "Tak apa, later I settle.",
      primaryLocale: "en-MY",
      secondaryLocales: ["ms-MY"],
      deliveryStyle: "MALAYSIAN_CONVERSATIONAL",
    });
    expect(() =>
      compileAiStoryTtsExecutionRequest({
        segment: switched,
        capability: capability({ supportedCodeSwitchPairs: [] }),
        outputFormat: "wav",
      })
    ).toThrowError(/code-switch/);
  });

  it("VOICE_CAPABILITY_MATRIX selects deterministically without inferring protected traits", () => {
    const item = segment({
      text: "Can settle today or not?",
      primaryLocale: "en-MY",
      deliveryStyle: "MALAYSIAN_CONVERSATIONAL",
    });
    const later = capability({ voiceCapabilityId: id(9), providerVoiceRef: "later" });
    const first = capability({ voiceCapabilityId: id(2), providerVoiceRef: "first" });
    expect(
      selectAiStoryVoiceCapability({ segment: item, capabilities: [later, first] })
        .voiceCapabilityId
    ).toBe(first.voiceCapabilityId);
    expect(item.voiceSelection.genderPresentation).toBeNull();
    expect(item.voiceSelection.ageRangePresentation).toBeNull();
  });

  it("actual OpenAI adapter capability remains neutral, review-pending, and paid-execution gated", async () => {
    const actual = createOpenAiNeutralVoiceCapability({
      voiceCapabilityId: id(60),
      providerVoiceRef: "nova",
      supportedBrandTones: ["Local SME warmth"],
    });
    expect(actual.providerId).toBe("openai");
    expect(actual.supportedDeliveryStyles).toEqual(["STANDARD_NEUTRAL"]);
    expect(actual.supportedCodeSwitchPairs).toEqual([]);
    expect(actual.certificationStatus).toBe("HUMAN_LISTENING_REVIEW_REQUIRED");
    const neutralSegment = {
      ...segment({
        text: "Exact neutral provider boundary.",
        primaryLocale: "en-SG",
        deliveryStyle: "STANDARD_NEUTRAL",
      }),
      voiceSelection: {
        ...segment({
          text: "Exact neutral provider boundary.",
          primaryLocale: "en-SG",
          deliveryStyle: "STANDARD_NEUTRAL",
        }).voiceSelection,
        voiceCapabilityId: actual.voiceCapabilityId,
        providerVoiceRef: actual.providerVoiceRef,
      },
    };
    const request = compileAiStoryTtsExecutionRequest({
      segment: neutralSegment,
      capability: actual,
      outputFormat: "mp3",
    });
    const adapter = createOpenAiStoryTtsAdapter({
      probeAudio: async () => {
        throw new Error("provider must not execute");
      },
      requireExplicitPaidExecutionAuthorization: async () => ({
        authorizationId: "",
      }),
    });
    await expect(adapter.synthesize(request)).rejects.toThrow(
      /PAID_EXECUTION_AUTHORITY_REQUIRED/
    );
  });

  it("TTS request fingerprint, cache identity, exact binding, and segment retry PASS", async () => {
    const item = segment({
      text: "Hadiah kecil, makna yang besar.",
      primaryLocale: "ms-MY",
      deliveryStyle: "MALAYSIAN_MALAY_PROFESSIONAL",
    });
    const voice = capability();
    const requestA = compileAiStoryTtsExecutionRequest({ segment: item, capability: voice, outputFormat: "wav" });
    const requestB = compileAiStoryTtsExecutionRequest({ segment: item, capability: voice, outputFormat: "wav" });
    expect(requestA.fingerprint).toBe(requestB.fingerprint);
    let calls = 0;
    const adapter = createDeterministicFakeTtsAdapter({
      onExecute: () => { calls += 1; },
      bytesForRequest: async () => ({
        bytes: Buffer.from("deterministic-local-audio"),
        durationMs: 900,
        sampleRate: 48000,
        channelCount: 2,
      }),
    });
    const cache = new AiStoryTtsMemoryCache();
    const first = await executeAiStoryTtsRequest({ request: requestA, capability: voice, adapter, cache, estimatedUsdPerMillionCharacters: 0 });
    const second = await executeAiStoryTtsRequest({ request: requestB, capability: voice, adapter, cache, estimatedUsdPerMillionCharacters: 0 });
    expect(calls).toBe(1);
    expect(second.result).toEqual(first.result);
    expect(first.result.speechSegmentId).toBe(item.speechSegmentId);
    expect(first.result.usage.actualCostUsd).toBe(0);
    await expect(
      retryAiStoryTtsSegment({
        request: requestA,
        capability: voice,
        adapter,
        cache: new AiStoryTtsMemoryCache(),
        authorization: {
          speechSegmentId: requestA.speechSegmentId,
          authorized: false,
          attempt: 1,
          maxAttempts: 1,
        },
      })
    ).rejects.toThrow(/AUTHORITY_REQUIRED/);
    await retryAiStoryTtsSegment({
      request: requestA,
      capability: voice,
      adapter,
      cache,
      authorization: {
        speechSegmentId: requestA.speechSegmentId,
        authorized: true,
        attempt: 1,
        maxAttempts: 1,
      },
    });
    expect(calls).toBe(2);
  });

  it("TTS_OUTPUT_STALE BLOCKS mismatched request fingerprints", () => {
    const assemblyPlan = assembly();
    const item = segment({
      text: "Exact frozen line.",
      primaryLocale: "en-SG",
      deliveryStyle: "SINGAPORE_PROFESSIONAL",
      timelineEntryId: assemblyPlan.resolvedTimeline[0]!.timelineEntryId,
    });
    const fixture = frozenPlan({ speech: [item], assemblyPlan });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: fixture.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(item)],
        ttsResults: [{ ...resultFor(item, 1000), requestFingerprint: hash("stale") }],
        audioSources: [],
      authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/stale/);
  });

  it("J_CUT and L_CUT authority resolve onto the Assembly V2 timeline", () => {
    const assemblyPlan = assembly();
    const second = assemblyPlan.resolvedTimeline[1]!;
    const jCut = segment({
      text: "You remembered.",
      primaryLocale: "en-SG",
      deliveryStyle: "EMOTIONAL_SOFT",
      timelineEntryId: second.timelineEntryId,
      jCutMs: 500,
    });
    const jFixture = frozenPlan({ speech: [jCut], assemblyPlan });
    const jMix = compileAiStoryAudioMixExecutionPlan({
      audioPlan: jFixture.plan,
      assemblyPlan,
      assemblyV2VideoContentHash: hash("assembly-video"),
      ttsRequests: [requestFor(jCut)],
      ttsResults: [resultFor(jCut, 1200)],
      audioSources: [],
      authorizedActionAuthorityIds: [],
    });
    expect(jMix.subtitleSpeechTiming[0]!.startMs).toBe(1500);
    expect(jMix.resolvedTracks[0]!.jCutExecuted).toBe(true);

    const first = assemblyPlan.resolvedTimeline[0]!;
    const lCut = segment({
      text: "A little care goes a long way.",
      primaryLocale: "en-MY",
      deliveryStyle: "EMOTIONAL_SOFT",
      timelineEntryId: first.timelineEntryId,
      offsetMs: 1200,
      lCutMs: 500,
      n: 20,
    });
    const lFixture = frozenPlan({ speech: [lCut], assemblyPlan });
    const lMix = compileAiStoryAudioMixExecutionPlan({
      audioPlan: lFixture.plan,
      assemblyPlan,
      assemblyV2VideoContentHash: hash("assembly-video"),
      ttsRequests: [requestFor(lCut)],
      ttsResults: [resultFor(lCut, 1200)],
      audioSources: [],
      authorizedActionAuthorityIds: [],
    });
    expect(lMix.subtitleSpeechTiming[0]!.endMs).toBe(2400);
    expect(lMix.resolvedTracks[0]!.lCutExecuted).toBe(true);
  });

  it("semantic AFTER_VISUAL_EVENT and BEFORE_NEXT_SHOT anchors resolve deterministically", () => {
    const assemblyPlan = assembly();
    const first = assemblyPlan.resolvedTimeline[0]!;
    const after = {
      ...segment({
        text: "After the reveal.",
        primaryLocale: "en-SG",
        deliveryStyle: "STANDARD_NEUTRAL",
        timelineEntryId: first.timelineEntryId,
      }),
      timelineAnchor: {
        timelineEntryId: first.timelineEntryId,
        relation: "AFTER_VISUAL_EVENT" as const,
        offsetMs: 500,
      },
      startIntent: "AFTER_VISUAL_EVENT" as const,
    };
    const before = {
      ...segment({
        text: "Before the next shot.",
        primaryLocale: "en-SG",
        deliveryStyle: "STANDARD_NEUTRAL",
        timelineEntryId: first.timelineEntryId,
        n: 25,
      }),
      timelineAnchor: {
        timelineEntryId: first.timelineEntryId,
        relation: "BEFORE_NEXT_SHOT" as const,
        offsetMs: -600,
      },
    };
    for (const [item, durationMs, expectedStartMs] of [
      [after, 500, 500],
      [before, 400, 1400],
    ] as const) {
      const fixture = frozenPlan({ speech: [item], assemblyPlan });
      const mix = compileAiStoryAudioMixExecutionPlan({
        audioPlan: fixture.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(item)],
        ttsResults: [resultFor(item, durationMs)],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      });
      expect(mix.subtitleSpeechTiming[0]!.startMs).toBe(expectedStartMs);
    }
  });

  it("invalid J/L cuts and dialogue collisions BLOCK", () => {
    const assemblyPlan = assembly();
    const first = assemblyPlan.resolvedTimeline[0]!;
    const invalid = segment({
      text: "Too long.",
      primaryLocale: "en-SG",
      deliveryStyle: "STANDARD_NEUTRAL",
      timelineEntryId: first.timelineEntryId,
    });
    const invalidFixture = frozenPlan({ speech: [invalid], assemblyPlan });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: invalidFixture.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(invalid)],
        ttsResults: [resultFor(invalid, 2500)],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/without L-cut authority/);

    const a = segment({ text: "One", primaryLocale: "en-SG", deliveryStyle: "STANDARD_NEUTRAL", timelineEntryId: first.timelineEntryId, n: 30 });
    const b = segment({ text: "Two", primaryLocale: "en-SG", deliveryStyle: "STANDARD_NEUTRAL", timelineEntryId: first.timelineEntryId, offsetMs: 300, n: 40 });
    const collision = frozenPlan({ speech: [a, b], assemblyPlan });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: collision.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(a), requestFor(b)],
        ttsResults: [resultFor(a, 1000), { ...resultFor(b, 1000), ttsResultId: id(302), audioAssetId: id(303) }],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/collide/);
  });

  it("invalid J-cut, excessive L-cut, absent ducking, and loud BGM BLOCK", () => {
    const assemblyPlan = assembly();
    const first = assemblyPlan.resolvedTimeline[0]!;
    const invalidJ = segment({
      text: "No preceding beat.",
      primaryLocale: "en-SG",
      deliveryStyle: "STANDARD_NEUTRAL",
      timelineEntryId: first.timelineEntryId,
      jCutMs: 500,
    });
    const jFixture = frozenPlan({ speech: [invalidJ], assemblyPlan });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: jFixture.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(invalidJ)],
        ttsResults: [resultFor(invalidJ, 500)],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/J-cut/);

    const excessiveL = segment({
      text: "Carries far too long.",
      primaryLocale: "en-MY",
      deliveryStyle: "STANDARD_NEUTRAL",
      timelineEntryId: first.timelineEntryId,
      offsetMs: 1200,
      lCutMs: 500,
      n: 27,
    });
    const lFixture = frozenPlan({ speech: [excessiveL], assemblyPlan });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: lFixture.plan,
        assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [requestFor(excessiveL)],
        ttsResults: [resultFor(excessiveL, 1600)],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/L-cut exceeds/);

    const voiced = segment({
      text: "Music stays under speech.",
      primaryLocale: "en-SG",
      deliveryStyle: "STANDARD_NEUTRAL",
      timelineEntryId: first.timelineEntryId,
      n: 28,
    });
    for (const fixture of [
      frozenPlan({ speech: [voiced], assemblyPlan, music: true, ducking: false }),
      frozenPlan({ speech: [voiced], assemblyPlan, music: true, musicGainDb: 0 }),
    ]) {
      expect(() =>
        compileAiStoryAudioMixExecutionPlan({
          audioPlan: fixture.plan,
          assemblyPlan,
          assemblyV2VideoContentHash: hash("assembly-video"),
          ttsRequests: [requestFor(voiced)],
          ttsResults: [resultFor(voiced, 600)],
          audioSources: fixture.sources,
          authorizedActionAuthorityIds: [],
        })
      ).toThrowError(/ducking authority|too loud/);
    }
  });

  it.each([
    ["COMMERCIAL_FLOWER_AUDIO", { speech: true, music: true, ambience: true, sfx: true }],
    ["SERVICE_AUDIO", { speech: true, music: true, ambience: true, sfx: true }],
    ["FOOD_AUDIO", { speech: true, music: true, ambience: true, sfx: true }],
    ["MINIMAL_HERO_AUDIO", { speech: false, music: true, ambience: true, sfx: false }],
  ] as const)("%s plan generalizes without Product dependency", (_name, shape) => {
    const assemblyPlan = assembly();
    const item = segment({
      text: "Small moments, delivered with care.",
      primaryLocale: "en-SG",
      deliveryStyle: "SINGAPORE_PROFESSIONAL",
      timelineEntryId: assemblyPlan.resolvedTimeline[0]!.timelineEntryId,
    });
    const fixture = frozenPlan({
      assemblyPlan,
      speech: shape.speech ? [item] : [],
      music: shape.music,
      ambience: shape.ambience,
      sfx: shape.sfx,
    });
    const mix = compileAiStoryAudioMixExecutionPlan({
      audioPlan: fixture.plan,
      assemblyPlan,
      assemblyV2VideoContentHash: hash("assembly-video"),
      ttsRequests: shape.speech ? [requestFor(item)] : [],
      ttsResults: shape.speech ? [resultFor(item, 1200)] : [],
      audioSources: fixture.sources,
      authorizedActionAuthorityIds: shape.sfx ? [id(813)] : [],
    });
    expect(mix.resolvedTracks.some((track) => track.trackKind === "MUSIC")).toBe(true);
    if (!shape.speech) expect(mix.subtitleSpeechTiming).toEqual([]);
  });

  it("missing source and wrong content hash BLOCK", () => {
    const fixture = frozenPlan({ music: true });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: fixture.plan,
        assemblyPlan: fixture.assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [],
        ttsResults: [],
        audioSources: [],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/missing/);
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: fixture.plan,
        assemblyPlan: fixture.assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [],
        ttsResults: [],
        audioSources: [{ ...fixture.sources[0]!, contentHash: hash("wrong") }],
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/hash/);
  });

  it("SFX without frozen Story action authority BLOCKS", () => {
    const fixture = frozenPlan({ sfx: true });
    expect(() =>
      compileAiStoryAudioMixExecutionPlan({
        audioPlan: fixture.plan,
        assemblyPlan: fixture.assemblyPlan,
        assemblyV2VideoContentHash: hash("assembly-video"),
        ttsRequests: [],
        ttsResults: [],
        audioSources: fixture.sources,
        authorizedActionAuthorityIds: [],
      })
    ).toThrowError(/authorized Story action/);
  });
});
