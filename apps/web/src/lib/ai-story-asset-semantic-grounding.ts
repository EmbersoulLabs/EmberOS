import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  AiStoryAssetAwareExecutionPlannerRepository,
  AiStoryAssetMatchingRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  AssetAnalysisService,
  VisualSemanticAssetAnalyzer,
  VISUAL_SEMANTIC_ANALYZER_VERSION,
} from "@ceo-agent/agents";
import {
  AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
  AiStoryAssetAnalysisSnapshotSchema,
  AiStoryAssetRegistryEntrySchema,
  compileStoryAssetGroundingContext,
  explicitRoleHintForAiStoryUsage,
  matchAnalyzedAssetsToStory,
  visualSemanticFactsFromSnapshot,
  type AiStoryStoryAssetGroundingContext,
} from "@ceo-agent/shared";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Db = ReturnType<typeof getDb>;
type StoryAssetLink = typeof schema.aiStoryAssetLinks.$inferSelect;

export class AiStorySemanticGroundingRuntimeError extends Error {
  constructor(
    readonly code:
      | "ASSET_SEMANTIC_ANALYSIS_FAILED"
      | "ASSET_SEMANTIC_SNAPSHOT_REQUIRED"
      | "ASSET_SEMANTIC_SCOPE_MISMATCH",
    message: string
  ) {
    super(message);
    this.name = "AiStorySemanticGroundingRuntimeError";
  }
}

function registryFromAsset(asset: typeof schema.assets.$inferSelect) {
  if (!asset.contentHash || !asset.mimeType) {
    throw new AiStorySemanticGroundingRuntimeError(
      "ASSET_SEMANTIC_SNAPSHOT_REQUIRED",
      `Asset ${asset.id} lacks finalized content identity`
    );
  }
  const fileKind = asset.type === "image"
    ? "IMAGE"
    : asset.type === "video"
      ? "VIDEO"
      : asset.type === "audio"
        ? "AUDIO"
        : asset.type === "pdf" || asset.type === "document"
          ? "DOCUMENT"
          : "OTHER";
  return AiStoryAssetRegistryEntrySchema.parse({
    assetId: asset.id,
    orgId: asset.orgId,
    workspaceId: asset.workspaceId,
    contentHash: asset.contentHash,
    mimeType: asset.mimeType,
    fileKind,
    storageRef: asset.storagePath,
    createdAt: asset.createdAt.toISOString(),
  });
}

async function loadAssetBytes(storagePath: string): Promise<Uint8Array> {
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
  const { data, error } = await createAdminClient().storage.from(bucket).download(storagePath);
  if (error || !data) throw new Error(error?.message ?? "ASSET_STORAGE_OBJECT_UNAVAILABLE");
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Canonical on-demand semantic analysis boundary used by intake and planning.
 * The repository cache is keyed by Workspace, content hash, analyzer version,
 * and schema version, so repeated UI reads never repeat a paid analysis call.
 */
export async function analyzeVisualSemanticAsset(input: {
  readonly db: Db;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assetId: string;
}) {
  const [asset] = await input.db
    .select()
    .from(schema.assets)
    .where(and(
      eq(schema.assets.id, input.assetId),
      eq(schema.assets.orgId, input.orgId),
      eq(schema.assets.workspaceId, input.workspaceId),
      isNull(schema.assets.deletedAt)
    ))
    .limit(1);
  if (!asset || asset.status !== "ready" || asset.type !== "image") {
    throw new AiStorySemanticGroundingRuntimeError(
      "ASSET_SEMANTIC_SNAPSHOT_REQUIRED",
      "Product variant analysis requires a ready image in the authorized Workspace"
    );
  }
  const service = new AssetAnalysisService(
    new AiStoryAssetAwareExecutionPlannerRepository(input.db),
    new VisualSemanticAssetAnalyzer()
  );
  return service.analyzeFinalizedAsset({
    asset,
    loadRawBytes: () => loadAssetBytes(asset.storagePath),
  });
}

export type PreparedStoryAssetGrounding = {
  readonly context: AiStoryStoryAssetGroundingContext | null;
  readonly analyzedAssets: readonly {
    readonly registry: ReturnType<typeof registryFromAsset>;
    readonly snapshot: ReturnType<typeof AiStoryAssetAnalysisSnapshotSchema.parse>;
    readonly usageType: string;
  }[];
  readonly semanticAnalyzerCalls: number;
};

/** Ensures exact selected Assets have cached semantic authority before Writer execution. */
export async function prepareStoryAssetGrounding(input: {
  readonly db: Db;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly assetLinks: readonly StoryAssetLink[];
}): Promise<PreparedStoryAssetGrounding> {
  if (input.assetLinks.length === 0) {
    return { context: null, analyzedAssets: [], semanticAnalyzerCalls: 0 };
  }
  const selectedIds = [...new Set(input.assetLinks.map((link) => link.assetId))];
  const assets = await input.db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.orgId, input.orgId),
        eq(schema.assets.workspaceId, input.workspaceId),
        inArray(schema.assets.id, selectedIds),
        isNull(schema.assets.deletedAt)
      )
    );
  if (assets.length !== selectedIds.length) {
    throw new AiStorySemanticGroundingRuntimeError(
      "ASSET_SEMANTIC_SCOPE_MISMATCH",
      "Every selected Story Asset must exist in the authorized Workspace"
    );
  }
  const linkByAssetId = new Map(input.assetLinks.map((link) => [link.assetId, link]));
  let semanticAnalyzerCalls = 0;
  const analyzedAssets = [] as Array<PreparedStoryAssetGrounding["analyzedAssets"][number]>;
  for (const assetId of selectedIds) {
    const asset = assets.find((candidate) => candidate.id === assetId)!;
    if (asset.status !== "ready") {
      throw new AiStorySemanticGroundingRuntimeError(
        "ASSET_SEMANTIC_SNAPSHOT_REQUIRED",
        `Selected Asset ${asset.id} is not ready for Story grounding`
      );
    }
    // This V1 analyzer is intentionally image-only. Existing video/audio
    // authorities continue through their certified analysis/runtime paths.
    if (asset.type !== "image") continue;
    try {
      const outcome = await analyzeVisualSemanticAsset({
        db: input.db,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        assetId: asset.id,
      });
      if (outcome.analyzerInvoked) semanticAnalyzerCalls += 1;
      analyzedAssets.push({
        registry: registryFromAsset(asset),
        snapshot: AiStoryAssetAnalysisSnapshotSchema.parse(outcome.snapshot),
        usageType: linkByAssetId.get(asset.id)?.usageType ?? "reference",
      });
    } catch (error) {
      throw new AiStorySemanticGroundingRuntimeError(
        "ASSET_SEMANTIC_ANALYSIS_FAILED",
        error instanceof Error ? error.message : "Asset semantic analysis failed"
      );
    }
  }
  if (analyzedAssets.length === 0) {
    return { context: null, analyzedAssets: [], semanticAnalyzerCalls };
  }
  const context = compileStoryAssetGroundingContext({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    assets: analyzedAssets.map((entry) => ({
      registry: entry.registry,
      snapshot: entry.snapshot,
      explicitRoleHint: explicitRoleHintForAiStoryUsage(entry.usageType),
    })),
  });
  return { context, analyzedAssets, semanticAnalyzerCalls };
}

