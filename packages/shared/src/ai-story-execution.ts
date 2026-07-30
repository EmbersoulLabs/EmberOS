/**
 * AI Story Sprint 3 — Execution Engine domain contracts.
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
  preferredCapabilityId: z.string(),
  risks: z.array(z.string()).default([]),
  targetOutputCount: z.number().int().positive(),
  mediaKind: z.enum(["video", "image"]),
});

export type GenerateReviewEstimate = z.infer<typeof GenerateReviewEstimateSchema>;

export const PromptBuilderShotPromptSchema = z.object({
  shotId: z.string(),
  sceneId: z.string(),
  order: z.number().int().nonnegative(),
  prompt: z.string().min(1),
  negativePrompt: z.string().default(""),
  durationSec: z.number().positive(),
  camera: z.object({
    type: z.string(),
    movement: z.string(),
    composition: z.string(),
    framing: z.string(),
    lens: z.string().default(""),
  }),
  continuityNotes: z.string().default(""),
});

export type PromptBuilderShotPrompt = z.infer<typeof PromptBuilderShotPromptSchema>;

export const PromptBuilderPackageSchema = z.object({
  storyId: z.string().uuid(),
  animationPackageId: z.string().uuid(),
  mediaKind: z.enum(["video", "image"]),
  capabilityId: z.string(),
  outputBriefs: z.array(
    z.object({
      outputIndex: z.number().int().nonnegative(),
      title: z.string(),
      hookType: z.string(),
      qualityScore: z.number().min(0).max(1),
      shotPrompts: z.array(PromptBuilderShotPromptSchema).min(1),
      caption: z.string().default(""),
      hashtags: z.array(z.string()).default([]),
      metadata: z.record(z.unknown()).default({}),
    })
  ),
  builtAt: z.string().datetime(),
});

export type PromptBuilderPackage = z.infer<typeof PromptBuilderPackageSchema>;

export const MarketingOutputArtifactSchema = z.object({
  id: z.string().uuid(),
  executionJobId: z.string().uuid(),
  creativeId: z.string().uuid().optional(),
  mediaKind: z.enum(["video", "image"]),
  status: z.enum(["draft", "pending_review", "approved", "rejected", "failed"]),
  title: z.string(),
  storagePath: z.string().optional(),
  thumbnailPath: z.string().optional(),
  caption: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  subtitlePath: z.string().optional(),
  prompt: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
  providerId: z.string().optional(),
  qualityScore: z.number().min(0).max(1).optional(),
});

export type MarketingOutputArtifact = z.infer<typeof MarketingOutputArtifactSchema>;

/** Capability IDs used by the Execution Engine router (UI must not hardcode providers). */
export const EXECUTION_CAPABILITY_IDS = {
  ANIMATION_VIDEO: "animation-video-generation",
  MARKETING_IMAGE: "marketing-image-generation",
  JSON_GENERATION: "json-generation",
} as const;
