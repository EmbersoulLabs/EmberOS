import { eq } from "drizzle-orm";
import { AiStoryAssetMatchingRepository, AiStoryAssetPlannerPersistenceError, getDb, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

const CONFIRMATION_STATUS: Record<string, number> = {
  STORY_ASSET_BINDING_SCOPE_MISMATCH: 404,
  NO_ASSET_CONFIRMATION_ASSETS_PRESENT: 409,
  NO_ASSET_CONFIRMATION_STALE_VERSION: 409,
  NO_ASSET_CONFIRMATION_VERSION_NOT_FROZEN: 409,
  NO_ASSET_CONFIRMATION_CONFLICT: 409,
};

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
    const body = await request.json().catch(() => null) as { confirmed?: unknown; storyVersionId?: unknown } | null;
    if (!body || body.confirmed !== true) {
      return apiError("Explicit no-asset confirmation is required", "VALIDATION_ERROR", 400);
    }
    if (typeof body.storyVersionId !== "string" || !isUuid(body.storyVersionId)) {
      return apiError("Frozen Story Version is required", "VALIDATION_ERROR", 400);
    }

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
    if (!loaded?.currentVersion) return apiError("AI Story not found", "NOT_FOUND", 404);
    if (loaded.currentVersion.id !== body.storyVersionId) {
      return apiError(
        "No-asset confirmation does not match the current frozen Story Version",
        "NO_ASSET_CONFIRMATION_STALE_VERSION",
        409
      );
    }
    if (!loaded.currentVersion.frozenAt) {
      return apiError(
        "Story Version must be frozen before no-asset confirmation",
        "NO_ASSET_CONFIRMATION_VERSION_NOT_FROZEN",
        409
      );
    }

    const result = await new AiStoryAssetMatchingRepository(db).confirmNoReferenceAssets({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      confirmedBy: user.id,
      confirmedAt: new Date().toISOString(),
      nativeDialogueDesired: loaded.story.episodeIntent?.nativeCharacterDialogue === true,
    });
    return apiSuccess({
      matchingResultId: result.matchingResultId,
      storyId: result.storyId,
      storyVersionId: result.storyVersionId,
      assetRecommendationStatus: result.assetRecommendationStatus,
      confirmedBy: result.noAssetConfirmation?.confirmedBy ?? null,
      confirmedAt: result.noAssetConfirmation?.confirmedAt ?? null,
    });
  } catch (error) {
    if (error instanceof AiStoryAssetPlannerPersistenceError) {
      return apiError(error.message, error.code, CONFIRMATION_STATUS[error.code] ?? 409);
    }
    return handleApiError(error);
  }
}
