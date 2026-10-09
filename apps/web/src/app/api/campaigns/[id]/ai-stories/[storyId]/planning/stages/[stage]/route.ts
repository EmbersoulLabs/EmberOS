import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueStoryPlanningStage } from "@ceo-agent/queue";
import {
  STORY_PLANNING_STAGE_ORDER,
  isUuid,
  type AiStoryStatus,
  type StoryPlanningStage,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; stage: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, stage: stageParam } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }
    if (!(STORY_PLANNING_STAGE_ORDER as readonly string[]).includes(stageParam)) {
      return apiError("Unknown planning stage", "VALIDATION_ERROR", 400);
    }
    const stage = stageParam as StoryPlanningStage;

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({
      user,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      minRole: "operator",
      request,
    });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    if (!loaded.currentVersion?.frozenAt) {
      return apiError("Story Version must be frozen before planning", "VALIDATION_ERROR", 409);
    }

    const status = loaded.story.status as AiStoryStatus;
    if (!["ready_for_animation", "planning", "planning_review", "failed"].includes(status)) {
      return apiError("Story cannot enter planning in its current state", "VALIDATION_ERROR", 409);
    }

    const regenerationIdentity = request.headers.get("x-ai-story-certification-regeneration-id");
    const job = await enqueueStoryPlanningStage({
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
      actorUserId: user.id,
      storyVersionId: loaded.currentVersion.id,
      stage,
      regenerationIdentity: regenerationIdentity && isUuid(regenerationIdentity) ? regenerationIdentity : null,
    });

    return apiSuccess({
      storyId,
      storyVersionId: loaded.currentVersion.id,
      status: "planning",
      stage,
      execution: "queued",
      jobId: job.id,
    }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
