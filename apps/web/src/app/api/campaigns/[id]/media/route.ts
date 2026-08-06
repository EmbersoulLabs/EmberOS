import { and, eq } from "drizzle-orm";
import {
  assertAssetsInWorkspace,
  assertStoriesInWorkspace,
  getDb,
  replaceCampaignMediaReferences,
  replaceStoryAssets,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import {
  CampaignMediaAttachBodySchema,
  directAssetsForStoryMode,
  isUuid,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { getCampaignAssets } from "@/lib/campaign-assets";

/**
 * Attach existing Assets and/or Ready Stories to a Campaign (PD-036).
 * Also records multi-video analysis choice without running AI (V1).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) {
      return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);
    }

    const parsed = CampaignMediaAttachBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid media attach payload", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);

    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assetIds = parsed.data.assetIds;
    const storyIds = parsed.data.storyIds;
    const storyAssetIds = parsed.data.storyAssetIds ?? [];

    const assetCheck = await assertAssetsInWorkspace(
      db,
      campaign.workspaceId,
      [...assetIds, ...storyAssetIds]
    );
    if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);

    const storyCheck = await assertStoriesInWorkspace(db, campaign.workspaceId, storyIds, {
      readyOnly: true,
    });
    if (!storyCheck.ok) return apiError(storyCheck.error, "VALIDATION_ERROR", 400);

    let createdStoryId: string | null = null;

    let finalAssetIds = assetIds;
    let finalStoryIds = storyIds;

    if (parsed.data.mediaAnalysisMode === "story" && storyAssetIds.length > 1) {
      const [workspace] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, campaign.workspaceId))
        .limit(1);
      if (!workspace) return apiError("Workspace not found", "NOT_FOUND", 404);

      const storyName =
        parsed.data.createStoryName?.trim() ||
        `${campaign.name} Story`;

      const [story] = await db
        .insert(schema.stories)
        .values({
          orgId: workspace.orgId,
          workspaceId: campaign.workspaceId,
          name: storyName,
          status: "draft",
          createdBy: user.id,
        })
        .returning();

      await replaceStoryAssets(db, story.id, storyAssetIds);
      await db
        .update(schema.stories)
        .set({ status: "ready", updatedAt: new Date() })
        .where(eq(schema.stories.id, story.id));
      createdStoryId = story.id;
      finalAssetIds = directAssetsForStoryMode(assetIds, storyAssetIds);
      finalStoryIds = [...storyIds, story.id];
    }

    await replaceCampaignMediaReferences(
      db,
      campaignId,
      finalAssetIds,
      finalStoryIds
    );

    if (parsed.data.mediaAnalysisMode) {
      const metadata = {
        ...(campaign.metadata ?? {}),
        mediaAnalysisMode: parsed.data.mediaAnalysisMode,
        mediaAnalysisModeUpdatedAt: new Date().toISOString(),
        mediaAnalysisModeUpdatedBy: user.id,
      };
      await db
        .update(schema.campaigns)
        .set({ metadata, updatedAt: new Date() })
        .where(eq(schema.campaigns.id, campaignId));
    }

    const assets = await getCampaignAssets(db, campaignId, campaign.workspaceId);
    const storyRefs = await db
      .select({ storyId: schema.campaignStoryRefs.storyId })
      .from(schema.campaignStoryRefs)
      .where(eq(schema.campaignStoryRefs.campaignId, campaignId));

    return apiSuccess({
      assets,
      storyIds: storyRefs.map((r) => r.storyId),
      createdStoryId,
      mediaAnalysisMode: parsed.data.mediaAnalysisMode ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
