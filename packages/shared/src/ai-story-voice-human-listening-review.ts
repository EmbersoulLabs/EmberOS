import { z } from "zod";

export const AI_STORY_VOICE_HUMAN_LISTENING_REVIEW_CONTRACT_VERSION =
  "ai-story-voice-human-listening-review.v1" as const;
export const AI_STORY_VOICE_LISTENING_SAMPLE_PLAN_VERSION =
  "ai-story-voice-listening-sample-plan.v1" as const;

export const SG_MY_VOICE_NATURALNESS_CERTIFICATION =
  "PENDING_HUMAN_LISTENING_REVIEW" as const;
export const PAID_TTS_COMMERCIAL_RUNTIME = "BLOCKED" as const;
export const AUTOMATIC_PAID_LISTENING_RETRY = "FORBIDDEN" as const;
export const VOICE_LISTENING_PRODUCTION_MUTATION = false as const;
export const VOICE_LISTENING_VIDEO_PROVIDER_CALLS = 0 as const;

export const AI_STORY_VOICE_REVIEW_DIMENSION_RESULTS = [
  "PASS",
  "WARN",
  "FAIL",
  "NOT_APPLICABLE",
] as const;
export const AI_STORY_VOICE_CERTIFICATION_RESULT_STATES = [
  "CERTIFIED_FOR_SELECTED_LOCALES",
  "PARTIALLY_CERTIFIED",
  "REJECTED_PROVIDER_MODEL",
  "REJECTED_VOICE",
  "REQUIRES_CAPABILITY_MIGRATION",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const NonEmpty = z.string().trim().min(1);
const ReviewResultSchema = z.enum(
  AI_STORY_VOICE_REVIEW_DIMENSION_RESULTS
);

export const AiStoryVoiceListeningLocaleSchema = z.enum([
  "en-SG",
  "en-MY",
  "zh-SG",
  "zh-MY",
  "ms-MY",
  "CODE_SWITCH",
]);

export const AiStoryVoiceCapabilityTupleSchema = z
  .object({
    provider: NonEmpty,
    model: NonEmpty,
    voice: NonEmpty,
    locale: AiStoryVoiceListeningLocaleSchema,
    deliveryStyle: NonEmpty,
    outputFormat: z.enum(["mp3", "wav", "aac", "opus", "flac", "pcm"]),
    generationSettings: z.record(z.union([z.string(), z.number(), z.boolean()])),
    generationSettingsFingerprint: Hash,
    codeSwitchCapabilityStatus: z.enum([
      "NOT_APPLICABLE",
      "UNVERIFIED_FOR_GPT_4O_MINI_TTS",
      "CERTIFIED",
    ]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.locale === "CODE_SWITCH" &&
      value.codeSwitchCapabilityStatus === "NOT_APPLICABLE"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Code-switch tuple requires model-specific capability status",
      });
    }
    if (
      value.locale !== "CODE_SWITCH" &&
      value.codeSwitchCapabilityStatus !== "NOT_APPLICABLE"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Single-locale tuple must mark code-switch capability not applicable",
      });
    }
  });
export type AiStoryVoiceCapabilityTuple = z.infer<
  typeof AiStoryVoiceCapabilityTupleSchema
>;

export const AiStoryVoiceListeningSamplePlanSchema = z
  .object({
    sampleId: Id,
    planVersion: z.literal(AI_STORY_VOICE_LISTENING_SAMPLE_PLAN_VERSION),
    capability: AiStoryVoiceCapabilityTupleSchema,
    exactScriptText: NonEmpty.max(500),
    characterCount: z.number().int().positive(),
    purpose: NonEmpty,
    expectedPaidCallCount: z.union([z.literal(0), z.literal(1)]),
    status: z.enum([
      "PLANNED_AWAITING_AUTHORIZATION",
      "CAPABILITY_BLOCKED",
      "GENERATED_AWAITING_HUMAN_REVIEW",
      "REVIEWED",
    ]),
    blockedReason: z
      .enum(["CODE_SWITCH_PROVIDER_CAPABILITY_UNSUPPORTED"])
      .nullable(),
    requestFingerprint: Hash,
    outputContentHash: Hash.nullable(),
    outputDurationMs: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const actualCharacters = Array.from(value.exactScriptText).length;
    if (actualCharacters !== value.characterCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "characterCount must equal exact Unicode code-point count",
      });
    }
    if (
      value.status === "CAPABILITY_BLOCKED" &&
      value.blockedReason !== "CODE_SWITCH_PROVIDER_CAPABILITY_UNSUPPORTED"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Blocked sample requires an explicit capability reason",
      });
    }
    if (
      (value.status === "CAPABILITY_BLOCKED" &&
        value.expectedPaidCallCount !== 0) ||
      (value.status !== "CAPABILITY_BLOCKED" &&
        value.expectedPaidCallCount !== 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Blocked samples require zero calls; payable samples require one",
      });
    }
    if (value.status !== "CAPABILITY_BLOCKED" && value.blockedReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only blocked samples may contain blockedReason",
      });
    }
    if (
      ["GENERATED_AWAITING_HUMAN_REVIEW", "REVIEWED"].includes(value.status) &&
      (!value.outputContentHash || !value.outputDurationMs)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generated samples require hashed media evidence",
      });
    }
  });
export type AiStoryVoiceListeningSamplePlan = z.infer<
  typeof AiStoryVoiceListeningSamplePlanSchema
>;

