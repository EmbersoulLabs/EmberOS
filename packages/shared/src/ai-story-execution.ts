/**
 * AI Story Sprint 3 — frozen execution contracts (video only).
 *
 * Canonical ownership is Story → Scene → Shot. A Scene is the provider
 * execution unit; a Story Video is a distinct final result. Marketing Output
 * quantity is intentionally absent from the frozen contracts.
 *
 * Planning schemas remain in ai-story.ts; this module owns execution contracts
 * only and does not implement persistence, routing, provider calls, review,
 * retries, assembly, or export.
 */
import { z } from "zod";

export const AI_STORY_EXECUTION_CONTRACT_VERSION = "1" as const;

const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = NonEmptyTextSchema;
const ImmutableReferenceSchema = z.object({
  uri: NonEmptyTextSchema,
  contentHash: IntegrityHashSchema,
  mediaType: NonEmptyTextSchema,
});

/** Immutable Story Version used to derive an Animation Package and Scene plan. */
export const AiStoryFrozenVersionReferenceSchema = z.object({
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  frozenAt: z.string().datetime(),
  integrityHash: IntegrityHashSchema,
});

export type AiStoryFrozenVersionReference = z.infer<
  typeof AiStoryFrozenVersionReferenceSchema
>;

/** Immutable Animation Package identity compiled from one frozen Story Version. */
export const AiStoryAnimationPackageExecutionReferenceSchema = z.object({
  animationPackageId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  sceneCount: z.number().int().positive(),
  integrityHash: IntegrityHashSchema,
});

export type AiStoryAnimationPackageExecutionReference = z.infer<
  typeof AiStoryAnimationPackageExecutionReferenceSchema
>;

/** Ordered Shot reference inside exactly one Scene execution unit. */
export const AiStorySceneShotReferenceSchema = z.object({
  shotId: NonEmptyTextSchema,
  sceneId: NonEmptyTextSchema,
  order: z.number().int().nonnegative(),
  durationMs: z.number().int().positive(),
  integrityHash: IntegrityHashSchema,
});

export type AiStorySceneShotReference = z.infer<
  typeof AiStorySceneShotReferenceSchema
>;

/**
 * Stable cross-boundary identity for one Scene execution.
 *
 * `sceneExecutionId` and `idempotencyKey` must remain stable across equivalent
 * scheduling attempts. Provider attempt identity is deliberately separate.
 */
export const AiStorySceneExecutionIdentitySchema = z.object({
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  sceneExecutionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  campaignId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  idempotencyKey: NonEmptyTextSchema,
  deterministicFingerprint: IntegrityHashSchema,
});

export type AiStorySceneExecutionIdentity = z.infer<
  typeof AiStorySceneExecutionIdentitySchema
>;

export const AI_STORY_SCENE_EXECUTION_STATUSES = [
  "PLANNED",
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
] as const;

export const AiStorySceneExecutionStatusSchema = z.enum(
  AI_STORY_SCENE_EXECUTION_STATUSES
);

export type AiStorySceneExecutionStatus = z.infer<
  typeof AiStorySceneExecutionStatusSchema
>;

/**
 * Provider-independent, immutable execution plan for exactly one Scene.
 * Prompt text and provider-specific request fields are not canonical Story data.
 */
export const AiStorySceneExecutionPlanSchema = z.object({
  identity: AiStorySceneExecutionIdentitySchema,
  frozenStoryVersion: AiStoryFrozenVersionReferenceSchema,
  animationPackage: AiStoryAnimationPackageExecutionReferenceSchema,
  shotReferences: z.array(AiStorySceneShotReferenceSchema).min(1),
  referencedAssetIds: z.array(z.string().uuid()).default([]),
  normalizedPayloadReference: ImmutableReferenceSchema,
  plannedDurationMs: z.number().int().positive(),
  compiledAt: z.string().datetime(),
  compilationHash: IntegrityHashSchema,
});

export type AiStorySceneExecutionPlan = z.infer<
  typeof AiStorySceneExecutionPlanSchema
>;

/**
 * Phase 1 name for the frozen Scene execution plan.
 * Alias only — same schema as AiStorySceneExecutionPlan (Phase 0).
 */
