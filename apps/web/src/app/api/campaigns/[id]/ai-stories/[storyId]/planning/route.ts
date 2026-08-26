import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  getLatestAnimationPackageForStory,
  getLatestCompleteAnimationPackageForStory,
  loadLatestCreativeContextForStory,
  readCompleteAnimationPackage,
  readPlanningDraftFromPackage,
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
    // Raw planning artifacts are an advanced operator surface. Normal users
    // consume the product-facing Story and Runtime projections instead.
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const [creativeContext, animationPackage, completeRow] = await Promise.all([
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
      getLatestCompleteAnimationPackageForStory(db, {
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
      planningDraft: readPlanningDraftFromPackage(animationPackage),
      completePackage:
        readCompleteAnimationPackage(animationPackage) ??
        readCompleteAnimationPackage(completeRow),
      completeAnimationPackageRow: completeRow,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
