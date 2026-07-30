import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { createGenerateReview } from "@ceo-agent/agents";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";

const BodySchema = z.object({
  mediaKind: z.enum(["video", "image"]).optional(),
});

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
    const raw = await request.json().catch(() => ({}));
    const body = BodySchema.safeParse(raw);
    if (!body.success) {
      return apiError("Invalid body", "VALIDATION_ERROR", 400);
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
    if (
      !["ready_for_execution", "generate_review", "execution_failed"].includes(status)
    ) {
      return apiError(
        "Animation Package must be READY FOR EXECUTION before Generate Review",
        "VALIDATION_ERROR",
        409
      );
    }

    const review = await createGenerateReview({
      db,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
      mediaKind: body.data.mediaKind,
    });

    if (status === "ready_for_execution") {
      await setAiStoryStatus(db, storyId, status, "generate_review");
    }

    return apiSuccess({
      storyId,
      status: status === "ready_for_execution" ? "generate_review" : status,
      animationPackageId: review.animationPackageId,
      estimate: review.estimate,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
