import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@ceo-agent/db";
import { AiStoryEpisodeIntentAuthoritySchema, isUuid, type AiStoryStatus } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import { AiStoryGenerationStrategyRecoveryError, createSceneCastSuccessor, getLatestCompleteAnimationPackageForStory } from "@/lib/ai-story-planning-service";
import { AiStoryCanonicalSceneProducerError } from "@/lib/ai-story-canonical-scene-producer";

const BodySchema = z.object({
  scenes: z.array(z.object({
    sceneId: z.string().trim().min(1).max(200),
    mode: z.enum(["AUTO", "SINGLE_CHARACTER", "MULTI_CHARACTER"]),
    participants: z.array(z.object({
      castId: z.string().uuid(),
      presence: z.enum(["ON_SCREEN", "OFF_SCREEN_DIALOGUE", "VOICE_ONLY"]),
      visualRole: z.enum(["PRIMARY_VISUAL", "SUPPORTING_VISUAL", "BACKGROUND_VISUAL"]),
    }).strict()).max(32),
    genericExtras: z.array(z.object({
      description: z.string().trim().min(1).max(1000),
      count: z.number().int().positive().max(100),
      facesReadable: z.boolean(),
    }).strict()).max(32).default([]),
  }).strict()).min(1).max(64),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid id", "VALIDATION_ERROR", 400);
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return apiError("Provide valid Scene cast decisions", "VALIDATION_ERROR", 422);
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    const status = loaded.story.status as AiStoryStatus;
    if (status !== "planning_review" && status !== "ready_for_execution") {
      return apiError("Story is not eligible for a Scene cast successor", "SCENE_CAST_SUCCESSOR_STATE_INVALID", 409);
    }
    const source = await getLatestCompleteAnimationPackageForStory(db, { campaignId, storyId, workspaceId: campaign.workspaceId });
    if (!source) return apiError("Complete source Planning Package not found", "NOT_FOUND", 404);
    const parsedIntent = AiStoryEpisodeIntentAuthoritySchema.safeParse(loaded.story.episodeIntent);
    const successor = await createSceneCastSuccessor(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
      sourcePackageId: source.id,
      castDirections: body.data.scenes,
      ...(parsedIntent.success ? { episodeIntent: parsedIntent.data } : {}),
    });
    if (status !== "planning_review") await setAiStoryStatus(db, storyId, status, "planning_review");
    return apiSuccess({
      status: "planning_review",
      sourcePackageId: successor.sourcePackageId,
      successorPackageId: successor.animationPackage.id,
      changes: successor.changes,
      externalAiCalls: successor.externalAiCalls,
      humanApprovalRequired: true,
    }, 201);
  } catch (error) {
    if (error instanceof AiStoryGenerationStrategyRecoveryError) return apiError(error.message, error.code, 409);
    if (error instanceof AiStoryCanonicalSceneProducerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
