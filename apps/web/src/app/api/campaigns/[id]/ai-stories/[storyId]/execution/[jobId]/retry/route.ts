import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { retryExecutionJob } from "@ceo-agent/agents";
import { enqueueStoryExecution } from "@ceo-agent/queue";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; jobId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, jobId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId) || !isUuid(jobId)) {
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

    const job = await retryExecutionJob(db, jobId, campaign.workspaceId);
    if (!job) return apiError("Retry failed", "RETRY_FAILED", 502);

    await enqueueStoryExecution({
      executionJobId: job.id,
      storyId,
      campaignId,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
    });

    return apiSuccess({ storyId, status: "executing", executionJob: job });
  } catch (error) {
    return handleApiError(error);
  }
}
