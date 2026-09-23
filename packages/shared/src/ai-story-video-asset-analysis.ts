/**
 * Provider-neutral classification of structured video observations.
 * This module does not read uploaded media and does not extract observations
 * from an MP4. Raw observation extraction is a separate, unimplemented step.
 * `createVideoAssetAnalysisRecord()` builds a record value. It does not persist it.
 * No Provider call and no Provider wire mapping.
 */
import { z } from "zod";

export const AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION =
  "ai-story-video-asset-analysis.v1" as const;
export const AI_STORY_VIDEO_ANALYSIS_PROVIDER_CALLS = 0 as const;
export const AI_STORY_VIDEO_ANALYSIS_PROVIDER_COST_USD = 0 as const;
export const RAW_VIDEO_OBSERVATION_EXTRACTION = "NOT_IMPLEMENTED" as const;
export const VIDEO_OBSERVATION_CLASSIFICATION = "IMPLEMENTED" as const;
export const VIDEO_ANALYSIS_RECORD_SCHEMA = "IMPLEMENTED" as const;
export const VIDEO_ANALYSIS_PERSISTENCE = "NOT_IMPLEMENTED" as const;
export const UPLOAD_ANALYSIS_INTEGRATION = "NOT_IMPLEMENTED" as const;
export const DIRECTOR_INTEGRATION = "NOT_IMPLEMENTED" as const;

export const AI_STORY_VIDEO_CAMERA_MOTIONS = [
  "STATIC",
  "HANDHELD",
  "SLOW_PAN",
  "SLOW_PUSH",
  "WALKING_FOLLOW",
  "MIXED",
] as const;
export const AI_STORY_VIDEO_SHOT_TYPES = [
  "CLOSE_UP",
  "MEDIUM",
  "WIDE",
  "DETAIL",
  "MIXED",
] as const;
export const AI_STORY_VIDEO_COMPOSITION_STABILITIES = [
  "STABLE",
  "MODERATE",
  "UNSTABLE",
] as const;
export const AI_STORY_VIDEO_ACTION_TAGS = [
  "WRITING",
  "WALKING",
  "PACKING",
  "HOLDING_FLOWERS",
  "HANDING_ITEM",
  "TALKING_TO_CAMERA",
  "OPERATING_CASHIER",
] as const;
export const AI_STORY_VIDEO_ENVIRONMENT_TAGS = [
  "STREET",
  "SHOP_FRONT",
  "FLORIST_COUNTER",
  "OFFICE_DESK",
  "RESTAURANT",
  "MARKET",
  "MALL",
  "HOME_INTERIOR",
] as const;
export const AI_STORY_VIDEO_QUALITY_RISK_FLAGS = [
  "TOO_BLURRY",
  "TOO_SHORT",
  "TOO_CHAOTIC",
  "NO_USEFUL_ACTION_OR_ENVIRONMENT",
  "CORRUPTED",
  "MEANINGLESS",
] as const;
export const AI_STORY_VIDEO_REFERENCE_USES = [
  "ACTION_REFERENCE",
  "ENVIRONMENT_REFERENCE",
  "ACTION_AND_ENVIRONMENT_REFERENCE",
  "EXISTING_VIDEO",
  "STRICT_V2V_CANDIDATE",
  "UNSUITABLE_VIDEO_REFERENCE",
] as const;

const BLOCKING_QUALITY_FLAGS = [
  "TOO_BLURRY",
  "TOO_SHORT",
  "TOO_CHAOTIC",
  "NO_USEFUL_ACTION_OR_ENVIRONMENT",
  "CORRUPTED",
  "MEANINGLESS",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Summary = z.string().trim().min(1).max(500);

export class AiStoryVideoAssetAnalysisError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AiStoryVideoAssetAnalysisError";
  }
}

function durationAgrees(value: { durationMs: number; durationSec: number }, ctx: z.RefinementCtx) {
  if (Math.abs(value.durationSec * 1000 - value.durationMs) > 0.5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["durationSec"],
      message: "durationSec must describe the same interval as durationMs",
    });
  }
}

