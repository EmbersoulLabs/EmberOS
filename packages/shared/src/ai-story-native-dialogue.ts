import { z } from "zod";
import {
  AI_STORY_AUDIO_LOCALES,
  AI_STORY_DELIVERY_STYLES,
  AiStoryCodeSwitchPolicySchema,
} from "./ai-story-audio-plan";

export const AI_STORY_NATIVE_DIALOGUE_CONTRACT_VERSION =
  "ai-story-native-dialogue.v1" as const;
export const AI_STORY_NATIVE_AV_RESULT_CONTRACT_VERSION =
  "ai-story-native-av-result.v1" as const;
export const AI_STORY_SEEDANCE_NATIVE_AUDIO_CAPABILITY_VERSION =
  "seedance-modelark-native-audio-2026-09-21.v1" as const;

export const SEEDANCE_NATIVE_AUDIO_PROVIDER = "seedance" as const;
export const SEEDANCE_NATIVE_AUDIO_MODEL =
  "dreamina-seedance-2-0-260128" as const;
export const SEEDANCE_NATIVE_AUDIO_API =
  "POST /api/v3/contents/generations/tasks" as const;
export const SEEDANCE_NATIVE_AUDIO_REQUEST_PARAMETER =
  "generate_audio=true" as const;
export const SEEDANCE_NATIVE_AUDIO_OFFICIAL_DOCUMENTATION = [
  "https://docs.byteplus.com/en/docs/ModelArk/2298881",
  "https://docs.byteplus.com/en/docs/ModelArk/2291680",
  "https://docs.byteplus.com/docs/ModelArk/1099320",
] as const;

export const SEEDANCE_NATIVE_AUDIO_API_AVAILABLE = true as const;
export const SEEDANCE_NATIVE_DIALOGUE_API_AVAILABLE = true as const;
export const SEEDANCE_REFERENCE_IMAGE_WITH_AUDIO_AVAILABLE = true as const;
export const SEEDANCE_NATIVE_AUDIO_MIN_DURATION_SEC = 4 as const;
export const SEEDANCE_NATIVE_AUDIO_MAX_DURATION_SEC = 15 as const;
export const SEEDANCE_NATIVE_AUDIO_OUTPUT_CONTAINER = "video/mp4" as const;
export const SEEDANCE_NATIVE_AUDIO_PRICING_AUTHORITY =
  "EXISTING_MODELARK_COMPLETION_TOKEN_PRICING" as const;
export const SEEDANCE_NATIVE_AUDIO_PRE_EXECUTION_COST =
  "UNKNOWN_UNTIL_PROVIDER_USAGE" as const;

export const SEEDANCE_NATIVE_AUDIO_CAPABILITY =
  "API_VERIFIED_REAL_OUTPUT_CERTIFICATION_PENDING" as const;
export const SEEDANCE_NATIVE_DIALOGUE_CAPABILITY =
  "API_VERIFIED_REAL_OUTPUT_CERTIFICATION_PENDING" as const;
export const VISIBLE_CHARACTER_NATIVE_DIALOGUE =
  "HUMAN_REVIEW_REQUIRED" as const;
export const NATIVE_AV_REQUEST_CONTRACT =
  "PROVIDER_FREE_CERTIFIED_REAL_PROVIDER_PENDING" as const;
export const NATIVE_AUDIO_RESULT_VALIDATION =
  "PROVIDER_FREE_CERTIFIED_REAL_PROVIDER_PENDING" as const;
export const SG_MY_LOCALE_REQUEST_AUTHORITY =
  "PROVIDER_FREE_CERTIFIED_REAL_PROVIDER_PENDING" as const;
export const SG_MY_NATIVE_DIALOGUE_NATURALNESS =
  "HUMAN_REVIEW_REQUIRED" as const;
export const DETACHED_TTS_REQUIRED_FOR_VISIBLE_DIALOGUE = false as const;
export const CHARACTER_DIALOGUE_PERFORMANCE_GATE =
  "HUMAN_REVIEW_REQUIRED" as const;
export const TAPAO_JOM_EPISODE = "NOT_RUN_IN_THIS_TICKET" as const;

