import { eq } from "drizzle-orm";
import { assertAssetsInWorkspace, assertAssetStoriesInWorkspace, getDb, persistSameWorkspaceCampaignAssetRef, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { CampaignAssetAttachBodySchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid Campaign", "VALIDATION_ERROR", 400);
    const parsed = CampaignAssetAttachBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid Asset references", "VALIDATION_ERROR", 400);
    const db = getDb();
    const [campaign] = await db.select({ id: schema.campaigns.id, orgId: schema.campaigns.orgId, workspaceId: schema.campaigns.workspaceId })
      .from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");
    try {
      await db.transaction(async (tx) => {
        await assertAssetsInWorkspace(tx, campaign, parsed.data.assetIds);
        await assertAssetStoriesInWorkspace(tx, campaign, parsed.data.storyIds, true);
        for (const [sortOrder, assetId] of parsed.data.assetIds.entries()) {
          await persistSameWorkspaceCampaignAssetRef(tx, { ...campaign, campaignId, assetId, sortOrder });
        }
        if (parsed.data.storyIds.length > 0) {
          await tx.insert(schema.campaignStoryRefs).values(parsed.data.storyIds.map((storyId) => ({ campaignId, storyId }))).onConflictDoNothing();
        }
      });
    } catch {
      return apiError("Asset reference is outside the authorized Workspace", "CAMPAIGN_ASSET_REF_DENIED", 403);
    }
    return apiSuccess({ assetIds: parsed.data.assetIds, storyIds: parsed.data.storyIds });
  } catch (error) { return handleApiError(error); }
}
