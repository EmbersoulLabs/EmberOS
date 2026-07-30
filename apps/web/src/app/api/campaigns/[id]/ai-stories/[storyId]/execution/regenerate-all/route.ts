import { and, eq, inArray } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { createGenerateReview, startExecutionJob } from "@ceo-agent/agents";
import { enqueueStoryExecution } from "@ceo-agent/queue";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

/** Regenerate ALL outputs by starting a new execution job (does not re-run planning). */
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
    if (!["execution_review", "execution_failed", "generate_review"].includes(status)) {
      return apiError(
        "Regenerate All requires an executed or failed Animation Package execution",
        "VALIDATION_ERROR",
        409
      );
    }

    await db
      .update(schema.aiStoryMarketingOutputs)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(
        and(
          eq(schema.aiStoryMarketingOutputs.storyId, storyId),
          eq(schema.aiStoryMarketingOutputs.workspaceId, campaign.workspaceId),
          inArray(schema.aiStoryMarketingOutputs.status, ["pending_review", "draft"])
        )
      );

    const review = await createGenerateReview({
      db,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });

    const started = await startExecutionJob({
      db,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      animationPackageId: review.animationPackageId,
      createdBy: user.id,
      estimate: review.estimate,
      storyStatus: status,
    });

    await enqueueStoryExecution({
      executionJobId: started.jobId,
      storyId,
      campaignId,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
    });

    return apiSuccess({
      storyId,
      status: "executing",
      executionJobId: started.jobId,
      regeneratedAll: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
