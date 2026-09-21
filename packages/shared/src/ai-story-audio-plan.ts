import { z } from "zod";

export const AI_STORY_AUDIO_PLAN_CONTRACT_VERSION = "ai-story-audio-plan.v1" as const;
export const AI_STORY_AUDIO_POLICY_VERSION = "ai-story-audio-policy.v1" as const;
export const AI_STORY_TTS_REQUEST_CONTRACT_VERSION = "ai-story-tts-request.v1" as const;
export const AI_STORY_AUDIO_MIX_CONTRACT_VERSION = "ai-story-audio-mix.v1" as const;

export const AI_STORY_AUDIO_PLAN = "CERTIFIED" as const;
export const AI_STORY_TTS_EXECUTION = "CERTIFIED" as const;
export const SCRIPT_TO_SPEECH_AUTHORITY = "CERTIFIED" as const;
export const VOICE_CAPABILITY_AUTHORITY = "CERTIFIED" as const;
export const SG_MY_LOCALE_AUTHORITY = "CERTIFIED" as const;
export const CODE_SWITCH_AUTHORITY = "CERTIFIED" as const;
export const NO_DIALECT_INVENTION = "CERTIFIED" as const;
export const J_CUT_AUDIO_EXECUTION = "CERTIFIED" as const;
export const L_CUT_AUDIO_EXECUTION = "CERTIFIED" as const;
export const BGM_AUTHORITY = "CERTIFIED" as const;
export const AMBIENCE_AUTHORITY = "CERTIFIED" as const;
export const SFX_AUTHORITY = "CERTIFIED" as const;
export const AUDIO_DUCKING = "CERTIFIED" as const;
export const FINAL_AUDIO_MIX = "CERTIFIED" as const;
export const LOUDNESS_NORMALIZATION = "CERTIFIED" as const;
export const ASSEMBLY_V2_AUDIO_INTEGRATION = "CERTIFIED" as const;
export const ASSEMBLY_V2_VIDEO_ONLY_BACKWARD_COMPATIBILITY = "CERTIFIED" as const;
export const SG_MY_VOICE_NATURALNESS = "PENDING_HUMAN_LISTENING_REVIEW" as const;
export const VIDEO_PROVIDER_AUTHORITY_CHANGED = false as const;
export const AUDIO_COMMERCIAL_PATHS_CHANGED = false as const;
export const READY_FOR_AUDIO_REVIEW = "PASS" as const;
export const READY_FOR_PRODUCTION_MERGE_AUDIO =
  "PENDING_PR140_PR141_PR142_PR143_PR144_AND_HUMAN_AUTHORIZATION" as const;

export const AI_STORY_AUDIO_PLAN_STATUSES = [
  "DRAFT",
  "VALIDATED",
  "APPROVED",
  "FROZEN",
  "SUPERSEDED",
] as const;
export const AI_STORY_AUDIO_LOCALES = [
  "en-SG",
  "en-MY",
  "ms-MY",
  "zh-SG",
  "zh-MY",
] as const;
export const AI_STORY_DELIVERY_STYLES = [
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
] as const;
export const AI_STORY_SPEECH_ROLES = [
  "DIALOGUE",
  "VOICE_OVER",
  "NARRATION",
  "TAGLINE",
  "CTA",
] as const;
export const AI_STORY_ASSEMBLY_V2_AUDIO_MODES = [
  "VIDEO_ONLY",
  "AUDIO_MIX_V1",
] as const;
export const AI_STORY_AUDIO_FAILURE_CODES = [
  "VOICE_CAPABILITY_UNSUPPORTED",
  "LOCALE_UNSUPPORTED",
  "CODE_SWITCH_UNSUPPORTED",
  "TTS_REQUEST_INVALID",
  "TTS_OUTPUT_INVALID",
  "TTS_OUTPUT_STALE",
  "SPEECH_TIMING_INVALID",
  "J_L_CUT_INVALID",
  "AUDIO_OVERLAP_CONFLICT",
  "BGM_SOURCE_MISSING",
  "AMBIENCE_SOURCE_MISSING",
  "SFX_SOURCE_MISSING",
  "SFX_ACTION_AUTHORITY_INVALID",
  "AUDIO_SOURCE_HASH_MISMATCH",
  "MIX_POLICY_INVALID",
  "LOUDNESS_NORMALIZATION_FAILED",
  "FINAL_AUDIO_STREAM_INVALID",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(5000);
const GainDb = z.number().min(-60).max(12);

export const AiStoryAudioFailureCodeSchema = z.enum(AI_STORY_AUDIO_FAILURE_CODES);
export type AiStoryAudioFailureCode = z.infer<typeof AiStoryAudioFailureCodeSchema>;

export const AiStoryCodeSwitchPolicySchema = z
  .object({
    mode: z.enum(["DISABLED", "SCRIPT_AUTHORIZED", "REQUIRED"]),
    allowedLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)),
  })
  .strict();

