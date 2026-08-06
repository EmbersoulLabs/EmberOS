import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import {
  STORY_PLANNING_STAGE_ORDER,
  isUuid,
  type AiStoryStatus,
  type StoryPlanningStage,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import { runSinglePlanningStage } from "@/lib/ai-story-planning-runner";

export async function POST(
  _request: Request,
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
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (!["ready_for_animation", "planning", "planning_review", "failed"].includes(status)) {
      return apiError("Story cannot enter planning in its current state", "VALIDATION_ERROR", 409);
    }

    try {
      const result = await runSinglePlanningStage({
        db,
        campaignId,
        storyId,
        stage,
        storyStatus: status,
      });
      return apiSuccess({
        storyId,
        status: result.status,
        stage: result.stage,
        completedStages: result.completedStages,
        creativeContext: result.creativeContext,
        animationPackage: result.animationPackage,
        planningDraft: result.planningDraft,
      });
    } catch (error) {
      if (status === "planning" || status === "ready_for_animation" || status === "planning_review") {
        try {
          const { setAiStoryStatus } = await import("@/lib/ai-story-service");
          await setAiStoryStatus(db, storyId, "planning", "failed");
        } catch {
          /* best-effort */
        }
      }
      return apiError(
        error instanceof Error ? error.message : "AI Story planning stage failed",
        "AI_PLANNING_FAILED",
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
