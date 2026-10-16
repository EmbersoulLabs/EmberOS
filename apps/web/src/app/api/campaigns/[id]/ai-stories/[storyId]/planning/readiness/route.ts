import { eq } from "drizzle-orm";
import { getDb, prepareEpisodePlanningExecutionReadiness, schema } from "@ceo-agent/db";
import { EpisodeProjectedAuthorityError, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import { getLatestCompleteAnimationPackageForStory } from "@/lib/ai-story-planning-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid id", "VALIDATION_ERROR", 400);
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    const animationPackage = await getLatestCompleteAnimationPackageForStory(db, { campaignId, storyId, workspaceId: campaign.workspaceId });
    if (!animationPackage) return apiError("Complete Animation Package not found — finish planning stages first", "NOT_FOUND", 404);
    const readiness = await prepareEpisodePlanningExecutionReadiness({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
    }, animationPackage.id, db);
    return apiSuccess({ readiness });
  } catch (error) {
    if (error instanceof EpisodeProjectedAuthorityError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