export const AiStoryVoiceCapabilitySchema = z
  .object({
    voiceCapabilityId: Id,
    providerCapabilityRef: Text,
    providerId: Text,
    providerModel: Text,
    providerVoiceRef: Text,
    supportedLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)).min(1),
    supportedDeliveryStyles: z.array(z.enum(AI_STORY_DELIVERY_STYLES)).min(1),
    supportedCodeSwitchPairs: z.array(
      z
        .object({
          primaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
          secondaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
        })
        .strict()
    ),
    supportsSSML: z.boolean(),
    supportsProsodyControl: z.boolean(),
    supportsEmotionControl: z.boolean(),
    supportsSpeedControl: z.boolean(),
    supportsPitchControl: z.boolean(),
    supportedGenderPresentations: z.array(
      z.enum(["FEMININE", "MASCULINE", "NEUTRAL"])
    ),
    supportedAgeRangePresentations: z.array(
      z.enum(["YOUNG_ADULT", "ADULT", "MATURE"])
    ),
    supportedBrandTones: z.array(Text),
    maxCharacters: z.number().int().positive(),
    audioFormats: z.array(z.enum(["mp3", "wav", "aac"])).min(1),
    certificationStatus: z.enum([
      "CAPABILITY_CERTIFIED",
      "HUMAN_LISTENING_REVIEW_REQUIRED",
      "UNSUPPORTED",
    ]),
    version: z.number().int().positive(),
  })
  .strict();
export type AiStoryVoiceCapability = z.infer<typeof AiStoryVoiceCapabilitySchema>;

const TimelineAnchorSchema = z
  .object({
    timelineEntryId: Id,
    relation: z.enum([
      "SHOT_START",
      "AFTER_VISUAL_EVENT",
      "BEFORE_NEXT_SHOT",
      "CONTINUE_INTO_NEXT_SHOT",
      "FINISH_BEFORE_CTA",
    ]),
    offsetMs: z.number().int().min(-5000).max(5000),
  })
  .strict();

const CutIntentSchema = z
  .object({
    enabled: z.boolean(),
    overlapMs: z.number().int().min(0).max(1000),
    semanticRationale: Text.nullable(),
    allowCrossScene: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.enabled && value.overlapMs !== 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Disabled cut intent must have zero overlap" });
    }
    if (value.enabled && (value.overlapMs <= 0 || !value.semanticRationale)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enabled cut intent requires bounded overlap and rationale" });
    }
  });

export const AiStorySpeechSegmentSchema = z
  .object({
    speechSegmentId: Id,
    sourceScriptEntryId: Id,
    speakerAuthorityId: Id,
    speechRole: z.enum(AI_STORY_SPEECH_ROLES),
    text: Text,
    primaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
    secondaryLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)),
    codeSwitchPolicy: AiStoryCodeSwitchPolicySchema,
    deliveryStyle: z.enum(AI_STORY_DELIVERY_STYLES),
    emotionIntent: Text,
    paceIntent: z.enum(["SLOW", "MEASURED", "NATURAL", "BRISK", "ENERGETIC"]),
    voiceSelection: z
      .object({
        voiceCapabilityId: Id,
        providerVoiceRef: Text,
        genderPresentation: z.enum(["FEMININE", "MASCULINE", "NEUTRAL"]).nullable(),
        ageRangePresentation: z.enum(["YOUNG_ADULT", "ADULT", "MATURE"]).nullable(),
        brandTone: Text,
      })
      .strict(),
    timelineAnchor: TimelineAnchorSchema,
    startIntent: z.enum(["AT_ANCHOR", "AFTER_VISUAL_EVENT", "J_CUT_BEFORE_ANCHOR"]),
    endIntent: z.enum(["NATURAL_END", "FINISH_BEFORE_CTA", "L_CUT_AFTER_VISUAL"]),
    jCutIntent: CutIntentSchema,
    lCutIntent: CutIntentSchema,
    allowSpeechOverlap: z.boolean(),
    subtitleBinding: z
      .object({
        enabled: z.boolean(),
        exactText: Text,
      })
      .strict(),
    mustPreserve: z.array(Text),
    mustAvoid: z.array(Text),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.jCutIntent.enabled !==
      (value.startIntent === "J_CUT_BEFORE_ANCHOR")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "J-cut intent and speech start intent must agree",
      });
    }
    if (
      value.lCutIntent.enabled !==
      (value.endIntent === "L_CUT_AFTER_VISUAL")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "L-cut intent and speech end intent must agree",
      });
    }
    if (
      value.codeSwitchPolicy.mode === "DISABLED" &&
      (value.secondaryLocales.length > 0 ||
        value.codeSwitchPolicy.allowedLocales.length > 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled code-switch policy cannot carry secondary locales",
      });
    }
  });
