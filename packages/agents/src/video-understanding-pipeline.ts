import type {
  CampaignAIContext,
  StepProgress,
  VisionAnalysis,
} from "@ceo-agent/shared";
import {
  buildHighlightIndex,
  type HighlightSegment,
  type TranscriptSegment,
} from "./highlight-index";
import { runVisionAgent, type VisionFrameInput } from "./vision";
import {
  createVideoPipelineResult,
  type VideoCheckpoint,
  type VideoPipelineResult,
} from "./video-pipeline-contract";
import type {
  PipelineExecutionResult,
  PipelineWarning,
} from "./workflow-contracts";

export interface VideoUnderstandingSource {
  assetId: string;
  storagePath: string;
  mimeType?: string | null;
  status?: string | null;
  durationSec: number;
}

export interface PreparedVideoUnderstandingMedia {
  frames: VisionFrameInput[];
  transcriptSummary?: string;
  transcriptSegments?: TranscriptSegment[];
}

export interface VideoUnderstandingUsage {
  input: number;
  output: number;
  costUsd: number;
}

export interface VideoUnderstandingDependencies {
  prepareMedia?: (
    source: VideoUnderstandingSource
  ) => Promise<PreparedVideoUnderstandingMedia>;
  analyzeVision?: typeof runVisionAgent;
}

export interface VideoUnderstandingCheckpointEvent {
  checkpoint: VideoCheckpoint;
  status: "running" | "completed";
  output?: unknown;
}

export interface VideoUnderstandingPipelineInput {
  source: VideoUnderstandingSource;
  campaignContext: CampaignAIContext;
  campaignName?: string;
  videoAnalysis?: string | null;
  highlightKeywords?: string[];
  progress?: StepProgress;
  dependencies?: VideoUnderstandingDependencies;
  persistCheckpoint?: (
    event: VideoUnderstandingCheckpointEvent
  ) => Promise<void>;
}

export interface VideoUnderstandingPipelineOutput {
  result: VideoPipelineResult;
  vision: VisionAnalysis;
  transcriptSummary?: string;
  transcriptSegments: TranscriptSegment[];
  highlights: HighlightSegment[];
  usage: VideoUnderstandingUsage;
  resumedCheckpoints: VideoCheckpoint[];
}

export function videoUnderstandingAsPipelineResult(
  result: VideoPipelineResult
): PipelineExecutionResult {
  return {
    pipelineType: "VIDEO",
    state: result.state,
    assetIds: result.sourceAssets.map((asset) => asset.assetId),
    creativeIds: result.creativeReferences.map(
      (creative) => creative.creativeId
    ),
    output: {
      contractVersion: result.contractVersion,
      phase: result.phase,
      checkpoint: result.checkpoint,
      metadata: result.metadata,
      transcriptReference: result.transcript ?? null,
      sceneAnalysis: result.sceneAnalysis ?? null,
      suggestedMoments: result.suggestedMoments ?? null,
      selectedHighlightSegments: result.selectedHighlights ?? null,
    },
    warnings: [...result.warnings],
    confidence: { ...result.confidence },
    provenance: [...result.provenance],
    deterministicKey: result.deterministicKey,
  };
}

const ZERO_USAGE: VideoUnderstandingUsage = {
  input: 0,
  output: 0,
  costUsd: 0,
};

function checkpointStep(
  progress: StepProgress,
  checkpoint: VideoCheckpoint
): StepProgress[string] | undefined {
  return progress[checkpoint];
}

function completedOutput<T>(
  progress: StepProgress,
  checkpoint: VideoCheckpoint
): T | undefined {
  const step = checkpointStep(progress, checkpoint);
  return step?.status === "completed" ? (step.output as T) : undefined;
}

async function persist(
  input: VideoUnderstandingPipelineInput,
  checkpoint: VideoCheckpoint,
  status: VideoUnderstandingCheckpointEvent["status"],
  output?: unknown
): Promise<void> {
  await input.persistCheckpoint?.({ checkpoint, status, output });
}

function validateSource(source: VideoUnderstandingSource): void {
  if (!source.assetId.trim()) throw new Error("Video source Asset ID is required");
  if (!source.storagePath.trim()) {
    throw new Error("Video source storage path is required");
  }
  if (source.status && source.status !== "ready") {
    throw new Error(`Video source Asset is not ready: ${source.status}`);
  }
  if (source.mimeType && !source.mimeType.startsWith("video/")) {
    throw new Error(`Unsupported Video MIME type: ${source.mimeType}`);
  }
  if (!Number.isFinite(source.durationSec) || source.durationSec <= 0) {
    throw new Error("Video source duration must be greater than zero");
  }
}

function metadataFor(source: VideoUnderstandingSource): Record<string, unknown> {
  return {
    assetId: source.assetId,
    storagePath: source.storagePath,
    mimeType: source.mimeType ?? "video/unknown",
    durationSec: source.durationSec,
  };
}

