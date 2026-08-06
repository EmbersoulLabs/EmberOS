import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  getDb,
  schema,
  requireWorkspaceRole,
  getBusinessProfileByWorkspace,
} from "@ceo-agent/db";
import {
  assessBusinessProfileCompletion,
  isUuid,
  normalizeBusinessProfileRecord,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { polishAiStoryDraft } from "@ceo-agent/agents";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  createAiStoryVersion,
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
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const status = loaded.story.status as AiStoryStatus;
    if (!["draft", "review", "failed"].includes(status)) {
      return apiError("Story cannot be polished in its current state", "VALIDATION_ERROR", 409);
    }

    await setAiStoryStatus(db, storyId, status, "generating");

    const profileRow = await getBusinessProfileByWorkspace(campaign.workspaceId);
    const profile = profileRow
      ? normalizeBusinessProfileRecord(profileRow as Record<string, unknown>)
      : null;
    const completion = profile ? assessBusinessProfileCompletion(profile) : null;

    const assetIds = loaded.assetLinks.map((l) => l.assetId);
    const assetLabels =
      assetIds.length === 0
        ? []
        : (
            await db
              .select({
                id: schema.assets.id,
                displayName: schema.assets.displayName,
                originalFilename: schema.assets.originalFilename,
              })
              .from(schema.assets)
              .where(
                and(
                  eq(schema.assets.workspaceId, campaign.workspaceId),
                  inArray(schema.assets.id, assetIds),
                  isNull(schema.assets.deletedAt)
                )
              )
          ).map(
            (a) =>
              a.displayName?.trim() ||
              a.originalFilename?.trim() ||
              `asset:${a.id.slice(0, 8)}`
          );

    const polish = await polishAiStoryDraft({
      originalIdea: loaded.story.originalIdea,
      campaign: {
        name: campaign.name,
        objective: campaign.objective,
        objectiveCustom: campaign.objectiveCustom,
        targetAudienceOverride: campaign.targetAudienceOverride,
        campaignBrief: campaign.campaignBrief,
        goal: campaign.goal,
      },
      businessProfile: profile
        ? {
            brandName: profile.companyName,
            brandTone: profile.brandPersonality?.[0] ?? profile.brandStyle?.[0] ?? null,
            targetAudience: profile.targetAudience,
            industry:
              profile.industryDisplayName ||
              profile.industryCustomValue ||
              null,
            description: profile.businessDescription,
          }
        : null,
      assetLabels,
      businessProfileComplete: completion?.complete,
    });

    if (!polish.ok) {
      await setAiStoryStatus(db, storyId, "generating", "failed");
      return apiError(polish.error, "AI_GENERATION_FAILED", 502);
    }

    const draft = {
      ...polish.draft,
      assetReferences: assetIds,
      warnings: [
        ...polish.warnings.map((w) => w.message),
        ...polish.draft.warnings,
      ],
    };

    const version = await createAiStoryVersion(db, {
      storyId,
      structuredContent: draft,
      sourceContextSnapshot: {
        campaignId,
        workspaceId: campaign.workspaceId,
        assetIds,
        warnings: polish.warnings,
      },
      aiMetadata: {
        provider: "json-generation",
        costUsd: polish.usage.costUsd,
        inputTokens: polish.usage.input,
        outputTokens: polish.usage.output,
      },
      createdBy: user.id,
    });

    await setAiStoryStatus(db, storyId, "generating", "review");

    return apiSuccess({
      storyId,
      status: "review",
      version,
      warnings: polish.warnings,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
