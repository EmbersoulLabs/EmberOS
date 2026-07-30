/**
 * AI Story Sprint 3 — Execution Engine domain contracts (video only).
 * Planning schemas remain in ai-story.ts; this module owns execution only.
 */
import { z } from "zod";

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
