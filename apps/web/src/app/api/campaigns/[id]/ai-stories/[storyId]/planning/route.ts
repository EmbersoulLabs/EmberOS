import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { agentQueue } from "@ceo-agent/queue";
import {
  describePlanningStageFailure,
  isUuid,
  STORY_PLANNING_STAGE_ORDER,
} from "@ceo-agent/shared";
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

/**
 * Stage jobs fail fast with a specific, actionable reason (e.g. an unaccepted
 * character proposal), but the frontend only polled this route and story
 * status, so that reason never reached the user — they just saw "failed"
 * with no next step. Look up the exact job BullMQ already recorded for the
 * stage the caller is currently waiting on and translate it.
 */
async function loadStageFailure(storyVersionId: string | null, stageParam: string | null) {
  if (!storyVersionId || !stageParam) return null;
  if (!(STORY_PLANNING_STAGE_ORDER as readonly string[]).includes(stageParam)) return null;
  const job = await agentQueue().getJob(`story-plan-${storyVersionId}-${stageParam}`);
  if (!job) return null;
  if ((await job.getState()) !== "failed") return null;
  return {
    stage: stageParam,
    code: job.failedReason ?? null,
    message: describePlanningStageFailure(job.failedReason),
  };
}

export async function GET(
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
    // Raw planning artifacts are an advanced operator surface. Normal users
    // consume the product-facing Story and Runtime projections instead.
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator", request });

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const stageParam = new URL(request.url).searchParams.get("stage");
    const [creativeContext, animationPackage, completeRow, stageFailure] = await Promise.all([
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
      loadStageFailure(loaded.currentVersion?.id ?? null, stageParam),
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
      stageFailure,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
