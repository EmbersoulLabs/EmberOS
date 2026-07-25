import type { CompositionResult } from "@ceo-agent/agents";
import type { EditPlan, RenderPhase } from "@ceo-agent/shared";
import {
  RENDER_PROVIDER_CONTRACT_VERSION,
  renderFingerprint,
  validateRenderRequest,
  validateRenderResult,
  type RenderCorrelation,
  type RenderOutputProfile,
  type RenderProvider,
  type RenderProviderCapability,
  type RenderQualityProfile,
  type RenderRequest,
  type RenderResult,
  type RenderSourceAsset,
  type RenderWarning,
} from "./render-providers/contracts";
import { selectRenderProvider } from "./render-providers";

export const RENDER_ORCHESTRATOR_CONTRACT_VERSION = "1" as const;

export type RenderCheckpoint =
  | "VIDEO_RENDER_PENDING"
  | "VIDEO_RENDERING"
  | "VIDEO_RENDER_COMPLETE";

export type NormalizedRenderStage =
  | "QUEUED"
  | "ACCEPTED"
  | "PREPARING"
  | "RENDERING"
  | "UPLOADING"
  | "COMPLETED"
  | "FAILED";

export interface NormalizedRenderProgress {
  readonly correlationId: string;
  readonly providerId: string;
  readonly stage: NormalizedRenderStage;
  readonly percent?: number;
  readonly timestamp: string;
  readonly warnings: readonly RenderWarning[];
}

export interface RenderCheckpointEvent {
  readonly checkpoint: RenderCheckpoint;
  readonly status: "WAITING_FOR_DEPENDENCY" | "RUNNING" | "COMPLETED";
  readonly progress?: NormalizedRenderProgress;
  readonly providerId?: string;
  readonly resultFingerprint?: string;
  readonly output?: RenderOrchestrationResult;
}

export interface RenderProgressSummary {
  readonly lastStage: NormalizedRenderStage;
  readonly lastPercent?: number;
  readonly eventCount: number;
}

export interface RenderOrchestrationResult {
  readonly contractVersion: typeof RENDER_ORCHESTRATOR_CONTRACT_VERSION;
  readonly pipelineType: "VIDEO_RENDER";
  readonly state: "PARTIALLY_COMPLETE";
  readonly checkpoint: "VIDEO_RENDER_COMPLETE";
  readonly providerId: string;
  readonly renderRequestFingerprint: string;
  readonly renderResult: RenderResult;
  readonly progress: RenderProgressSummary;
  readonly warnings: readonly RenderWarning[];
  readonly provenance: RenderResult["provenance"];
  readonly deterministicKey: string;
}

export interface RenderRequestContext {
  readonly sourceAssets: readonly RenderSourceAsset[];
  readonly outputProfile: RenderOutputProfile;
  readonly qualityProfile: RenderQualityProfile;
  readonly retry: {
    readonly attempt: number;
    readonly cachedOutputUri?: string;
  };
  readonly correlation: RenderCorrelation;
  readonly destinations: RenderRequest["destinations"];
  readonly cachedBaseUri?: string;
  readonly sourceDurationSec?: number;
  readonly cover?: RenderRequest["cover"];
  readonly branding?: RenderRequest["branding"];
  readonly legacyEditPlan?: EditPlan;
}

export interface RenderOrchestratorInput {
  readonly compositionResult: CompositionResult;
  readonly creativeDraftId: string;
  readonly requestContext: RenderRequestContext;
  readonly requiredCapabilities: readonly RenderProviderCapability[];
  readonly resumeFrom?: "VIDEO_RENDER_PENDING" | "VIDEO_RENDERING";
  readonly completedResult?: RenderOrchestrationResult;
  readonly canReuseCompletedResult?: (
    result: RenderOrchestrationResult
  ) => boolean | Promise<boolean>;
  readonly selectProvider?: (
    requiredCapabilities: readonly RenderProviderCapability[]
  ) => RenderProvider;
  readonly persistCheckpoint?: (
    event: RenderCheckpointEvent
  ) => void | Promise<void>;
  readonly onProgress?: (
    progress: NormalizedRenderProgress
  ) => void | Promise<void>;
}

function assertComposition(
  compositionResult: CompositionResult,
  creativeDraftId: string
) {
  if (
    compositionResult.state !== "COMPLETED" ||
    compositionResult.checkpoint !== "VIDEO_COMPOSITION_COMPLETE"
  ) {
    throw new Error(
      "Render requires VIDEO_COMPOSITION_COMPLETE CompositionResult"
    );
  }
  const draft = compositionResult.creativeDrafts.find(
    (candidate) => candidate.creativeId === creativeDraftId
  );
  if (!draft || draft.status !== "draft") {
    throw new Error("Render requires a valid Creative Draft reference");
  }
  if (!draft.renderSpecification.deterministicKey) {
    throw new Error("Render requires a canonical Render Specification");
  }
  return draft;
}

