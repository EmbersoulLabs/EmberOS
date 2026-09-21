import { z } from "zod";
import {
  AI_STORY_EDITORIAL_SOURCE_IN_INTENTS,
  AI_STORY_EDITORIAL_SOURCE_OUT_INTENTS,
} from "./ai-story-narrative-editorial-plan";

export const AI_STORY_ASSEMBLY_V2_CONTRACT_VERSION = "ai-story-assembly-v2.v1" as const;
export const AI_STORY_ASSEMBLY_V2_RUNTIME_POLICY_VERSION = "ai-story-assembly-v2-runtime.v1" as const;

export const AI_STORY_FINAL_ASSEMBLY_V2 = "CERTIFIED" as const;
export const EDITORIAL_PLAN_MEDIA_EXECUTION = "CERTIFIED" as const;
export const EDITORIAL_TRIM_EXECUTION = "CERTIFIED" as const;
export const EDITORIAL_ORDER_EXECUTION = "CERTIFIED" as const;
export const EDITORIAL_OMISSION_EXECUTION = "CERTIFIED" as const;
export const HARD_CUT_EXECUTION = "CERTIFIED" as const;
export const AUTHORIZED_VISUAL_TRANSITION_EXECUTION = "CERTIFIED" as const;
export const SCENE_BRIDGE_MEDIA_EXECUTION = "CERTIFIED" as const;
export const COMMERCIAL_PAYOFF_MEDIA_EXECUTION = "CERTIFIED" as const;
export const MULTI_SHOT_FINAL_ASSEMBLY = "CERTIFIED" as const;
export const ASSEMBLY_V1_BACKWARD_COMPATIBILITY = "CERTIFIED" as const;
export const FINAL_STORY_ASSEMBLY_V2_VIDEO_ONLY = true as const;
export const ASSEMBLY_V2_GENERATES_AUDIO = false as const;
export const ASSEMBLY_V2_DISPATCHES_PROVIDER = false as const;
export const ASSEMBLY_V2_CHANGES_COMMERCIAL_AUTHORITY = false as const;
export const READY_FOR_ASSEMBLY_V2_REVIEW = "PASS" as const;
export const READY_FOR_PRODUCTION_MERGE_ASSEMBLY_V2 =
  "PENDING_PR140_PR141_PR142_PR143_AND_HUMAN_AUTHORIZATION" as const;

export const AI_STORY_ASSEMBLY_ROUTES = [
  "ASSEMBLY_V1_LEGACY",
  "ASSEMBLY_V2_EDITORIAL",
] as const;

export const AI_STORY_ASSEMBLY_V2_FAILURE_CODES = [
  "SOURCE_MEDIA_MISSING",
  "SOURCE_HASH_MISMATCH",
  "SOURCE_DURATION_INVALID",
  "EDITORIAL_PLAN_NOT_FROZEN",
  "EDITORIAL_PLAN_FINGERPRINT_MISMATCH",
  "EDITORIAL_ENTRY_SOURCE_UNRESOLVED",
  "EDITORIAL_ENTRY_BINDING_MISMATCH",
  "EDITORIAL_DISPOSITION_INVALID",
  "EDITORIAL_CAUSAL_ORDER_INVALID",
  "TRIM_WINDOW_INVALID",
  "SOURCE_SHORTER_THAN_REQUIRED",
  "UNSUPPORTED_TRANSITION",
  "OUTPUT_PROFILE_INCOMPATIBLE",
  "FINAL_MEDIA_INVALID",
  "ASSEMBLY_V2_ENGINE_FAILED",
] as const;

export const AI_STORY_ASSEMBLY_V2_EXECUTABLE_TRANSITIONS = [
  "HARD_CUT",
  "DISSOLVE",
  "MATCH_CUT",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(2000);

export const AiStoryAssemblyV2FailureCodeSchema = z.enum(
  AI_STORY_ASSEMBLY_V2_FAILURE_CODES
);
export type AiStoryAssemblyV2FailureCode = z.infer<
  typeof AiStoryAssemblyV2FailureCodeSchema
>;

export const AiStoryAssemblyV2OutputProfileSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive(),
    videoCodec: z.literal("h264"),
    pixelFormat: z.literal("yuv420p"),
    containerFormat: z.literal("mp4"),
    audioPolicy: z.literal("VIDEO_ONLY"),
    aspectRatioPolicy: z.literal("PRESERVE_EXACT"),
  })
  .strict();

export const AiStoryAssemblyV2SourceMediaSchema = z
  .object({
    sourceResultId: Id,
    generationUnitId: Id,
    directorShotId: Id,
    sourceUri: Text,
    contentHash: Hash,
    mediaType: Text,
    acceptanceStatus: z.literal("ACCEPTED"),
    durationMs: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frameRate: z.number().positive().nullable(),
    semanticTimingEvidence: z
      .array(
        z
          .object({
            semantic:
              z.enum(AI_STORY_EDITORIAL_SOURCE_IN_INTENTS).or(
                z.enum(AI_STORY_EDITORIAL_SOURCE_OUT_INTENTS)
              ),
            timestampMs: z.number().int().nonnegative(),
            evidenceId: Id,
          })
          .strict()
      )
      .default([]),
  })
  .strict();

