/**
 * Lazy first-use video observation.
 * Upload does not call this. A valid snapshot is reused. A missing snapshot is
 * claimed once, observed, classified, and stored. Director execution is not invoked.
 */
import { randomUUID } from "node:crypto";
import {
  AI_STORY_VIDEO_ANALYSIS_TYPE,
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
  AI_STORY_VIDEO_OBSERVATION_PROMPT,
  AI_STORY_VIDEO_OBSERVATION_SCHEMA_HINT,
  mergeTrustedVideoObservation,
  videoObservationInputFingerprint,
  type AiStoryVideoAnalysisReuseKey,
  type AiStoryVideoAnalysisSnapshotRecord,
  type AiStoryVideoAnalysisSnapshotRepository,
} from "@ceo-agent/shared";
import { classifyAiStoryVideoAssetAnalysis } from "@ceo-agent/shared";

export const AI_STORY_VIDEO_OBSERVATION_MODEL = "gpt-4o" as const;

export class AiStoryVideoAnalysisServiceError extends Error {
  constructor(
    readonly code:
      | "VIDEO_ASSET_OUT_OF_SCOPE"
      | "VIDEO_ASSET_CONTENT_HASH_MISMATCH"
      | "VIDEO_ANALYSIS_PREPARATION_FAILED"
      | "VIDEO_OBSERVATION_INVALID"
      | "VIDEO_ANALYSIS_CLASSIFICATION_FAILED"
      | "VIDEO_ANALYSIS_CLAIM_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "AiStoryVideoAnalysisServiceError";
  }
}

export type AuthorizedVideoAsset = {
  readonly assetId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storagePath: string;
  readonly contentHash: string;
  readonly mimeType: string | null;
  readonly mediaType: string;
  readonly durationSec: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  readonly deletedAt: string | null;
};

export type PreparedVideoObservationMedia = {
  readonly frames: readonly { readonly atSec: number; readonly dataUrl: string }[];
  readonly transcriptSummary?: string;
};

export type VideoObservationExtractorResult = {
  readonly raw: unknown;
  readonly providerId: string;
  readonly requestedModelId: string;
  readonly providerModelId: string | null;
  readonly providerRequestId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
};

export type EnsureAiStoryVideoAssetAnalysisResult = {
  readonly reused: boolean;
  readonly providerCalls: number;
  readonly providerCostUsd: number;
  readonly snapshot: AiStoryVideoAnalysisSnapshotRecord;
};

function reuseKey(asset: AuthorizedVideoAsset): AiStoryVideoAnalysisReuseKey {
  return {
    workspaceId: asset.workspaceId,
    assetId: asset.assetId,
    assetContentHash: asset.contentHash,
    analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
    extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
  };
}

function assertAuthorizedVideo(asset: AuthorizedVideoAsset | null, requested: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assetId: string;
  readonly contentHash: string;
}): AuthorizedVideoAsset {
  if (
    !asset ||
    asset.deletedAt ||
    asset.orgId !== requested.orgId ||
    asset.workspaceId !== requested.workspaceId ||
    asset.assetId !== requested.assetId
  ) {
    throw new AiStoryVideoAnalysisServiceError(
      "VIDEO_ASSET_OUT_OF_SCOPE",
      "The video asset is outside the authorized workspace",
    );
  }
  if (asset.mediaType !== "video" && !asset.mimeType?.toLowerCase().startsWith("video/")) {
    throw new AiStoryVideoAnalysisServiceError("VIDEO_ASSET_OUT_OF_SCOPE", "The asset is not a video");
  }
  if (asset.contentHash !== requested.contentHash) {
    throw new AiStoryVideoAnalysisServiceError(
      "VIDEO_ASSET_CONTENT_HASH_MISMATCH",
      "The requested content hash does not match the stored asset",
    );
  }
  if (!asset.durationSec || asset.durationSec <= 0 || !asset.width || !asset.height) {
    throw new AiStoryVideoAnalysisServiceError(
      "VIDEO_ANALYSIS_PREPARATION_FAILED",
      "Canonical video duration and dimensions are required",
    );
  }
  return asset;
}

async function claimOrReuse(input: {
  readonly repository: AiStoryVideoAnalysisSnapshotRepository;
  readonly key: AiStoryVideoAnalysisReuseKey;
  readonly orgId: string;
}): Promise<
  | { readonly kind: "snapshot"; readonly snapshot: AiStoryVideoAnalysisSnapshotRecord }
  | { readonly kind: "claim"; readonly claimId: string }
> {
  const existing = await input.repository.findSucceededSnapshot(input.key);
  if (existing) return { kind: "snapshot", snapshot: existing };
  const claim = await input.repository.tryClaim({ ...input.key, orgId: input.orgId });
  if (claim.acquired) return { kind: "claim", claimId: claim.claimId };
  const settled = await input.repository.waitForSettlement(input.key);
  if (settled.snapshot) return { kind: "snapshot", snapshot: settled.snapshot };
  if (!settled.failed) {
    throw new AiStoryVideoAnalysisServiceError(
      "VIDEO_ANALYSIS_CLAIM_FAILED",
      "Another analysis claim is still in progress",
    );
  }
  const retry = await input.repository.tryClaim({ ...input.key, orgId: input.orgId });
  if (!retry.acquired) {
    throw new AiStoryVideoAnalysisServiceError(
      "VIDEO_ANALYSIS_CLAIM_FAILED",
      "The analysis claim could not be acquired",
    );
  }
  return { kind: "claim", claimId: retry.claimId };
}