export function buildRenderRequest(
  compositionResult: CompositionResult,
  creativeDraftId: string,
  context: RenderRequestContext
): RenderRequest {
  const draft = assertComposition(compositionResult, creativeDraftId);
  const requestFingerprint = renderFingerprint({
    composition: compositionResult.deterministicKey,
    creativeDraft: {
      creativeId: draft.creativeId,
      stableKey: draft.stableKey,
    },
    renderSpecification: draft.renderSpecification.deterministicKey,
    sourceAssets: context.sourceAssets.map((asset) => ({
      assetId: asset.assetId,
      mediaType: asset.mediaType,
    })),
    outputProfile: context.outputProfile,
    qualityProfile: context.qualityProfile,
    correlation: context.correlation,
  });

  return validateRenderRequest({
    contractVersion: RENDER_PROVIDER_CONTRACT_VERSION,
    renderSpecification: structuredClone(draft.renderSpecification),
    creativeDraftReferences: [
      { creativeId: draft.creativeId, stableKey: draft.stableKey },
    ],
    sourceAssets: context.sourceAssets.map((asset) => ({ ...asset })),
    outputProfile: { ...context.outputProfile },
    qualityProfile: { ...context.qualityProfile },
    retry: {
      attempt: context.retry.attempt,
      deterministicKey: requestFingerprint,
      cachedOutputUri: context.retry.cachedOutputUri,
    },
    correlation: { ...context.correlation },
    destinations: { ...context.destinations },
    cachedBaseUri: context.cachedBaseUri,
    sourceDurationSec: context.sourceDurationSec,
    cover: context.cover ? { ...context.cover } : undefined,
    branding: context.branding ? { ...context.branding } : undefined,
    legacyEditPlan: context.legacyEditPlan
      ? structuredClone(context.legacyEditPlan)
      : undefined,
  });
}

function assertReference(
  references: RenderResult["outputReferences"],
  label: string
): void {
  if (
    references.length === 0 ||
    references.some((reference) => !reference.uri.trim())
  ) {
    throw new Error(`RenderResult requires valid ${label}`);
  }
}

function sameCorrelation(
  expected: RenderCorrelation,
  actual: RenderCorrelation
): boolean {
  return (
    expected.taskId === actual.taskId &&
    expected.creativeId === actual.creativeId &&
    expected.campaignId === actual.campaignId &&
    expected.workspaceId === actual.workspaceId &&
    expected.orgId === actual.orgId &&
    expected.correlationId === actual.correlationId
  );
}

export function validateCompletedRenderResult(
  request: RenderRequest,
  value: unknown
): RenderResult {
  const result = validateRenderResult(value);
  if (result.status !== "COMPLETED") {
    throw new Error(`Render provider did not complete: ${result.status}`);
  }
  const finalOutputs = result.outputReferences.filter(
    (reference) => reference.role === "output"
  );
  assertReference(finalOutputs, "final output references");
  if (request.outputProfile.mode === "preview") {
    assertReference(result.previewReferences, "preview references");
  }
  if (request.destinations.coverOutputUri) {
    assertReference(result.coverReferences, "cover references");
  }
  if (!Number.isFinite(result.durationSec) || result.durationSec <= 0) {
    throw new Error("RenderResult requires a positive duration");
  }
  if (
    !Number.isFinite(result.resolution.width) ||
    !Number.isFinite(result.resolution.height) ||
    result.resolution.width <= 0 ||
    result.resolution.height <= 0
  ) {
    throw new Error("RenderResult requires a valid resolution");
  }
  if (!result.fingerprint.trim()) {
    throw new Error("RenderResult requires a fingerprint");
  }
  if (result.providerMetadata.providerId.trim() === "") {
    throw new Error("RenderResult requires Provider identity");
  }
  if (!sameCorrelation(request.correlation, result.correlation)) {
    throw new Error("RenderResult correlation does not match RenderRequest");
  }
  if (
    result.provenance.length === 0 ||
    result.provenance.some(
      (entry) =>
        !entry.providerId.trim() ||
        !entry.renderSpecificationKey.trim() ||
        entry.renderSpecificationKey !==
          request.renderSpecification.deterministicKey ||
        entry.correlationId !== request.correlation.correlationId ||
        !entry.timestamp.trim()
    )
  ) {
    throw new Error("RenderResult requires traceable provenance");
  }
  return result;
}

export function normalizeRenderProgress(
  phase: RenderPhase,
  percent: number,
  providerId: string,
  correlationId: string,
  warnings: readonly RenderWarning[] = []
): NormalizedRenderProgress {
  const stage: NormalizedRenderStage =
    phase === "queued"
      ? "QUEUED"
      : phase === "downloading"
        ? "PREPARING"
        : phase === "upload"
          ? "UPLOADING"
          : phase === "done"
            ? "COMPLETED"
            : "RENDERING";
  return {
    correlationId,
    providerId,
    stage,
    percent,
    timestamp: new Date().toISOString(),
    warnings,
  };
}

