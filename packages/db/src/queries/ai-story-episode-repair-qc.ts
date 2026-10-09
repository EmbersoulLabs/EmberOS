import { and, desc, eq, lte } from "drizzle-orm";
import {
  AiStoryCanonicalSceneSchema,
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryEpisodeIntentAuthoritySchema,
  resolveCommercialEpisodeRepairQc,
  type AiStoryCanonicalScene,
  type AiStoryDirectorPlan,
  type AiStoryEpisodeProjectedDirectorPlan,
  type AiStoryEpisodeProjectedMotionPlan,
  type AiStoryMotionPlan,
  type AiStoryScriptVersion,
  type CharacterContinuityScene,
  type FrozenDialogueEntry,
} from "@ceo-agent/shared";
import {
  CommercialVisibleDialogueProjectionError,
  projectCommercialSceneVisibleDialogue,
  projectEpisodeProjectedVisibleDialogue,
} from "@ceo-agent/shared/server";
import { getDb } from "../client";
import * as schema from "../schema";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Scope = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
};

function dialogueEntries(scene: AiStoryScriptVersion["scenes"][number]): FrozenDialogueEntry[] {
  const entries: FrozenDialogueEntry[] = [];
  for (const entry of scene.entries) {
    if (entry.type === "DIALOGUE") {
      entries.push({ type: "DIALOGUE", speakerId: entry.speakerId, line: entry.line, language: entry.language });
    } else if (entry.type === "VO") {
      entries.push({ type: "VO" });
    } else {
      entries.push({ type: "ACTION" });
    }
  }
  return entries;
}

/**
 * Hydrates Gate Set V4 from the current Story Version's Episode intent,
 * Character DNA, frozen dialogue, and the existing native-dialogue compiler.
 * Historical Stories with a null episode intent stay untouched.
 */