export const AiStorySceneExecutionIntentSchema = AiStorySceneExecutionPlanSchema;
export type AiStorySceneExecutionIntent = AiStorySceneExecutionPlan;

/** Ordered character continuity references preserved on a Scene Intent (IDs only). */
export const AiStorySceneCharacterReferenceSchema = z.object({
  characterId: NonEmptyTextSchema,
  name: NonEmptyTextSchema,
  integrityHash: IntegrityHashSchema,
});

export type AiStorySceneCharacterReference = z.infer<
  typeof AiStorySceneCharacterReferenceSchema
>;

/**
 * Provider-neutral compiled instruction snapshot for one Scene.
 * Derived from the Animation Package; never rewritten by QC or providers.
 * Not a Canonical Provider Request.
 */
export const AiStorySceneCompiledInstructionsSchema = z.object({
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  capabilityId: z.literal("animation-video-generation"),
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  purpose: NonEmptyTextSchema,
  transition: z.string().default(""),
  continuityNotes: z.string().default(""),
  beatIds: z.array(NonEmptyTextSchema).default([]),
  durationMs: z.number().int().positive(),
  shots: z
    .array(
      z.object({
        shotId: NonEmptyTextSchema,
        order: z.number().int().nonnegative(),
        durationMs: z.number().int().positive(),
        cameraType: NonEmptyTextSchema,
        cameraMovement: NonEmptyTextSchema,
        composition: NonEmptyTextSchema,
        framing: NonEmptyTextSchema,
        lensSuggestion: z.string().default(""),
        focus: NonEmptyTextSchema,
        emotion: NonEmptyTextSchema,
        information: NonEmptyTextSchema,
      })
    )
    .min(1),
  characterReferences: z.array(AiStorySceneCharacterReferenceSchema).default([]),
  referencedAssetIds: z.array(z.string().uuid()).default([]),
  worldContinuity: z.record(z.unknown()).default({}),
  productIdentityConstraints: z.array(NonEmptyTextSchema).min(1),
});

export type AiStorySceneCompiledInstructions = z.infer<
  typeof AiStorySceneCompiledInstructionsSchema
>;

/** Canonical Story-level plan containing ordered Scene execution identities. */
export const AiStoryExecutionPlanSchema = z.object({
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  storyExecutionId: z.string().uuid(),
  frozenStoryVersion: AiStoryFrozenVersionReferenceSchema,
  animationPackage: AiStoryAnimationPackageExecutionReferenceSchema,
  sceneExecutions: z.array(AiStorySceneExecutionIdentitySchema).min(1),
  compilationHash: IntegrityHashSchema,
  compiledAt: z.string().datetime(),
});

export type AiStoryExecutionPlan = z.infer<typeof AiStoryExecutionPlanSchema>;

/** Immutable identity of one provider attempt for one Scene execution. */
export const AiStorySceneExecutionAttemptSchema = z.object({
  attemptId: NonEmptyTextSchema,
  sceneExecutionId: z.string().uuid(),
  attemptNumber: z.number().int().nonnegative(),
  providerExecutionId: NonEmptyTextSchema.optional(),
  status: AiStorySceneExecutionStatusSchema,
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  requestHash: IntegrityHashSchema,
  responseHash: IntegrityHashSchema.optional(),
});

export type AiStorySceneExecutionAttempt = z.infer<
  typeof AiStorySceneExecutionAttemptSchema
>;

/** Immutable generated video result belonging to exactly one Scene attempt. */
export const AiStorySceneVideoResultSchema = z.object({
  sceneResultId: z.string().uuid(),
  sceneExecutionId: z.string().uuid(),
  attemptId: NonEmptyTextSchema,
  providerExecutionId: NonEmptyTextSchema,
  sceneId: NonEmptyTextSchema,
  sceneOrder: z.number().int().nonnegative(),
  videoReference: ImmutableReferenceSchema,
  durationMs: z.number().int().positive(),
  acceptedAt: z.string().datetime(),
  integrityHash: IntegrityHashSchema,
});

export type AiStorySceneVideoResult = z.infer<
  typeof AiStorySceneVideoResultSchema