function orchestrationResult(
  request: RenderRequest,
  providerId: string,
  renderResult: RenderResult,
  progress: RenderProgressSummary
): RenderOrchestrationResult {
  const body = {
    contractVersion: RENDER_ORCHESTRATOR_CONTRACT_VERSION,
    pipelineType: "VIDEO_RENDER" as const,
    state: "PARTIALLY_COMPLETE" as const,
    checkpoint: "VIDEO_RENDER_COMPLETE" as const,
    providerId,
    renderRequestFingerprint: request.retry.deterministicKey,
    renderResult,
    progress,
    warnings: renderResult.warnings,
    provenance: renderResult.provenance,
  };
  return {
    ...body,
    deterministicKey: renderFingerprint({
      request: body.renderRequestFingerprint,
      providerId,
      result: renderResult.fingerprint,
    }),
  };
}

export async function runRenderOrchestrator(
  input: RenderOrchestratorInput
): Promise<RenderOrchestrationResult> {
  const request = buildRenderRequest(
    input.compositionResult,
    input.creativeDraftId,
    input.requestContext
  );

  if (
    input.completedResult?.checkpoint === "VIDEO_RENDER_COMPLETE" &&
    input.completedResult.renderRequestFingerprint ===
      request.retry.deterministicKey &&
    (await (input.canReuseCompletedResult?.(input.completedResult) ?? true))
  ) {
    validateCompletedRenderResult(
      request,
      input.completedResult.renderResult
    );
    return input.completedResult;
  }

  if (!input.resumeFrom) {
    await input.persistCheckpoint?.({
      checkpoint: "VIDEO_RENDER_PENDING",
      status: "WAITING_FOR_DEPENDENCY",
    });
  }

  const select = input.selectProvider ?? selectRenderProvider;
  const provider = select(input.requiredCapabilities);
  let eventCount = 0;
  let accepted = false;
  const bufferedProgress: NormalizedRenderProgress[] = [];
  let lastProgress: NormalizedRenderProgress = {
    correlationId: request.correlation.correlationId,
    providerId: provider.id,
    stage: "ACCEPTED",
    timestamp: new Date().toISOString(),
    warnings: [],
  };
  const emitProgress = async (progress: NormalizedRenderProgress) => {
    lastProgress = progress;
    eventCount += 1;
    await input.onProgress?.(progress);
    await input.persistCheckpoint?.({
      checkpoint: "VIDEO_RENDERING",
      status: "RUNNING",
      progress,
      providerId: provider.id,
    });
  };
  const execution = provider.execute(request, async (percent, phase) => {
    const progress = normalizeRenderProgress(
      phase,
      percent,
      provider.id,
      request.correlation.correlationId
    );
    if (!accepted) {
      bufferedProgress.push(progress);
      return;
    }
    await emitProgress(progress);
  });

  eventCount += 1;
  await input.onProgress?.(lastProgress);
  await input.persistCheckpoint?.({
    checkpoint: "VIDEO_RENDERING",
    status: "RUNNING",
    progress: lastProgress,
    providerId: provider.id,
  });
  while (bufferedProgress.length > 0) {
    await emitProgress(bufferedProgress.shift()!);
  }
  accepted = true;

  let providerResult: RenderResult;
  try {
    providerResult = await execution;
  } catch (error) {
    const failed: NormalizedRenderProgress = {
      correlationId: request.correlation.correlationId,
      providerId: provider.id,
      stage: "FAILED",
      timestamp: new Date().toISOString(),
      warnings: [
        {
          code: "RENDER_PROVIDER_FAILED",
          message:
            error instanceof Error ? error.message : "Render provider failed",
          retryable: true,
        },
      ],
    };
    await input.onProgress?.(failed);
    throw error;
  }

  const renderResult = validateCompletedRenderResult(request, providerResult);
  const completed: NormalizedRenderProgress = {
    correlationId: request.correlation.correlationId,
    providerId: provider.id,
    stage: "COMPLETED",
    percent: 100,
    timestamp: new Date().toISOString(),
    warnings: renderResult.warnings,
  };
  eventCount += 1;
  await input.onProgress?.(completed);

  const result = orchestrationResult(request, provider.id, renderResult, {
    lastStage: completed.stage,
    lastPercent: completed.percent,
    eventCount,
  });
  await input.persistCheckpoint?.({
    checkpoint: "VIDEO_RENDER_COMPLETE",
    status: "COMPLETED",
    progress: completed,
    providerId: provider.id,
    resultFingerprint: renderResult.fingerprint,
    output: result,
  });
  return result;
}
