import { and, eq } from "drizzle-orm";
import { getCampaignAssets, getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isUuid, validateCampaignForGenerate } from "@ceo-agent/shared";

/**
 * SPEC-002 / UI-SPEC-002 Generate — Sprint 0003 placeholder only.
 * Validates required inputs and records a non-AI processing state.
 * Does NOT enqueue agent.pipeline /run.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) {
      return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);

    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assets = await getCampaignAssets(db, campaignId, campaign.workspaceId);
    const storyRefs = await db
      .select({ storyId: schema.campaignStoryRefs.storyId })
      .from(schema.campaignStoryRefs)
      .innerJoin(schema.stories, eq(schema.stories.id, schema.campaignStoryRefs.storyId))
      .where(
        and(
          eq(schema.campaignStoryRefs.campaignId, campaignId),
          eq(schema.stories.status, "ready")
        )
      );

    const validation = validateCampaignForGenerate({
      name: campaign.name,
      objective: campaign.objective,
      objectiveCustom: campaign.objectiveCustom,
      outputLanguage: campaign.outputLanguage,
      subtitleLanguage: campaign.subtitleLanguage,
      ctaLanguage: campaign.ctaLanguage,
      hashtagLanguage: campaign.hashtagLanguage,
      assetCount: assets.length,
      storyCount: storyRefs.length,
    });

    if (!validation.ok) {
      await db
        .update(schema.campaigns)
        .set({
          generateStatus: "failed",
          generateSummary: { errors: validation.errors, aiGeneration: false },
          updatedAt: new Date(),
        })
        .where(eq(schema.campaigns.id, campaignId));
      return apiError(validation.errors.join("; "), "VALIDATION_ERROR", 400);
    }

    const [updated] = await db
      .update(schema.campaigns)
      .set({
        generateStatus: "waiting",
        generateSummary: {
          ...validation.summary,
          validatedAt: new Date().toISOString(),
          validatedBy: user.id,
          aiGeneration: false,
          marketingPackageGenerated: false,
        },
        // Business status remains Draft until real AI/activation exists.
        status: campaign.status === "draft" ? "draft" : campaign.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, campaignId))
      .returning();

    return apiSuccess({
      campaign: updated,
      summary: validation.summary,
      generateStatus: "waiting",
      aiInvoked: false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