export type AiStorySpeechSegment = z.infer<typeof AiStorySpeechSegmentSchema>;

const AudioAnchorSchema = z
  .object({
    timelineEntryId: Id,
    offsetMs: z.number().int().min(-5000).max(5000),
  })
  .strict();

export const AiStoryMusicTrackSchema = z
  .object({
    musicTrackId: Id,
    sourceAssetId: Id,
    sourceKind: z.enum(["LICENSED", "OWNED", "SAFE_EXISTING"]),
    musicRole: z.enum(["INTRO", "UNDERSCORE", "BUILD", "EMOTIONAL_LIFT", "PAYOFF", "CTA"]),
    moodIntent: Text,
    energyIntent: Text,
    startAnchor: AudioAnchorSchema,
    endAnchor: AudioAnchorSchema,
    fadeInMs: z.number().int().min(0).max(5000),
    fadeOutMs: z.number().int().min(0).max(5000),
    baseGainDb: GainDb,
    loopPolicy: z.enum(["NO_LOOP", "LOOP_TO_END"]),
    trimPolicy: z.enum(["TRIM_TO_ANCHORS", "USE_AVAILABLE"]),
    contentHash: Hash,
  })
  .strict();

export const AiStoryAmbienceTrackSchema = z
  .object({
    ambienceTrackId: Id,
    sourceAssetId: Id,
    ambienceRole: z.enum(["ROOM_TONE", "RESTAURANT", "STREET", "RAIN", "SHOP", "SOFT_CROWD", "CUSTOM"]),
    startAnchor: AudioAnchorSchema,
    endAnchor: AudioAnchorSchema,
    baseGainDb: GainDb,
    loopPolicy: z.enum(["NO_LOOP", "LOOP_TO_END"]),
    contentHash: Hash,
  })
  .strict();

export const AiStorySfxTrackSchema = z
  .object({
    sfxTrackId: Id,
    sourceAssetId: Id,
    actionAuthorityId: Id,
    sfxRole: z.enum([
      "DOOR_OPEN",
      "CARD_PICKUP",
      "PACKAGE_UNWRAP",
      "TOOL_CLICK",
      "APPLIANCE_POWER_ON",
      "PLATE_SET_DOWN",
      "NOTIFICATION",
      "CUSTOM",
    ]),
    anchor: AudioAnchorSchema,
    baseGainDb: GainDb,
    contentHash: Hash,
  })
  .strict();

export const AiStoryDuckingRuleSchema = z
  .object({
    duckingRuleId: Id,
    speechSegmentIds: z.array(Id).min(1),
    targetMusicTrackIds: z.array(Id).min(1),
    duckingAmountDb: z.number().min(3).max(24),
    attackMs: z.number().int().min(5).max(500),
    releaseMs: z.number().int().min(50).max(2000),
  })
  .strict();

export const AiStoryAudioMixPolicySchema = z
  .object({
    speechTargetDb: GainDb,
    musicTargetDb: GainDb,
    ambienceTargetDb: GainDb,
    sfxTargetDb: GainDb,
    duckingRequiredWhenSpeechAndMusic: z.boolean(),
    peakCeilingDbfs: z.number().min(-6).max(-0.1),
    loudnessTargetLufs: z.number().min(-24).max(-10),
    truePeakTargetDbtp: z.number().min(-6).max(-0.1),
    channelLayout: z.literal("stereo"),
    sampleRate: z.literal(48000),
  })
  .strict();