export const AiStoryVoiceHumanListeningDimensionsSchema = z
  .object({
    intelligibility: ReviewResultSchema,
    pronunciationAccuracy: ReviewResultSchema,
    naturalness: ReviewResultSchema,
    pacing: ReviewResultSchema,
    emotionalFit: ReviewResultSchema,
    commercialUsability: ReviewResultSchema,
    localeAcceptability: ReviewResultSchema,
    roboticArtifacts: ReviewResultSchema,
    unwantedAccentStylization: ReviewResultSchema,
    codeSwitchQuality: ReviewResultSchema,
  })
  .strict();

export const AiStoryVoiceHumanListeningReviewSchema = z
  .object({
    reviewId: Id,
    contractVersion: z.literal(
      AI_STORY_VOICE_HUMAN_LISTENING_REVIEW_CONTRACT_VERSION
    ),
    sampleId: Id,
    requestFingerprint: Hash,
    outputContentHash: Hash,
    capability: AiStoryVoiceCapabilityTupleSchema,
    reviewerId: Id,
    dimensions: AiStoryVoiceHumanListeningDimensionsSchema,
    conciseFindings: z.array(NonEmpty.max(500)).min(1).max(12),
    decision: z.enum(["PASS", "WARN", "FAIL"]),
    reviewedAt: z.string().datetime(),
    supersedesReviewId: Id.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const dimensionValues = Object.values(value.dimensions);
    if (value.decision === "PASS" && dimensionValues.includes("FAIL")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A review containing a failed dimension cannot PASS",
      });
    }
    if (
      value.capability.locale !== "CODE_SWITCH" &&
      value.dimensions.codeSwitchQuality !== "NOT_APPLICABLE"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Single-locale review must mark codeSwitchQuality NOT_APPLICABLE",
      });
    }
  });
export type AiStoryVoiceHumanListeningReview = z.infer<
  typeof AiStoryVoiceHumanListeningReviewSchema
>;

export const AiStoryVoiceHumanListeningCertificationSchema = z
  .object({
    certificationId: Id,
    contractVersion: z.literal(
      AI_STORY_VOICE_HUMAN_LISTENING_REVIEW_CONTRACT_VERSION
    ),
    provider: NonEmpty,
    model: NonEmpty,
    voice: NonEmpty,
    reviewIds: z.array(Id).min(1),
    localeResults: z
      .object({
        "en-SG": z.enum(["PASS", "WARN", "FAIL", "NOT_REVIEWED"]),
        "en-MY": z.enum(["PASS", "WARN", "FAIL", "NOT_REVIEWED"]),
        "zh-SG": z.enum(["PASS", "WARN", "FAIL", "NOT_REVIEWED"]),
        "zh-MY": z.enum(["PASS", "WARN", "FAIL", "NOT_REVIEWED"]),
        "ms-MY": z.enum(["PASS", "WARN", "FAIL", "NOT_REVIEWED"]),
        CODE_SWITCH: z.enum([
          "PASS",
          "WARN",
          "FAIL",
          "NOT_REVIEWED",
          "CAPABILITY_UNSUPPORTED",
        ]),
      })
      .strict(),
    resultState: z.enum(AI_STORY_VOICE_CERTIFICATION_RESULT_STATES),
    decidedBy: Id,
    decidedAt: z.string().datetime(),
    conciseDecisionRationale: z.array(NonEmpty.max(500)).min(1).max(12),
  })
  .strict();
export type AiStoryVoiceHumanListeningCertification = z.infer<
  typeof AiStoryVoiceHumanListeningCertificationSchema
>;

export const AiStoryVoiceListeningExecutionPreviewSchema = z
  .object({
    provider: NonEmpty,
    model: NonEmpty,
    voice: NonEmpty,
    samples: z.array(AiStoryVoiceListeningSamplePlanSchema).min(1),
    paidSampleCount: z.number().int().nonnegative(),
    totalCharacters: z.number().int().nonnegative(),
    estimatedMaximumCostUsd: z.number().nonnegative(),
    outputFormat: z.enum(["mp3", "wav", "aac", "opus", "flac", "pcm"]),
    productionMutation: z.literal(false),
    commercialReservation: z.literal(false),
    videoProviderCalls: z.literal(0),
    authorizationStatus: z.literal(
      "WAITING_FOR_EXPLICIT_PAID_TTS_AUTHORIZATION"
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payable = value.samples.filter(
      (sample) => sample.status === "PLANNED_AWAITING_AUTHORIZATION"
    );
    if (payable.length !== value.paidSampleCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "paidSampleCount must exclude capability-blocked samples",
      });
    }
    const characters = payable.reduce(
      (total, sample) => total + sample.characterCount,
      0
    );
    if (characters !== value.totalCharacters) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "totalCharacters must equal payable sample characters",
      });
    }
  });
export type AiStoryVoiceListeningExecutionPreview = z.infer<
  typeof AiStoryVoiceListeningExecutionPreviewSchema
>;

export function assertFreshPaidListeningAuthorization(input: {
  authorizationStatus: "WAITING" | "AUTHORIZED";
  authorizedSampleIds: readonly string[];
  requestedSampleId: string;
  attempt: number;
}): void {
  if (
    input.authorizationStatus !== "AUTHORIZED" ||
    !input.authorizedSampleIds.includes(input.requestedSampleId) ||
    input.attempt !== 1
  ) {
    throw new Error("EXPLICIT_PAID_TTS_AUTHORIZATION_REQUIRED");
  }
}
