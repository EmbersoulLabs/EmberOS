import {
  AiStoryAssetAwareExecutionPlannerRepository,
  type schema,
} from "@ceo-agent/db";
import {
  AssetAnalysisService,
  FinalizedAssetMetadataAnalyzer,
} from "@ceo-agent/agents";

type FinalizedAsset = typeof schema.assets.$inferSelect;

export type AssetIntelligenceFinalizationResult =
  | {
      readonly status: "READY";
      readonly snapshotId: string;
      readonly cacheStatus: "HIT" | "MISS";
      readonly analyzerInvoked: boolean;
      readonly analyzerVersion: string;
      readonly schemaVersion: string;
    }
  | {
      readonly status: "FAILED";
      readonly errorCode: string;
    };

/**
 * Canonical upload-finalization handoff. Analysis failures are persisted by the
 * cache repository but never delete or disguise the successfully uploaded Asset.
 */
export async function finalizeAssetIntelligence(
  asset: FinalizedAsset
): Promise<AssetIntelligenceFinalizationResult> {
  const analyzer = new FinalizedAssetMetadataAnalyzer();
  const service = new AssetAnalysisService(
    new AiStoryAssetAwareExecutionPlannerRepository(),
    analyzer
  );
  try {
    const result = await service.analyzeFinalizedAsset({ asset });
    return {
      status: "READY",
      snapshotId: result.snapshot.snapshotId,
      cacheStatus: result.cacheStatus,
      analyzerInvoked: result.analyzerInvoked,
      analyzerVersion: analyzer.analyzerVersion,
      schemaVersion: analyzer.schemaVersion,
    };
  } catch (error) {
    return {
      status: "FAILED",
      errorCode:
        error instanceof Error && "code" in error
          ? String((error as Error & { code: unknown }).code)
          : "ASSET_ANALYSIS_FAILED",
    };
  }
}