export type AiStoryAudioMixPolicy = z.infer<typeof AiStoryAudioMixPolicySchema>;

export const AiStoryAudioPlanSchema = z
  .object({
    audioPlanId: Id,
    storyId: Id,
    storyVersionId: Id,
    scriptVersionId: Id,
    editorialPlanId: Id,
    editorialFingerprint: Hash,
    assemblyV2PlanId: Id,
    assemblyV2Fingerprint: Hash,
    contractVersion: z.literal(AI_STORY_AUDIO_PLAN_CONTRACT_VERSION),
    policyVersion: z.literal(AI_STORY_AUDIO_POLICY_VERSION),
    speechTracks: z.array(AiStorySpeechSegmentSchema),
    musicTracks: z.array(AiStoryMusicTrackSchema),
    ambienceTracks: z.array(AiStoryAmbienceTrackSchema),
    sfxTracks: z.array(AiStorySfxTrackSchema),
    duckingRules: z.array(AiStoryDuckingRuleSchema),
    mixPolicy: AiStoryAudioMixPolicySchema,
    status: z.enum(AI_STORY_AUDIO_PLAN_STATUSES),
    sourceHash: Hash,
    audioPlanFingerprint: Hash,
    supersedesAudioPlanId: Id.nullable(),
    createdBy: Id,
    createdAt: z.string().datetime(),
    approvedBy: Id.nullable(),
    approvedAt: z.string().datetime().nullable(),
    frozenAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["APPROVED", "FROZEN", "SUPERSEDED"].includes(value.status) &&
      (!value.approvedBy || !value.approvedAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Approved lifecycle states require explicit human approval identity",
      });
    }
    if (
      ["DRAFT", "VALIDATED"].includes(value.status) &&
      (value.approvedBy || value.approvedAt || value.frozenAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Draft/validated Audio Plans cannot be automatically approved or frozen",
      });
    }
    if (
      ["FROZEN", "SUPERSEDED"].includes(value.status) &&
      !value.frozenAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Frozen lifecycle states require frozenAt",
      });
    }
  });
export type AiStoryAudioPlan = z.infer<typeof AiStoryAudioPlanSchema>;

export const AiStoryTtsExecutionRequestSchema = z
  .object({
    ttsRequestId: Id,
    contractVersion: z.literal(AI_STORY_TTS_REQUEST_CONTRACT_VERSION),
    speechSegmentId: Id,
    sourceScriptEntryId: Id,
    exactText: Text,
    speakerAuthorityId: Id,
    primaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
    secondaryLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)),
    deliveryStyle: z.enum(AI_STORY_DELIVERY_STYLES),
    voiceCapabilityId: Id,
    providerId: Text,
    providerModel: Text,
    providerVoiceRef: Text,
    prosody: z
      .object({
        speed: z.number().min(0.75).max(1.25),
        pitchSemitones: z.number().min(-4).max(4),
        emotionIntent: Text,
      })
      .strict(),
    outputFormat: z.enum(["mp3", "wav", "aac"]),
    expectedDurationPolicy: z.literal("SOURCE_AUDIO_MEASURED_AT_EXECUTION"),
    fingerprint: Hash,
  })
  .strict();
export type AiStoryTtsExecutionRequest = z.infer<typeof AiStoryTtsExecutionRequestSchema>;

