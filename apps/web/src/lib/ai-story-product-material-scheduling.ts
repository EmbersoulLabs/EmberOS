import { and, desc, eq } from "drizzle-orm";
import { SceneSchedulingCoordinator, type SceneSchedulingCoordinatorDependencies } from "@ceo-agent/agents";
import { getDb, schema } from "@ceo-agent/db";
import {
  AiStoryCanonicalSceneSchema,
  AiStoryDirectorPlanSchema,
  AiStoryEpisodeIntentAuthoritySchema,
  AiStoryMotionPlanSchema,
  AiStoryScriptVersionSchema,
  buildVisualTextProviderConstraint,
  type AiStoryCharacterDialoguePerformanceAuthority,
  type AiStoryEpisodeIntentAuthority,
} from "@ceo-agent/shared";
import {
  CommercialVisibleDialogueProjectionError,
  projectCommercialSceneVisibleDialogue,
} from "@ceo-agent/shared/server";
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

type RepairScope = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly sceneId: string;
};

function unsatisfied(message: string): never {
  throw new CommercialEpisodeRepairSchedulingError(
    "NATIVE_DIALOGUE_REQUEST_UNSATISFIED",
    message,
  );
}

function identityCastId(cast: { readonly scope: string; readonly id: string }): string | null {
  if (cast.scope === "EPHEMERAL_ACTOR") return null;
  return cast.id;
}

async function recurringCastRequiresContinuity(input: RepairScope): Promise<boolean> {
  const rows = await getDb()
    .select({ snapshot: schema.aiStoryCanonicalSceneVersions.snapshot })
    .from(schema.aiStoryCanonicalSceneVersions)
    .innerJoin(
      schema.aiStoryCanonicalScenes,
      eq(
        schema.aiStoryCanonicalScenes.currentSceneVersionId,
        schema.aiStoryCanonicalSceneVersions.sceneVersionId,
      ),
    )
    .where(and(
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, input.storyVersionId),
      eq(schema.aiStoryCanonicalSceneVersions.orgId, input.orgId),
      eq(schema.aiStoryCanonicalSceneVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCanonicalSceneVersions.campaignId, input.campaignId),
      eq(schema.aiStoryCanonicalSceneVersions.storyId, input.storyId),
    ));
  const counts = new Map<string, number>();
  const currentIds = new Set<string>();
  for (const row of rows) {
    const parsed = AiStoryCanonicalSceneSchema.safeParse(row.snapshot);
    if (!parsed.success) continue;
    const ids = parsed.data.castBindings.flatMap((cast) => {
      const id = identityCastId(cast);
      return id ? [id] : [];
    });
    for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (parsed.data.sceneId === input.sceneId) {
      for (const id of ids) currentIds.add(id);
    }
  }
  return [...currentIds].some((id) => (counts.get(id) ?? 0) > 1);
}