export async function loadCommercialEpisodeRepairForQc(
  tx: Tx,
  input: {
    readonly scope: Scope;
    readonly script: AiStoryScriptVersion;
    readonly canonicalScenes: readonly AiStoryCanonicalScene[];
    readonly directorPlan: AiStoryDirectorPlan | null;
    readonly motionPlan: AiStoryMotionPlan | null;
    readonly projectedDirectorPlan?: AiStoryEpisodeProjectedDirectorPlan | null;
    readonly projectedMotionPlan?: AiStoryEpisodeProjectedMotionPlan | null;
    readonly sceneExecutionId: string;
  },
): Promise<ReturnType<typeof resolveCommercialEpisodeRepairQc>> {
  const db = tx;
  const [version] = await db
    .select({ id: schema.aiStoryVersions.id })
    .from(schema.aiStoryVersions)
    .where(and(
      eq(schema.aiStoryVersions.id, input.scope.storyVersionId),
      eq(schema.aiStoryVersions.storyId, input.scope.storyId),
    ))
    .limit(1);
  const [story] = await db
    .select({ episodeIntent: schema.aiStories.episodeIntent })
    .from(schema.aiStories)
    .where(and(
      eq(schema.aiStories.id, input.scope.storyId),
      eq(schema.aiStories.orgId, input.scope.orgId),
      eq(schema.aiStories.workspaceId, input.scope.workspaceId),
      eq(schema.aiStories.campaignId, input.scope.campaignId),
    ))
    .limit(1);
  const intent = AiStoryEpisodeIntentAuthoritySchema.safeParse(story?.episodeIntent);
  if (!version || !intent.success) return null;
  const [execution] = await db
    .select({ sceneId: schema.aiStorySceneExecutions.sceneId })
    .from(schema.aiStorySceneExecutions)
    .where(and(
      eq(schema.aiStorySceneExecutions.id, input.sceneExecutionId),
      eq(schema.aiStorySceneExecutions.storyId, input.scope.storyId),
      eq(schema.aiStorySceneExecutions.storyVersionId, input.scope.storyVersionId),
      eq(schema.aiStorySceneExecutions.workspaceId, input.scope.workspaceId),
    ))
    .limit(1);
  const [storyVersion] = await db
    .select({
      createdAt: schema.aiStoryVersions.createdAt,
      frozenAt: schema.aiStoryVersions.frozenAt,
    })
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.id, input.scope.storyVersionId))
    .limit(1);
  const cutoff = storyVersion?.frozenAt ?? storyVersion?.createdAt ?? new Date();
  const bindingRows = await db
    .select({ snapshot: schema.aiStoryEpisodeCharacterBindings.snapshot })
    .from(schema.aiStoryEpisodeCharacterBindings)
    .where(and(
      eq(schema.aiStoryEpisodeCharacterBindings.orgId, input.scope.orgId),
      eq(schema.aiStoryEpisodeCharacterBindings.workspaceId, input.scope.workspaceId),
      eq(schema.aiStoryEpisodeCharacterBindings.storyId, input.scope.storyId),
      lte(schema.aiStoryEpisodeCharacterBindings.createdAt, cutoff),
    ))
    .orderBy(desc(schema.aiStoryEpisodeCharacterBindings.createdAt));
  const bindings = bindingRows.flatMap((row) => {
    const parsed = AiStoryEpisodeCharacterBindingSchema.safeParse(row.snapshot);
    return parsed.success && parsed.data.characterDnaFingerprint ? [parsed.data] : [];
  });
  const dna = bindings[0] ?? null;
  const dnaMismatch = dna
    ? bindings.some((binding) => binding.characterDnaFingerprint !== dna.characterDnaFingerprint)
    : false;
  const scenes: CharacterContinuityScene[] = input.canonicalScenes.map((scene) => {
    const characterIds = scene.castBindings.flatMap((cast) => cast.scope === "EPHEMERAL_ACTOR" ? [] : [cast.id]);
    const backgroundOnly = characterIds.length === 0;
    const matchesDna = dna !== null && characterIds.some((id) =>
      id === dna.campaignCharacterId || id === dna.reusableCharacterId,
    );
    return {
      sceneId: scene.sceneId,
      characterIds,
      backgroundOnly,
      characterDnaFingerprint: matchesDna ? dna?.characterDnaFingerprint ?? null : null,
      reusableCharacterId: matchesDna ? dna?.reusableCharacterId ?? null : null,
      reusableCharacterVersionId: matchesDna ? dna?.reusableCharacterVersionId ?? null : null,
      campaignCharacterId: matchesDna ? dna?.campaignCharacterId ?? null : null,
      campaignCharacterVersionId: matchesDna ? dna?.campaignCharacterVersionId ?? null : null,
      identityFingerprint: matchesDna ? dna?.identityFingerprint ?? null : null,
    };
  });
  if (dnaMismatch && dna) {
    const otherFingerprint = bindings.find((binding) =>
      binding.characterDnaFingerprint !== dna.characterDnaFingerprint,
    )?.characterDnaFingerprint ?? null;
    const matchedCharacterIds = scenes.flatMap((scene) =>
      scene.characterDnaFingerprint === dna.characterDnaFingerprint ? [...scene.characterIds] : [],
    );
    scenes.push({
      sceneId: "00000000-0000-4000-8000-000000000000",
      characterIds: matchedCharacterIds.length > 0
        ? [...new Set(matchedCharacterIds)]
        : [dna.campaignCharacterId, dna.reusableCharacterId],
      characterDnaFingerprint: otherFingerprint,
      reusableCharacterId: dna.reusableCharacterId,
      reusableCharacterVersionId: dna.reusableCharacterVersionId,
      campaignCharacterId: dna.campaignCharacterId,
      campaignCharacterVersionId: dna.campaignCharacterVersionId,
      identityFingerprint: dna.identityFingerprint,
    });
  }
  const entriesBySceneId: Record<string, FrozenDialogueEntry[]> = {};
  for (const canonical of input.canonicalScenes) {
    const parsed = AiStoryCanonicalSceneSchema.safeParse(canonical);
    if (!parsed.success) continue;
    entriesBySceneId[canonical.sceneId] = input.script.scenes.flatMap((scene) =>
      parsed.data.sourceScriptSceneIds.includes(scene.scriptSceneId) ? dialogueEntries(scene) : [],
    );
  }
  const targetSceneId = execution?.sceneId ?? input.canonicalScenes[0]?.sceneId ?? "";
  const target = input.canonicalScenes.find((scene) => scene.sceneId === targetSceneId) ?? null;
  let dialogueProjection: { ok: boolean; fingerprint: string | null; characterId: string | null } | null = null;
  const targetHasDialogue = (entriesBySceneId[targetSceneId] ?? []).some((entry) => entry.type === "DIALOGUE");
  if (targetHasDialogue && target && input.directorPlan && input.motionPlan) {
    try {
      const authority = projectCommercialSceneVisibleDialogue({
        intent: intent.data,
        script: input.script,
        directorPlan: input.directorPlan,
        motionPlan: input.motionPlan,
        canonicalScene: target,
      });
      dialogueProjection = authority
        ? { ok: true, fingerprint: authority.dialogueFingerprint, characterId: authority.characterId }
        : null;
    } catch (error) {
      if (error instanceof CommercialVisibleDialogueProjectionError) {
        dialogueProjection = { ok: false, fingerprint: null, characterId: null };
      } else {
        throw error;
      }
    }
  } else if (targetHasDialogue && target && input.projectedDirectorPlan && input.projectedMotionPlan) {
    try {
      const authority = projectEpisodeProjectedVisibleDialogue({
        intent: intent.data,
        script: input.script,
        directorPlan: input.projectedDirectorPlan,
        motionPlan: input.projectedMotionPlan,
        canonicalScene: target,
      });
      dialogueProjection = authority
        ? { ok: true, fingerprint: authority.dialogueFingerprint, characterId: authority.characterId }
        : null;
    } catch (error) {
      if (error instanceof CommercialVisibleDialogueProjectionError) {
        dialogueProjection = { ok: false, fingerprint: null, characterId: null };
      } else {
        throw error;
      }
    }
  } else if (targetHasDialogue) {
    dialogueProjection = { ok: false, fingerprint: null, characterId: null };
  }
  return resolveCommercialEpisodeRepairQc({
    episodeIntent: intent.data,
    targetSceneId,
    scenes,
    entriesBySceneId,
    dialogueProjection,
    nativeAvCapabilityValid: dialogueProjection?.ok === true,
  });
}