>;

export const AI_STORY_SCENE_REVIEW_DECISIONS = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

export const AiStorySceneReviewDecisionSchema = z.enum(
  AI_STORY_SCENE_REVIEW_DECISIONS
);

export type AiStorySceneReviewDecision = z.infer<
  typeof AiStorySceneReviewDecisionSchema
>;

/** Review fact for one immutable Scene video result. */
export const AiStorySceneReviewSchema = z.object({
  sceneReviewId: z.string().uuid(),
  sceneResultId: z.string().uuid(),
  decision: AiStorySceneReviewDecisionSchema,
  reviewedBy: z.string().uuid().optional(),
  reviewedAt: z.string().datetime().optional(),
});

export type AiStorySceneReview = z.infer<typeof AiStorySceneReviewSchema>;

/**
 * Canonical final Story video result. It is distinct from Scene results and
 * from Marketing Outputs. Assembly behavior is intentionally not defined here.
 */
export const AiStoryVideoResultSchema = z.object({
  storyVideoResultId: z.string().uuid(),
  storyExecutionId: z.string().uuid(),
  storyId: z.string().uuid(),
  storyVersionId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  orderedSceneResultIds: z.array(z.string().uuid()).min(1),
  videoReference: ImmutableReferenceSchema,
  durationMs: z.number().int().positive(),
  createdAt: z.string().datetime(),
  integrityHash: IntegrityHashSchema,
});

export type AiStoryVideoResult = z.infer<typeof AiStoryVideoResultSchema>;

/** Scene-based Generate Review contract; no Marketing output quantity exists. */
export const AiStoryExecutionReviewEstimateSchema = z.object({
  storySummary: z.string(),
  aiSummary: z.string(),
  requiredSceneCount: z.number().int().positive(),
  estimatedProviderExecutions: z.number().int().positive(),
  estimatedCredits: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  estimatedDurationSec: z.number().nonnegative(),
  preferredCapabilityId: z.literal("animation-video-generation"),
  risks: z.array(z.string()).default([]),
  referencedAssetIds: z.array(z.string().uuid()).default([]),
});

export type AiStoryExecutionReviewEstimate = z.infer<
  typeof AiStoryExecutionReviewEstimateSchema
>;

/** Stable machine-readable AI QC finding codes (Phase 1). */
export const AI_STORY_AI_QC_ERROR_CODES = [
  "STORY_VERSION_MISSING",
  "STORY_VERSION_NOT_FROZEN",
  "ANIMATION_PACKAGE_MISSING",
  "ANIMATION_PACKAGE_NOT_APPROVED",
  "ANIMATION_PACKAGE_STORY_MISMATCH",
  "SCENE_NOT_IN_PACKAGE",
  "SCENE_ORDER_INVALID",
  "SHOT_MISSING",
  "SHOT_ORDER_INVALID",
  "SCENE_DURATION_INVALID",
  "SHOT_DURATION_INCONSISTENT",
  "CONTINUITY_CONTEXT_MISSING",
  "COMPILED_INSTRUCTIONS_EMPTY",
  "PROMPT_CONTRACT_INVALID",
  "CAPABILITY_INVALID",
  "FORBIDDEN_MARKETING_INSTRUCTION",
  "FORBIDDEN_IMAGE_GENERATION_INSTRUCTION",
  "MISSING_CAMPAIGN_ASSET",
  "ASSET_WORKSPACE_MISMATCH",
  "ASSET_CAMPAIGN_UNAUTHORIZED",
  "PRODUCT_IDENTITY_REFERENCE_MISSING",
  "IDENTITY_UNSTABLE",
  "DETERMINISM_HASH_MISMATCH",
  "EXECUTION_PARAMETER_INVALID",
] as const;

export type AiStoryAiQcErrorCode = (typeof AI_STORY_AI_QC_ERROR_CODES)[number];

export const AiStoryAiQcSeveritySchema = z.enum(["blocking", "warning"]);
export type AiStoryAiQcSeverity = z.infer<typeof AiStoryAiQcSeveritySchema>;

