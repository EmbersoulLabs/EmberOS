import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { assertPhase1ExecutionLocked, isUuid } from "@ceo-agent/shared";
import { apiError } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

/**
 * Regenerate ONE execution video output without re-running planning or the full job pipeline.
 */
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
    assertPhase1ExecutionLocked();
  } catch (error) {
    return handleApiError(error);
  }
}
