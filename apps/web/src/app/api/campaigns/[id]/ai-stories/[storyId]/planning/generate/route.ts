import { eq } from "drizzle-orm";
import { AiStoryAssetMatchingRepository, getDb, schema } from "@ceo-agent/db";
import { enqueueStoryPlanningStage } from "@ceo-agent/queue";
import {
  STORY_PLANNING_STAGE_ORDER,
  AiStorySceneGroundingError,
  isUuid,
  nextRequiredPlanningStage,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  getLatestAnimationPackageForStory,
  readCompleteAnimationPackage,
  readPlanningDraftFromPackage,
} from "@/lib/ai-story-planning-service";
import {
  persistStoryAssetMatching,
  prepareStoryAssetGroundingFromCache,
} from "@/lib/ai-story-asset-semantic-grounding";

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

    const status = loaded.story.status as AiStoryStatus;
    if (!["ready_for_animation", "planning", "planning_review", "failed"].includes(status)) {
      return apiError("Story cannot enter planning in its current state", "VALIDATION_ERROR", 409);
    }
    if (!loaded.currentVersion.frozenAt) {
      return apiError("Story Version must be frozen before planning", "VALIDATION_ERROR", 409);
    }

    try {
      await new AiStoryAssetMatchingRepository(db).loadScenePlanningGroundingContext({
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        storyId,
        storyVersionId: loaded.currentVersion.id,
      });
    } catch (error) {
      if (!(error instanceof AiStorySceneGroundingError) || error.code !== "SCENE_GROUNDING_AUTHORITY_REQUIRED") {
        throw error;
      }
      const grounding = await prepareStoryAssetGroundingFromCache({
        db,
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        assetLinks: loaded.assetLinks,
      });
      if (grounding.analyzedAssets.length === 0) throw error;
      await persistStoryAssetMatching({
        db,
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        storyId,
        storyVersionId: loaded.currentVersion.id,
        storyVersionNumber: loaded.currentVersion.versionNumber,
        structuredStory: loaded.currentVersion.structuredContent,
        grounding,
        nativeDialogueDesired: loaded.story.episodeIntent?.nativeCharacterDialogue === true,
      });
    }

    const latestPackage = await getLatestAnimationPackageForStory(db, {
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });
    const sameVersion = latestPackage?.storyVersionId === loaded.currentVersion.id;
    // A package whose payload is already the assembled AnimationPackagePayload (not a
    // StoryPlanningDraft) means every stage already completed. readPlanningDraftFromPackage
    // returns null for that shape, which previously made nextRequiredPlanningStage(undefined ?? [])
    // fall through to the FIRST stage and silently re-run — and overwrite — an already-complete plan.
    if (sameVersion && readCompleteAnimationPackage(latestPackage) !== null) {
      return apiSuccess({
        storyId,
        storyVersionId: loaded.currentVersion.id,
        status,
        execution: "complete",
        completedStages: [...STORY_PLANNING_STAGE_ORDER],
      });
    }
    const draft = sameVersion ? readPlanningDraftFromPackage(latestPackage) : null;
    const stage = nextRequiredPlanningStage(draft?.completedStages ?? []);
    if (!stage) {
      return apiSuccess({
        storyId,
        storyVersionId: loaded.currentVersion.id,
        status,
        execution: "complete",
        completedStages: draft?.completedStages ?? [...STORY_PLANNING_STAGE_ORDER],
      });
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