function transcriptWarning(): PipelineWarning {
  return {
    code: "VIDEO_TRANSCRIPT_UNAVAILABLE",
    message:
      "Audio transcript is unavailable; Video understanding uses validated visual analysis.",
    retryable: false,
    assetId: undefined,
  };
}

function renderPendingWarning(): PipelineWarning {
  return {
    code: "VIDEO_RENDER_PENDING",
    message:
      "Marketing uses validated Video understanding while composition and rendering remain pending.",
    retryable: false,
  };
}

function legacyVision(progress: StepProgress): VisionAnalysis | undefined {
  return progress.vision_analyze?.status === "completed"
    ? (progress.vision_analyze.output as VisionAnalysis)
    : undefined;
}

function legacyHighlights(
  progress: StepProgress
): HighlightSegment[] | undefined {
  return progress.highlight_index?.status === "completed"
    ? (progress.highlight_index.output as HighlightSegment[])
    : undefined;
}

function transcriptCheckpoint(
  progress: StepProgress
):
  | {
      summary?: string;
      segments: TranscriptSegment[];
      available: boolean;
    }
  | undefined {
  return completedOutput(progress, "VIDEO_TRANSCRIPT_COMPLETE");
}

/**
 * Canonical AD-002 Video Understanding boundary.
 *
 * This module normalizes existing preparation, Vision, and Highlight
 * capabilities. It deliberately stops at READY_FOR_MARKETING.
 */
