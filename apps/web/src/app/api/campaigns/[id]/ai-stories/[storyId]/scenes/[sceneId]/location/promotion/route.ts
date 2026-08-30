import { and, eq } from "drizzle-orm";
import { AiStoryLocationAuthorityService, schema } from "@ceo-agent/db";
import { AiStoryCanonicalSceneSchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { resolveAiStoryCastApiScope } from "@/lib/ai-story-cast-access";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string; sceneId: string }> },
) {
  try {
    const { id, storyId, sceneId } = await params;
    if (![id, storyId, sceneId].every(isUuid)) {
      return apiError("Invalid Scene location identity", "VALIDATION_ERROR", 400);
    }
    const context = await resolveAiStoryCastApiScope(id, storyId, true);
    if (!context) return apiError("Story not found", "NOT_FOUND", 404);

    const [row] = await context.db
      .select({ snapshot: schema.aiStoryCanonicalSceneVersions.snapshot })
      .from(schema.aiStoryCanonicalScenes)
      .innerJoin(
        schema.aiStoryCanonicalSceneVersions,
        eq(schema.aiStoryCanonicalSceneVersions.sceneVersionId, schema.aiStoryCanonicalScenes.currentSceneVersionId),
      )
      .where(and(
        eq(schema.aiStoryCanonicalScenes.sceneId, sceneId),
        eq(schema.aiStoryCanonicalScenes.storyId, storyId),
        eq(schema.aiStoryCanonicalScenes.campaignId, id),
        eq(schema.aiStoryCanonicalScenes.workspaceId, context.scope.workspaceId),
      ))
      .limit(1);
    if (!row) return apiError("Scene not found", "NOT_FOUND", 404);
    const scene = AiStoryCanonicalSceneSchema.parse(row.snapshot);
    const locations = new AiStoryLocationAuthorityService(context.db);

    if (scene.locationBinding.scope === "EPHEMERAL_ENVIRONMENT") {
      const promotion = await locations.promoteEphemeralToStory(
        context.scope,
        scene.locationBinding,
        {
          displayName: scene.locationBinding.displayName,
          identity: scene.locationBinding.environmentDescription,
          appearance: scene.locationBinding.environmentDescription,
          fixedElements: [],
          environmentalCharacteristics: [],
          visualAssetIds: [],
        },
      );
      return apiSuccess({ promotion }, 201);
    }
    if (scene.locationBinding.scope === "STORY_LOCATION") {
      return apiSuccess({ promotion: await locations.promoteStoryToCampaign(context.scope, scene.locationBinding) }, 201);
    }
    return apiError("This Location is already reusable across the Campaign", "CONFLICT", 409);
  } catch (error) {
    return handleApiError(error);
  }
}
