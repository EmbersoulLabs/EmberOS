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

export const AI_STORY_VIDEO_OBSERVATION_CANONICALIZER_VERSION =
  "ai-story-video-observation-canonicalizer.v1" as const;
export const AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION =
  "ai-story-video-observation-extractor.v4" as const;
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
  "observedActions",
  "observedObjects",
  "environmentSummary",
  "environmentTags",
  "observedEnvironments",
  "visiblePeopleEstimate",
  "primaryPersonPresent",
  "signageIdentityVisible",
  "qualityRiskFlags",
] as const;
export const AI_STORY_VIDEO_OBSERVATION_PROMPT =
  `Describe only what is visibly supported by the supplied sampled video frames. Return one JSON object. Put these fields directly at the root. Do not wrap the object in observable, result, data, or analysis. Do not choose a generation strategy. Do not infer whether the clip should be reused, replaced, or regenerated. dominantShotType must be one of: ${AI_STORY_VIDEO_SHOT_TYPES.join(", ")}. cameraMotion must be one of: ${AI_STORY_VIDEO_CAMERA_MOTIONS.join(", ")}. compositionStability must be one of: ${AI_STORY_VIDEO_COMPOSITION_STABILITIES.join(", ")}. actionTags must use only: ${AI_STORY_VIDEO_ACTION_TAGS.join(", ")}. environmentTags must use only: ${AI_STORY_VIDEO_ENVIRONMENT_TAGS.join(", ")}. Put any other visible action phrase in observedActions, any visible object name in observedObjects, and any other place noun in observedEnvironments. Those three fields are free observations, not enums.` as const;
export const AI_STORY_VIDEO_OBSERVATION_SCHEMA_HINT =
  `Return one JSON object at the root with shotCountEstimate, framingSummary, oneContinuousShot, abruptCuts, primaryActionSummary, environmentSummary, visiblePeopleEstimate, primaryPersonPresent, signageIdentityVisible, and qualityRiskFlags. Enums: dominantShotType=${AI_STORY_VIDEO_SHOT_TYPES.join("|")}; cameraMotion=${AI_STORY_VIDEO_CAMERA_MOTIONS.join("|")}; compositionStability=${AI_STORY_VIDEO_COMPOSITION_STABILITIES.join("|")}; actionTags=${AI_STORY_VIDEO_ACTION_TAGS.join("|")}; environmentTags=${AI_STORY_VIDEO_ENVIRONMENT_TAGS.join("|")}. Free observations: observedActions, observedObjects, observedEnvironments. Do not wrap the object.` as const;
export const AI_STORY_VIDEO_CONTEXT_FREE_EXISTING_VIDEO_REASON =
  "Final-media use is decided at planning time from explicit intent." as const;

const Summary = z.string().trim().min(1).max(500);
const OpenSemanticValue = z.string().trim().min(1).max(80);
const OpenSemanticList = z.array(OpenSemanticValue).max(12);

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
  observedActions: OpenSemanticList.default([]),
  observedObjects: OpenSemanticList.default([]),
  environmentSummary: Summary.default("No distinctive environment was established from the sampled frames."),
  environmentTags: z.array(z.enum(AI_STORY_VIDEO_ENVIRONMENT_TAGS)).max(12).default([]),
  observedEnvironments: OpenSemanticList.default([]),
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
  const hasAction = !blocked && (visible.actionTags.length > 0 || visible.observedActions.length > 0);
  const hasEnvironment = !blocked && (
    visible.environmentTags.length > 0 || visible.observedEnvironments.length > 0
  );
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

const SHOT_SYNONYMS: Record<string, (typeof AI_STORY_VIDEO_SHOT_TYPES)[number]> = {
  "close up": "CLOSE_UP",
  closeup: "CLOSE_UP",
  medium: "MEDIUM",
  "medium shot": "MEDIUM",
  wide: "WIDE",
  "wide shot": "WIDE",
  detail: "DETAIL",
  "detail shot": "DETAIL",
  mixed: "MIXED",
};
const CAMERA_SYNONYMS: Record<string, (typeof AI_STORY_VIDEO_CAMERA_MOTIONS)[number]> = {
  static: "STATIC",
  locked: "STATIC",
  "locked off": "STATIC",
  handheld: "HANDHELD",
  "hand held": "HANDHELD",
  "slow pan": "SLOW_PAN",
  "slow push": "SLOW_PUSH",
  "walking follow": "WALKING_FOLLOW",
  mixed: "MIXED",
};
const STABILITY_SYNONYMS: Record<string, (typeof AI_STORY_VIDEO_COMPOSITION_STABILITIES)[number]> = {
  stable: "STABLE",
  steady: "STABLE",
  moderate: "MODERATE",
  unstable: "UNSTABLE",
  shaky: "UNSTABLE",
};
const ACTION_SYNONYMS: Record<string, (typeof AI_STORY_VIDEO_ACTION_TAGS)[number]> = {
  writing: "WRITING",
  walking: "WALKING",
  packing: "PACKING",
  "holding flowers": "HOLDING_FLOWERS",
  "handing item": "HANDING_ITEM",
  "talking to camera": "TALKING_TO_CAMERA",
  "operating cashier": "OPERATING_CASHIER",
};
const ENVIRONMENT_SYNONYMS: Record<string, (typeof AI_STORY_VIDEO_ENVIRONMENT_TAGS)[number]> = {
  street: "STREET",
  "shop front": "SHOP_FRONT",
  "florist counter": "FLORIST_COUNTER",
  "office desk": "OFFICE_DESK",
  restaurant: "RESTAURANT",
  market: "MARKET",
  mall: "MALL",
  "home interior": "HOME_INTERIOR",
};
const OBJECT_TERMS = new Set(["notebook", "table", "plant", "water bottle", "glasses"]);