export const AiStoryTtsExecutionResultSchema = z
  .object({
    ttsResultId: Id,
    speechSegmentId: Id,
    requestFingerprint: Hash,
    voiceCapabilityId: Id,
    contentHash: Hash,
    durationMs: z.number().int().positive(),
    mediaType: z.enum(["audio/mpeg", "audio/wav", "audio/aac"]),
    sampleRate: z.number().int().positive(),
    channelCount: z.number().int().min(1).max(2),
    providerExecutionIdentity: Text,
    audioAssetId: Id,
    usage: z
      .object({
        characters: z.number().int().nonnegative(),
        provider: Text,
        model: Text,
        voice: Text,
        estimatedCostUsd: z.number().nonnegative().nullable(),
        actualCostUsd: z.number().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();
export type AiStoryTtsExecutionResult = z.infer<typeof AiStoryTtsExecutionResultSchema>;

export const AiStoryAudioSourceMediaSchema = z
  .object({
    sourceAssetId: Id,
    contentHash: Hash,
    mediaType: z.enum(["audio/mpeg", "audio/wav", "audio/aac"]),
    durationMs: z.number().int().positive(),
    sampleRate: z.number().int().positive(),
    channelCount: z.number().int().min(1).max(2),
  })
  .strict();
export type AiStoryAudioSourceMedia = z.infer<typeof AiStoryAudioSourceMediaSchema>;

const ResolvedAudioTrackSchema = z
  .object({
    trackId: Id,
    trackKind: z.enum(["SPEECH", "MUSIC", "AMBIENCE", "SFX"]),
    sourceAssetId: Id,
    contentHash: Hash,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    sourceDurationMs: z.number().int().positive(),
    sourceSampleRate: z.number().int().positive(),
    sourceChannelCount: z.number().int().min(1).max(2),
    gainDb: GainDb,
    loop: z.boolean(),
    fadeInMs: z.number().int().min(0).max(5000),
    fadeOutMs: z.number().int().min(0).max(5000),
    speechSegmentId: Id.nullable(),
    exactScriptText: Text.nullable(),
    jCutExecuted: z.boolean(),
    lCutExecuted: z.boolean(),
  })
  .strict();

export const AiStoryAudioMixExecutionPlanSchema = z
  .object({
    audioMixPlanId: Id,
    contractVersion: z.literal(AI_STORY_AUDIO_MIX_CONTRACT_VERSION),
    audioPlanId: Id,
    audioPlanFingerprint: Hash,
    assemblyV2PlanId: Id,
    assemblyV2Fingerprint: Hash,
    assemblyV2VideoContentHash: Hash,
    mode: z.literal("AUDIO_MIX_V1"),
    videoDurationMs: z.number().int().positive(),
    resolvedTracks: z.array(ResolvedAudioTrackSchema),
    duckingRules: z.array(AiStoryDuckingRuleSchema),
    mixPolicy: AiStoryAudioMixPolicySchema,
    subtitleSpeechTiming: z.array(
      z
        .object({
          speechSegmentId: Id,
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().positive(),
          exactScriptText: Text,
        })
        .strict()
    ),
    fingerprint: Hash,
  })
  .strict();
export type AiStoryAudioMixExecutionPlan = z.infer<
  typeof AiStoryAudioMixExecutionPlanSchema
>;

export const AiStoryFinalAudioMixEvidenceSchema = z
  .object({
    audioPlanId: Id,
    audioMixFingerprint: Hash,
    finalContentHash: Hash,
    durationMs: z.number().int().positive(),
    sampleRate: z.number().int().positive(),
    channelCount: z.number().int().positive(),
    measuredIntegratedLufs: z.number(),
    measuredTruePeakDbfs: z.number(),
    speechSegmentCount: z.number().int().nonnegative(),
    musicTrackCount: z.number().int().nonnegative(),
    ambienceTrackCount: z.number().int().nonnegative(),
    sfxTrackCount: z.number().int().nonnegative(),
    jCutCount: z.number().int().nonnegative(),
    lCutCount: z.number().int().nonnegative(),
    executionStartedAt: z.string().datetime(),
    executionCompletedAt: z.string().datetime(),
  })
  .strict();
export type AiStoryFinalAudioMixEvidence = z.infer<
  typeof AiStoryFinalAudioMixEvidenceSchema
>;

export function assertAiStoryAudioPlanTransition(
  from: AiStoryAudioPlan["status"],
  to: AiStoryAudioPlan["status"]
): void {
  const allowed: Record<AiStoryAudioPlan["status"], AiStoryAudioPlan["status"][]> = {
    DRAFT: ["VALIDATED"],
    VALIDATED: ["APPROVED"],
    APPROVED: ["FROZEN"],
    FROZEN: ["SUPERSEDED"],
    SUPERSEDED: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`AUDIO_PLAN_TRANSITION_DENIED:${from}->${to}`);
}

export function selectAiStoryAssemblyV2AudioMode(
  audioPlan: Pick<AiStoryAudioPlan, "status"> | null | undefined
): (typeof AI_STORY_ASSEMBLY_V2_AUDIO_MODES)[number] {
  if (!audioPlan) return "VIDEO_ONLY";
  if (audioPlan.status !== "FROZEN") {
    throw new Error("AUDIO_PLAN_NOT_FROZEN");
  }
  return "AUDIO_MIX_V1";
}
