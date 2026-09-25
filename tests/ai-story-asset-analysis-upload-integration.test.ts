import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const source = (path: string) =>
  readFileSync(join(root, path), "utf8");

describe("Asset Intelligence upload-finalization integration", () => {
  it("uses a cross-process advisory lock and immutable attempt evidence", () => {
    const repository = source(
      "packages/db/src/queries/ai-story-asset-aware-execution-planner.ts"
    );
    expect(repository).toContain("pg_advisory_xact_lock");
    expect(repository).toContain("assetAnalysisSnapshots");
    expect(repository).toContain("assetAnalysisAttempts");
    expect(repository).toContain("ASSET_ANALYSIS_FAILED");
  });

  it("hooks Workspace Library and Campaign image finalization", () => {
    const libraryConfirm = source(
      "apps/web/src/app/api/workspaces/[id]/library/[assetId]/confirm/route.ts"
    );
    const campaignConfirm = source(
      "apps/web/src/app/api/campaigns/[id]/assets/[assetId]/confirm/route.ts"
    );
    for (const route of [libraryConfirm, campaignConfirm]) {
      expect(route).toContain("finalizeStoredSourceAssetIdentity");
      expect(route).toContain("finalizeAssetIntelligence");
    }
  });

  it("hooks video analysis only after final hash and metadata persistence", () => {
    const worker = source("apps/worker/src/processors/index.ts");
    const hashPosition = worker.indexOf("finalContentHash");
    const persistencePosition = worker.indexOf(
      "const [finalizedAsset] = await db"
    );
    const analysisPosition = worker.indexOf(
      "new AssetAnalysisService(",
      persistencePosition
    );
    expect(hashPosition).toBeGreaterThan(-1);
    expect(persistencePosition).toBeGreaterThan(hashPosition);
    expect(analysisPosition).toBeGreaterThan(persistencePosition);
  });

  it("does not invoke Asset analyzers from Story planning or generation", () => {
    const planning = source(
      "packages/agents/src/ai-story/story-planning-service.ts"
    );
    const generate = source(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts"
    );
    expect(planning).not.toContain("AssetAnalysisService");
    expect(generate).not.toContain("AssetAnalysisService");
    expect(generate).not.toContain("FinalizedAssetMetadataAnalyzer");
  });
});
