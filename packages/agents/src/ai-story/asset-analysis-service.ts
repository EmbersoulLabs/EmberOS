import {
  AiStoryAssetAnalysisResultSchema,
  type AiStoryAssetAnalysisSnapshot,
} from "@ceo-agent/shared";

export const ASSET_INTELLIGENCE_ANALYZER_VERSION =
  "emberos-asset-metadata-analyzer.v1" as const;
export const ASSET_INTELLIGENCE_SCHEMA_VERSION =
  "ai-story-asset-analysis.v1" as const;

export type FinalizedAssetForAnalysis = {
  readonly id: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly type: string;
  readonly storagePath: string;
  readonly contentHash: string | null;
  readonly mimeType: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: string | null;
  readonly fileSizeBytes: number | null;
  readonly metadata: Record<string, unknown> | null;
  readonly status: string;
  readonly deletedAt: Date | null;
};

export type AssetAnalysisCacheRepository = {
  findReusableAnalysis(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly contentHash: string;
    readonly analyzerVersion: string;
    readonly schemaVersion: string;
  }): Promise<AiStoryAssetAnalysisSnapshot | null>;
  resolveAnalysisOnce(input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly assetId: string;
    readonly contentHash: string;
    readonly analyzerVersion: string;
    readonly schemaVersion: string;
    readonly analyze: () => Promise<AiStoryAssetAnalysisSnapshot["analysis"]>;
  }): Promise<{
    readonly snapshot: AiStoryAssetAnalysisSnapshot;
    readonly cacheStatus: "HIT" | "MISS";
    readonly analyzerInvoked: boolean;
  }>;
};

export type AssetIntelligenceAnalyzer = {
  readonly analyzerVersion: string;
  readonly schemaVersion: string;
  analyze(input: {
    readonly asset: FinalizedAssetForAnalysis & { readonly contentHash: string };
    /** Raw bytes remain inaccessible until the cache-miss callback runs. */
    readonly loadRawBytes?: () => Promise<Uint8Array>;
  }): Promise<AiStoryAssetAnalysisSnapshot["analysis"]>;
};

export class AssetAnalysisServiceError extends Error {
  constructor(
    readonly code:
      | "ASSET_NOT_FINALIZED"
      | "ASSET_ANALYZER_VERSION_INVALID",
    message: string
  ) {
    super(message);
    this.name = "AssetAnalysisServiceError";
  }
}

function canonicalFileKind(type: string) {
  switch (type.trim().toLowerCase()) {
    case "image":
      return "IMAGE" as const;
    case "video":
      return "VIDEO" as const;
    case "audio":
      return "AUDIO" as const;
    case "pdf":
    case "document":
      return "DOCUMENT" as const;
    default:
      return "OTHER" as const;
  }
}

/** Zero-paid-call baseline analyzer over finalized canonical media metadata. */
export class FinalizedAssetMetadataAnalyzer implements AssetIntelligenceAnalyzer {
  readonly analyzerVersion = ASSET_INTELLIGENCE_ANALYZER_VERSION;
  readonly schemaVersion = ASSET_INTELLIGENCE_SCHEMA_VERSION;

  async analyze(input: {
    readonly asset: FinalizedAssetForAnalysis & { readonly contentHash: string };
  }): Promise<AiStoryAssetAnalysisSnapshot["analysis"]> {
    const fileKind = canonicalFileKind(input.asset.type);
    const metadata = input.asset.metadata ?? {};
    const rejected = metadata.rejected === true;
    const hasAudio =
      metadata.hasAudio === true ||
      (typeof metadata.finishedAdRisk === "object" &&
        metadata.finishedAdRisk !== null &&
        (metadata.finishedAdRisk as Record<string, unknown>).hasAudio === true);
    return AiStoryAssetAnalysisResultSchema.parse({
      fileKind,
      usable: !rejected,
      rejectionReasons:
        rejected && typeof metadata.reason === "string"
          ? [metadata.reason]
          : [],
      affordances: {
        visualReference: fileKind === "IMAGE" || fileKind === "VIDEO",
        firstFrame: fileKind === "IMAGE",
        sourceMotion: fileKind === "VIDEO",
        sourceAudio: fileKind === "AUDIO" || hasAudio,
        // Semantic suitability remains false until a versioned visual analyzer
        // establishes it. Metadata must not fabricate Product/Character facts.
        productGrounding: false,
        characterGrounding: false,
      },
      facts: {
        mimeType: input.asset.mimeType,
        width: input.asset.width,
        height: input.asset.height,
        durationSec: input.asset.durationSec,
        fileSizeBytes: input.asset.fileSizeBytes,
        hasAudio,
        storageFinalized: true,
      },
    });
  }
}

export class AssetAnalysisService {
  constructor(
    private readonly repository: AssetAnalysisCacheRepository,
    private readonly analyzer: AssetIntelligenceAnalyzer
  ) {}

  async analyzeFinalizedAsset(input: {
    readonly asset: FinalizedAssetForAnalysis;
    readonly loadRawBytes?: () => Promise<Uint8Array>;
  }): Promise<{
    readonly snapshot: AiStoryAssetAnalysisSnapshot;
    readonly cacheStatus: "HIT" | "MISS";
    readonly analyzerInvoked: boolean;
  }> {
    const asset = input.asset;
    if (
      asset.deletedAt ||
      asset.status === "uploading" ||
      !asset.contentHash ||
      !/^sha256:[0-9a-f]{64}$/.test(asset.contentHash)
    ) {
      throw new AssetAnalysisServiceError(
        "ASSET_NOT_FINALIZED",
        "Asset Intelligence requires stable storage and canonical content identity"
      );
    }
    if (!this.analyzer.analyzerVersion || !this.analyzer.schemaVersion) {
      throw new AssetAnalysisServiceError(
        "ASSET_ANALYZER_VERSION_INVALID",
        "Asset analyzer and analysis schema versions are required"
      );
    }

    const cached = await this.repository.findReusableAnalysis({
      orgId: asset.orgId,
      workspaceId: asset.workspaceId,
      contentHash: asset.contentHash,
      analyzerVersion: this.analyzer.analyzerVersion,
      schemaVersion: this.analyzer.schemaVersion,
    });
    if (cached) {
      return {
        snapshot: cached,
        cacheStatus: "HIT",
        analyzerInvoked: false,
      };
    }

    return this.repository.resolveAnalysisOnce({
      orgId: asset.orgId,
      workspaceId: asset.workspaceId,
      assetId: asset.id,
      contentHash: asset.contentHash,
      analyzerVersion: this.analyzer.analyzerVersion,
      schemaVersion: this.analyzer.schemaVersion,
      analyze: () =>
        this.analyzer.analyze({
          asset: { ...asset, contentHash: asset.contentHash! },
          ...(input.loadRawBytes
            ? { loadRawBytes: input.loadRawBytes }
            : {}),
        }),
    });
  }
}
