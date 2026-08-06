import { createHash } from "node:crypto";
import { z } from "zod";
import { PIPELINE_STATES, type PipelineState, type StepProgress } from "@ceo-agent/shared";
import type {
  PipelineProvenance,
  PipelineWarning,
} from "./workflow-contracts";

export const VIDEO_PIPELINE_CONTRACT_VERSION = "1" as const;

export const VIDEO_PHASES = [
  "UNDERSTANDING",
  "READY_FOR_MARKETING",
  "COMPOSITION",
  "RENDERING",
  "FINALIZATION",
  "COMPLETE",
] as const;
export type VideoPhase = (typeof VIDEO_PHASES)[number];

export const VIDEO_CHECKPOINTS = [
  "VIDEO_VALIDATION_COMPLETE",
  "VIDEO_METADATA_COMPLETE",
  "VIDEO_TRANSCRIPT_COMPLETE",
  "VIDEO_SCENE_ANALYSIS_COMPLETE",
  "VIDEO_HIGHLIGHTS_COMPLETE",
  "VIDEO_UNDERSTANDING_COMPLETE",
  "VIDEO_READY_FOR_MARKETING",
  "VIDEO_COMPOSITION_COMPLETE",
  "VIDEO_RENDER_PENDING",
  "VIDEO_RENDERING",
  "VIDEO_RENDER_COMPLETE",
  "VIDEO_GATES_COMPLETE",
  "VIDEO_COMPLETE",
] as const;
export type VideoCheckpoint = (typeof VIDEO_CHECKPOINTS)[number];

export interface VideoSourceReference {
  readonly assetId: string;
  readonly mimeType?: string;
  readonly storagePath?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VideoCreativeReference {
  readonly creativeId: string;
  readonly status?: string;
  readonly lineage?: Readonly<Record<string, unknown>>;
}

export interface VideoRenderReference {
  readonly creativeId?: string;
  readonly videoUrl?: string;
  readonly previewUrl?: string;
  readonly coverUrl?: string;
  readonly storagePath?: string;
  readonly fingerprint?: string;
  readonly provider?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VideoPipelineResult {
  readonly pipelineType: "VIDEO";
  readonly contractVersion: typeof VIDEO_PIPELINE_CONTRACT_VERSION;
  readonly state: PipelineState;
  readonly phase: VideoPhase;
  readonly sourceAssets: readonly VideoSourceReference[];
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly transcript?: unknown;
  readonly sceneAnalysis?: unknown;
  readonly suggestedMoments?: unknown;
  readonly selectedHighlights?: unknown;
  readonly editPlans?: unknown;
  readonly subtitleReferences?: unknown;
  readonly creativeReferences: readonly VideoCreativeReference[];
  readonly renderReferences: readonly VideoRenderReference[];
  readonly warnings: readonly PipelineWarning[];
  readonly confidence: Readonly<Record<string, number>>;
  readonly provenance: readonly PipelineProvenance[];
  readonly checkpoint: VideoCheckpoint;
  readonly deterministicKey: string;
  readonly extensions: Readonly<Record<string, unknown>>;
}

export type VideoPipelineResultInput = Omit<
  VideoPipelineResult,
  | "pipelineType"
  | "contractVersion"
  | "deterministicKey"
  | "extensions"
> & {
  readonly deterministicKey?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
};

const recordSchema = z.record(z.unknown());
const sourceReferenceSchema = z
  .object({
    assetId: z.string().min(1),
    mimeType: z.string().optional(),
    storagePath: z.string().optional(),
    metadata: recordSchema.optional(),
  })
  .passthrough();
const creativeReferenceSchema = z
  .object({
    creativeId: z.string().min(1),
    status: z.string().optional(),
    lineage: recordSchema.optional(),
  })
  .passthrough();
const renderReferenceSchema = z
  .object({
    creativeId: z.string().optional(),
    videoUrl: z.string().optional(),
    previewUrl: z.string().optional(),
    coverUrl: z.string().optional(),
    storagePath: z.string().optional(),
    fingerprint: z.string().optional(),
    provider: z.string().optional(),
    metadata: recordSchema.optional(),
  })
  .passthrough();
const warningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
    assetId: z.string().optional(),
  })
  .passthrough();
