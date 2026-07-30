import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  approveAnimationPackage,
  getLatestCompleteAnimationPackageForStory,
} from "@/lib/ai-story-planning-service";

export async function POST(
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
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (status !== "planning_review") {
      return apiError("Story must be in planning review before approval", "VALIDATION_ERROR", 409);
    }

    const animationPackage = await getLatestCompleteAnimationPackageForStory(db, {
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });
    if (!animationPackage) {
      return apiError(
        "Complete Animation Package not found — finish planning stages first",
        "NOT_FOUND",
        404
      );
    }
    if (animationPackage.status === "ready_for_execution") {
      return apiError("Animation Package is already approved", "ALREADY_APPROVED", 409);
    }

    const approvedPackage = await approveAnimationPackage(db, {
      packageId: animationPackage.id,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
      approvedBy: user.id,
    });
    await setAiStoryStatus(db, storyId, "planning_review", "ready_for_execution");

    return apiSuccess({
      storyId,
      status: "ready_for_execution",
      animationPackage: approvedPackage,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