function observationToken(value: unknown): string {
  return String(value).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function enumOrThrow<T extends string>(
  field: string,
  raw: unknown,
  synonyms: Record<string, T>,
  allowed: readonly T[],
): T {
  const token = observationToken(raw);
  const exact = allowed.find((entry) => entry.toLowerCase() === token || entry.toLowerCase().replace(/_/g, " ") === token);
  const mapped = synonyms[token] ?? exact;
  if (!mapped) {
    throw new Error(`AI_STORY_VIDEO_OBSERVATION_UNKNOWN_ENUM:${field}:${String(raw)}`);
  }
  return mapped;
}

function pushUnique(target: string[], value: string) {
  const normalized = observationToken(value);
  if (!normalized || normalized.length > 80) {
    throw new Error("AI_STORY_VIDEO_OBSERVATION_OPEN_VALUE_REJECTED");
  }
  if (!target.includes(normalized)) target.push(normalized);
  if (target.length > 12) throw new Error("AI_STORY_VIDEO_OBSERVATION_OPEN_VALUE_REJECTED");
}

/**
 * Deterministic field canonicalizer. Bounded enums use explicit synonym maps.
 * Open actions, objects, and places leave the enum fields. Unknown enum tokens fail.
 */
export function canonicalizeAiStoryVideoObservation(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  if ("dominantShotType" in source) {
    next.dominantShotType = enumOrThrow("dominantShotType", source.dominantShotType, SHOT_SYNONYMS, AI_STORY_VIDEO_SHOT_TYPES);
  }
  if ("cameraMotion" in source) {
    next.cameraMotion = enumOrThrow("cameraMotion", source.cameraMotion, CAMERA_SYNONYMS, AI_STORY_VIDEO_CAMERA_MOTIONS);
  }
  if ("compositionStability" in source) {
    next.compositionStability = enumOrThrow("compositionStability", source.compositionStability, STABILITY_SYNONYMS, AI_STORY_VIDEO_COMPOSITION_STABILITIES);
  }
  const actionTags: string[] = [];
  const observedActions: string[] = [];
  const observedObjects: string[] = [];
  const environmentTags: string[] = [];
  const observedEnvironments: string[] = [];
  const absorbList = (raw: unknown, accept: (token: string, original: string) => void) => {
    if (!Array.isArray(raw)) return;
    for (const entry of raw) accept(observationToken(entry), String(entry));
  };
  absorbList(source.observedActions, (_token, original) => pushUnique(observedActions, original));
  absorbList(source.observedObjects, (_token, original) => pushUnique(observedObjects, original));
  absorbList(source.observedEnvironments, (_token, original) => pushUnique(observedEnvironments, original));
  absorbList(source.actionTags, (token, original) => {
    if (ACTION_SYNONYMS[token] || AI_STORY_VIDEO_ACTION_TAGS.some((tag) => tag.toLowerCase().replace(/_/g, " ") === token)) {
      actionTags.push(ACTION_SYNONYMS[token] ?? AI_STORY_VIDEO_ACTION_TAGS.find((tag) => tag.toLowerCase().replace(/_/g, " ") === token)!);
      return;
    }
    if (OBJECT_TERMS.has(token)) {
      pushUnique(observedObjects, original);
      return;
    }
    pushUnique(observedActions, original);
  });
  absorbList(source.environmentTags, (token, original) => {
    if (ENVIRONMENT_SYNONYMS[token] || AI_STORY_VIDEO_ENVIRONMENT_TAGS.some((tag) => tag.toLowerCase().replace(/_/g, " ") === token)) {
      environmentTags.push(ENVIRONMENT_SYNONYMS[token] ?? AI_STORY_VIDEO_ENVIRONMENT_TAGS.find((tag) => tag.toLowerCase().replace(/_/g, " ") === token)!);
      return;
    }
    if (OBJECT_TERMS.has(token)) {
      pushUnique(observedObjects, original);
      return;
    }
    pushUnique(observedEnvironments, original);
  });
  if ("actionTags" in source || observedActions.length > 0) next.actionTags = [...new Set(actionTags)];
  if ("environmentTags" in source || observedEnvironments.length > 0) next.environmentTags = [...new Set(environmentTags)];
  if ("actionTags" in source || "observedActions" in source) next.observedActions = observedActions;
  if ("actionTags" in source || "environmentTags" in source || "observedObjects" in source) next.observedObjects = observedObjects;
  if ("environmentTags" in source || "observedEnvironments" in source) next.observedEnvironments = observedEnvironments;
  return next;
}

export function mergeTrustedVideoObservation(
  canonical: AiStoryVideoCanonicalMetadata,
  modelValue: unknown,
): AiStoryVideoAssetObservation {
  const model = AiStoryVideoModelObservationSchema.parse(
    canonicalizeAiStoryVideoObservation(
      stripUntrustedVideoObservationFields(normalizeAiStoryVideoModelObservationEnvelope(modelValue)),
    ),
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
  readonly rawProviderObservation: unknown;
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
  readonly rawProviderObservation: unknown;
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
  rawProviderObservation: unknown;
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
    rawProviderObservation: row.rawProviderObservation,
    analysis: AiStoryVideoAssetAnalysisSchema.parse(row.analysis),
  };
}