const provenanceSchema = z
  .object({
    source: z.string().min(1),
    pipelineType: z.literal("VIDEO"),
    assetId: z.string().optional(),
    creativeId: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    skillVersion: z.string().optional(),
    promptVersion: z.string().optional(),
  })
  .passthrough();

const videoPipelineResultSchema = z
  .object({
    pipelineType: z.literal("VIDEO"),
    contractVersion: z.literal(VIDEO_PIPELINE_CONTRACT_VERSION),
    state: z.enum(PIPELINE_STATES),
    phase: z.enum(VIDEO_PHASES),
    sourceAssets: z.array(sourceReferenceSchema),
    metadata: recordSchema,
    transcript: z.unknown().optional(),
    sceneAnalysis: z.unknown().optional(),
    suggestedMoments: z.unknown().optional(),
    selectedHighlights: z.unknown().optional(),
    editPlans: z.unknown().optional(),
    subtitleReferences: z.unknown().optional(),
    creativeReferences: z.array(creativeReferenceSchema),
    renderReferences: z.array(renderReferenceSchema),
    warnings: z.array(warningSchema),
    confidence: z.record(z.number()),
    provenance: z.array(provenanceSchema),
    checkpoint: z.enum(VIDEO_CHECKPOINTS),
    deterministicKey: z.string().min(1),
    extensions: recordSchema.default({}),
  })
  .passthrough();