const AiStoryVideoAssetObservationObject = z.object({
  videoAssetId: Id,
  contentHash: Hash,
  durationMs: z.number().int().positive(),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive().nullable(),
  orgId: Id,
  workspaceId: Id,
  shotCountEstimate: z.number().int().positive(),
  dominantShotType: z.enum(AI_STORY_VIDEO_SHOT_TYPES),
  cameraMotion: z.enum(AI_STORY_VIDEO_CAMERA_MOTIONS),
  compositionStability: z.enum(AI_STORY_VIDEO_COMPOSITION_STABILITIES),
  framingSummary: Summary,
  oneContinuousShot: z.boolean(),
  abruptCuts: z.boolean(),
  primaryActionSummary: Summary,
  actionTags: z.array(z.enum(AI_STORY_VIDEO_ACTION_TAGS)).max(12),
  actionReferenceStrength: z.boolean(),
  handMotionImportant: z.boolean(),
  bodyPostureImportant: z.boolean(),
  interactionTimingImportant: z.boolean(),
  environmentSummary: Summary,
  environmentTags: z.array(z.enum(AI_STORY_VIDEO_ENVIRONMENT_TAGS)).max(12),
  environmentReferenceStrength: z.boolean(),
  layoutImportant: z.boolean(),
  lightingMoodImportant: z.boolean(),
  signageIdentityVisible: z.boolean(),
  backgroundClutterImportant: z.boolean(),
  visiblePeopleEstimate: z.number().int().nonnegative(),
  primaryPersonPresent: z.boolean(),
  personCentric: z.boolean(),
  humanIsReplaceableActionReference: z.boolean(),
  identityFidelityImportant: z.boolean(),
  strictMotionPreservationMatters: z.boolean(),
  strictTimelinePreservationMatters: z.boolean(),
  strictShotStructureMatters: z.boolean(),
  subjectReplacementLikely: z.boolean(),
  canUseAsExistingVideo: z.boolean(),
  existingVideoSuitabilityReason: Summary,
  requiresGenerationToBeUseful: z.boolean(),
  qualityRiskFlags: z.array(z.enum(AI_STORY_VIDEO_QUALITY_RISK_FLAGS)).max(8),
  analyzedAt: z.string().datetime(),
}).strict();

export const AiStoryVideoAssetObservationSchema = AiStoryVideoAssetObservationObject.superRefine(durationAgrees);

export const AiStoryVideoAssetAnalysisSchema = AiStoryVideoAssetObservationObject.extend({
  analysisVersion: z.literal(AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION),
  recommendedReferenceUse: z.enum(AI_STORY_VIDEO_REFERENCE_USES),
  confidence: z.number().min(0).max(1),
  rationale: Summary,
  couldBeStrictV2vCandidateIfProviderExists: z.boolean(),
}).strict().superRefine(durationAgrees);

export const AiStoryVideoAssetAnalysisRecordSchema = z.object({
  recordVersion: z.literal("ai-story-video-asset-analysis-record.v1"),
  reuseKey: z.string().min(1),
  videoAssetId: Id,
  workspaceId: Id,
  contentHash: Hash,
  analysisVersion: z.literal(AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION),
  analysis: AiStoryVideoAssetAnalysisSchema,
  storedAt: z.string().datetime(),
  durablePersistence: z.literal(VIDEO_ANALYSIS_PERSISTENCE),
}).strict();

export type AiStoryVideoAssetObservation = z.infer<typeof AiStoryVideoAssetObservationSchema>;
export type AiStoryVideoAssetAnalysis = z.infer<typeof AiStoryVideoAssetAnalysisSchema>;
export type AiStoryVideoAssetAnalysisRecord = z.infer<typeof AiStoryVideoAssetAnalysisRecordSchema>;
export type AiStoryVideoReferenceUse = (typeof AI_STORY_VIDEO_REFERENCE_USES)[number];

export type AiStoryVideoAnalysisInvalidationReason =
  | "NOT_STORED"
  | "CONTENT_HASH_CHANGED"
  | "ANALYSIS_VERSION_CHANGED"
  | "ASSET_IDENTITY_CHANGED"
  | "STORED_ANALYSIS_MISSING";

export type AiStoryStoredVideoAnalysis =
  | { readonly completeness: "ABSENT" }
  | { readonly completeness: "COMPLETE"; readonly analysis: AiStoryVideoAssetAnalysis }
  | { readonly completeness: "IDENTITY_ONLY"; readonly identity: AiStoryStoredVideoAnalysisIdentity };