/** Builds and persists Story-relative matching only after a real Story Version exists. */
export async function persistStoryAssetMatching(input: {
  readonly db: Db;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly storyVersionNumber: number;
  readonly structuredStory: unknown;
  readonly grounding: PreparedStoryAssetGrounding;
  readonly nativeDialogueDesired?: boolean;
}) {
  if (input.grounding.analyzedAssets.length === 0) return null;
  const createdAt = new Date().toISOString();
  const canonicalStoryText = JSON.stringify(input.structuredStory).toLocaleLowerCase();
  const semanticDecisions = input.grounding.analyzedAssets.map((entry) => {
    const facts = visualSemanticFactsFromSnapshot(entry.snapshot);
    const explicitProduct = entry.usageType === "product_source";
    const storyUsesProduct = explicitProduct && facts.inferred.productCandidates.some(
      (candidate) => canonicalStoryText.includes(candidate.name.toLocaleLowerCase())
    );
    const intent = storyUsesProduct ? "PRODUCT_IDENTITY" as const : "SUPPORTING" as const;
    return {
      assetId: entry.registry.assetId,
      analysisSnapshotId: entry.snapshot.snapshotId,
      intent,
      required: storyUsesProduct,
      reason: storyUsesProduct
        ? `Explicit Product source supported by semantic evidence: ${facts.inferred.productCandidates.map((candidate) => candidate.name).join(", ")}`
        : `Story reference grounded by observed semantic evidence: ${facts.observed.namedItems.join(", ") || facts.observed.objects.join(", ")}`,
      source: explicitProduct ? "HUMAN_SELECTION" as const : "CANONICAL_AUTHORITY" as const,
    };
  });
  const identity = {
    kind: "ai-story-asset-matching-runtime.v1",
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    nativeDialogueDesired: input.nativeDialogueDesired === true,
    snapshots: input.grounding.analyzedAssets.map((entry) => ({
      assetId: entry.registry.assetId,
      snapshotId: entry.snapshot.snapshotId,
      contentHash: entry.registry.contentHash,
      intent: semanticDecisions.find((decision) => decision.assetId === entry.registry.assetId)!.intent,
    })),
  };
  const identityFingerprint = sha256CanonicalIntegrityHash(identity);
  const matchingResultId = deterministicUuidFromFingerprint(
    "ai-story-asset-matching-result",
    identityFingerprint
  );
  const bindingIdByAssetId = Object.fromEntries(
    input.grounding.analyzedAssets.map((entry) => [
      entry.registry.assetId,
      deterministicUuidFromFingerprint(
        "ai-story-asset-binding",
        sha256CanonicalIntegrityHash({ ...identity, assetId: entry.registry.assetId })
      ),
    ])
  );
  const result = matchAnalyzedAssetsToStory({
    matchingResultId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    storyVersionNumber: input.storyVersionNumber,
    requirements: {
      productIdentityRequired: semanticDecisions.some(
        (decision) => decision.intent === "PRODUCT_IDENTITY"
      ),
      nativeDialogueDesired: input.nativeDialogueDesired === true,
    },
    assets: input.grounding.analyzedAssets,
    semanticDecisions,
    bindingIdByAssetId,
    matcherVersion: "emberos-story-asset-grounding-matcher.v1",
    createdAt,
  });
  return new AiStoryAssetMatchingRepository(input.db).acceptMatchingResult({
    result,
    resultFingerprint: sha256CanonicalIntegrityHash({ result }),
  });
}

export const STORY_ASSET_SEMANTIC_RUNTIME_IDENTITY = {
  analyzerVersion: VISUAL_SEMANTIC_ANALYZER_VERSION,
  schemaVersion: AI_STORY_VISUAL_SEMANTIC_SCHEMA_VERSION,
} as const;
