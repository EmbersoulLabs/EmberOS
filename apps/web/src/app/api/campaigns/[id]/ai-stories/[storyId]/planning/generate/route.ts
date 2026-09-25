import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { STORY_PLANNING_STAGE_ORDER, isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import { runSinglePlanningStage } from "@/lib/ai-story-planning-runner";

export async function POST(
  request: Request,
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
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator", request });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    if (!loaded.currentVersion) {
      return apiError("No frozen Story Draft found for planning", "VALIDATION_ERROR", 409);
    }

    let status = loaded.story.status as AiStoryStatus;
    if (!["ready_for_animation", "planning", "planning_review", "failed"].includes(status)) {
      return apiError("Story cannot enter planning in its current state", "VALIDATION_ERROR", 409);
    }
    if (!loaded.currentVersion.frozenAt) {
      return apiError("Story Version must be frozen before planning", "VALIDATION_ERROR", 409);
    }

    try {
      let result: Awaited<ReturnType<typeof runSinglePlanningStage>> | null = null;
      for (const stage of STORY_PLANNING_STAGE_ORDER) {
        result = await runSinglePlanningStage({
          db,
          campaignId,
          storyId,
          actorUserId: user.id,
          stage,
          storyStatus: status,
          regenerationIdentity: request.headers.get("x-ai-story-certification-regeneration-id"),
        });
        status = result.status as AiStoryStatus;
      }
      return apiSuccess({
        storyId,
        status: result!.status,
        creativeContext: result!.creativeContext,
        animationPackage: result!.animationPackage,
      });
    } catch (error) {
      if (status === "planning") await setAiStoryStatus(db, storyId, "planning", "failed");
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