export const AiStoryAssemblyV2ResolvedTrimWindowSchema = z
  .object({
    sourceStartMs: z.number().int().nonnegative(),
    sourceEndMs: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    minimumDurationMs: z.number().int().positive(),
    preferredDurationMs: z.number().int().positive(),
    maximumDurationMs: z.number().int().positive(),
    sourceInIntent: z.enum(AI_STORY_EDITORIAL_SOURCE_IN_INTENTS),
    sourceOutIntent: z.enum(AI_STORY_EDITORIAL_SOURCE_OUT_INTENTS),
    resolutionMethod: z.enum([
      "CERTIFIED_EVENT_METADATA",
      "DETERMINISTIC_FALLBACK",
    ]),
    evidenceIds: z.array(Id),
  })
  .strict();

export const AiStoryAssemblyV2ResolvedTransitionSchema = z
  .object({
    editorialIntent: Text,
    executionKind: z.enum(AI_STORY_ASSEMBLY_V2_EXECUTABLE_TRANSITIONS),
    durationMs: z.number().int().nonnegative(),
    resolutionMethod: z.literal("EDITORIAL_AUTHORITY"),
  })
  .strict();

export const AiStoryAssemblyV2SceneBridgeExecutionSchema = z
  .object({
    fromSceneId: Id,
    toSceneId: Id,
    bridgeType: Text,
    executionKind: z.enum([
      "ORDER_AND_CUT_PRESERVED",
      "AUTHORIZED_DISSOLVE",
    ]),
  })
  .strict();

export const AiStoryAssemblyV2ResolvedTimelineEntrySchema = z
  .object({
    timelineEntryId: Id,
    order: z.number().int().nonnegative(),
    sceneId: Id,
    sceneVersionId: Id,
    directorShotId: Id,
    generationUnitId: Id,
    sourceResultId: Id,
    sourceUri: Text,
    sourceContentHash: Hash,
    sourceDurationMs: z.number().int().positive(),
    sourceWidth: z.number().int().positive(),
    sourceHeight: z.number().int().positive(),
    sourceFrameRate: z.number().positive().nullable(),
    editorialRole: Text,
    trimWindow: AiStoryAssemblyV2ResolvedTrimWindowSchema,
    transitionFromPrevious: AiStoryAssemblyV2ResolvedTransitionSchema,
    sceneBridgeExecution: AiStoryAssemblyV2SceneBridgeExecutionSchema.nullable(),
    cutOnActionExecution: z.enum([
      "NOT_APPLICABLE",
      "CUT_ON_ACTION_APPROXIMATE",
      "CUT_ON_ACTION_EXACT_CERTIFIED_METADATA",
    ]),
  })
  .strict();

export const AiStoryAssemblyV2PlanSchema = z
  .object({
    assemblyV2PlanId: Id,
    storyId: Id,
    storyVersionId: Id,
    editorialPlanId: Id,
    editorialFingerprint: Hash,
    contractVersion: z.literal(AI_STORY_ASSEMBLY_V2_CONTRACT_VERSION),
    runtimePolicyVersion: z.literal(AI_STORY_ASSEMBLY_V2_RUNTIME_POLICY_VERSION),
    assemblyRoute: z.literal("ASSEMBLY_V2_EDITORIAL"),
    sourceGenerationPlanFingerprints: z.array(Hash).min(1),
    resolvedTimeline: z.array(AiStoryAssemblyV2ResolvedTimelineEntrySchema).min(1),
    omittedGenerationUnitIds: z.array(Id),
    optionalExcludedGenerationUnitIds: z.array(Id),
    outputProfile: AiStoryAssemblyV2OutputProfileSchema,
    expectedOutputDurationMs: z.number().int().positive(),
    assemblyFingerprint: Hash,
    videoOnly: z.literal(true),
  })
  .strict();

export type AiStoryAssemblyV2Plan = z.infer<typeof AiStoryAssemblyV2PlanSchema>;
export type AiStoryAssemblyV2OutputProfile = z.infer<
  typeof AiStoryAssemblyV2OutputProfileSchema
>;
export type AiStoryAssemblyV2SourceMedia = z.infer<
  typeof AiStoryAssemblyV2SourceMediaSchema
>;
export type AiStoryAssemblyV2ResolvedTimelineEntry = z.infer<
  typeof AiStoryAssemblyV2ResolvedTimelineEntrySchema
>;

export const AiStoryAssemblyV2ExecutionEvidenceSchema = z
  .object({
    assemblyVersion: z.literal("V2"),
    editorialPlanId: Id,
    editorialFingerprint: Hash,
    assemblyFingerprint: Hash,
    timelineEntryCount: z.number().int().positive(),
    usedUnitCount: z.number().int().positive(),
    omittedUnitCount: z.number().int().nonnegative(),
    finalDurationMs: z.number().int().positive(),
    transitionCount: z.number().int().nonnegative(),
    executionStartedAt: z.string().datetime(),
    executionCompletedAt: z.string().datetime(),
  })
  .strict();

export type AiStoryAssemblyV2ExecutionEvidence = z.infer<
  typeof AiStoryAssemblyV2ExecutionEvidenceSchema
>;

export function selectAiStoryAssemblyRoute(input: {
  editorialPlan: { status: string } | null | undefined;
  assemblyV2AuthorityValid: boolean;
}): (typeof AI_STORY_ASSEMBLY_ROUTES)[number] {
  if (!input.editorialPlan) return "ASSEMBLY_V1_LEGACY";
  if (input.editorialPlan.status !== "FROZEN") {
    throw new Error("EDITORIAL_PLAN_NOT_FROZEN");
  }
  if (!input.assemblyV2AuthorityValid) {
    throw new Error("ASSEMBLY_V2_AUTHORITY_INVALID");
  }
  return "ASSEMBLY_V2_EDITORIAL";
}