export async function ensureAiStoryVideoAssetAnalysis(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly planningContext?: { readonly campaignId?: string; readonly episodeId?: string; readonly sceneId?: string };
  readonly findAsset: (requested: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly assetId: string;
  }) => Promise<AuthorizedVideoAsset | null>;
  readonly repository: AiStoryVideoAnalysisSnapshotRepository;
  readonly prepareVision: (asset: AuthorizedVideoAsset) => Promise<PreparedVideoObservationMedia>;
  readonly extractObservation: (prepared: PreparedVideoObservationMedia) => Promise<VideoObservationExtractorResult>;
  readonly now?: () => string;
}): Promise<EnsureAiStoryVideoAssetAnalysisResult> {
  const asset = assertAuthorizedVideo(
    await input.findAsset({
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      assetId: input.assetId,
    }),
    input,
  );
  const key = reuseKey(asset);
  const claim = await claimOrReuse({ repository: input.repository, key, orgId: asset.orgId });
  if (claim.kind === "snapshot") {
    return { reused: true, providerCalls: 0, providerCostUsd: 0, snapshot: claim.snapshot };
  }

  try {
    const prepared = await input.prepareVision(asset);
    if (prepared.frames.length < 1) {
      throw new AiStoryVideoAnalysisServiceError(
        "VIDEO_ANALYSIS_PREPARATION_FAILED",
        "Vision preparation produced no frames",
      );
    }
    const extracted = await input.extractObservation(prepared);
    const analyzedAt = (input.now ?? (() => new Date().toISOString()))();
    await input.repository.recordProviderAttempt(claim.claimId, {
      providerId: extracted.providerId,
      requestedModelId: extracted.requestedModelId,
      providerModelId: extracted.providerModelId,
      providerRequestId: extracted.providerRequestId,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      costUsd: extracted.costUsd,
      attemptedAt: analyzedAt,
      rawProviderObservation: extracted.raw,
    });
    let observation;
    try {
      observation = mergeTrustedVideoObservation({
        videoAssetId: asset.assetId,
        contentHash: asset.contentHash,
        durationMs: Math.round(asset.durationSec! * 1000),
        durationSec: asset.durationSec!,
        width: asset.width!,
        height: asset.height!,
        fps: asset.fps,
        orgId: asset.orgId,
        workspaceId: asset.workspaceId,
        analyzedAt,
      }, extracted.raw);
    } catch (error) {
      throw new AiStoryVideoAnalysisServiceError(
        "VIDEO_OBSERVATION_INVALID",
        error instanceof Error ? error.message : "The observation model returned an invalid observation",
      );
    }
    let analysis;
    try {
      analysis = classifyAiStoryVideoAssetAnalysis(observation);
    } catch (error) {
      throw new AiStoryVideoAnalysisServiceError(
        "VIDEO_ANALYSIS_CLASSIFICATION_FAILED",
        error instanceof Error ? error.message : "Classification rejected the observation",
      );
    }
    const snapshot: AiStoryVideoAnalysisSnapshotRecord = {
      id: randomUUID(),
      orgId: asset.orgId,
      workspaceId: asset.workspaceId,
      assetId: asset.assetId,
      assetContentHash: asset.contentHash,
      analysisType: AI_STORY_VIDEO_ANALYSIS_TYPE,
      analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
      extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
      observation,
      rawProviderObservation: extracted.raw,
      analysis,
      providerId: extracted.providerId,
      modelId: extracted.providerModelId ?? extracted.requestedModelId,
      requestedModelId: extracted.requestedModelId,
      providerModelId: extracted.providerModelId,
      providerRequestId: extracted.providerRequestId,
      inputTokens: extracted.inputTokens,
      outputTokens: extracted.outputTokens,
      inputFingerprint: videoObservationInputFingerprint(key),
      costUsd: extracted.costUsd,
      createdAt: observation.analyzedAt,
    };
    const stored = await input.repository.insertSnapshot(snapshot);
    await input.repository.completeClaim(claim.claimId, stored.id);
    return {
      reused: false,
      providerCalls: 1,
      providerCostUsd: extracted.costUsd,
      snapshot: stored,
    };
  } catch (error) {
    await input.repository.failClaim(
      claim.claimId,
      error instanceof AiStoryVideoAnalysisServiceError ? error.code : "VIDEO_ANALYSIS_PREPARATION_FAILED",
    );
    throw error;
  }
}

export async function extractOpenAiVideoObservation(input: {
  readonly callVision: (
    system: string,
    userText: string,
    imageDataUrls: string[],
    schemaHint: string,
  ) => Promise<{
    result: unknown;
    usage: { input: number; output: number; costUsd: number };
    providerRequestId?: string | null;
    requestedModelId: string;
    providerModelId: string | null;
  }>;
  readonly prepared: PreparedVideoObservationMedia;
}): Promise<VideoObservationExtractorResult> {
  const userText = [
    AI_STORY_VIDEO_OBSERVATION_PROMPT,
    "Sampled frames:",
    ...input.prepared.frames.map((frame) => `- frame at ${frame.atSec}s`),
    input.prepared.transcriptSummary
      ? `Transcript summary: ${input.prepared.transcriptSummary}`
      : "Transcript summary: none",
  ].join("\n");
  const response = await input.callVision(
    AI_STORY_VIDEO_OBSERVATION_PROMPT,
    userText,
    input.prepared.frames.map((frame) => frame.dataUrl),
    AI_STORY_VIDEO_OBSERVATION_SCHEMA_HINT,
  );
  return {
    raw: response.result,
    providerId: "openai",
    requestedModelId: response.requestedModelId,
    providerModelId: response.providerModelId,
    providerRequestId: response.providerRequestId ?? null,
    inputTokens: response.usage.input,
    outputTokens: response.usage.output,
    costUsd: response.usage.costUsd,
  };
}
