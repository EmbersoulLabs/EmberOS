/**
 * Raw-video observation extraction contracts.
 * The model describes media facts. Identity fields come from canonical asset metadata.
 * Classification stays in the deterministic video-analysis module.
 */
import { z } from "zod";
import {
  AI_STORY_VIDEO_ACTION_TAGS,
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  AI_STORY_VIDEO_CAMERA_MOTIONS,
  AI_STORY_VIDEO_COMPOSITION_STABILITIES,
  AI_STORY_VIDEO_ENVIRONMENT_TAGS,
  AI_STORY_VIDEO_QUALITY_RISK_FLAGS,
  AI_STORY_VIDEO_SHOT_TYPES,
  AiStoryVideoAssetAnalysisSchema,
  AiStoryVideoAssetObservationSchema,
  type AiStoryVideoAssetAnalysis,
  type AiStoryVideoAssetObservation,
} from "./ai-story-video-asset-analysis";

export const AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION =
  "ai-story-video-observation-extractor.v1" as const;
export const AI_STORY_VIDEO_ANALYSIS_TYPE = "AI_STORY_VIDEO" as const;
export const RAW_VIDEO_OBSERVATION_EXTRACTOR = "IMPLEMENTED" as const;
export const AI_STORY_VIDEO_OBSERVATION_PROMPT =
  "Describe only what is visibly or audibly supported by the supplied sampled video frames and transcript. Do not choose a generation strategy or Provider. Do not infer user intent beyond visible media evidence." as const;

const Summary = z.string().trim().min(1).max(500);

export const AiStoryVideoModelObservationSchema = z.object({
  shotCountEstimate: z.number().int().positive().default(1),
  dominantShotType: z.enum(AI_STORY_VIDEO_SHOT_TYPES).default("MIXED"),
  cameraMotion: z.enum(AI_STORY_VIDEO_CAMERA_MOTIONS).default("MIXED"),
  compositionStability: z.enum(AI_STORY_VIDEO_COMPOSITION_STABILITIES).default("MODERATE"),
  framingSummary: Summary.default("Framing was not established from the sampled frames."),
  oneContinuousShot: z.boolean().default(true),
  abruptCuts: z.boolean().default(false),
  primaryActionSummary: Summary.default("No strong action was established from the sampled frames."),
  actionTags: z.array(z.enum(AI_STORY_VIDEO_ACTION_TAGS)).max(12).default([]),
  actionReferenceStrength: z.boolean().default(false),
  handMotionImportant: z.boolean().default(false),
  bodyPostureImportant: z.boolean().default(false),
  interactionTimingImportant: z.boolean().default(false),
  environmentSummary: Summary.default("No distinctive environment was established from the sampled frames."),
  environmentTags: z.array(z.enum(AI_STORY_VIDEO_ENVIRONMENT_TAGS)).max(12).default([]),
  environmentReferenceStrength: z.boolean().default(false),
  layoutImportant: z.boolean().default(false),
  lightingMoodImportant: z.boolean().default(false),
  signageIdentityVisible: z.boolean().default(false),
  backgroundClutterImportant: z.boolean().default(false),
  visiblePeopleEstimate: z.number().int().nonnegative().default(0),
  primaryPersonPresent: z.boolean().default(false),
  personCentric: z.boolean().default(false),
  humanIsReplaceableActionReference: z.boolean().default(false),
  identityFidelityImportant: z.boolean().default(false),
  strictMotionPreservationMatters: z.boolean().default(false),
  strictTimelinePreservationMatters: z.boolean().default(false),
  strictShotStructureMatters: z.boolean().default(false),
  subjectReplacementLikely: z.boolean().default(false),
  canUseAsExistingVideo: z.boolean().default(false),
  existingVideoSuitabilityReason: Summary.default("Final-media usability was not established from the sampled media."),
  requiresGenerationToBeUseful: z.boolean().default(true),
  qualityRiskFlags: z.array(z.enum(AI_STORY_VIDEO_QUALITY_RISK_FLAGS)).max(8).default([]),
}).strict();

export type AiStoryVideoModelObservation = z.infer<typeof AiStoryVideoModelObservationSchema>;

export type AiStoryVideoCanonicalMetadata = {
  readonly videoAssetId: string;
  readonly contentHash: string;
  readonly durationMs: number;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number | null;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly analyzedAt: string;
};