export type AiStoryStoredVideoAnalysisIdentity = {
  readonly videoAssetId: string;
  readonly workspaceId: string;
  readonly contentHash: string;
  readonly analysisVersion: string;
};

const CLASSIFICATION_RATIONALE = {
  UNSUITABLE_QUALITY: "The clip is not reliable enough to use as final media or as a reference.",
  UNSUITABLE_EMPTY: "The clip has no reliable action or environment reference.",
  EXISTING_VIDEO: "The clip is already usable as final media, so generation is not required.",
  STRICT_V2V_CANDIDATE: "Exact motion, timeline, and shot structure matter, and the visible person is the element to replace.",
  ACTION_AND_ENVIRONMENT_REFERENCE: "The clip preserves a useful action and a distinctive environment for a new generation.",
  ACTION_REFERENCE: "The clip's action is strong enough to guide a new generation, and the environment is not a required reference.",
  ENVIRONMENT_REFERENCE: "The clip's environment is strong enough to guide a new generation, and the action is not a required reference.",
} as const;

function blockingQuality(observation: AiStoryVideoAssetObservation): boolean {
  return observation.qualityRiskFlags.some((flag) =>
    (BLOCKING_QUALITY_FLAGS as readonly string[]).includes(flag)
  ) || observation.durationMs < 1000;
}

function strictV2vCandidate(observation: AiStoryVideoAssetObservation): boolean {
  if (!observation.primaryPersonPresent || !observation.subjectReplacementLikely) return false;
  if (!observation.strictMotionPreservationMatters) return false;
  if (!observation.strictTimelinePreservationMatters) return false;
  if (!observation.strictShotStructureMatters) return false;
  if (!observation.oneContinuousShot || observation.abruptCuts) return false;
  if (!observation.actionReferenceStrength && !observation.interactionTimingImportant) return false;
  return true;
}

function classifyReferenceUse(observation: AiStoryVideoAssetObservation): {
  recommendedReferenceUse: AiStoryVideoReferenceUse;
  confidence: number;
  rationale: string;
} {
  if (blockingQuality(observation)) {
    return {
      recommendedReferenceUse: "UNSUITABLE_VIDEO_REFERENCE",
      confidence: 0.93,
      rationale: CLASSIFICATION_RATIONALE.UNSUITABLE_QUALITY,
    };
  }
  if (observation.canUseAsExistingVideo && !observation.requiresGenerationToBeUseful) {
    return {
      recommendedReferenceUse: "EXISTING_VIDEO",
      confidence: 0.91,
      rationale: CLASSIFICATION_RATIONALE.EXISTING_VIDEO,
    };
  }
  if (strictV2vCandidate(observation)) {
    return {
      recommendedReferenceUse: "STRICT_V2V_CANDIDATE",
      confidence: 0.9,
      rationale: CLASSIFICATION_RATIONALE.STRICT_V2V_CANDIDATE,
    };
  }
  if (observation.actionReferenceStrength && observation.environmentReferenceStrength) {
    return {
      recommendedReferenceUse: "ACTION_AND_ENVIRONMENT_REFERENCE",
      confidence: 0.86,
      rationale: CLASSIFICATION_RATIONALE.ACTION_AND_ENVIRONMENT_REFERENCE,
    };
  }
  if (observation.actionReferenceStrength) {
    return {
      recommendedReferenceUse: "ACTION_REFERENCE",
      confidence: 0.88,
      rationale: CLASSIFICATION_RATIONALE.ACTION_REFERENCE,
    };
  }
  if (observation.environmentReferenceStrength) {
    return {
      recommendedReferenceUse: "ENVIRONMENT_REFERENCE",
      confidence: 0.88,
      rationale: CLASSIFICATION_RATIONALE.ENVIRONMENT_REFERENCE,
    };
  }
  return {
    recommendedReferenceUse: "UNSUITABLE_VIDEO_REFERENCE",
    confidence: 0.7,
    rationale: CLASSIFICATION_RATIONALE.UNSUITABLE_EMPTY,
  };
}

/**
 * Classifies an already structured observation.
 * This is not raw-video understanding and it does not replace an unimplemented
 * observation extractor.
 */
