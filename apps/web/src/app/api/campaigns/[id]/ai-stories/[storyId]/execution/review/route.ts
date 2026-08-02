import { eq } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { createGenerateReview } from "@ceo-agent/agents";
import { isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";

/**
 * Sprint 3 Phase 1 — Generate Review:
 * compile Scene Execution Intents + run provider-neutral AI QC.
 * Does not start provider execution.
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
      orgId: campaign.orgId,
    });

    if (status === "ready_for_execution") {
      await setAiStoryStatus(db, storyId, status, "generate_review");
    }

    const blockingErrors = review.qcResults.flatMap((r) =>
      r.errors.filter((e) => e.severity === "blocking")
    );
    const warnings = review.qcResults.flatMap((r) =>
      r.errors.filter((e) => e.severity === "warning")
    );

    return apiSuccess({
      storyId,
      status: status === "ready_for_execution" ? "generate_review" : status,
      animationPackageId: review.animationPackageId,
      phase: review.phase,
      estimate: review.estimate,
      storyExecutionPlan: review.storyExecutionPlan,
      sceneIntentCount: review.sceneIntents.length,
      sceneIntents: review.sceneIntents.map((intent) => ({
        sceneExecutionId: intent.identity.sceneExecutionId,
        sceneId: intent.identity.sceneId,
        sceneOrder: intent.identity.sceneOrder,
        plannedDurationMs: intent.plannedDurationMs,
        shotCount: intent.shotReferences.length,
        referencedAssetIds: intent.referencedAssetIds,
        deterministicFingerprint: intent.identity.deterministicFingerprint,
      })),
      qc: {
        overallStatus: review.overallQcStatus,
        results: review.qcResults,
        blockingErrors,
        warnings,
      },
      executionAllowed: review.executionAllowed,
      qcPass: review.overallQcStatus !== "failed",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