export async function runVideoUnderstandingPipeline(
  input: VideoUnderstandingPipelineInput
): Promise<VideoUnderstandingPipelineOutput> {
  const progress = input.progress ?? {};
  const resumedCheckpoints: VideoCheckpoint[] = [];

  const validation = completedOutput<Record<string, unknown>>(
    progress,
    "VIDEO_VALIDATION_COMPLETE"
  );
  if (validation) {
    resumedCheckpoints.push("VIDEO_VALIDATION_COMPLETE");
  } else {
    await persist(input, "VIDEO_VALIDATION_COMPLETE", "running");
    validateSource(input.source);
    await persist(input, "VIDEO_VALIDATION_COMPLETE", "completed", {
      valid: true,
      assetId: input.source.assetId,
    });
  }

  let metadata = completedOutput<Record<string, unknown>>(
    progress,
    "VIDEO_METADATA_COMPLETE"
  );
  if (metadata) {
    resumedCheckpoints.push("VIDEO_METADATA_COMPLETE");
  } else {
    await persist(input, "VIDEO_METADATA_COMPLETE", "running");
    metadata = metadataFor(input.source);
    await persist(
      input,
      "VIDEO_METADATA_COMPLETE",
      "completed",
      metadata
    );
  }

  const persistedTranscript = transcriptCheckpoint(progress);
  let transcriptSummary = persistedTranscript?.summary;
  let transcriptSegments = persistedTranscript?.segments ?? [];
  let preparedFrames: VisionFrameInput[] = [];
  let preparedMediaLoaded = false;
  let transcriptAvailable = persistedTranscript?.available ?? false;
  const canonicalVision = completedOutput<VisionAnalysis>(
    progress,
    "VIDEO_SCENE_ANALYSIS_COMPLETE"
  );
  const reusedLegacyVision = canonicalVision ? undefined : legacyVision(progress);
  const persistedVision = canonicalVision ?? reusedLegacyVision;

  if (persistedTranscript) {
    resumedCheckpoints.push("VIDEO_TRANSCRIPT_COMPLETE");
  } else if (!persistedVision) {
    await persist(input, "VIDEO_TRANSCRIPT_COMPLETE", "running");
    const prepared = input.dependencies?.prepareMedia
      ? await input.dependencies.prepareMedia(input.source)
      : { frames: [] };
    preparedMediaLoaded = true;
    preparedFrames = prepared.frames;
    transcriptSummary = prepared.transcriptSummary;
    transcriptSegments = prepared.transcriptSegments ?? [];
    transcriptAvailable = Boolean(
      transcriptSummary?.trim() || transcriptSegments.length > 0
    );
    await persist(input, "VIDEO_TRANSCRIPT_COMPLETE", "completed", {
      summary: transcriptSummary,
      segments: transcriptSegments,
      available: transcriptAvailable,
    });
  } else {
    transcriptSummary = persistedVision.transcriptSummary;
    transcriptAvailable = Boolean(transcriptSummary?.trim());
    await persist(input, "VIDEO_TRANSCRIPT_COMPLETE", "completed", {
      summary: transcriptSummary,
      segments: transcriptSegments,
      available: transcriptAvailable,
    });
  }

  if (
    !persistedVision &&
    !preparedMediaLoaded &&
    input.dependencies?.prepareMedia
  ) {
    const prepared = await input.dependencies.prepareMedia(input.source);
    preparedFrames = prepared.frames;
  }

  let vision = persistedVision;
  let usage = ZERO_USAGE;
  if (canonicalVision) {
    resumedCheckpoints.push("VIDEO_SCENE_ANALYSIS_COMPLETE");
  } else if (reusedLegacyVision) {
    await persist(
      input,
      "VIDEO_SCENE_ANALYSIS_COMPLETE",
      "completed",
      reusedLegacyVision
    );
  } else {
    await persist(input, "VIDEO_SCENE_ANALYSIS_COMPLETE", "running");
    const analyzeVision =
      input.dependencies?.analyzeVision ?? runVisionAgent;
    const execution = await analyzeVision({
      assetId: input.source.assetId,
      mediaType: "video",
      durationSec: input.source.durationSec,
      campaignName: input.campaignName,
      videoAnalysis: input.videoAnalysis,
      frames: preparedFrames.length > 0 ? preparedFrames : undefined,
      transcriptSummary,
      campaignContext: input.campaignContext,
    });
    vision = execution.analysis;
    usage = execution.usage;
    await persist(
      input,
      "VIDEO_SCENE_ANALYSIS_COMPLETE",
      "completed",
      vision
    );
  }
  if (!vision) throw new Error("Video Vision analysis is unavailable");

  const canonicalHighlights = completedOutput<HighlightSegment[]>(
    progress,
    "VIDEO_HIGHLIGHTS_COMPLETE"
  );
  const reusedLegacyHighlights = canonicalHighlights
    ? undefined
    : legacyHighlights(progress);
  let highlights = canonicalHighlights ?? reusedLegacyHighlights;
  if (canonicalHighlights) {
    resumedCheckpoints.push("VIDEO_HIGHLIGHTS_COMPLETE");
  } else if (reusedLegacyHighlights) {
    await persist(
      input,
      "VIDEO_HIGHLIGHTS_COMPLETE",
      "completed",
      reusedLegacyHighlights
    );
  } else {
    await persist(input, "VIDEO_HIGHLIGHTS_COMPLETE", "running");
    highlights = buildHighlightIndex({
      vision,
      sourceDurationSec: input.source.durationSec,
      transcriptSegments,
      transcriptSummary,
      keywords: input.highlightKeywords ?? [],
    });
    if (highlights.length === 0) {
      throw new Error("Video Understanding produced no highlight candidates");
    }
    await persist(
      input,
      "VIDEO_HIGHLIGHTS_COMPLETE",
      "completed",
      highlights
    );
  }
  if (!highlights) {
    throw new Error("Video Understanding highlights are unavailable");
  }

  const warnings = [renderPendingWarning()];
  if (!transcriptAvailable) warnings.unshift(transcriptWarning());

  const understandingOutput = {
    assetId: input.source.assetId,
    transcriptSummary,
    sceneCount: vision.scenes.length,
    highlightCount: highlights.length,
  };
  if (
    completedOutput(progress, "VIDEO_UNDERSTANDING_COMPLETE")
  ) {
    resumedCheckpoints.push("VIDEO_UNDERSTANDING_COMPLETE");
  } else {
    await persist(
      input,
      "VIDEO_UNDERSTANDING_COMPLETE",
      "completed",
      understandingOutput
    );
  }

  const result = createVideoPipelineResult({
    state: "PARTIALLY_COMPLETE",
    phase: "READY_FOR_MARKETING",
    checkpoint: "VIDEO_READY_FOR_MARKETING",
    sourceAssets: [
      {
        assetId: input.source.assetId,
        mimeType: input.source.mimeType ?? undefined,
        storagePath: input.source.storagePath,
      },
    ],
    metadata,
    transcript: transcriptAvailable
      ? {
          summary: transcriptSummary,
          segments: transcriptSegments,
        }
      : undefined,
    sceneAnalysis: vision.scenes,
    suggestedMoments: vision.suggestedMoments,
    selectedHighlights: highlights,
    creativeReferences: [],
    renderReferences: [],
    warnings,
    confidence: { overall: vision.confidence ?? 0 },
    provenance: [
      {
        source:
          (vision as VisionAnalysis & {
            diagnostics?: { source?: string };
          }).diagnostics?.source === "fallback"
            ? "vision_fallback"
            : "vision_analysis",
        pipelineType: "VIDEO",
        assetId: input.source.assetId,
      },
    ],
  });

  if (completedOutput(progress, "VIDEO_READY_FOR_MARKETING")) {
    resumedCheckpoints.push("VIDEO_READY_FOR_MARKETING");
  } else {
    await persist(
      input,
      "VIDEO_READY_FOR_MARKETING",
      "completed",
      result
    );
  }

  return {
    result,
    vision,
    transcriptSummary,
    transcriptSegments,
    highlights,
    usage,
    resumedCheckpoints,
  };
}