export const AI_STORY_NATIVE_AV_MODES = [
  "VIDEO_ONLY",
  "NATIVE_AUDIO_VIDEO",
] as const;
export const AI_STORY_NATIVE_DIALOGUE_FAILURE_CODES = [
  "NATIVE_AUDIO_MODEL_UNSUPPORTED",
  "NATIVE_AUDIO_CAPABILITY_DISABLED",
  "NATIVE_DIALOGUE_AUTHORITY_INVALID",
  "NATIVE_DIALOGUE_SCRIPT_MISMATCH",
  "NATIVE_DIALOGUE_CHARACTER_MISMATCH",
  "NATIVE_DIALOGUE_DETACHED_TTS_FORBIDDEN",
  "NATIVE_AV_VIDEO_STREAM_MISSING",
  "NATIVE_AV_AUDIO_STREAM_MISSING",
  "NATIVE_AV_DURATION_INVALID",
  "NATIVE_AV_DURATION_MISMATCH",
  "NATIVE_AV_DECODE_FAILED",
  "NATIVE_AV_CONTENT_HASH_MISMATCH",
  "NATIVE_DIALOGUE_ASSEMBLY_AUDIO_STRIPPED",
  "NATIVE_DIALOGUE_TRIM_DESYNCHRONIZED",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(5000);

export const AiStoryNativeDialogueFailureCodeSchema = z.enum(
  AI_STORY_NATIVE_DIALOGUE_FAILURE_CODES
);
export type AiStoryNativeDialogueFailureCode = z.infer<
  typeof AiStoryNativeDialogueFailureCodeSchema
>;

export const AiStorySeedanceNativeAudioCapabilitySchema = z
  .object({
    capabilityVersion: z.literal(
      AI_STORY_SEEDANCE_NATIVE_AUDIO_CAPABILITY_VERSION
    ),
    providerId: z.literal(SEEDANCE_NATIVE_AUDIO_PROVIDER),
    modelId: z.literal(SEEDANCE_NATIVE_AUDIO_MODEL),
    endpoint: z.literal(SEEDANCE_NATIVE_AUDIO_API),
    region: z.literal("ap-southeast"),
    requestParameter: z.literal(SEEDANCE_NATIVE_AUDIO_REQUEST_PARAMETER),
    nativeAudioSupport: z.literal(true),
    nativeDialogueSupport: z.literal(true),
    visibleCharacterDialogueSupport: z.literal(true),
    referenceImageWithAudioSupport: z.literal(true),
    dialogueLipSyncSupport: z.literal("HUMAN_REVIEW_REQUIRED"),
    localeRequestSupport: z.array(z.enum(AI_STORY_AUDIO_LOCALES)).min(1),
    localeNaturalnessCertification: z.literal("HUMAN_REVIEW_REQUIRED"),
    codeSwitchBehavior: z.literal("UNVERIFIED"),
    minDurationSec: z.literal(SEEDANCE_NATIVE_AUDIO_MIN_DURATION_SEC),
    maxDurationSec: z.literal(SEEDANCE_NATIVE_AUDIO_MAX_DURATION_SEC),
    outputContainer: z.literal(SEEDANCE_NATIVE_AUDIO_OUTPUT_CONTAINER),
    officialDocumentation: z
      .array(z.string().url())
      .length(SEEDANCE_NATIVE_AUDIO_OFFICIAL_DOCUMENTATION.length),
    accessRestrictions: z
      .array(Text)
      .min(1),
    realProviderCertification: z.enum([
      "NOT_RUN",
      "TECHNICAL_PASS_HUMAN_REVIEW_REQUIRED",
      "PASS",
      "FAIL",
    ]),
  })
  .strict();
export type AiStorySeedanceNativeAudioCapability = z.infer<
  typeof AiStorySeedanceNativeAudioCapabilitySchema
>;

export const AiStoryCharacterDialoguePerformanceAuthoritySchema = z
  .object({
    dialogueAuthorityId: Id,
    contractVersion: z.literal(AI_STORY_NATIVE_DIALOGUE_CONTRACT_VERSION),
    storyId: Id,
    storyVersionId: Id,
    scriptVersionId: Id,
    scriptFingerprint: Hash,
    scriptSceneId: Id,
    dialogueEntryId: Id,
    generationUnitId: Id,
    directorShotId: Id,
    characterId: Id,
    exactText: Text,
    primaryLocale: z.enum(AI_STORY_AUDIO_LOCALES),
    secondaryLocales: z.array(z.enum(AI_STORY_AUDIO_LOCALES)),
    codeSwitchPolicy: AiStoryCodeSwitchPolicySchema,
    deliveryStyle: z.enum(AI_STORY_DELIVERY_STYLES),
    performanceIntent: Text,
    emotionIntent: Text,
    speechIntensity: z.enum(["SOFT", "NATURAL", "EMPHATIC"]),
    paceIntent: z.enum(["SLOW", "MEASURED", "NATURAL", "BRISK"]),
    onScreenSpeaker: z.literal(true),
    nativeAvRequired: z.literal(true),
    detachedTtsPermitted: z.literal(false),
    mustPreserve: z.array(Text),
    mustAvoid: z.array(Text),
    dialogueFingerprint: Hash,
  })
  .strict()
  .superRefine((value, ctx) => {
    const locales = new Set([
      value.primaryLocale,
      ...value.secondaryLocales,
    ]);
    if (
      value.codeSwitchPolicy.mode === "DISABLED" &&
      value.secondaryLocales.length > 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Disabled code-switch authority cannot include secondary locales",
      });
    }
    if (
      value.codeSwitchPolicy.mode !== "DISABLED" &&
      (value.secondaryLocales.length === 0 ||
        value.codeSwitchPolicy.allowedLocales.some(
          (locale) => !locales.has(locale)
        ))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Code-switch authority must bind only the exact primary/secondary locales",
      });
    }
  });
