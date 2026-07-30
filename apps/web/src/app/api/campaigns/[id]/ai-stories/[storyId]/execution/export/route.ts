import { and, desc, eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { enqueueTaskExport } from "@ceo-agent/queue";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

/**
 * Export approved AI Story marketing outputs only (ZIP via existing task export).
 */
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

    const [job] = await db
      .select()
      .from(schema.aiStoryExecutionJobs)
      .where(
        and(
          eq(schema.aiStoryExecutionJobs.storyId, storyId),
          eq(schema.aiStoryExecutionJobs.workspaceId, campaign.workspaceId)
        )
      )
      .orderBy(desc(schema.aiStoryExecutionJobs.createdAt))
      .limit(1);
    if (!job?.taskId) {
      return apiError("No execution task found for export", "NOT_FOUND", 404);
    }

    const approved = await db
      .select()
      .from(schema.aiStoryMarketingOutputs)
      .where(
        and(
          eq(schema.aiStoryMarketingOutputs.executionJobId, job.id),
          eq(schema.aiStoryMarketingOutputs.status, "approved")
        )
      );
    if (approved.length === 0) {
      return apiError(
        "Export requires at least one approved marketing output",
        "VALIDATION_ERROR",
        409
      );
    }

    // Sync creative statuses for export gate (approved only).
    const creativeIds = approved
      .map((row) => row.creativeId)
      .filter((id): id is string => Boolean(id));
    if (creativeIds.length > 0) {
      await db
        .update(schema.creatives)
        .set({ status: "approved", updatedAt: new Date() })
        .where(
          and(
            eq(schema.creatives.taskId, job.taskId),
            eq(schema.creatives.workspaceId, campaign.workspaceId)
          )
        );
      // Re-assert only approved outputs remain approved; demote others on the task.
      const allOutputs = await db
        .select()
        .from(schema.aiStoryMarketingOutputs)
        .where(eq(schema.aiStoryMarketingOutputs.executionJobId, job.id));
      for (const output of allOutputs) {
        if (!output.creativeId) continue;
        if (output.status !== "approved") {
          await db
            .update(schema.creatives)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(eq(schema.creatives.id, output.creativeId));
        }
      }
    }

    await enqueueTaskExport({
      taskId: job.taskId,
      workspaceId: campaign.workspaceId,
      orgId: campaign.orgId,
      campaignId,
      platforms: campaign.platforms?.length ? campaign.platforms : ["instagram"],
      resolution: "1080p",
    });

    return apiSuccess({
      storyId,
      taskId: job.taskId,
      approvedCount: approved.length,
      exportQueued: true,
      formats: ["ZIP", "MP4", "PNG", "JSON"],
    });
  } catch (error) {
    return handleApiError(error);
  }
}
