import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryAssetSelectionSchema,
  isCanonicalSourceContentHash,
  type SourceAssetContentHash,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export class AiStoryProductSourceAuthorityError extends Error {
  readonly code = "VALIDATION_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "AiStoryProductSourceAuthorityError";
  }
}

export type AiStoryProductSourceAssetCandidate = {
  id: string;
  orgId: string;
  workspaceId: string;
  status: string;
  deletedAt: Date | null;
  contentHash: string | null;
};

export type AiStoryResolvedProductSource = {
  storyId: string;
  assetId: string;
  usageType: "product_source";
  orgId: string;
  workspaceId: string;
  campaignId: string;
  contentHash: SourceAssetContentHash;
  status: string;
};

type VerifiedProductSourceAsset = Omit<
  AiStoryResolvedProductSource,
  "storyId" | "usageType"
>;

/**
 * Verifies explicit IDs against canonical Asset and Campaign-link facts.
 * Display metadata, filenames, media type, and Photo Scene metadata are intentionally absent.
 */
function verifyExplicitProductSourceAssets(input: {
  orgId: string;
  workspaceId: string;
  campaignId: string;
  assetIds: readonly string[];
  productAssetIds: readonly string[];
  assets: readonly AiStoryProductSourceAssetCandidate[];
  campaignAssetIds: ReadonlySet<string>;
}): VerifiedProductSourceAsset[] {
  const selection = AiStoryAssetSelectionSchema.parse({
    assetIds: [...input.assetIds],
    productAssetIds: [...input.productAssetIds],
  });
  const byId = new Map(input.assets.map((asset) => [asset.id, asset]));

  return [...selection.productAssetIds]
    .sort((left, right) => left.localeCompare(right))
    .map((assetId) => {
      const asset = byId.get(assetId);
      if (!asset) {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} does not exist`
        );
      }
      if (asset.orgId !== input.orgId || asset.workspaceId !== input.workspaceId) {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} is outside the authorized workspace`
        );
      }
      if (!input.campaignAssetIds.has(assetId)) {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} is not linked to the authorized Campaign`
        );
      }
      if (asset.deletedAt) {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} is deleted`
        );
      }
      if (asset.status !== "ready") {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} is not ready`
        );
      }
      if (!isCanonicalSourceContentHash(asset.contentHash)) {
        throw new AiStoryProductSourceAuthorityError(
          `Product source Asset ${assetId} lacks canonical content identity`
        );
      }
      return {
        assetId,
        orgId: asset.orgId,
        workspaceId: asset.workspaceId,
        campaignId: input.campaignId,
        contentHash: asset.contentHash,
        status: asset.status,
      };
    });
}

export function verifyExplicitStoryProductSources(input: {
  storyId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  assetIds: readonly string[];
  productAssetIds: readonly string[];
  assets: readonly AiStoryProductSourceAssetCandidate[];
  campaignAssetIds: ReadonlySet<string>;
}): AiStoryResolvedProductSource[] {
  return verifyExplicitProductSourceAssets(input).map((asset) => ({
    storyId: input.storyId,
    ...asset,
    usageType: "product_source" as const,
  }));
}

async function loadProductCandidates(db: Db, productAssetIds: readonly string[]) {
  if (productAssetIds.length === 0) return [];
  return db
    .select({
      id: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
      status: schema.assets.status,
      deletedAt: schema.assets.deletedAt,
      contentHash: schema.assets.contentHash,
    })
    .from(schema.assets)
    .where(inArray(schema.assets.id, [...productAssetIds]));
}

async function loadCampaignAssetIds(
  db: Db,
  campaignId: string,
  productAssetIds: readonly string[]
) {
  if (productAssetIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ assetId: schema.campaignAssetRefs.assetId })
    .from(schema.campaignAssetRefs)
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, campaignId),
        inArray(schema.campaignAssetRefs.assetId, [...productAssetIds])
      )
    );
  return new Set(rows.map((row) => row.assetId));
}

/** Pre-create validation of the authenticated explicit Product designation. */
export async function assertAuthorizedStoryProductSourceSelection(
  db: Db,
  input: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    assetIds: readonly string[];
    productAssetIds: readonly string[];
  }
): Promise<void> {
  const [assets, campaignAssetIds] = await Promise.all([
    loadProductCandidates(db, input.productAssetIds),
    loadCampaignAssetIds(db, input.campaignId, input.productAssetIds),
  ]);
  verifyExplicitProductSourceAssets({
    ...input,
    assets,
    campaignAssetIds,
  });
}

/** Resolves only persisted product_source links; legacy reference rows remain generic. */
export async function resolveStoryProductSources(
  db: Db,
  input: { storyId: string; orgId: string; workspaceId: string; campaignId: string }
): Promise<AiStoryResolvedProductSource[]> {
  const [story] = await db
    .select({
      id: schema.aiStories.id,
      orgId: schema.aiStories.orgId,
      workspaceId: schema.aiStories.workspaceId,
      campaignId: schema.aiStories.campaignId,
    })
    .from(schema.aiStories)
    .where(eq(schema.aiStories.id, input.storyId))
    .limit(1);
  if (
    !story ||
    story.orgId !== input.orgId ||
    story.workspaceId !== input.workspaceId ||
    story.campaignId !== input.campaignId
  ) {
    throw new AiStoryProductSourceAuthorityError(
      "Story Product source scope does not match authenticated authority"
    );
  }

  const links = await db
    .select({ assetId: schema.aiStoryAssetLinks.assetId })
    .from(schema.aiStoryAssetLinks)
    .where(
      and(
        eq(schema.aiStoryAssetLinks.storyId, input.storyId),
        eq(schema.aiStoryAssetLinks.usageType, "product_source")
      )
    );
  const productAssetIds = links.map((link) => link.assetId);
  const [assets, campaignAssetIds] = await Promise.all([
    loadProductCandidates(db, productAssetIds),
    loadCampaignAssetIds(db, input.campaignId, productAssetIds),
  ]);
  return verifyExplicitStoryProductSources({
    ...input,
    assetIds: productAssetIds,
    productAssetIds,
    assets,
    campaignAssetIds,
  });
}
