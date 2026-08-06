import { createHash } from "node:crypto";
import type { CampaignAIContext } from "@ceo-agent/shared";
import { enrichCampaignAIContext } from "./campaign-context-provider";
import type {
  MergedCampaignContext,
  PipelineExecutionResult,
  PipelineWarning,
} from "./workflow-contracts";

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

function warningKey(warning: PipelineWarning): string {
  return `${warning.code}:${warning.assetId ?? ""}:${warning.message}`;
}

export function mergePipelineContext(
  campaignContext: CampaignAIContext,
  results: readonly PipelineExecutionResult[]
): MergedCampaignContext {
  const usable = [...results]
    .filter(
      (result) =>
        result.state === "COMPLETED" || result.state === "PARTIALLY_COMPLETE"
    )
    .sort((a, b) => a.pipelineType.localeCompare(b.pipelineType));
  const video = usable.find((result) => result.pipelineType === "VIDEO");
  const transcript =
    (typeof video?.output.transcriptReference === "string"
      ? video.output.transcriptReference
      : null) ??
    campaignContext.transcript ??
    null;
  const generatedOutputs = Object.fromEntries(
    usable.map((result) => [result.pipelineType, canonicalize(result.output)])
  );
  const assetIds = unique(usable.flatMap((result) => result.assetIds)).sort();
  const creativeIds = unique(usable.flatMap((result) => result.creativeIds)).sort();
  const merged = enrichCampaignAIContext(campaignContext, {
    transcript,
    generatedOutputs,
    workflowMetadata: {
      ...(campaignContext.workflowMetadata ?? {}),
      mediaPipelineTypes: usable.map((result) => result.pipelineType),
      mediaAssetIds: assetIds,
      mediaCreativeIds: creativeIds,
    },
  });
  const provenance = usable
    .flatMap((result) => result.provenance)
    .sort((a, b) =>
      `${a.pipelineType}:${a.assetId ?? ""}:${a.creativeId ?? ""}:${a.source}`.localeCompare(
        `${b.pipelineType}:${b.assetId ?? ""}:${b.creativeId ?? ""}:${b.source}`
      )
    );
  const warningMap = new Map<string, PipelineWarning>();
  for (const warning of usable.flatMap((result) => result.warnings)) {
    warningMap.set(warningKey(warning), warning);
  }
  const warnings = [...warningMap.values()].sort((a, b) =>
    warningKey(a).localeCompare(warningKey(b))
  );
  const confidence = Object.fromEntries(
    usable.flatMap((result) =>
      Object.entries(result.confidence)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [`${result.pipelineType}.${key}`, value])
    )
  );
  const deterministicKey = createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          objective: merged.campaignObjective,
          platforms: merged.publishingPlatforms,
          assets: merged.assets?.map((asset) => asset.id).sort(),
          results: usable.map((result) => ({
            pipelineType: result.pipelineType,
            assetIds: result.assetIds,
            creativeIds: result.creativeIds,
            output: result.output,
            warnings: result.warnings,
            confidence: result.confidence,
            provenance: result.provenance,
          })),
        })
      )
    )
    .digest("hex");

  return {
    campaignContext: merged,
    pipelineResults: usable,
    assetIds,
    creativeIds,
    provenance,
    warnings,
    confidence,
    deterministicKey,
  };
}
