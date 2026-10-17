import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { AiStoryEpisodeIntentAuthoritySchema, isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  AiStoryGenerationStrategyRecoveryError,
  createGenerationStrategySuccessor,
  getLatestCompleteAnimationPackageForStory,
} from "@/lib/ai-story-planning-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid id", "VALIDATION_ERROR", 400);
    if ((await request.text()).trim()) return apiError("Strategy recovery accepts no client authority fields", "VALIDATION_ERROR", 422);
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    const status = loaded.story.status as AiStoryStatus;
    if (!["planning_review", "ready_for_execution", "generate_review", "execution_failed"].includes(status)) {
      return apiError("Story is not eligible for Planning successor recovery", "GENERATION_STRATEGY_SUCCESSOR_STATE_INVALID", 409);
    }
    const source = await getLatestCompleteAnimationPackageForStory(db, { campaignId, storyId, workspaceId: campaign.workspaceId });
    if (!source) return apiError("Complete source Planning Package not found", "NOT_FOUND", 404);
    const parsedIntent = AiStoryEpisodeIntentAuthoritySchema.safeParse(loaded.story.episodeIntent);
    const successor = await createGenerationStrategySuccessor(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
      sourcePackageId: source.id,
      ...(parsedIntent.success ? { episodeIntent: parsedIntent.data } : {}),
    });
    if (status !== "planning_review") await setAiStoryStatus(db, storyId, status, "planning_review");
    return apiSuccess({
      status: "planning_review",
      sourcePackageId: successor.sourcePackageId,
      successorPackageId: successor.animationPackage.id,
      externalAiCalls: successor.externalAiCalls,
      idempotent: successor.idempotent,
      humanApprovalRequired: true,
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryGenerationStrategyRecoveryError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
