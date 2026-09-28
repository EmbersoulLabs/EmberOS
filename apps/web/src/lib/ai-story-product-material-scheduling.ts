import { and, eq } from "drizzle-orm";
import { SceneSchedulingCoordinator, type SceneSchedulingCoordinatorDependencies } from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryEpisodeIntentAuthoritySchema,
  buildVisualTextProviderConstraint,
} from "@ceo-agent/shared";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";

export class CommercialEpisodeRepairSchedulingError extends Error {
  constructor(
    readonly code: "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
    message: string,
  ) {
    super(message);
    this.name = "CommercialEpisodeRepairSchedulingError";
  }
}

async function sceneHasFrozenVisibleDialogue(input: {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly sceneId: string;
}): Promise<boolean> {
  const db = getDb();
  const [scene] = await db
    .select({
      scriptVersionId: schema.aiStoryCanonicalSceneVersions.scriptVersionId,
      snapshot: schema.aiStoryCanonicalSceneVersions.snapshot,
    })
    .from(schema.aiStoryCanonicalSceneVersions)
    .where(and(
      eq(schema.aiStoryCanonicalSceneVersions.sceneId, input.sceneId),
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, input.storyVersionId),
      eq(schema.aiStoryCanonicalSceneVersions.orgId, input.orgId),
      eq(schema.aiStoryCanonicalSceneVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCanonicalSceneVersions.campaignId, input.campaignId),
      eq(schema.aiStoryCanonicalSceneVersions.storyId, input.storyId),
    ))
    .limit(1);
  if (!scene) return false;
  const [script] = await db
    .select({ script: schema.aiStoryScriptVersions.script })
    .from(schema.aiStoryScriptVersions)
    .where(and(
      eq(schema.aiStoryScriptVersions.scriptVersionId, scene.scriptVersionId),
      eq(schema.aiStoryScriptVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryScriptVersions.storyId, input.storyId),
    ))
    .limit(1);
  const sourceIds = new Set(scene.snapshot.sourceScriptSceneIds);
  return (script?.script.scenes ?? []).some((entry) =>
    sourceIds.has(entry.scriptSceneId) &&
    entry.entries.some((line) => line.type === "DIALOGUE"),
  );
}

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
      if (
        parsed.data.nativeCharacterDialogue &&
        await sceneHasFrozenVisibleDialogue(input)
      ) {
        throw new CommercialEpisodeRepairSchedulingError(
          "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
          "Visible dialogue cannot be scheduled until native audiovisual authority is compiled",
        );
      }
      return {
        characterContinuityRequired: parsed.data.nativeCharacterDialogue,
        visualTextConstraint: buildVisualTextProviderConstraint(parsed.data),
        visibleDialogue: null,
      };
    },
  });
}