export type AiStoryCharacterDialoguePerformanceAuthority = z.infer<
  typeof AiStoryCharacterDialoguePerformanceAuthoritySchema
>;

export const AiStoryNativeAvRequestAuthoritySchema = z
  .object({
    audioMode: z.literal("NATIVE_AV"),
    dialogueAuthority:
      AiStoryCharacterDialoguePerformanceAuthoritySchema,
    characterPerformanceRequired: z.literal(true),
    exactDialoguePreservationRequired: z.literal(true),
    visibleSpeechRequired: z.literal(true),
    sourceAudioPolicy: z.literal("PRESERVE_SYNCHRONIZED_SOURCE_AUDIO"),
  })
  .strict();
export type AiStoryNativeAvRequestAuthority = z.infer<
  typeof AiStoryNativeAvRequestAuthoritySchema
>;

const HumanReviewResultSchema = z.enum([
  "PASS",
  "FAIL",
  "HUMAN_REVIEW_REQUIRED",
  "NOT_RUN",
]);

export const AiStoryNativeAvHumanPerformanceReviewSchema = z
  .object({
    dialogueIsSpokenNotRead: HumanReviewResultSchema,
    lipSync: HumanReviewResultSchema,
    facialPerformance: HumanReviewResultSchema,
    bodyPerformance: HumanReviewResultSchema,
    conversationalTiming: HumanReviewResultSchema,
    emotion: HumanReviewResultSchema,
    phraseEmphasis: HumanReviewResultSchema,
    microPauses: HumanReviewResultSchema,
    speechActionCoordination: HumanReviewResultSchema,
    codeSwitchContinuity: HumanReviewResultSchema,
  })
  .strict();

export const AiStoryNativeAvResultEvidenceSchema = z
  .object({
    resultEvidenceId: Id,
    contractVersion: z.literal(AI_STORY_NATIVE_AV_RESULT_CONTRACT_VERSION),
    providerId: z.literal(SEEDANCE_NATIVE_AUDIO_PROVIDER),
    modelId: z.literal(SEEDANCE_NATIVE_AUDIO_MODEL),
    providerTaskId: Text,
    requestFingerprint: Hash,
    dialogueAuthorityId: Id,
    mediaContentHash: Hash,
    mediaType: z.literal("video/mp4"),
    byteSize: z.number().int().positive(),
    videoCodec: Text,
    audioCodec: Text,
    videoDurationMs: z.number().int().positive(),
    audioDurationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
    sampleRate: z.number().int().positive(),
    channelCount: z.number().int().positive(),
    decodable: z.literal(true),
    durationToleranceMs: z.number().int().min(0).max(250),
    technicalNativeAudio: z.literal("PASS"),
    humanPerformanceReview: AiStoryNativeAvHumanPerformanceReviewSchema,
    inspectedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      Math.abs(value.videoDurationMs - value.audioDurationMs) >
      value.durationToleranceMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Native audiovisual stream durations are incompatible",
      });
    }
  });
export type AiStoryNativeAvResultEvidence = z.infer<
  typeof AiStoryNativeAvResultEvidenceSchema
>;

export const AiStoryCharacterDialoguePerformanceGateResultSchema = z
  .object({
    technicalNativeAudio: z.enum(["PASS", "FAIL"]),
    lipSync: z.enum(["PASS", "FAIL", "HUMAN_REVIEW_REQUIRED"]),
    humanConversationalDelivery: z.enum([
      "PASS",
      "FAIL",
      "HUMAN_REVIEW_REQUIRED",
    ]),
    emotionalCharacterPerformance: z.enum([
      "PASS",
      "FAIL",
      "HUMAN_REVIEW_REQUIRED",
    ]),
  })
  .strict();

function aggregateHumanReview(
  values: readonly z.infer<typeof HumanReviewResultSchema>[]
): "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED" {
  if (values.includes("FAIL")) return "FAIL";
  if (values.length > 0 && values.every((value) => value === "PASS")) {
    return "PASS";
  }
  return "HUMAN_REVIEW_REQUIRED";
}

export function evaluateCharacterDialoguePerformanceGate(
  evidence: AiStoryNativeAvResultEvidence
): z.infer<typeof AiStoryCharacterDialoguePerformanceGateResultSchema> {
  const review = evidence.humanPerformanceReview;
  return AiStoryCharacterDialoguePerformanceGateResultSchema.parse({
    technicalNativeAudio:
      evidence.technicalNativeAudio === "PASS" ? "PASS" : "FAIL",
    lipSync:
      review.lipSync === "PASS" || review.lipSync === "FAIL"
        ? review.lipSync
        : "HUMAN_REVIEW_REQUIRED",
    humanConversationalDelivery: aggregateHumanReview([
      review.dialogueIsSpokenNotRead,
      review.conversationalTiming,
      review.phraseEmphasis,
      review.microPauses,
    ]),
    emotionalCharacterPerformance: aggregateHumanReview([
      review.emotion,
      review.facialPerformance,
      review.bodyPerformance,
      review.speechActionCoordination,
    ]),
  });
}
