import { describe, expect, it } from "vitest";
import {
  AssetAnalysisService,
  type AssetAnalysisCacheRepository,
  type AssetIntelligenceAnalyzer,
  type FinalizedAssetForAnalysis,
} from "@ceo-agent/agents";
import {
  AiStoryAssetAnalysisSnapshotSchema,
  resolveAiStoryAssetAwareExecutionPlan,
  type AiStoryAssetAnalysisSnapshot,
} from "@ceo-agent/shared";

const id = (value: number) =>
  `b2000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const now = "2026-09-24T00:30:00.000Z";

function asset(input: {
  assetId?: string;
  workspaceId?: string;
  contentHash?: string;
  filename?: string;
} = {}): FinalizedAssetForAnalysis {
  return {
    id: input.assetId ?? id(10),
    orgId: id(1),
    workspaceId: input.workspaceId ?? id(2),
    type: "image",
    storagePath: `${input.workspaceId ?? id(2)}/library/${input.assetId ?? id(10)}.png`,
    contentHash: input.contentHash ?? hash("a"),
    mimeType: "image/png",
    width: 1024,
    height: 1024,
    durationSec: null,
    fileSizeBytes: 128,
    metadata: { originalFilename: input.filename ?? "same-name.png" },
    status: "ready",
    deletedAt: null,
  };
}

class MemorySingleFlightRepository implements AssetAnalysisCacheRepository {
  readonly snapshots = new Map<string, AiStoryAssetAnalysisSnapshot>();
  readonly pending = new Map<string, Promise<AiStoryAssetAnalysisSnapshot>>();

  private key(input: {
    workspaceId: string;
    contentHash: string;
    analyzerVersion: string;
    schemaVersion: string;
  }) {
    return [
      input.workspaceId,
      input.contentHash,
      input.analyzerVersion,
      input.schemaVersion,
    ].join(":");
  }

  async findReusableAnalysis(input: {
    orgId: string;
    workspaceId: string;
    contentHash: string;
    analyzerVersion: string;
    schemaVersion: string;
  }) {
    return this.snapshots.get(this.key(input)) ?? null;
  }

  async resolveAnalysisOnce(input: {
    orgId: string;
    workspaceId: string;
    assetId: string;
    contentHash: string;
    analyzerVersion: string;
    schemaVersion: string;
    analyze: () => Promise<AiStoryAssetAnalysisSnapshot["analysis"]>;
  }) {
    const key = this.key(input);
    const cached = this.snapshots.get(key);
    if (cached) {
      return {
        snapshot: cached,
        cacheStatus: "HIT" as const,
        analyzerInvoked: false,
      };
    }
    const existing = this.pending.get(key);
    if (existing) {
      return {
        snapshot: await existing,
        cacheStatus: "HIT" as const,
        analyzerInvoked: false,
      };
    }
    const promise = (async () => {
      const analysis = await input.analyze();
      const snapshot = AiStoryAssetAnalysisSnapshotSchema.parse({
        snapshotId: id(100 + this.snapshots.size),
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        sourceAssetId: input.assetId,
        analyzedContentHash: input.contentHash,
        analyzerVersion: input.analyzerVersion,
        schemaVersion: input.schemaVersion,
        analysis,
        analysisFingerprint: hash(
          String.fromCharCode(98 + this.snapshots.size)
        ),
        createdAt: now,
      });
      this.snapshots.set(key, snapshot);
      return snapshot;
    })();
    this.pending.set(key, promise);
    try {
      return {
        snapshot: await promise,
        cacheStatus: "MISS" as const,
        analyzerInvoked: true,
      };
    } finally {
      this.pending.delete(key);
    }
  }
}

function countingAnalyzer(
  calls: { value: number },
  analyzerVersion = "asset-test.v1",
  fail = false
): AssetIntelligenceAnalyzer {
  return {
    analyzerVersion,
    schemaVersion: "asset-analysis.v1",
    async analyze() {
      calls.value += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (fail) throw new Error("fixture analyzer failure");
      return {
        fileKind: "IMAGE",
        usable: true,
        rejectionReasons: [],
        affordances: {
          visualReference: true,
          firstFrame: true,
          sourceMotion: false,
          sourceAudio: false,
          productGrounding: false,
          characterGrounding: false,
        },
        facts: {},
      };
    },
  };
}

describe("AssetAnalysisService upload-finalization cache", () => {
  it("invokes the analyzer exactly once on miss and zero times on replay hit", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls)
    );
    const first = await service.analyzeFinalizedAsset({ asset: asset() });
    const replay = await service.analyzeFinalizedAsset({ asset: asset() });
    expect(first.cacheStatus).toBe("MISS");
    expect(replay.cacheStatus).toBe("HIT");
    expect(replay.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
    expect(calls.value).toBe(1);
  });

  it("does not collide same filenames with different content", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls)
    );
    await service.analyzeFinalizedAsset({
      asset: asset({ assetId: id(11), contentHash: hash("a") }),
    });
    await service.analyzeFinalizedAsset({
      asset: asset({ assetId: id(12), contentHash: hash("c") }),
    });
    expect(calls.value).toBe(2);
    expect(repository.snapshots.size).toBe(2);
  });

  it("reuses same-byte analysis for a duplicate Asset in the same Workspace", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls)
    );
    const first = await service.analyzeFinalizedAsset({
      asset: asset({ assetId: id(11), contentHash: hash("a") }),
    });
    const duplicate = await service.analyzeFinalizedAsset({
      asset: asset({ assetId: id(12), contentHash: hash("a") }),
    });
    expect(calls.value).toBe(1);
    expect(duplicate.cacheStatus).toBe("HIT");
    expect(duplicate.snapshot.snapshotId).toBe(first.snapshot.snapshotId);
    expect(duplicate.snapshot.sourceAssetId).toBe(id(11));
  });

  it("converges concurrent duplicate cache misses", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls)
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        service.analyzeFinalizedAsset({ asset: asset() })
      )
    );
    expect(calls.value).toBe(1);
    expect(new Set(results.map((result) => result.snapshot.snapshotId)).size).toBe(
      1
    );
  });

  it("creates a new immutable cache identity for a newer analyzer version", async () => {
    const repository = new MemorySingleFlightRepository();
    const v1Calls = { value: 0 };
    const v2Calls = { value: 0 };
    const v1 = new AssetAnalysisService(
      repository,
      countingAnalyzer(v1Calls, "asset-test.v1")
    );
    const v2 = new AssetAnalysisService(
      repository,
      countingAnalyzer(v2Calls, "asset-test.v2")
    );
    const oldSnapshot = await v1.analyzeFinalizedAsset({ asset: asset() });
    const newSnapshot = await v2.analyzeFinalizedAsset({ asset: asset() });
    expect(v1Calls.value).toBe(1);
    expect(v2Calls.value).toBe(1);
    expect(newSnapshot.snapshot.snapshotId).not.toBe(
      oldSnapshot.snapshot.snapshotId
    );
    expect(repository.snapshots.size).toBe(2);
  });

  it("does not reuse same bytes across Workspace authority", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls)
    );
    await service.analyzeFinalizedAsset({
      asset: asset({ assetId: id(13), workspaceId: id(2) }),
    });
    await service.analyzeFinalizedAsset({
      asset: {
        ...asset({ assetId: id(14), workspaceId: id(3) }),
        orgId: id(4),
      },
    });
    expect(calls.value).toBe(2);
  });

  it("does not turn analysis failure into implicit T2V", async () => {
    const repository = new MemorySingleFlightRepository();
    const calls = { value: 0 };
    const service = new AssetAnalysisService(
      repository,
      countingAnalyzer(calls, "asset-test.v1", true)
    );
    await expect(
      service.analyzeFinalizedAsset({ asset: asset() })
    ).rejects.toThrow("fixture analyzer failure");
    const plan = resolveAiStoryAssetAwareExecutionPlan({
      plannerSnapshotId: id(20),
      orgId: id(1),
      workspaceId: id(2),
      storyId: id(21),
      storyVersionId: id(22),
      requirements: {},
      audioIntent: "NONE",
      bindings: [],
      plannerVersion: "asset-aware-planner.v1",
      createdAt: now,
    });
    expect(plan.assetDecisionStatus).toBe(
      "AWAITING_NO_ASSET_CONFIRMATION"
    );
    expect(plan.resolvedGenerationMode).toBeNull();
    expect(calls.value).toBe(1);
  });
});
