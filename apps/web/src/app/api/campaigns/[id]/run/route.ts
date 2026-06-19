import { eq, and, desc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueuePipeline } from "@ceo-agent/queue";
import { LLM_BUDGET_PER_TASK_USD } from "@ceo-agent/shared";
import { validateCampaignAssetsForRun } from "@/lib/campaign-assets";

const MAX_CONCURRENT_CAMPAIGNS = 2;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId } = await params;
    const db = getDb();

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    const processing = await db
      .select()
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.orgId, campaign.orgId),
          eq(schema.campaigns.status, "processing")
        )
      );

    if (processing.length >= MAX_CONCURRENT_CAMPAIGNS) {
      return apiError(
        `Max ${MAX_CONCURRENT_CAMPAIGNS} concurrent campaigns per org`,
        "RATE_LIMIT",
        429
      );
    }

    const assetCheck = await validateCampaignAssetsForRun(db, campaignId, campaign.workspaceId);
    if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);

    const [task] = await db
      .insert(schema.tasks)
      .values({
        orgId: campaign.orgId,
        workspaceId: campaign.workspaceId,
        campaignId,
        status: "queued",
        costBudgetUsd: String(LLM_BUDGET_PER_TASK_USD),
        stepProgress: {},
      })
      .returning();

    await db
      .update(schema.campaigns)
      .set({ status: "processing" })
      .where(eq(schema.campaigns.id, campaignId));

    await enqueuePipeline(task!.id, campaignId, campaign.workspaceId, campaign.orgId);

    return apiSuccess({ taskId: task!.id, status: "queued" }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
