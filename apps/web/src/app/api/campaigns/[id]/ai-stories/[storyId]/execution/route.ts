import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { createGenerateReview } from "@ceo-agent/agents";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

const BodySchema = z.object({
  confirm: z.literal(true),
});

/**
 * Sprint 3 Phase 1 — execution start is locked.
 * Re-runs Generate Review / AI QC and refuses provider execution.
 */
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
      orgId: campaign.orgId,
    });

    if (review.overallQcStatus === "failed") {
      return apiError(
        "AI QC blocking findings prevent execution",
        "AI_QC_BLOCKED",
        409
      );
    }

    return apiError(
      "Phase 1 lock: Scene compilation and AI QC only. Provider execution, Outbox, and Worker paths are disabled until later Sprint 3 phases are approved.",
      "PHASE1_EXECUTION_LOCKED",
      409
    );
  } catch (error) {
    return handleApiError(error);
  }
}
