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
  "ai-story-video-observation-extractor.v3" as const;
export const AI_STORY_VIDEO_ANALYSIS_TYPE = "AI_STORY_VIDEO" as const;
export const RAW_VIDEO_OBSERVATION_EXTRACTOR = "IMPLEMENTED" as const;
export const AI_STORY_VIDEO_OBSERVATION_ROOT_FIELDS = [
  "shotCountEstimate",
  "dominantShotType",
  "cameraMotion",
  "compositionStability",
  "framingSummary",
  "oneContinuousShot",
  "abruptCuts",
  "primaryActionSummary",
  "actionTags",
  "environmentSummary",
  "environmentTags",
  "visiblePeopleEstimate",
  "primaryPersonPresent",
  "signageIdentityVisible",
  "qualityRiskFlags",
] as const;
export const AI_STORY_VIDEO_OBSERVATION_PROMPT =
  "Describe only what is visibly supported by the supplied sampled video frames. Return one JSON object. Put these fields directly at the root. Do not wrap the object in observable, result, data, or analysis. Do not choose a generation strategy. Do not infer whether the clip should be reused, replaced, or regenerated." as const;
export const AI_STORY_VIDEO_OBSERVATION_SCHEMA_HINT =
  `Return one JSON object. Put these fields directly at the root: ${AI_STORY_VIDEO_OBSERVATION_ROOT_FIELDS.join(", ")}. Do not wrap the object in observable, result, data, or analysis.` as const;
export const AI_STORY_VIDEO_CONTEXT_FREE_EXISTING_VIDEO_REASON =
  "Final-media use is decided at planning time from explicit intent." as const;

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
  environmentSummary: Summary.default("No distinctive environment was established from the sampled frames."),
  environmentTags: z.array(z.enum(AI_STORY_VIDEO_ENVIRONMENT_TAGS)).max(12).default([]),
  visiblePeopleEstimate: z.number().int().nonnegative().default(0),
  primaryPersonPresent: z.boolean().default(false),
  signageIdentityVisible: z.boolean().default(false),
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
  "sceneId",
  "analyzedAt",
  "analysisVersion",
  "recommendedReferenceUse",
  "provider",
  "model",
  "generationMode",
  "executionMode",
  "actionReferenceStrength",
  "handMotionImportant",
  "bodyPostureImportant",
  "interactionTimingImportant",
  "environmentReferenceStrength",
  "layoutImportant",
  "lightingMoodImportant",
  "backgroundClutterImportant",
  "personCentric",
  "humanIsReplaceableActionReference",
  "identityFidelityImportant",
  "strictMotionPreservationMatters",
  "strictTimelinePreservationMatters",
  "strictShotStructureMatters",
  "subjectReplacementLikely",
  "canUseAsExistingVideo",
  "existingVideoSuitabilityReason",
  "requiresGenerationToBeUseful",
] as const;

const HAND_ACTION_TAGS = new Set([
  "WRITING",
  "PACKING",
  "HOLDING_FLOWERS",
  "HANDING_ITEM",
  "OPERATING_CASHIER",
]);

/**
 * Use-judgments are a pure function of visible tags. Campaign, Episode, and
 * user intent do not change the stored observation.
 */
export function contextFreeVideoObservationJudgments(
  visible: AiStoryVideoModelObservation,
): Pick<
  AiStoryVideoAssetObservation,
  | "actionReferenceStrength"
  | "handMotionImportant"
  | "bodyPostureImportant"
  | "interactionTimingImportant"
  | "environmentReferenceStrength"
  | "layoutImportant"
  | "lightingMoodImportant"
  | "backgroundClutterImportant"
  | "personCentric"
  | "humanIsReplaceableActionReference"
  | "identityFidelityImportant"
  | "strictMotionPreservationMatters"
  | "strictTimelinePreservationMatters"
  | "strictShotStructureMatters"
  | "subjectReplacementLikely"
  | "canUseAsExistingVideo"
  | "existingVideoSuitabilityReason"
  | "requiresGenerationToBeUseful"
> {
  const blocked = visible.qualityRiskFlags.length > 0;
  const hasAction = !blocked && visible.actionTags.length > 0;
  const hasEnvironment = !blocked && visible.environmentTags.length > 0;
  return {
    actionReferenceStrength: hasAction,
    handMotionImportant: hasAction && visible.actionTags.some((tag) => HAND_ACTION_TAGS.has(tag)),
    bodyPostureImportant: hasAction && (
      visible.actionTags.includes("WALKING") || visible.actionTags.includes("TALKING_TO_CAMERA")
    ),
    interactionTimingImportant: hasAction && visible.actionTags.includes("HANDING_ITEM"),
    environmentReferenceStrength: hasEnvironment,
    layoutImportant: false,
    lightingMoodImportant: false,
    backgroundClutterImportant: false,
    personCentric: visible.primaryPersonPresent && visible.visiblePeopleEstimate === 1,
    humanIsReplaceableActionReference: false,
    identityFidelityImportant: false,
    strictMotionPreservationMatters: false,
    strictTimelinePreservationMatters: false,
    strictShotStructureMatters: false,
    subjectReplacementLikely: false,
    canUseAsExistingVideo: false,
    existingVideoSuitabilityReason: AI_STORY_VIDEO_CONTEXT_FREE_EXISTING_VIDEO_REASON,
    requiresGenerationToBeUseful: true,
  };
}

const OBSERVED_MODEL_ENVELOPE_KEY = "observable";

/**
 * Accepts a direct observation object, or exactly one observed `{ observable }`
 * wrapper. Any other envelope is rejected before strict observation validation.
 */
export function normalizeAiStoryVideoModelObservationEnvelope(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(source, OBSERVED_MODEL_ENVELOPE_KEY)) return value;
  const keys = Object.keys(source);
  if (keys.length !== 1) {
    throw new Error("AI_STORY_VIDEO_OBSERVATION_ENVELOPE_REJECTED");
  }
  const inner = source[OBSERVED_MODEL_ENVELOPE_KEY];
  if (!inner || typeof inner !== "object" || Array.isArray(inner)) {
    throw new Error("AI_STORY_VIDEO_OBSERVATION_ENVELOPE_REJECTED");
  }
  if (Object.prototype.hasOwnProperty.call(inner, OBSERVED_MODEL_ENVELOPE_KEY)) {
    throw new Error("AI_STORY_VIDEO_OBSERVATION_ENVELOPE_REJECTED");
  }
  return inner;
}

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
  const model = AiStoryVideoModelObservationSchema.parse(
    stripUntrustedVideoObservationFields(normalizeAiStoryVideoModelObservationEnvelope(modelValue)),
  );
  return AiStoryVideoAssetObservationSchema.parse({
    ...model,
    ...contextFreeVideoObservationJudgments(model),
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
  readonly requestedModelId: string;
  readonly providerModelId: string | null;
  readonly providerRequestId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly inputFingerprint: string;
  readonly costUsd: number;
  readonly createdAt: string;
};

export type AiStoryVideoProviderAttemptEvidence = {
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly providerModelId: string | null;
  readonly providerRequestId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly attemptedAt: string;
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
  recordProviderAttempt(claimId: string, evidence: AiStoryVideoProviderAttemptEvidence): Promise<void>;
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
  requestedModelId: string;
  providerModelId: string | null;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
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