export const AiStoryAiQcFindingSchema = z.object({
  code: z.enum(AI_STORY_AI_QC_ERROR_CODES),
  path: NonEmptyTextSchema,
  message: NonEmptyTextSchema,
  severity: AiStoryAiQcSeveritySchema,
});

export type AiStoryAiQcFinding = z.infer<typeof AiStoryAiQcFindingSchema>;

export const AiStoryAiQcStatusSchema = z.enum(["passed", "failed", "warning"]);
export type AiStoryAiQcStatus = z.infer<typeof AiStoryAiQcStatusSchema>;

/**
 * Provider-neutral AI QC result for one Scene Execution Intent.
 * Pure validation artifact — never mutates the Intent.
 */
export const AiStoryAiQcResultSchema = z.object({
  status: AiStoryAiQcStatusSchema,
  intentId: z.string().uuid(),
  sceneId: NonEmptyTextSchema,
  validatedAt: z.string().datetime(),
  contractVersion: z.literal(AI_STORY_EXECUTION_CONTRACT_VERSION),
  errors: z.array(AiStoryAiQcFindingSchema).default([]),
});

export type AiStoryAiQcResult = z.infer<typeof AiStoryAiQcResultSchema>;

/** Aggregate QC + estimate payload returned by Generate Review (Phase 1). */
export const AiStoryGenerateReviewResultSchema = z.object({
  estimate: AiStoryExecutionReviewEstimateSchema,
  storyExecutionPlan: AiStoryExecutionPlanSchema,
  sceneIntents: z.array(AiStorySceneExecutionIntentSchema).min(1),
  qcResults: z.array(AiStoryAiQcResultSchema).min(1),
  overallQcStatus: AiStoryAiQcStatusSchema,
  executionAllowed: z.boolean(),
  phase: z.literal("phase_1_qc_only"),
});

export type AiStoryGenerateReviewResult = z.infer<
  typeof AiStoryGenerateReviewResultSchema
>;

/*
 * Legacy Sprint 3 compatibility contracts below remain unchanged so Phase 0
 * does not alter runtime behavior. They are not the frozen canonical model and
 * must not be used by new AI Story execution code.
 */

