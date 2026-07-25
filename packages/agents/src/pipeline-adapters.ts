import { createHash } from "node:crypto";
import type { PipelineExecutionResult, PipelineWarning } from "./workflow-contracts";

function resultKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface VideoAdapterInput {
  assetIds: string[];
  creativeIds?: string[];
  transcript?: string | null;
  sceneAnalysis?: unknown;
  suggestedMoments?: unknown;
  selectedHighlights?: unknown;
  editPlanReferences?: unknown;
  renderedCreativeReferences?: unknown;
  subtitleReferences?: unknown;
  warnings?: PipelineWarning[];
  confidence?: Record<string, number>;
  provenance?: PipelineExecutionResult["provenance"];
  complete?: boolean;
}

export function adaptVideoPipelineResult(
  input: VideoAdapterInput
): PipelineExecutionResult {
  const output = {
    transcriptReference: input.transcript ?? null,
    sceneAnalysis: input.sceneAnalysis ?? null,
    suggestedMoments: input.suggestedMoments ?? null,
    selectedHighlightSegments: input.selectedHighlights ?? null,
    editPlanReferences: input.editPlanReferences ?? null,
    renderedCreativeReferences: input.renderedCreativeReferences ?? null,
    subtitleReferences: input.subtitleReferences ?? null,
  };
  return {
    pipelineType: "VIDEO",
    state: input.complete ? "COMPLETED" : "PARTIALLY_COMPLETE",
    assetIds: [...new Set(input.assetIds)].sort(),
    creativeIds: [...new Set(input.creativeIds ?? [])].sort(),
    output,
    warnings: input.warnings ?? [],
    confidence: input.confidence ?? {},
    provenance:
      input.provenance ??
      input.assetIds.map((assetId) => ({
        source: "video_pipeline",
        pipelineType: "VIDEO",
        assetId,
      })),
    deterministicKey: resultKey({ assetIds: input.assetIds, output }),
  };
}

export function preRenderVideoWarning(): PipelineWarning {
  return {
    code: "VIDEO_RENDER_PENDING",
    message:
      "Marketing uses validated transcript, scene, and highlight outputs while rendering remains pending.",
    retryable: false,
  };
}

export interface ImageUnderstandingAdapterInput {
  assetIds: string[];
  classification?: unknown;
  productDetection?: unknown;
  subjectDetection?: unknown;
  sceneDetection?: unknown;
  warnings?: PipelineWarning[];
  confidence?: Record<string, number>;
  provenance?: PipelineExecutionResult["provenance"];
}

export function adaptImageUnderstandingResult(
  input: ImageUnderstandingAdapterInput
): PipelineExecutionResult {
  const output = {
    imageClassification: input.classification ?? null,
    productDetection: input.productDetection ?? null,
    subjectDetection: input.subjectDetection ?? null,
    sceneDetection: input.sceneDetection ?? null,
  };
  return {
    pipelineType: "IMAGE_UNDERSTANDING",
    state: "COMPLETED",
    assetIds: [...new Set(input.assetIds)].sort(),
    creativeIds: [],
    output,
    warnings: input.warnings ?? [],
    confidence: input.confidence ?? {},
    provenance:
      input.provenance ??
      input.assetIds.map((assetId) => ({
        source: "image_understanding",
        pipelineType: "IMAGE_UNDERSTANDING",
        assetId,
      })),
    deterministicKey: resultKey({ assetIds: input.assetIds, output }),
  };
}

export function productImageNotRequiredResult(): PipelineExecutionResult {
  return {
    pipelineType: "PRODUCT_IMAGE",
    state: "NOT_REQUIRED",
    assetIds: [],
    creativeIds: [],
    output: {},
    warnings: [],
    confidence: {},
    provenance: [],
    deterministicKey: resultKey({ pipelineType: "PRODUCT_IMAGE", state: "NOT_REQUIRED" }),
  };
}

export function adaptMarketingPipelineResult(
  output: Record<string, unknown>,
  provenance: PipelineExecutionResult["provenance"] = []
): PipelineExecutionResult {
  return {
    pipelineType: "MARKETING",
    state: "COMPLETED",
    assetIds: [],
    creativeIds: [],
    output,
    warnings: [],
    confidence: {},
    provenance,
    deterministicKey: resultKey({ pipelineType: "MARKETING", output }),
  };
}
