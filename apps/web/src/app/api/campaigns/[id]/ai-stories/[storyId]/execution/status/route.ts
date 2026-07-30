import { and, desc, eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

export async function GET(
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
    await requireWorkspaceRole(campaign.workspaceId, user.id, "client_viewer");

    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);

    const [job] = await db
      .select()
      .from(schema.aiStoryExecutionJobs)
      .where(
        and(
          eq(schema.aiStoryExecutionJobs.campaignId, campaignId),
          eq(schema.aiStoryExecutionJobs.storyId, storyId),
          eq(schema.aiStoryExecutionJobs.workspaceId, campaign.workspaceId)
        )
      )
      .orderBy(desc(schema.aiStoryExecutionJobs.createdAt))
      .limit(1);

    const outputs = job
      ? await db
          .select()
          .from(schema.aiStoryMarketingOutputs)
          .where(eq(schema.aiStoryMarketingOutputs.executionJobId, job.id))
          .orderBy(schema.aiStoryMarketingOutputs.outputIndex)
      : [];

    return apiSuccess({
      story: loaded.story,
      executionJob: job,
      outputs,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
