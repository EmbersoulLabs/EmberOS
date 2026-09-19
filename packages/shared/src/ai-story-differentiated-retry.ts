import { z } from "zod";

export const AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION = "1" as const;
export const AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS = 3 as const;

export const HUMAN_CREATIVE_REJECTION_REASONS = [
  "INSUFFICIENT_SCENE_DIFFERENTIATION",
  "PRODUCT_IDENTITY_DRIFT",
  "COMPOSITION_UNACCEPTABLE",
  "CAMERA_MOTION_UNACCEPTABLE",
  "VISUAL_QUALITY_UNACCEPTABLE",
  "CONTINUITY_UNACCEPTABLE",
  "OTHER_CREATIVE_REASON",
] as const;
export const HumanCreativeRejectionReasonSchema = z.enum(HUMAN_CREATIVE_REJECTION_REASONS);
export type HumanCreativeRejectionReason = z.infer<typeof HumanCreativeRejectionReasonSchema>;

export const RetryEligibilitySchema = z.enum([
  "ELIGIBLE",
  "INELIGIBLE_MAX_ATTEMPTS",
  "INELIGIBLE_TERMINAL_POLICY",
  "INELIGIBLE_AUTHORITY_CONFLICT",
]);
export type RetryEligibility = z.infer<typeof RetryEligibilitySchema>;

const BoundedText = z.string().trim().min(1).max(500);
const Hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const Uuid = z.string().uuid();

export const AI_STORY_RETRY_PROVIDER_MODES = ["REFERENCE_FREE_T2V", "FIRST_FRAME_I2V"] as const;
export const AiStoryRetryProviderModeSchema = z.enum(AI_STORY_RETRY_PROVIDER_MODES);
export type AiStoryRetryProviderMode = z.infer<typeof AiStoryRetryProviderModeSchema>;

export class AiStoryRetryModeAuthorityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryRetryModeAuthorityError";
  }
}

export function deriveAiStoryRetryProviderModeFromFrozenScene(input: {
  readonly generationAuthority?: {
    readonly strategy?: string;
    readonly referenceSource?: string;
  } | null;
}): AiStoryRetryProviderMode {
  const strategy = input.generationAuthority?.strategy;
  const referenceSource = input.generationAuthority?.referenceSource;
  if (strategy === "TEXT_TO_VIDEO" && referenceSource === "REFERENCE_FREE_T2V") {
    return "REFERENCE_FREE_T2V";
  }
  if (
    (strategy === "FIRST_FRAME_IMAGE_TO_VIDEO" || strategy === "PRODUCT_GROUNDED_VIDEO") &&
    referenceSource === "SCENE_EXPLICIT"
  ) {
    return "FIRST_FRAME_I2V";
  }
  throw new AiStoryRetryModeAuthorityError(
    "RETRY_MODE_UNSUPPORTED",
    "Human retry requires an exact frozen Scene generation authority"
  );
}

export function assertRetryProviderModeMatchesFrozenScene(input: {
  readonly retryProviderMode: AiStoryRetryProviderMode;
  readonly generationAuthority?: {
    readonly strategy?: string;
    readonly referenceSource?: string;
  } | null;
}): void {
  const frozen = deriveAiStoryRetryProviderModeFromFrozenScene(input);
  if (frozen !== input.retryProviderMode) {
    throw new AiStoryRetryModeAuthorityError(
      "RETRY_MODE_ESCALATION_DENIED",
      "Retry mode must remain the frozen Scene generation authority"
    );
  }
}

export const SceneRetryCreativeDirectionSchema = z.object({
  visualRole: BoundedText,
  cameraInstruction: BoundedText,
  focusProgression: z.array(BoundedText).min(2).max(5),
  shotEmphasis: BoundedText,
  pacing: BoundedText.optional(),
}).strict();
export type SceneRetryCreativeDirection = z.infer<typeof SceneRetryCreativeDirectionSchema>;

const SceneAttemptInputRevisionBase = {
  retryInputRevisionId: Uuid,
  orgId: Uuid,
  workspaceId: Uuid,
  campaignId: Uuid,
  storyId: Uuid,
  executionPlanId: Uuid,
  sceneExecutionId: Uuid,
  revisionNumber: z.number().int().positive(),
  parentRevisionId: Uuid.nullable(),
  sourceAttemptId: z.string().min(1),
  sourceReviewId: Uuid,
  retryReason: HumanCreativeRejectionReasonSchema,
  creativeDirection: SceneRetryCreativeDirectionSchema,
  canonicalFingerprint: Hash,
  createdBy: Uuid,
  createdAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION),
} as const;

