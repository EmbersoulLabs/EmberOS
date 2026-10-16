import { and, eq } from "drizzle-orm";
import { AiStorySceneGenerationAuthoritySchema, AuthoritativeAnimationPackagePayloadSchema, EpisodeProjectedAuthorityError, type AiStoryEpisodeProjectedDirectorPlan, type AiStoryEpisodeProjectedMotionPlan, type AiStoryScriptVersion, type EpisodeProjectedAuthoritySource } from "@ceo-agent/shared";
import { assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent, evaluateEpisodeProjectedPlanningReadiness } from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
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

type ProjectionPackage = { id: string; payload: ReturnType<typeof AuthoritativeAnimationPackagePayloadSchema.parse> };

function stateFact(fact: { dimension: string; subjectId: string; value: string; fromValue?: string | null; reason?: string | null }) {
  return {
    dimension: fact.dimension,
    subjectId: fact.subjectId,
    value: fact.value,
    ...(fact.fromValue !== undefined ? { fromValue: fact.fromValue } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
  };
}

function projectionSource(current: AiStoryScriptVersion, scenes: NonNullable<Awaited<ReturnType<typeof resolveCurrentFrozenCanonicalSceneSet>>>, animationPackage: ProjectionPackage): LoadedEpisodeDispatchAuthority {
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
        ...(shot.cameraSafety ? { cameraSafety: shot.cameraSafety } : {}),
      })),
    },
  };
}

async function frozenScript(db: Db, scope: AiStoryScriptScope) {
  const scripts = await new AiStoryScriptAuthorityService(db).history(scope);
  const frozen = scripts.filter((item) => item.status === "FROZEN" && item.storyVersionId === scope.storyVersionId);
  if (frozen.length !== 1) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Episode projection requires exactly one FROZEN Script for the Story Version");
  return frozen[0]!;
}

export async function loadEpisodeDispatchProjectionSource(db: Db, scope: AiStoryScriptScope): Promise<LoadedEpisodeDispatchAuthority> {
  const current = await frozenScript(db, scope);
  const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, scope);
  const animationPackage = await resolveCurrentCanonicalApprovedAnimationPackageForStoryVersion(db, scope);
  if (!scenes || !animationPackage) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Episode projection requires the current FROZEN Canonical Scene set and approved Animation Package");
  return projectionSource(current, scenes, { id: animationPackage.id, payload: AuthoritativeAnimationPackagePayloadSchema.parse(animationPackage.payload) });
}

export async function loadEpisodePlanningProjectionSource(db: Db, scope: AiStoryScriptScope, animationPackageId: string): Promise<LoadedEpisodeDispatchAuthority> {
  const current = await frozenScript(db, scope);
  const scenes = await resolveCurrentFrozenCanonicalSceneSet(db, scope);
  const [row] = await db.select().from(schema.aiStoryAnimationPackages).where(and(
    eq(schema.aiStoryAnimationPackages.id, animationPackageId),
    eq(schema.aiStoryAnimationPackages.orgId, scope.orgId),
    eq(schema.aiStoryAnimationPackages.workspaceId, scope.workspaceId),
    eq(schema.aiStoryAnimationPackages.campaignId, scope.campaignId),
    eq(schema.aiStoryAnimationPackages.storyId, scope.storyId),
    eq(schema.aiStoryAnimationPackages.storyVersionId, scope.storyVersionId),
  )).limit(1);
  if (!scenes || !row) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Planning readiness requires the current FROZEN Canonical Scene set and exact Animation Package");
  const payload = AuthoritativeAnimationPackagePayloadSchema.parse(row.payload);
  assertAiStoryAnimationPackageCanonicalSceneAuthorityCurrent({ storyId: scope.storyId, storyVersionId: scope.storyVersionId, scenePlan: payload.scenePlan, canonicalScenes: scenes, authority: payload.canonicalSceneAuthority });
  return projectionSource(current, scenes, { id: row.id, payload });
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

export async function prepareEpisodePlanningExecutionReadiness(
  scope: AiStoryScriptScope,
  animationPackageId: string,
  db: Db = getDb(),
) {
  const loaded = await loadEpisodePlanningProjectionSource(db, scope, animationPackageId);
  const handoffRecord = await new AiStoryScriptDirectorHandoffAuthorityService(db).createFromFrozenScript(scope, loaded.scriptVersionId);
  const director = await new AiStoryDirectorPlanAuthorityService(db).projectFromEpisodeAuthority(scope, loaded.source, undefined, "VALIDATED");
  const motion = await new AiStoryMotionPlanAuthorityService(db).projectFromEpisodeAuthority(scope, loaded.source, director.directorPlanId, undefined, "VALIDATED");
  const scripts = await new AiStoryScriptAuthorityService(db).history(scope);
  const script = scripts.find((item) => item.scriptVersionId === loaded.scriptVersionId && item.status === "FROZEN");
  const canonicalScenes = await resolveCurrentFrozenCanonicalSceneSet(db, scope);
  if (!script || !canonicalScenes) throw new EpisodeProjectedAuthorityError("EPISODE_DISPATCH_SOURCE_MISSING", "Planning readiness lost frozen Script or Canonical Scene authority");
  const readiness = evaluateEpisodeProjectedPlanningReadiness({
    script,
    handoff: handoffRecord.handoff,
    directorPlan: director as AiStoryEpisodeProjectedDirectorPlan,
    motionPlan: motion as AiStoryEpisodeProjectedMotionPlan,
    canonicalScenes,
  });
  return { ...readiness, handoffId: handoffRecord.handoff.handoffId, animationPackageId };
}
