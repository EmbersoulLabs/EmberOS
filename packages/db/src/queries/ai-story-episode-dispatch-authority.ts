import { AiStorySceneGenerationAuthoritySchema, EpisodeProjectedAuthorityError, type EpisodeProjectedAuthoritySource } from "@ceo-agent/shared";
import { getDb } from "../client";
import { resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion } from "./ai-story-approved-animation-package";
import { AiStoryDirectorPlanAuthorityService } from "./ai-story-director-plan";
import { AiStoryMotionPlanAuthorityService } from "./ai-story-motion-plan";
import { resolveCurrentFrozenCanonicalSceneSet } from "./ai-story-scene-authority";
import { AiStoryScriptDirectorHandoffAuthorityService } from "./ai-story-script-director-handoff";
import { AiStoryScriptAuthorityService, type AiStoryScriptScope } from "./ai-story-script";

type Db = ReturnType<typeof getDb>;

export type LoadedEpisodeDispatchAuthority = {
  scriptVersionId: string;
  source: EpisodeProjectedAuthoritySource;
};

function stateFact(fact: { dimension: string; subjectId: string; value: string; fromValue?: string | null; reason?: string | null }) {
  return {
    dimension: fact.dimension,
    subjectId: fact.subjectId,
    value: fact.value,
    ...(fact.fromValue !== undefined ? { fromValue: fact.fromValue } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
  };
}

export async function loadEpisodeDispatchProjectionSource(
  db: Db,
  scope: AiStoryScriptScope,
): Promise<LoadedEpisodeDispatchAuthority> {
  const scripts = await new AiStoryScriptAuthorityService(db).history(scope);
  const script = scripts.filter((item) => item.status === "FROZEN" && item.storyVersionId === scope.storyVersionId);
  if (script.length !== 1) {
    throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Episode projection requires exactly one FROZEN Script for the Story Version");
  }
  const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, scope);
  const animationPackage = await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db, scope);
  if (!scenes || !animationPackage) {
    throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Episode projection requires the current FROZEN Canonical Scene set and approved Animation Package");
  }
  const current = script[0]!;
  return {
    scriptVersionId: current.scriptVersionId,
    source: {
      animationPackageId: animationPackage.id,
      scriptScenes: current.scenes.map((scene) => ({
        scriptSceneId: scene.scriptSceneId,
        order: scene.order,
        sceneFunction: scene.sceneFunction,
        actions: scene.entries.flatMap((entry) => entry.type === "ACTION" ? [{
          entryId: entry.entryId,
          action: entry.action,
          subjectId: entry.subjectId,
          ...(entry.objectId ? { objectId: entry.objectId } : {}),
          ...(entry.stateDelta ? { stateDelta: stateFact(entry.stateDelta) } : {}),
        }] : []),
        sceneStateIn: scene.sceneStateIn.map(stateFact),
        sceneStateDeltas: scene.sceneStateDeltas.map(stateFact),
        sceneStateOut: scene.sceneStateOut.map(stateFact),
        productEvidence: [...scene.productEvidence],
        productAuthorityRefs: [...scene.productAuthorityRefs],
        propIds: [...scene.propIds],
      })),
      canonicalScenes: scenes.map((scene) => {
        const generation = scene.generationAuthority ? AiStorySceneGenerationAuthoritySchema.safeParse(scene.generationAuthority) : null;
        return {
          sceneId: scene.sceneId,
          sceneVersionId: scene.sceneVersionId,
          fingerprint: scene.fingerprint,
          order: scene.order,
          sceneFunction: scene.sceneFunction,
          sourceScriptSceneIds: [...scene.sourceScriptSceneIds],
          entryState: scene.entryState.map(stateFact),
          events: scene.events.flatMap((event) => event.type === "ACTION" ? [{
            entryId: event.entryId,
            type: "ACTION" as const,
            action: event.action,
            subjectId: event.subjectId,
            objectId: event.objectId ?? null,
            stateDelta: event.stateDelta ? stateFact(event.stateDelta) : null,
          }] : []),
          exitState: scene.exitState.map(stateFact),
          productBindingIds: scene.productBindings.map((binding) => binding.productAuthorityId),
          mustKeep: [...scene.mustKeep],
          mustAvoid: [...scene.mustAvoid],
          generationAuthority: generation?.success ? generation.data : null,
        };
      }),
      scenePlan: animationPackage.payload.scenePlan.map((scene) => ({
        id: scene.id,
        order: scene.order,
        purpose: scene.purpose,
        continuityNotes: scene.continuityNotes,
        durationSec: scene.durationSec,
      })),
      shotPlan: animationPackage.payload.shotPlan.map((shot) => ({
        id: shot.id,
        sceneId: shot.sceneId,
        order: shot.order,
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        focus: shot.focus,
        information: shot.information,
        durationSec: shot.durationSec,
      })),
    },
  };
}

export async function ensureCurrentEpisodeDispatchAuthorityProjection(
  scope: AiStoryScriptScope,
  db: Db = getDb(),
  dependencies: {
    load?: typeof loadEpisodeDispatchProjectionSource;
    createHandoff?: (scope: AiStoryScriptScope, scriptVersionId: string) => Promise<{ handoffId: string }>;
    projectDirector?: (scope: AiStoryScriptScope, source: EpisodeProjectedAuthoritySource) => Promise<{ directorPlanId: string; directorFingerprint: string; status: string }>;
    projectMotion?: (scope: AiStoryScriptScope, source: EpisodeProjectedAuthoritySource, directorPlanId: string) => Promise<{ motionPlanId: string; motionFingerprint: string; status: string }>;
  } = {},
) {
  const load = dependencies.load ?? loadEpisodeDispatchProjectionSource;
  const createHandoff = dependencies.createHandoff ?? (async (authorityScope, scriptVersionId) => {
    const created = await new AiStoryScriptDirectorHandoffAuthorityService(db).createFromFrozenScript(authorityScope, scriptVersionId);
    return { handoffId: created.handoff.handoffId };
  });
  const projectDirector = dependencies.projectDirector ?? ((authorityScope, source) => new AiStoryDirectorPlanAuthorityService(db).projectFromEpisodeAuthority(authorityScope, source));
  const projectMotion = dependencies.projectMotion ?? ((authorityScope, source, directorPlanId) => new AiStoryMotionPlanAuthorityService(db).projectFromEpisodeAuthority(authorityScope, source, directorPlanId));
  const loaded = await load(db, scope);
  const handoff = await createHandoff(scope, loaded.scriptVersionId);
  const director = await projectDirector(scope, loaded.source);
  const motion = await projectMotion(scope, loaded.source, director.directorPlanId);
  return {
    handoffId: handoff.handoffId,
    scriptVersionId: loaded.scriptVersionId,
    directorPlanId: director.directorPlanId,
    directorFingerprint: director.directorFingerprint,
    directorStatus: director.status,
    motionPlanId: motion.motionPlanId,
    motionFingerprint: motion.motionFingerprint,
    motionStatus: motion.status,
  };
}