async function resolveVisibleDialogue(
  input: RepairScope,
  intent: AiStoryEpisodeIntentAuthority,
): Promise<AiStoryCharacterDialoguePerformanceAuthority | null> {
  const db = getDb();
  const [sceneRow] = await db
    .select({
      scriptVersionId: schema.aiStoryCanonicalSceneVersions.scriptVersionId,
      snapshot: schema.aiStoryCanonicalSceneVersions.snapshot,
      status: schema.aiStoryCanonicalSceneVersions.status,
      approvedBy: schema.aiStoryCanonicalSceneVersions.approvedBy,
      approvedAt: schema.aiStoryCanonicalSceneVersions.approvedAt,
      frozenAt: schema.aiStoryCanonicalSceneVersions.frozenAt,
    })
    .from(schema.aiStoryCanonicalSceneVersions)
    .innerJoin(
      schema.aiStoryCanonicalScenes,
      eq(
        schema.aiStoryCanonicalScenes.currentSceneVersionId,
        schema.aiStoryCanonicalSceneVersions.sceneVersionId,
      ),
    )
    .where(and(
      eq(schema.aiStoryCanonicalSceneVersions.sceneId, input.sceneId),
      eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, input.storyVersionId),
      eq(schema.aiStoryCanonicalSceneVersions.orgId, input.orgId),
      eq(schema.aiStoryCanonicalSceneVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryCanonicalSceneVersions.campaignId, input.campaignId),
      eq(schema.aiStoryCanonicalSceneVersions.storyId, input.storyId),
    ))
    .limit(1);
  if (!sceneRow) {
    unsatisfied("Native dialogue cannot be scheduled without the current canonical Scene");
  }
  const [scriptRow] = await db
    .select()
    .from(schema.aiStoryScriptVersions)
    .where(and(
      eq(schema.aiStoryScriptVersions.scriptVersionId, sceneRow.scriptVersionId),
      eq(schema.aiStoryScriptVersions.orgId, input.orgId),
      eq(schema.aiStoryScriptVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryScriptVersions.campaignId, input.campaignId),
      eq(schema.aiStoryScriptVersions.storyId, input.storyId),
      eq(schema.aiStoryScriptVersions.storyVersionId, input.storyVersionId),
    ))
    .limit(1);
  const scriptParsed = scriptRow
    ? AiStoryScriptVersionSchema.safeParse({
        ...scriptRow.script,
        status: scriptRow.status,
        approvedBy: scriptRow.approvedBy,
        approvedAt: scriptRow.approvedAt?.toISOString() ?? null,
        frozenAt: scriptRow.frozenAt?.toISOString() ?? null,
      })
    : null;
  if (!scriptParsed?.success) {
    unsatisfied("Native dialogue cannot be scheduled without the frozen Script");
  }
  const canonicalParsed = AiStoryCanonicalSceneSchema.safeParse({
    ...sceneRow.snapshot,
    status: sceneRow.status,
    approvedBy: sceneRow.approvedBy,
    approvedAt: sceneRow.approvedAt?.toISOString() ?? null,
    frozenAt: sceneRow.frozenAt?.toISOString() ?? null,
  });
  if (!canonicalParsed.success) {
    unsatisfied("Native dialogue cannot be scheduled without canonical Scene authority");
  }
  const hasDialogue = scriptParsed.data.scenes.some((scene) =>
    canonicalParsed.data.sourceScriptSceneIds.includes(scene.scriptSceneId) &&
    scene.entries.some((entry) => entry.type === "DIALOGUE"),
  );
  if (!hasDialogue) return null;
  const [directorRow] = await db
    .select()
    .from(schema.aiStoryDirectorPlanVersions)
    .where(and(
      eq(schema.aiStoryDirectorPlanVersions.storyVersionId, input.storyVersionId),
      eq(schema.aiStoryDirectorPlanVersions.orgId, input.orgId),
      eq(schema.aiStoryDirectorPlanVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryDirectorPlanVersions.campaignId, input.campaignId),
      eq(schema.aiStoryDirectorPlanVersions.storyId, input.storyId),
      eq(schema.aiStoryDirectorPlanVersions.status, "FROZEN"),
    ))
    .orderBy(desc(schema.aiStoryDirectorPlanVersions.version))
    .limit(1);
  const [motionRow] = await db
    .select()
    .from(schema.aiStoryMotionPlanVersions)
    .where(and(
      eq(schema.aiStoryMotionPlanVersions.storyVersionId, input.storyVersionId),
      eq(schema.aiStoryMotionPlanVersions.orgId, input.orgId),
      eq(schema.aiStoryMotionPlanVersions.workspaceId, input.workspaceId),
      eq(schema.aiStoryMotionPlanVersions.campaignId, input.campaignId),
      eq(schema.aiStoryMotionPlanVersions.storyId, input.storyId),
      eq(schema.aiStoryMotionPlanVersions.status, "FROZEN"),
    ))
    .orderBy(desc(schema.aiStoryMotionPlanVersions.version))
    .limit(1);
  const directorParsed = directorRow
    ? AiStoryDirectorPlanSchema.safeParse({
        ...directorRow.directorPlan,
        status: directorRow.status,
        approvedBy: directorRow.approvedBy,
        approvedAt: directorRow.approvedAt?.toISOString() ?? null,
        frozenAt: directorRow.frozenAt?.toISOString() ?? null,
      })
    : null;
  const motionParsed = motionRow
    ? AiStoryMotionPlanSchema.safeParse({
        ...motionRow.motionPlan,
        status: motionRow.status,
        approvedBy: motionRow.approvedBy,
        approvedAt: motionRow.approvedAt?.toISOString() ?? null,
        frozenAt: motionRow.frozenAt?.toISOString() ?? null,
      })
    : null;
  if (!directorParsed?.success || !motionParsed?.success) {
    unsatisfied("Visible dialogue cannot be scheduled until native audiovisual authority is compiled");
  }
  if (motionParsed.data.directorPlanId !== directorParsed.data.directorPlanId) {
    unsatisfied("Frozen Motion does not bind the current Director Plan");
  }
  try {
    return projectCommercialSceneVisibleDialogue({
      intent,
      script: scriptParsed.data,
      directorPlan: directorParsed.data,
      motionPlan: motionParsed.data,
      canonicalScene: canonicalParsed.data,
    });
  } catch (error) {
    if (error instanceof CommercialVisibleDialogueProjectionError) unsatisfied(error.message);
    throw error;
  }
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
      const characterContinuityRequired = await recurringCastRequiresContinuity(input);
      if (!parsed.data.nativeCharacterDialogue) {
        return {
          characterContinuityRequired,
          visualTextConstraint: buildVisualTextProviderConstraint(parsed.data),
          visibleDialogue: null,
        };
      }
      const visibleDialogue = await resolveVisibleDialogue(input, parsed.data);
      return {
        characterContinuityRequired: characterContinuityRequired || visibleDialogue !== null,
        visualTextConstraint: buildVisualTextProviderConstraint(parsed.data),
        visibleDialogue,
      };
    },
  });
}
