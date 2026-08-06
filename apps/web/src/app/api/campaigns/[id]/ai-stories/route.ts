import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { AiStoryCreateBodySchema, isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  assertCampaignAssets,
  listCampaignAiStories,
  replaceAiStoryAssetLinks,
} from "@/lib/ai-story-service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const stories = await listCampaignAiStories(db, campaignId, campaign.workspaceId);
    return apiSuccess({ stories });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    if (!isUuid(campaignId)) return apiError("Invalid campaign id", "VALIDATION_ERROR", 400);

    const parsed = AiStoryCreateBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid AI Story payload", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const assetIds = parsed.data.assetIds ?? [];
    if (assetIds.length) {
      await assertCampaignAssets(db, campaignId, campaign.workspaceId, assetIds);
    }

    const [story] = await db
      .insert(schema.aiStories)
      .values({
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId,
        title: parsed.data.title,
        originalIdea: parsed.data.originalIdea,
        status: "draft",
        createdBy: user.id,
      })
      .returning();

    if (!story) return apiError("Failed to create AI Story", "INTERNAL", 500);
    if (assetIds.length) await replaceAiStoryAssetLinks(db, story.id, assetIds);

    return apiSuccess({ story }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