const KNOWN_FIELDS = new Set([
  ...Object.keys(videoPipelineResultSchema.shape),
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function deterministicFingerprint(
  namespace: string,
  value: unknown
): string {
  return createHash("sha256")
    .update(`${namespace}:`)
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function fingerprintVideoSourceAssets(
  sources: readonly VideoSourceReference[]
): string {
  return deterministicFingerprint(
    "video-source-assets-v1",
    [...sources].sort((left, right) => left.assetId.localeCompare(right.assetId))
  );
}

export function fingerprintVideoCampaign(value: unknown): string {
  return deterministicFingerprint("video-campaign-v1", value);
}

export function fingerprintVideoHighlights(value: unknown): string {
  return deterministicFingerprint("video-highlights-v1", value);
}

export function fingerprintVideoMarketingOutput(value: unknown): string {
  return deterministicFingerprint("video-marketing-output-v1", value);
}

export function fingerprintVideoRenderSpec(value: unknown): string {
  return deterministicFingerprint("video-render-spec-v1", value);
}

export function fingerprintVideoOutput(value: unknown): string {
  return deterministicFingerprint("video-output-v1", value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

function checkpointIndex(checkpoint: VideoCheckpoint): number {
  return VIDEO_CHECKPOINTS.indexOf(checkpoint);
}

export function compareVideoCheckpoints(
  left: VideoCheckpoint,
  right: VideoCheckpoint
): number {
  return checkpointIndex(left) - checkpointIndex(right);
}

export function isVideoCheckpointAtLeast(
  checkpoint: VideoCheckpoint,
  required: VideoCheckpoint
): boolean {
  return compareVideoCheckpoints(checkpoint, required) >= 0;
}

function assertContractSemantics(result: VideoPipelineResult): void {
  if (result.state === "PARTIALLY_COMPLETE") {
    if (
      result.phase !== "READY_FOR_MARKETING" ||
      result.checkpoint !== "VIDEO_READY_FOR_MARKETING"
    ) {
      throw new Error(
        "PARTIALLY_COMPLETE Video requires READY_FOR_MARKETING phase and checkpoint"
      );
    }
    if (!result.warnings.some((warning) => warning.code === "VIDEO_RENDER_PENDING")) {
      throw new Error(
        "PARTIALLY_COMPLETE Video requires VIDEO_RENDER_PENDING warning"
      );
    }
    if (result.renderReferences.length > 0) {
      throw new Error(
        "PARTIALLY_COMPLETE Video must not contain final render references"
      );
    }
    const transcriptAvailable =
      result.transcript !== undefined &&
      result.transcript !== null;
    const transcriptUnavailableByWarning = result.warnings.some(
      (warning) => warning.code === "VIDEO_TRANSCRIPT_UNAVAILABLE"
    );
    if (
      result.sourceAssets.length === 0 ||
      Object.keys(result.metadata).length === 0 ||
      (!transcriptAvailable && !transcriptUnavailableByWarning) ||
      result.sceneAnalysis === undefined ||
      result.sceneAnalysis === null ||
      result.selectedHighlights === undefined ||
      result.selectedHighlights === null ||
      Object.keys(result.confidence).length === 0 ||
      result.provenance.length === 0
    ) {
      throw new Error(
        "PARTIALLY_COMPLETE Video is missing required understanding outputs"
      );
    }
  }

  if (result.state === "COMPLETED") {
    if (
      result.phase !== "COMPLETE" ||
      result.checkpoint !== "VIDEO_COMPLETE"
    ) {
      throw new Error("COMPLETED Video requires COMPLETE phase and VIDEO_COMPLETE checkpoint");
    }
    if (result.renderReferences.length === 0) {
      throw new Error("COMPLETED Video requires at least one render reference");
    }
  }
}

function mergeUnknownFields(
  value: Record<string, unknown>,
  extensions: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const unknown = Object.fromEntries(
    Object.entries(value).filter(([key]) => !KNOWN_FIELDS.has(key))
  );
  return { ...unknown, ...extensions };
}

function normalizedResult(
  value: z.infer<typeof videoPipelineResultSchema>
): VideoPipelineResult {
  const extensions = mergeUnknownFields(
    value as Record<string, unknown>,
    value.extensions
  );
  const withoutUnknown = Object.fromEntries(
    Object.entries(value).filter(([key]) => KNOWN_FIELDS.has(key))
  ) as unknown as VideoPipelineResult;
  const result = {
    ...withoutUnknown,
    sourceAssets: [...value.sourceAssets].sort((left, right) =>
      left.assetId.localeCompare(right.assetId)
    ),
    creativeReferences: [...value.creativeReferences].sort((left, right) =>
      left.creativeId.localeCompare(right.creativeId)
    ),
    renderReferences: [...value.renderReferences].sort((left, right) =>
      `${left.creativeId ?? ""}:${left.videoUrl ?? left.previewUrl ?? ""}`.localeCompare(
        `${right.creativeId ?? ""}:${right.videoUrl ?? right.previewUrl ?? ""}`
      )
    ),
    extensions,
  } satisfies VideoPipelineResult;
  assertContractSemantics(result);
  return deepFreeze(result);
}

export function createVideoPipelineResult(
  input: VideoPipelineResultInput
): VideoPipelineResult {
  const candidate = {
    ...input,
    pipelineType: "VIDEO",
    contractVersion: VIDEO_PIPELINE_CONTRACT_VERSION,
    deterministicKey:
      input.deterministicKey ??
      deterministicFingerprint("video-pipeline-result-v1", {
        ...input,
        deterministicKey: undefined,
        extensions: input.extensions ?? {},
      }),
    extensions: input.extensions ?? {},
  };
  return normalizedResult(videoPipelineResultSchema.parse(candidate));
}

export class UnsupportedVideoContractVersionError extends Error {
  constructor(readonly version: string) {
    super(`Unsupported VideoPipelineResult contract version: ${version}`);
    this.name = "UnsupportedVideoContractVersionError";
  }
}

export function serializeVideoPipelineResult(
  result: VideoPipelineResult
): string {
  const validated = normalizedResult(videoPipelineResultSchema.parse(result));
  return JSON.stringify(canonicalize({
    ...validated.extensions,
    ...validated,
    extensions: validated.extensions,
  }));
}

export function deserializeVideoPipelineResult(
  serialized: string
): VideoPipelineResult {
  const parsed = JSON.parse(serialized) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("VideoPipelineResult must be a JSON object");
  }
  const version = String(
    (parsed as Record<string, unknown>).contractVersion ?? "legacy"
  );
  if (version !== VIDEO_PIPELINE_CONTRACT_VERSION) {
    if (version === "legacy") return readCompatibleVideoPipelineResult(parsed);
    throw new UnsupportedVideoContractVersionError(version);
  }
  return normalizedResult(videoPipelineResultSchema.parse(parsed));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function legacyRenderReferences(
  value: unknown,
  creativeIds: readonly string[]
): VideoRenderReference[] {
  const references = Array.isArray(value) ? value : [];
  const normalized = references.map((reference, index) => {
    const item = asRecord(reference);
    return {
      creativeId:
        typeof item.creativeId === "string"
          ? item.creativeId
          : creativeIds[index],
      videoUrl: typeof item.videoUrl === "string" ? item.videoUrl : undefined,
      previewUrl:
        typeof item.previewUrl === "string" ? item.previewUrl : undefined,
      coverUrl: typeof item.coverUrl === "string" ? item.coverUrl : undefined,
      storagePath:
        typeof item.storagePath === "string" ? item.storagePath : undefined,
      fingerprint:
        typeof item.fingerprint === "string" ? item.fingerprint : undefined,
      provider: typeof item.provider === "string" ? item.provider : undefined,
      metadata: item,
    };
  });
  return normalized.filter(
    (reference) =>
      reference.creativeId ||
      reference.videoUrl ||
      reference.previewUrl ||
      reference.storagePath
  );
}

function legacyCheckpoint(
  state: PipelineState,
  output: Record<string, unknown>,
  progress: Record<string, unknown>,
  explicitCheckpoint: unknown
): { phase: VideoPhase; checkpoint: VideoCheckpoint } {
  if (
    typeof explicitCheckpoint === "string" &&
    VIDEO_CHECKPOINTS.includes(explicitCheckpoint as VideoCheckpoint)
  ) {
    const checkpoint = explicitCheckpoint as VideoCheckpoint;
    if (checkpoint === "VIDEO_COMPLETE") {
      return { phase: "COMPLETE", checkpoint };
    }
    if (checkpoint === "VIDEO_GATES_COMPLETE") {
      return { phase: "FINALIZATION", checkpoint };
    }
    if (checkpoint === "VIDEO_RENDER_COMPLETE") {
      return { phase: "FINALIZATION", checkpoint };
    }
    if (checkpoint === "VIDEO_RENDERING") {
      return { phase: "RENDERING", checkpoint };
    }
    if (checkpoint === "VIDEO_RENDER_PENDING") {
      return { phase: "COMPOSITION", checkpoint };
    }
    if (checkpoint === "VIDEO_COMPOSITION_COMPLETE") {
      return { phase: "COMPOSITION", checkpoint };
    }
    if (checkpoint === "VIDEO_READY_FOR_MARKETING") {
      return { phase: "READY_FOR_MARKETING", checkpoint };
    }
    return { phase: "UNDERSTANDING", checkpoint };
  }
  const renders = legacyRenderReferences(
    output.renderedCreativeReferences ?? output.renderReferences,
    stringValues(output.creativeIds)
  );
  if (state === "COMPLETED" && renders.length > 0) {
    return { phase: "COMPLETE", checkpoint: "VIDEO_COMPLETE" };
  }
  if (asRecord(progress.ffmpeg_render).status === "completed") {
    return { phase: "FINALIZATION", checkpoint: "VIDEO_RENDER_COMPLETE" };
  }
  if (
    asRecord(progress.ffmpeg_render).status === "running" ||
    output.editPlanReferences
  ) {
    return { phase: "RENDERING", checkpoint: "VIDEO_RENDERING" };
  }
  if (output.selectedHighlightSegments) {
    return {
      phase: "READY_FOR_MARKETING",
      checkpoint: "VIDEO_READY_FOR_MARKETING",
    };
  }
  if (output.sceneAnalysis) {
    return {
      phase: "UNDERSTANDING",
      checkpoint: "VIDEO_SCENE_ANALYSIS_COMPLETE",
    };
  }
  if (output.transcriptReference) {
    return {
      phase: "UNDERSTANDING",
      checkpoint: "VIDEO_TRANSCRIPT_COMPLETE",
    };
  }
  return {
    phase: "UNDERSTANDING",
    checkpoint: "VIDEO_VALIDATION_COMPLETE",
  };
}

export function readCompatibleVideoPipelineResult(
  input: unknown
): VideoPipelineResult {
  const root = asRecord(input);
  if (root.contractVersion !== undefined) {
    const version = String(root.contractVersion);
    if (version !== VIDEO_PIPELINE_CONTRACT_VERSION) {
      throw new UnsupportedVideoContractVersionError(version);
    }
    return normalizedResult(videoPipelineResultSchema.parse(root));
  }

  const progress = (
    root.video_pipeline_output || root.vision_analyze || root.ffmpeg_render
      ? root
      : {}
  ) as Record<string, unknown>;
  const step = asRecord(progress.video_pipeline_output);
  const legacy = Object.keys(step).length > 0 ? asRecord(step.output) : root;
  const output = asRecord(legacy.output);
  const legacyOutput = Object.keys(output).length > 0 ? output : legacy;
  const legacyState =
    typeof legacy.state === "string" && PIPELINE_STATES.includes(legacy.state as PipelineState)
      ? (legacy.state as PipelineState)
      : asRecord(progress.ffmpeg_render).status === "completed"
        ? "COMPLETED"
        : "RUNNING";
  const assetIds = stringValues(legacy.assetIds);
  const legacySourceAssets = Array.isArray(legacy.sourceAssets)
    ? legacy.sourceAssets.map(asRecord)
    : [];
  const sourceAssets: VideoSourceReference[] =
    legacySourceAssets.length > 0
      ? legacySourceAssets
          .map((source) => ({
            assetId:
              typeof source.assetId === "string"
                ? source.assetId
                : typeof source.id === "string"
                  ? source.id
                  : "",
            mimeType:
              typeof source.mimeType === "string" ? source.mimeType : undefined,
            storagePath:
              typeof source.storagePath === "string"
                ? source.storagePath
                : undefined,
            metadata: source,
          }))
          .filter((source) => source.assetId)
      : assetIds.map((assetId) => ({ assetId }));
  const legacyCreativeReferences = Array.isArray(
    legacyOutput.creativeReferences
  )
    ? legacyOutput.creativeReferences.map(asRecord)
    : [];
  const creativeReferences: VideoCreativeReference[] =
    legacyCreativeReferences.length > 0
      ? legacyCreativeReferences
          .map((reference) => ({
            creativeId:
              typeof reference.creativeId === "string"
                ? reference.creativeId
                : typeof reference.id === "string"
                  ? reference.id
                  : "",
            status:
              typeof reference.status === "string"
                ? reference.status
                : undefined,
            lineage: reference,
          }))
          .filter((reference) => reference.creativeId)
      : stringValues(legacy.creativeIds).map((creativeId) => ({ creativeId }));
  const creativeIds = creativeReferences.map(
    (reference) => reference.creativeId
  );
  const renderReferences = legacyRenderReferences(
    legacyOutput.renderedCreativeReferences ?? legacyOutput.renderReferences,
    creativeIds
  );
  const checkpoint = legacyCheckpoint(
    legacyState,
    legacyOutput,
    progress,
    legacy.checkpoint
  );
  const hasRequiredUnderstanding =
    sourceAssets.length > 0 &&
    Object.keys(asRecord(legacyOutput.metadata)).length > 0 &&
    (legacyOutput.transcriptReference !== undefined ||
      legacyOutput.transcript !== undefined ||
      (Array.isArray(legacy.warnings) &&
        legacy.warnings.some(
          (warning) =>
            asRecord(warning).code === "VIDEO_TRANSCRIPT_UNAVAILABLE"
        ))) &&
    legacyOutput.sceneAnalysis !== undefined &&
    legacyOutput.selectedHighlightSegments !== undefined &&
    Object.keys(asRecord(legacy.confidence)).length > 0 &&
    Array.isArray(legacy.provenance) &&
    legacy.provenance.length > 0;
  const canonicalState: PipelineState =
    legacyState === "PARTIALLY_COMPLETE" &&
    (checkpoint.checkpoint !== "VIDEO_READY_FOR_MARKETING" ||
      !hasRequiredUnderstanding)
      ? "RUNNING"
      : legacyState === "COMPLETED" && renderReferences.length === 0
        ? "RUNNING"
        : legacyState;
  const canonicalCheckpoint =
    canonicalState === "COMPLETED"
      ? { phase: "COMPLETE" as const, checkpoint: "VIDEO_COMPLETE" as const }
      : legacyState === "PARTIALLY_COMPLETE" &&
          canonicalState !== "PARTIALLY_COMPLETE"
        ? {
            phase: "UNDERSTANDING" as const,
            checkpoint: "VIDEO_UNDERSTANDING_COMPLETE" as const,
          }
      : checkpoint;
  const warnings = Array.isArray(legacy.warnings)
    ? (legacy.warnings as PipelineWarning[])
    : [];
  if (
    canonicalState === "PARTIALLY_COMPLETE" &&
    !warnings.some((warning) => warning.code === "VIDEO_RENDER_PENDING")
  ) {
    warnings.push({
      code: "VIDEO_RENDER_PENDING",
      message:
        "Marketing uses validated Video understanding while composition and rendering remain pending.",
      retryable: false,
    });
  }

  return createVideoPipelineResult({
    state: canonicalState,
    phase: canonicalCheckpoint.phase,
    checkpoint: canonicalCheckpoint.checkpoint,
    sourceAssets,
    metadata: asRecord(legacyOutput.metadata),
    transcript: legacyOutput.transcriptReference ?? legacyOutput.transcript,
    sceneAnalysis: legacyOutput.sceneAnalysis,
    suggestedMoments: legacyOutput.suggestedMoments,
    selectedHighlights: legacyOutput.selectedHighlightSegments,
    editPlans: legacyOutput.editPlanReferences,
    subtitleReferences: legacyOutput.subtitleReferences,
    creativeReferences,
    renderReferences,
    warnings,
    confidence: asRecord(legacy.confidence) as Record<string, number>,
    provenance: Array.isArray(legacy.provenance)
      ? (legacy.provenance as PipelineProvenance[])
      : assetIds.map((assetId) => ({
          source: "legacy_video_pipeline",
          pipelineType: "VIDEO" as const,
          assetId,
        })),
    extensions: {
      legacy: true,
      legacyCheckpoint: legacy.checkpoint,
      legacyStepStatus: step.status,
      legacyCreativeReferences: legacyOutput.creativeReferences,
      legacyRenderReferences: legacyOutput.renderedCreativeReferences,
    },
  });
}

export function readVideoPipelineResultFromProgress(
  progress: StepProgress | Record<string, unknown>
): VideoPipelineResult | undefined {
  const root = progress as Record<string, unknown>;
  const step = asRecord(root.video_pipeline_output);
  if (Object.keys(step).length === 0 || step.output === undefined) return undefined;
  return readCompatibleVideoPipelineResult(root);
}