export const AI_STORY_EXECUTION_STATUSES = [
  "queued",
  "preparing",
  "running",
  "collecting_assets",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AiStoryExecutionStatus = (typeof AI_STORY_EXECUTION_STATUSES)[number];

export const AI_STORY_EXECUTION_ALLOWED_TRANSITIONS: Record<
  AiStoryExecutionStatus,
  readonly AiStoryExecutionStatus[]
> = {
  queued: ["preparing", "cancelled", "failed"],
  preparing: ["running", "cancelled", "failed"],
  running: ["collecting_assets", "cancelled", "failed"],
  collecting_assets: ["completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
};

export function assertAiStoryExecutionTransition(
  from: AiStoryExecutionStatus,
  to: AiStoryExecutionStatus
): void {
  if (from === to) return;
  const allowed = AI_STORY_EXECUTION_ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid AI Story execution transition: ${from} → ${to}`);
  }
}

/** @deprecated Legacy output-based runtime compatibility contract. */
export const AiStoryExecutionProgressSchema = z.object({
  phase: z.enum(AI_STORY_EXECUTION_STATUSES),
  percent: z.number().min(0).max(100).default(0),
  message: z.string().default(""),
  completedOutputs: z.number().int().nonnegative().default(0),
  targetOutputs: z.number().int().positive().default(5),
  providerAttempts: z.number().int().nonnegative().default(0),
  lastError: z.string().optional(),
});

export type AiStoryExecutionProgress = z.infer<typeof AiStoryExecutionProgressSchema>;

/** @deprecated Legacy Marketing-output-based review compatibility contract. */
export const GenerateReviewEstimateSchema = z.object({
  storySummary: z.string(),
  aiSummary: z.string(),
  estimatedCredits: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  estimatedDurationSec: z.number().nonnegative(),
  preferredCapabilityId: z.literal("animation-video-generation"),
  risks: z.array(z.string()).default([]),
  targetOutputCount: z.number().int().positive(),
  referencedAssetIds: z.array(z.string().uuid()).default([]),
});

export type GenerateReviewEstimate = z.infer<typeof GenerateReviewEstimateSchema>;

export const PRODUCT_IDENTITY_CONSTRAINTS = [
  "Preserve product shape exactly as in the referenced Campaign Asset.",
  "Preserve product colour, packaging, logo, labels, and visible text.",
  "Preserve proportions and uploaded asset identity.",
  "Do not recreate, redesign, or invent a different product.",
] as const;

export const ExecutionCompiledShotSchema = z.object({
  shotId: z.string(),
  sceneId: z.string(),
  beatIds: z.array(z.string()).default([]),
  order: z.number().int().nonnegative(),
  durationSec: z.number().positive(),
  cameraType: z.string(),
  cameraMovement: z.string(),
  composition: z.string(),
  framing: z.string(),
  lensSuggestion: z.string().default(""),
  focus: z.string(),
  emotion: z.string(),
  information: z.string(),
  transition: z.string().default(""),
  continuityNotes: z.string().default(""),
  subjectAssetIds: z.array(z.string().uuid()).default([]),
  promptSection: z.string().min(1),
});

export type ExecutionCompiledShot = z.infer<typeof ExecutionCompiledShotSchema>;

/** @deprecated Legacy complete-Story output manifest compatibility contract. */
export const ExecutionManifestSchema = z.object({
  storyId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  capabilityId: z.literal("animation-video-generation"),
  referencedAssetIds: z.array(z.string().uuid()),
  identityConstraints: z.array(z.string()).min(1),
  characterContinuity: z.array(z.record(z.unknown())).default([]),
  worldContinuity: z.record(z.unknown()).default({}),
  scenes: z.array(
    z.object({
      sceneId: z.string(),
      beatIds: z.array(z.string()),
      order: z.number().int().nonnegative(),
      purpose: z.string(),
      durationSec: z.number().positive(),
      transition: z.string().default(""),
      shotIds: z.array(z.string()),
    })
  ),
  shots: z.array(ExecutionCompiledShotSchema).min(1),
  /** Deterministic ordered provider request body sections (one final video output). */
  compiledProviderRequest: z.object({
    prompt: z.string().min(1),
    negativePrompt: z.string().default(""),
    durationSec: z.number().positive(),
    aspectRatio: z.string().default("9:16"),
    assetReferences: z.array(
      z.object({
        assetId: z.string().uuid(),
        storagePath: z.string(),
        role: z.string().default("product"),
      })
    ),
    shotMap: z.array(
      z.object({
        shotId: z.string(),
        sceneId: z.string(),
        sectionIndex: z.number().int().nonnegative(),
      })
    ),
  }),
  builtAt: z.string().datetime(),
});

export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;

export const AiStoryExecutionOutputStatusSchema = z.enum([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "failed",
]);

export type AiStoryExecutionOutputStatus = z.infer<
  typeof AiStoryExecutionOutputStatusSchema
>;

/** @deprecated Legacy generic output compatibility contract. */
export const AiStoryExecutionOutputSchema = z.object({
  id: z.string().uuid(),
  executionJobId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  outputType: z.literal("animation_video"),
  providerId: z.string().optional(),
  providerExecutionId: z.string().optional(),
  referencedAssetIds: z.array(z.string().uuid()).default([]),
  generatedVideoAssetId: z.string().uuid().optional(),
  storagePath: z.string().optional(),
  executionManifest: ExecutionManifestSchema.optional(),
  /** DB column `status` — draft | pending_review | approved | rejected | failed */
  status: AiStoryExecutionOutputStatusSchema,
  failureMessage: z.string().optional(),
  creativeId: z.string().uuid().optional(),
  title: z.string(),
  outputIndex: z.number().int().nonnegative().default(0),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  qualityScore: z.number().min(0).max(1).optional(),
});

export type AiStoryExecutionOutput = z.infer<typeof AiStoryExecutionOutputSchema>;

/** Capability IDs used by the AI Story Execution Engine (UI must not hardcode providers). */
export const EXECUTION_CAPABILITY_IDS = {
  ANIMATION_VIDEO: "animation-video-generation",
  JSON_GENERATION: "json-generation",
} as const;
