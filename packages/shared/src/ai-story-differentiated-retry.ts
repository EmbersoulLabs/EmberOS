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

export const SceneRetryCreativeDirectionSchema = z.object({
  visualRole: BoundedText,
  cameraInstruction: BoundedText,
  focusProgression: z.array(BoundedText).min(2).max(5),
  shotEmphasis: BoundedText,
  pacing: BoundedText.optional(),
}).strict();
export type SceneRetryCreativeDirection = z.infer<typeof SceneRetryCreativeDirectionSchema>;

export const SceneAttemptInputRevisionFactSchema = z.object({
  retryInputRevisionId: z.string().uuid(),
  orgId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  executionPlanId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  parentRevisionId: z.string().uuid().nullable(),
  sourceAttemptId: z.string().min(1),
  sourceReviewId: z.string().uuid(),
  retryReason: HumanCreativeRejectionReasonSchema,
  creativeDirection: SceneRetryCreativeDirectionSchema,
  productAssetId: z.string().uuid(),
  productAuthorityHash: Hash,
  visualAuthorityCertificationHash: Hash,
  providerModeRequirement: z.literal("FIRST_FRAME_I2V"),
  canonicalFingerprint: Hash,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION),
}).strict();
export type SceneAttemptInputRevisionFact = z.infer<typeof SceneAttemptInputRevisionFactSchema>;

export const SceneRetryEligibilityFactSchema = z.object({
  retryEligibilityId: z.string().uuid(),
  orgId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid(),
  storyId: z.string().uuid(), executionPlanId: z.string().uuid(), sceneExecutionId: z.string().uuid(),
  sourceReviewId: z.string().uuid(), sourceAttemptId: z.string().min(1),
  eligibility: RetryEligibilitySchema,
  nextAttemptNumber: z.number().int().positive().nullable(),
  reason: HumanCreativeRejectionReasonSchema,
  canonicalFingerprint: Hash,
  evaluatedAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_DIFFERENTIATED_RETRY_CONTRACT_VERSION),
}).strict();
export type SceneRetryEligibilityFact = z.infer<typeof SceneRetryEligibilityFactSchema>;

export const SceneRetryAuthorizationFactSchema = z.object({
  retryAuthorizationId: z.string().uuid(),
  orgId: z.string().uuid(), workspaceId: z.string().uuid(), campaignId: z.string().uuid(),
  storyId: z.string().uuid(), executionPlanId: z.string().uuid(), sceneExecutionId: z.string().uuid(),
  sourceReviewId: z.string().uuid(), sourceAttemptId: z.string().min(1),
  authorizedAttemptNumber: z.number().int().min(2).max(AI_STORY_MAX_HUMAN_AUTHORIZED_ATTEMPTS),
  authorizedBy: z.string().uuid(), authorizedAt: z.string().datetime(),
  reason: HumanCreativeRejectionReasonSchema,
  retryInputRevisionId: z.string().uuid(), retryInputFingerprint: Hash,
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
  sourceReviewId: z.string().uuid(),
  creativeDirection: SceneRetryCreativeDirectionSchema,
}).strict();

export const AuthorizeSceneRetryCommandSchema = z.object({
  sourceReviewId: z.string().uuid(),
  retryInputRevisionId: z.string().uuid(),
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
