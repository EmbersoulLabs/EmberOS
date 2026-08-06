import type { CampaignCreativeBrief } from "@ceo-agent/shared";
import type {
  MarketingExecutionMetadata,
  MergedCampaignContext,
} from "./workflow-contracts";
import { runStrategyAgent } from "./strategy";
import { runMarketingContentAgent } from "./marketing-content";

export interface MarketingPipelineResult<T> {
  output: T;
  contextKey: string;
}

/**
 * Reusable Marketing execution boundary. Business logic remains supplied by
 * the existing Marketing stages; this boundary guarantees merged context.
 */
export async function runMarketingPipeline<T>(
  merged: MergedCampaignContext,
  execute: (context: MergedCampaignContext["campaignContext"]) => Promise<T>
): Promise<MarketingPipelineResult<T>> {
  if (!merged.deterministicKey || !merged.campaignContext) {
    throw new Error("Marketing Pipeline requires merged Campaign context");
  }
  if (
    merged.pipelineResults.length === 0 ||
    merged.pipelineResults.some(
      (result) =>
        result.state !== "COMPLETED" &&
        !(
          result.state === "PARTIALLY_COMPLETE" &&
          result.warnings.some(
            (warning) => warning.code === "VIDEO_RENDER_PENDING"
          )
        )
    )
  ) {
    throw new Error("Marketing Pipeline requires ready normalized upstream results");
  }
  return {
    output: await execute(merged.campaignContext),
    contextKey: merged.deterministicKey,
  };
}

function executionMetadata(
  merged: MergedCampaignContext
): MarketingExecutionMetadata {
  const metadata = merged.campaignContext.workflowMetadata?.marketingExecution;
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Merged Campaign context is missing Marketing execution metadata");
  }
  return metadata as unknown as MarketingExecutionMetadata;
}

export function runStrategyPipeline(merged: MergedCampaignContext) {
  const metadata = executionMetadata(merged);
  return runMarketingPipeline(merged, (campaignContext) =>
    runStrategyAgent({
      campaignName: metadata.campaignName,
      campaignContext,
      assetsUploaded: metadata.assetsUploaded,
      creativeBrief: metadata.creativeBrief as CampaignCreativeBrief | undefined,
      videoAnalysis: metadata.videoAnalysis,
    })
  );
}

export function runMarketingContentPipeline(merged: MergedCampaignContext) {
  const metadata = executionMetadata(merged);
  const strategy = merged.campaignContext.strategy;
  const vision = merged.campaignContext.vision;
  if (!strategy || !vision) {
    throw new Error("Merged Campaign context is missing Strategy or Vision");
  }
  return runMarketingPipeline(merged, (campaignContext) =>
    runMarketingContentAgent({
      campaignContext,
      strategy,
      vision,
      videoAnalysis: metadata.videoAnalysis,
      campaignName: metadata.campaignName,
    })
  );
}
