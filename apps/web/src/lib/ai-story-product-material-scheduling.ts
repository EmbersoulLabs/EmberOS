import { and, eq } from "drizzle-orm";
import { SceneSchedulingCoordinator, type SceneSchedulingCoordinatorDependencies } from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryEpisodeIntentAuthoritySchema,
  buildVisualTextProviderConstraint,
} from "@ceo-agent/shared";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";

/** Normal application scheduling always resolves exact current Product material. */
export function createCanonicalProductMaterialSchedulingCoordinator(
  router: SceneSchedulingCoordinatorDependencies["router"],
): SceneSchedulingCoordinator {
  return new SceneSchedulingCoordinator({
    router,
    productMaterialSelectionResolver: resolveCurrentSceneProductMaterialForScheduling,
    episodeRepairResolver: async (input) => {
      const [story] = await getDb()
        .select({ episodeIntent: schema.aiStories.episodeIntent })
        .from(schema.aiStories)
        .where(and(
          eq(schema.aiStories.id, input.storyId),
          eq(schema.aiStories.orgId, input.orgId),
          eq(schema.aiStories.workspaceId, input.workspaceId),
          eq(schema.aiStories.campaignId, input.campaignId),
        ))
        .limit(1);
      const parsed = AiStoryEpisodeIntentAuthoritySchema.safeParse(story?.episodeIntent);
      if (!parsed.success) return null;
      return {
        characterContinuityRequired: parsed.data.nativeCharacterDialogue,
        visualTextConstraint: buildVisualTextProviderConstraint(parsed.data),
        visibleDialogue: null,
      };
    },
  });
}