const UNTRUSTED_MODEL_KEYS = [
  "videoAssetId",
  "contentHash",
  "durationMs",
  "durationSec",
  "width",
  "height",
  "fps",
  "orgId",
  "workspaceId",
  "campaignId",
  "episodeId",
  "analyzedAt",
  "analysisVersion",
  "recommendedReferenceUse",
  "provider",
  "model",
  "generationMode",
  "executionMode",
] as const;

export function stripUntrustedVideoObservationFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!(UNTRUSTED_MODEL_KEYS as readonly string[]).includes(key)) next[key] = entry;
  }
  return next;
}

export function mergeTrustedVideoObservation(
  canonical: AiStoryVideoCanonicalMetadata,
  modelValue: unknown,
): AiStoryVideoAssetObservation {
  const model = AiStoryVideoModelObservationSchema.parse(stripUntrustedVideoObservationFields(modelValue));
  return AiStoryVideoAssetObservationSchema.parse({
    ...model,
    ...canonical,
  });
}

export type AiStoryVideoAnalysisReuseKey = {
  readonly workspaceId: string;
  readonly assetId: string;
  readonly assetContentHash: string;
  readonly analysisVersion: string;
  readonly extractorVersion: string;
};

export type AiStoryVideoAnalysisSnapshotRecord = {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assetId: string;
  readonly assetContentHash: string;
  readonly analysisType: typeof AI_STORY_VIDEO_ANALYSIS_TYPE;
  readonly analysisVersion: typeof AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION;
  readonly extractorVersion: typeof AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION;
  readonly observation: AiStoryVideoAssetObservation;
  readonly analysis: AiStoryVideoAssetAnalysis;
  readonly providerId: string;
  readonly modelId: string;
  readonly providerRequestId: string | null;
  readonly inputFingerprint: string;
  readonly costUsd: number;
  readonly createdAt: string;
};

export function videoObservationInputFingerprint(key: AiStoryVideoAnalysisReuseKey): string {
  return [
    key.workspaceId,
    key.assetId,
    key.assetContentHash,
    key.analysisVersion,
    key.extractorVersion,
  ].join(":");
}

export interface AiStoryVideoAnalysisSnapshotRepository {
  findSucceededSnapshot(key: AiStoryVideoAnalysisReuseKey): Promise<AiStoryVideoAnalysisSnapshotRecord | null>;
  tryClaim(input: AiStoryVideoAnalysisReuseKey & { readonly orgId: string }): Promise<
    | { readonly acquired: true; readonly claimId: string }
    | { readonly acquired: false }
  >;
  waitForSettlement(key: AiStoryVideoAnalysisReuseKey): Promise<{
    readonly snapshot: AiStoryVideoAnalysisSnapshotRecord | null;
    readonly failed: boolean;
  }>;
  insertSnapshot(row: AiStoryVideoAnalysisSnapshotRecord): Promise<AiStoryVideoAnalysisSnapshotRecord>;
  completeClaim(claimId: string, snapshotId: string): Promise<void>;
  failClaim(claimId: string, errorCode: string): Promise<void>;
}

export function parseStoredVideoAnalysisSnapshot(row: {
  id: string;
  orgId: string;
  workspaceId: string;
  assetId: string;
  assetContentHash: string;
  analysisType: string;
  analysisVersion: string;
  extractorVersion: string;
  observation: unknown;
  analysis: unknown;
  providerId: string;
  modelId: string;
  providerRequestId: string | null;
  inputFingerprint: string;
  costUsd: number;
  createdAt: string;
}): AiStoryVideoAnalysisSnapshotRecord {
  if (
    row.analysisType !== AI_STORY_VIDEO_ANALYSIS_TYPE ||
    row.analysisVersion !== AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION ||
    row.extractorVersion !== AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION
  ) {
    throw new Error("VIDEO_ANALYSIS_SNAPSHOT_VERSION_MISMATCH");
  }
  return {
    ...row,
    analysisType: AI_STORY_VIDEO_ANALYSIS_TYPE,
    analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
    extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
    observation: AiStoryVideoAssetObservationSchema.parse(row.observation),
    analysis: AiStoryVideoAssetAnalysisSchema.parse(row.analysis),
  };
}
