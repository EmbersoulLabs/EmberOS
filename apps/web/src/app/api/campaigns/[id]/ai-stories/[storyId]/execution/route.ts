import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { createGenerateReview, startExecutionJob } from "@ceo-agent/agents";
import { enqueueStoryExecution } from "@ceo-agent/queue";
import {
  GenerateReviewEstimateSchema,
  isUuid,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

const BodySchema = z.object({
  confirm: z.literal(true),
  estimate: GenerateReviewEstimateSchema.optional(),
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
      return apiError(
        "Execution requires confirm:true after Generate Review",
        "VALIDATION_ERROR",
        400
      );
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
        "Story cannot start execution in its current state",
        "VALIDATION_ERROR",
        409
      );
    }

    const review = await createGenerateReview({
      db,
      campaignId,
      storyId,
      workspaceId: campaign.workspaceId,
    });
    const estimate = body.data.estimate ?? review.estimate;

    const started = await startExecutionJob({
      db,
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      animationPackageId: review.animationPackageId,
      createdBy: user.id,
      estimate,
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
      taskId: started.taskId,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