export const SceneAttemptInputRevisionFactSchema = z.discriminatedUnion("providerModeRequirement", [
  z.object({
    ...SceneAttemptInputRevisionBase,
    providerModeRequirement: z.literal("REFERENCE_FREE_T2V"),
    productAssetId: z.null(),
    productAuthorityHash: z.null(),
    visualAuthorityCertificationHash: z.null(),
  }).strict(),
  z.object({
    ...SceneAttemptInputRevisionBase,
    providerModeRequirement: z.literal("FIRST_FRAME_I2V"),
    productAssetId: Uuid,
    productAuthorityHash: Hash,
    visualAuthorityCertificationHash: Hash,
  }).strict(),
]);
export type SceneAttemptInputRevisionFact = z.infer<typeof SceneAttemptInputRevisionFactSchema>;

export const SceneRetryEligibilityFactSchema = z.object({
  retryEligibilityId: Uuid, orgId: Uuid, workspaceId: Uuid, campaignId: Uuid,
  storyId: Uuid, executionPlanId: Uuid, sceneExecutionId: Uuid,
  sourceReviewId: Uuid, sourceAttemptId: z.string().min(1),
  eligibility: RetryEligibilitySchema,
  nextAttemptNumber: z.number().int().positive().nullable(),
  reason: HumanCreativeRejectionReasonSchema,
  canonicalFingerprint: Hash,
  evaluatedAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION),
}).strict();
export type SceneRetryEligibilityFact = z.infer<typeof SceneRetryEligibilityFactSchema>;

export const SceneRetryAuthorizationFactSchema = z.object({
  retryAuthorizationId: Uuid,
  orgId: Uuid, workspaceId: Uuid, campaignId: Uuid,
  storyId: Uuid, executionPlanId: Uuid, sceneExecutionId: Uuid,
  sourceReviewId: Uuid, sourceAttemptId: z.string().min(1),
  authorizedAttemptNumber: z.number().int().min(2).max(AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS),
  authorizedBy: Uuid, authorizedAt: z.string().datetime(),
  reason: HumanCreativeRejectionReasonSchema,
  retryInputRevisionId: Uuid, retryInputFingerprint: Hash,
  status: z.enum(["AUTHORIZED", "CONSUMED"]),
  canonicalFingerprint: Hash,
  contractVersion: z.literal(AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION),
}).strict();
export type SceneRetryAuthorizationFact = z.infer<typeof SceneRetryAuthorizationFactSchema>;

export const RejectGeneratedSceneCreativeCommandSchema = z.object({
  reason: HumanCreativeRejectionReasonSchema,
  note: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.reason === "OTHER_CREATIVE_REASON" && !value.note) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["note"], message: "A bounded note is required" });
  }
});

export const CreateSceneRetryInputRevisionCommandSchema = z.object({
  sourceReviewId: Uuid,
  creativeDirection: SceneRetryCreativeDirectionSchema,
}).strict();

export const AuthorizeSceneRetryCommandSchema = z.object({
  sourceReviewId: Uuid,
  retryInputRevisionId: Uuid,
}).strict();

export function normalizedCreativeDirection(value: SceneRetryCreativeDirection) {
  const parsed = SceneRetryCreativeDirectionSchema.parse(value);
  return {
    visualRole: parsed.visualRole.trim().toUpperCase(),
    cameraInstruction: parsed.cameraInstruction.trim().toUpperCase(),
    focusProgression: parsed.focusProgression.map((part) => part.trim().toUpperCase()),
    shotEmphasis: parsed.shotEmphasis.trim().toUpperCase(),
    ...(parsed.pacing ? { pacing: parsed.pacing.trim().toUpperCase() } : {}),
  };
}
export function isMateriallyDifferentiated(input: {
  source: SceneRetryCreativeDirection;
  candidate: SceneRetryCreativeDirection;
  reason: HumanCreativeRejectionReason;
}): boolean {
  const source = normalizedCreativeDirection(input.source);
  const candidate = normalizedCreativeDirection(input.candidate);
  const changed = [
    source.visualRole !== candidate.visualRole,
    source.cameraInstruction !== candidate.cameraInstruction,
    source.focusProgression.join("→") !== candidate.focusProgression.join("→"),
    source.shotEmphasis !== candidate.shotEmphasis,
  ].filter(Boolean).length;
  return input.reason === "INSUFFICIENT_SCENE_DIFFERENTIATION" ? changed >= 2 : changed >= 1;
}
