import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryEpisodeIntentAuthoritySchema,
  ExecutionUnitDurationChangeError,
  isUuid,
  type AiStoryStatus,
} from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory, setAiStoryStatus } from "@/lib/ai-story-service";
import {
  AiStoryGenerationStrategyRecoveryError,
  createExecutionUnitDurationSuccessor,
  getLatestCompleteAnimationPackageForStory,
} from "@/lib/ai-story-planning-service";
import { AiStoryCanonicalSceneProducerError } from "@/lib/ai-story-canonical-scene-producer";

const BodySchema = z.object({
  durations: z.array(z.object({
    sceneId: z.string().trim().min(1).max(200),
    durationSec: z.number(),
  }).strict()).min(1).max(64),
}).strict();

const ELIGIBLE: readonly AiStoryStatus[] = ["planning_review", "ready_for_execution", "generate_review", "execution_failed", "executing"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> },
) {
  try {
    const user = await requireAuth();
    const { id: campaignId, storyId } = await params;
    if (!isUuid(campaignId) || !isUuid(storyId)) return apiError("Invalid id", "VALIDATION_ERROR", 400);
    const body = BodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return apiError("Provide the authorized Scene durations", "VALIDATION_ERROR", 422);
    const db = getDb();
    const [campaign] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).limit(1);
    if (!campaign) return apiError("Campaign not found", "NOT_FOUND", 404);
    await authorizeAiStoryAccess({ user, orgId: campaign.orgId, workspaceId: campaign.workspaceId, minRole: "operator" });
    const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
    if (!loaded) return apiError("AI Story not found", "NOT_FOUND", 404);
    const status = loaded.story.status as AiStoryStatus;
    if (!ELIGIBLE.includes(status)) {
      return apiError("Story is not eligible for a duration successor", "EXECUTION_UNIT_DURATION_SUCCESSOR_STATE_INVALID", 409);
    }
    if (status === "executing") {
      const [evidence] = await db.select({
        startedScenes: sql<number>`(select count(*) from ${schema.aiStorySceneExecutions}
          where ${schema.aiStorySceneExecutions.storyId} = ${storyId}
          and ${schema.aiStorySceneExecutions.workspaceId} = ${campaign.workspaceId}
          and ${schema.aiStorySceneExecutions.status} <> 'PLANNED')::int`,
        dispatchAuthorities: sql<number>`(select count(*) from ${schema.aiStoryLocalGpuDispatchAuthorities}
          where ${schema.aiStoryLocalGpuDispatchAuthorities.storyId} = ${storyId}
          and ${schema.aiStoryLocalGpuDispatchAuthorities.workspaceId} = ${campaign.workspaceId})::int`,
        outputs: sql<number>`(select count(*) from ${schema.aiStoryLocalGenerationOutputs} o
          join ${schema.aiStoryLocalGenerationPackages} p on p.package_id = o.package_id
          where p.story_id = ${storyId} and p.workspace_id = ${campaign.workspaceId})::int`,
      }).from(schema.aiStories).where(and(eq(schema.aiStories.id, storyId), ne(schema.aiStories.status, "archived"))).limit(1);
      if (!evidence || evidence.startedScenes > 0 || evidence.dispatchAuthorities > 0 || evidence.outputs > 0) {
        return apiError(
          "Execution has already started; a duration successor would rewrite active execution history",
          "EXECUTION_UNIT_DURATION_SUCCESSOR_EXECUTION_STARTED",
          409,
        );
      }
    }
    const source = await getLatestCompleteAnimationPackageForStory(db, { campaignId, storyId, workspaceId: campaign.workspaceId });
    if (!source) return apiError("Complete source Planning Package not found", "NOT_FOUND", 404);
    const parsedIntent = AiStoryEpisodeIntentAuthoritySchema.safeParse(loaded.story.episodeIntent);
    const successor = await createExecutionUnitDurationSuccessor(db, {
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId,
      storyId,
      storyVersionId: loaded.currentVersion.id,
      actorUserId: user.id,
      sourcePackageId: source.id,
      durations: body.data.durations,
      ...(parsedIntent.success ? { episodeIntent: parsedIntent.data } : {}),
    });
    if (status !== "planning_review") await setAiStoryStatus(db, storyId, status, "planning_review");
    return apiSuccess({
      status: "planning_review",
      sourcePackageId: successor.sourcePackageId,
      successorPackageId: successor.animationPackage.id,
      changes: successor.changes,
      externalAiCalls: successor.externalAiCalls,
      idempotent: successor.idempotent,
      humanApprovalRequired: true,
    }, 201);
  } catch (error) {
    if (error instanceof ExecutionUnitDurationChangeError) return apiError(error.message, error.code, 422);
    if (error instanceof AiStoryGenerationStrategyRecoveryError) return apiError(error.message, error.code, 409);
    if (error instanceof AiStoryCanonicalSceneProducerError) return apiError(error.message, error.code, 409);
    return handleApiError(error);
  }
}
