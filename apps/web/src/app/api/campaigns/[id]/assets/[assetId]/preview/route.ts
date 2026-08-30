import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { ASSET_SIGNED_URL_TTL_SECONDS, signPrivateCampaignAsset } from "@/lib/asset-signed-delivery";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, assetId } = await params;
    const db = getDb();
    const [campaign] = await db.select({ workspaceId: schema.campaigns.workspaceId })
      .from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");
    const [asset] = await db.select({ storagePath: schema.assets.storagePath, mimeType: schema.assets.mimeType })
      .from(schema.assets).leftJoin(
        schema.campaignAssetRefs,
        and(eq(schema.campaignAssetRefs.assetId, schema.assets.id), eq(schema.campaignAssetRefs.campaignId, campaignId)),
      ).where(and(
        eq(schema.assets.id, assetId),
        eq(schema.assets.workspaceId, campaign.workspaceId),
        eq(schema.assets.type, "image"),
        isNull(schema.assets.deletedAt),
        or(eq(schema.assets.campaignId, campaignId), eq(schema.campaignAssetRefs.campaignId, campaignId)),
      )).limit(1);
    if (!asset?.storagePath) return apiError("Reference photo not found", "NOT_FOUND", 404);
    const previewUrl = await signPrivateCampaignAsset({ workspaceId: campaign.workspaceId, storagePath: asset.storagePath });
    return apiSuccess({ previewUrl, mimeType: asset.mimeType, expiresInSeconds: ASSET_SIGNED_URL_TTL_SECONDS });
  } catch (error) { return handleApiError(error); }
}
