import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  getLatestAnimationPackageForStory,
  loadLatestCreativeContextForStory,
} from "@/lib/ai-story-planning-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const [creativeContext, animationPackage] = await Promise.all([
      loadLatestCreativeContextForStory(db, {
        campaignId,
        storyId,
        workspaceId: campaign.workspaceId,
      }),
      getLatestAnimationPackageForStory(db, {
        campaignId,
        storyId,
        workspaceId: campaign.workspaceId,
      }),
    ]);

    return apiSuccess({
      story: loaded.story,
      currentVersion: loaded.currentVersion,
      creativeContext,
      animationPackage,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
