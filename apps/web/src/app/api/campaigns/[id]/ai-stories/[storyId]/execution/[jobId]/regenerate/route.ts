import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { regenerateSingleExecutionOutput } from "@ceo-agent/agents";
import { isUuid } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

const BodySchema = z.object({
  outputId: z.string().uuid(),
});

/**
 * Regenerate ONE execution video output without re-running planning or the full job pipeline.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; jobId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId, jobId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId) || !isUuid(jobId)) {
      return apiError("Invalid id", "VALIDATION_ERROR", 400);
    }
    const raw = await request.json().catch(() => ({}));
    const body = BodySchema.safeParse(raw);
    if (!body.success) {
      return apiError("outputId is required", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(campaign.workspaceId, user.id, "operator");

    await regenerateSingleExecutionOutput({
      db,
      executionJobId: jobId,
      outputId: body.data.outputId,
      workspaceId: campaign.workspaceId,
    });
    return apiSuccess({
      storyId,
      executionJobId: jobId,
      outputId: body.data.outputId,
      regenerated: true,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
