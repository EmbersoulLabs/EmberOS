import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { apiSuccess, apiError } from "@/lib/api";
import {
  freezeAiStoryVersion,
  loadCampaignAiStory,
  setAiStoryStatus,
} from "@/lib/ai-story-service";

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
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    if (!loaded.currentVersion) {
      return apiError("No Story Draft to approve", "VALIDATION_ERROR", 409);
    }

    let status = loaded.story.status as AiStoryStatus;
    if (status === "ready_for_animation") {
      return apiError("Story is already Ready for Animation", "ALREADY_APPROVED", 409);
    }
    // A draft can already have a durable current version when a previous save
    // completed but the follow-up review transition did not. The explicit
    // approval request is the operator's review action, so recover that valid
    // checkpoint without creating or mutating another version.
    if (status === "draft") {
      await setAiStoryStatus(db, storyId, "draft", "review");
      status = "review";
    }
    if (status !== "review" && status !== "approved") {
      return apiError("Story must be in review before approval", "VALIDATION_ERROR", 409);
    }

    const frozen = await freezeAiStoryVersion(db, {
      storyId,
      versionId: loaded.currentVersion.id,
      frozenBy: user.id,
      fromStatus: status === "approved" ? "approved" : "review",
    });

    const [story] = await db
      .select()
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, storyId))
      .limit(1);

    return apiSuccess({
      story,
      frozenVersion: frozen,
      status: "ready_for_animation",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
