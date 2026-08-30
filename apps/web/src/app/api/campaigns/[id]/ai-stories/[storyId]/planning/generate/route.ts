import { and, eq, inArray } from "drizzle-orm";
import {
  getBusinessProfileByWorkspace,
  getDb,
  schema,
} from "@ceo-agent/db";
import { runFullStoryPlanningPipeline } from "@ceo-agent/agents";
import {
  AiStoryStructuredDraftSchema,
  assessBusinessProfileCompletion,
  isUuid,
  normalizeBusinessProfileRecord,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import {
  assetLabelFromProductionRow,
  campaignPlanningFields,
} from "@/lib/ai-story-production-compat";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  saveAnimationPackage,
  saveCreativeContext,
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
    if (!loaded.currentVersion) {
      return apiError("No frozen Story Draft found for planning", "VALIDATION_ERROR", 409);
    }

    const status = loaded.story.status as AiStoryStatus;
    if (!["ready_for_animation", "planning_review"].includes(status)) {
      return apiError("Story cannot enter planning in its current state", "VALIDATION_ERROR", 409);
    }
    if (!loaded.currentVersion.frozenAt) {
      return apiError("Story Version must be frozen before planning", "VALIDATION_ERROR", 409);
    }

    await setAiStoryStatus(db, storyId, status, "planning");

    try {
      const storyDraft = AiStoryStructuredDraftSchema.parse(
        loaded.currentVersion.structuredContent
      );
      const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
      const profile = profileRow
        ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
        : null;
      const completion = profile ? assessBusinessProfileCompletion(profile) : null;

      const assetIds = loaded.assetLinks.map((link) => link.assetId);
      const assetLabels =
        assetIds.length === 0
          ? []
          : (
              await db
              .select({
                id: schema.assets.id,
                storagePath: schema.assets.storagePath,
                metadata: schema.assets.metadata,
              })
              .from(schema.assets)
              .where(
                and(
                  eq(schema.assets.workspaceId, campaign.workspaceId),
                  inArray(schema.assets.id, assetIds)
                )
              )
            ).map((asset) => assetLabelFromProductionRow(asset));

      const animationPackage = await runFullStoryPlanningPipeline({
        storyDraft,
        campaign: {
          id: campaign.id,
          ...campaignPlanningFields(campaign),
        },
        brand: profile
          ? {
              brandName: profile.companyName,
              brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
              targetAudience: profile.targetAudience,
              industry:
                profile.industryDisplayName ||
                profile.industryCustomValue ||
                null,
              description: profile.businessDescription,
              values: profile.brandValues,
              style: profile.brandStyle,
            }
          : null,
        assetLabels: [
          ...assetLabels,
          ...(completion?.complete === false
            ? ["Business Profile incomplete; keep brand assumptions explicit."]
            : []),
        ],
      });

      const creativeContext = await saveCreativeContext(db, {
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: loaded.currentVersion.id,
        payload: animationPackage.creativeContext,
      });
      const savedPackage = await saveAnimationPackage(db, {
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId,
        storyId,
        storyVersionId: loaded.currentVersion.id,
        payload: animationPackage,
      });

      await setAiStoryStatus(db, storyId, "planning", "planning_review");

      return apiSuccess({
        storyId,
        status: "planning_review",
        creativeContext,
        animationPackage: savedPackage,
      });
    } catch (error) {
      await setAiStoryStatus(db, storyId, "planning", "failed");
      return apiError(
        error instanceof Error ? error.message : "AI Story planning failed",
        "AI_PLANNING_FAILED",
        502
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