export function classifyAiStoryVideoAssetAnalysis(
  input: AiStoryVideoAssetObservation,
): AiStoryVideoAssetAnalysis {
  const observation = AiStoryVideoAssetObservationSchema.parse(input);
  const classification = classifyReferenceUse(observation);
  return AiStoryVideoAssetAnalysisSchema.parse({
    ...observation,
    analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
    recommendedReferenceUse: classification.recommendedReferenceUse,
    confidence: classification.confidence,
    rationale: classification.rationale,
    couldBeStrictV2vCandidateIfProviderExists:
      classification.recommendedReferenceUse === "STRICT_V2V_CANDIDATE",
  });
}

export function videoAssetAnalysisReuseKey(input: {
  readonly analysisVersion: string;
  readonly workspaceId: string;
  readonly videoAssetId: string;
  readonly contentHash: string;
}): string {
  return [
    input.analysisVersion,
    input.workspaceId,
    input.videoAssetId,
    input.contentHash,
  ].join(":");
}

export function videoAnalysisInvalidationReason(
  stored: AiStoryStoredVideoAnalysisIdentity | null,
  requested: AiStoryStoredVideoAnalysisIdentity,
): AiStoryVideoAnalysisInvalidationReason | null {
  if (!stored) return "NOT_STORED";
  if (
    stored.videoAssetId !== requested.videoAssetId ||
    stored.workspaceId !== requested.workspaceId
  ) {
    return "ASSET_IDENTITY_CHANGED";
  }
  if (stored.analysisVersion !== requested.analysisVersion) return "ANALYSIS_VERSION_CHANGED";
  if (stored.contentHash !== requested.contentHash) return "CONTENT_HASH_CHANGED";
  return null;
}

export function resolveReusableVideoAssetAnalysis(input: {
  readonly stored: AiStoryStoredVideoAnalysis;
  readonly observation: AiStoryVideoAssetObservation;
  readonly analyze?: (observation: AiStoryVideoAssetObservation) => AiStoryVideoAssetAnalysis;
}): {
  readonly analysis: AiStoryVideoAssetAnalysis;
  readonly reused: boolean;
  readonly invalidationReason: AiStoryVideoAnalysisInvalidationReason | null;
} {
  const observation = AiStoryVideoAssetObservationSchema.parse(input.observation);
  const requested: AiStoryStoredVideoAnalysisIdentity = {
    videoAssetId: observation.videoAssetId,
    workspaceId: observation.workspaceId,
    contentHash: observation.contentHash,
    analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  };
  const analyze = input.analyze ?? classifyAiStoryVideoAssetAnalysis;
  const recompute = (invalidationReason: AiStoryVideoAnalysisInvalidationReason) => ({
    analysis: analyze(observation),
    reused: false as const,
    invalidationReason,
  });

  if (input.stored.completeness === "ABSENT") return recompute("NOT_STORED");

  if (input.stored.completeness === "IDENTITY_ONLY") {
    const reason = videoAnalysisInvalidationReason(input.stored.identity, requested);
    return recompute(reason ?? "STORED_ANALYSIS_MISSING");
  }

  const storedAnalysis = AiStoryVideoAssetAnalysisSchema.parse(input.stored.analysis);
  const reason = videoAnalysisInvalidationReason(storedAnalysis, requested);
  if (reason !== null) return recompute(reason);
  return {
    analysis: storedAnalysis,
    reused: true,
    invalidationReason: null,
  };
}

export function createVideoAssetAnalysisRecord(
  analysis: AiStoryVideoAssetAnalysis,
  storedAt: string,
): AiStoryVideoAssetAnalysisRecord {
  const parsed = AiStoryVideoAssetAnalysisSchema.parse(analysis);
  return AiStoryVideoAssetAnalysisRecordSchema.parse({
    recordVersion: "ai-story-video-asset-analysis-record.v1",
    reuseKey: videoAssetAnalysisReuseKey(parsed),
    videoAssetId: parsed.videoAssetId,
    workspaceId: parsed.workspaceId,
    contentHash: parsed.contentHash,
    analysisVersion: parsed.analysisVersion,
    analysis: parsed,
    storedAt,
    durablePersistence: VIDEO_ANALYSIS_PERSISTENCE,
  });
}
