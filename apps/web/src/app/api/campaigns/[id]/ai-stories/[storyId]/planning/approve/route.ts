import { eq } from "drizzle-orm";
import {
  ensureCurrentEpisodeDispatchAuthorityProjection,
  getDb,
  prepareEpisodePlanningExecutionReadiness,
  schema,
} from "@ceo-agent/db";
import { EpisodeProjectedAuthorityError, isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { NextResponse } from "next/server";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
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
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });

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
    const scope = {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
    };
    const readiness = await prepareEpisodePlanningExecutionReadiness(scope, animationPackage.id, db);
    if (readiness.status !== "PASS") {
      return NextResponse.json({
        error: "Planning is not execution-ready. Resolve the consolidated creative decisions before approval.",
        code: "PLANNING_EXECUTION_READINESS_BLOCKED",
        readiness,
      }, { status: 409 });
    }
    const approvedPackage = await approveAnimationPackage(db, {
      packageId: animationPackage.id,
      orgId: campaign.orgId,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
      approvedBy: user.id,
    });
    const frozen = await ensureCurrentEpisodeDispatchAuthorityProjection(scope, db);
    if (
      frozen.directorFingerprint !== readiness.directorFingerprint
      || frozen.motionFingerprint !== readiness.motionFingerprint
    ) {
      return apiError(
        "Validated execution authority changed during approval; reload and review the current plan",
        "PLANNING_EXECUTION_AUTHORITY_STALE",
        409
      );
    }
    await setAiStoryStatus(db, storyId, "planning_review", "ready_for_execution");

    return apiSuccess({
      storyId,
      status: "ready_for_execution",
      animationPackage: approvedPackage,
      readiness,
    });
  } catch (error) {
    if (error instanceof EpisodeProjectedAuthorityError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
