import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export class CampaignAssetRefError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | "CAMPAIGN_ASSET_REF_MISSING"
      | "CAMPAIGN_ASSET_REF_DENIED"
      | "CAMPAIGN_ASSET_REF_PERSIST_FAILED",
    message: string,
    status = 409
  ) {
    super(message);
    this.name = "CampaignAssetRefError";
    this.status = status;
  }
}

export type PersistCampaignAssetRefInput = {
  readonly campaignId: string;
  readonly assetId: string;
  readonly workspaceId: string;
  readonly orgId: string;
  readonly sortOrder?: number;
};

/**
 * Persist a same-workspace campaign_asset_refs binding.
 * Fail closed on missing rows or cross-workspace identity.
 */
export async function persistSameWorkspaceCampaignAssetRef(
  db: QueryDb,
  input: PersistCampaignAssetRefInput
): Promise<void> {
  const [campaign] = await db
    .select({
      id: schema.campaigns.id,
      orgId: schema.campaigns.orgId,
      workspaceId: schema.campaigns.workspaceId,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.campaignId))
    .limit(1);
  if (
    !campaign ||
    campaign.workspaceId !== input.workspaceId ||
    campaign.orgId !== input.orgId
  ) {
    throw new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_DENIED",
      "Campaign is not authorized for this workspace"
    );
  }

  const [asset] = await db
    .select({
      id: schema.assets.id,
      orgId: schema.assets.orgId,
      workspaceId: schema.assets.workspaceId,
    })
    .from(schema.assets)
    .where(eq(schema.assets.id, input.assetId))
    .limit(1);
  if (!asset) {
    throw new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_MISSING",
      "Asset is missing for campaign binding"
    );
  }
  if (asset.workspaceId !== input.workspaceId || asset.orgId !== input.orgId) {
    throw new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_DENIED",
      "Cross-workspace campaign asset refs are denied"
    );
  }

  try {
    await db
      .insert(schema.campaignAssetRefs)
      .values({
        campaignId: input.campaignId,
        assetId: input.assetId,
        sortOrder: input.sortOrder ?? 0,
      })
      .onConflictDoNothing();
  } catch (error) {
    throw new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_PERSIST_FAILED",
      error instanceof Error
        ? `Campaign asset ref could not be persisted: ${error.message}`
        : "Campaign asset ref could not be persisted"
    );
  }

  const [bound] = await db
    .select({ assetId: schema.campaignAssetRefs.assetId })
    .from(schema.campaignAssetRefs)
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, input.campaignId),
        eq(schema.campaignAssetRefs.assetId, input.assetId)
      )
    )
    .limit(1);
  if (!bound) {
    throw new CampaignAssetRefError(
      "CAMPAIGN_ASSET_REF_PERSIST_FAILED",
      "Campaign asset ref was not durable after insert"
    );
  }
}

export async function listCampaignAssetRefIds(
  db: QueryDb,
  campaignId: string,
  assetIds: readonly string[]
): Promise<readonly string[]> {
  if (assetIds.length === 0) return [];
  const linked = await db
    .select({ assetId: schema.campaignAssetRefs.assetId })
    .from(schema.campaignAssetRefs)
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, campaignId),
        inArray(schema.campaignAssetRefs.assetId, [...assetIds])
      )
    );
  return linked.map((row) => row.assetId);
}
