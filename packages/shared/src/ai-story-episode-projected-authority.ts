import { z } from "zod";
import { AI_STORY_CAMERA_FAMILIES } from "./ai-story-director-plan";
import { cinematicCameraMovementIntensity } from "./ai-story-cinematic-execution-contract";
import { AiStorySceneGenerationAuthoritySchema } from "./ai-story-generation-authority";
import { provePersistedProductCameraSafety, type AiStoryShotCameraSafety } from "./ai-story-product-camera-safety";

export const AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION = "ai-story-director-plan.episode-projected.v1" as const;
export const AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION = "ai-story-motion-plan.episode-projected.v1" as const;
export const AI_STORY_PROJECTED_EVIDENCE_STATES = ["KNOWN", "NOT_ASSERTED", "NOT_APPLICABLE"] as const;
export const AI_STORY_PROJECTED_DIFFERENTIATION_DIMENSIONS = [
  "SCENE_FUNCTION",
  "SHOT_COMPOSITION",
  "CAMERA_MOVEMENT",
  "FOCUS",
  "AUDIENCE_INFORMATION",
  "PRODUCT_ROLE",
] as const;
export const AI_STORY_EPISODE_PROJECTED_MOTION_COMPLEXITY_POLICY = Object.freeze({
  policyId: "episode-projected-qc-complexity.v1",
  maxActions: 2,
  maxShots: 4,
  maxCameraBehaviors: 2,
  maxDurationSec: 12,
});

const PHYSICAL_SCRIPT_DIMENSIONS = new Set(["POSSESSION", "LOCATION", "PHYSICAL_CONDITION", "PRODUCT_STATE"]);
const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(4000);
const Status = z.enum(["DRAFT", "VALIDATED", "APPROVED", "FROZEN", "SUPERSEDED"]);

export function projectedEvidence<T extends z.ZodTypeAny>(value: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("KNOWN"), value }).strict(),
    z.object({ state: z.literal("NOT_ASSERTED") }).strict(),
    z.object({ state: z.literal("NOT_APPLICABLE"), reason: Text.max(500) }).strict(),
  ]);
}

export const notAsserted = { state: "NOT_ASSERTED" as const };
export const notApplicable = (reason: string) => ({ state: "NOT_APPLICABLE" as const, reason });
export const known = <T>(value: T) => ({ state: "KNOWN" as const, value });

const StateFactSchema = z.object({
  dimension: z.string().trim().min(1).max(80),
  subjectId: Id,
  value: Text,
  fromValue: Text.nullable().optional(),
  reason: Text.nullable().optional(),
}).strict();

const ShotCameraSchema = z.object({
  shotId: Text.max(200),
  order: z.number().int().nonnegative(),
  cameraType: Text.max(200),
  cameraMovement: Text.max(200),
  composition: Text.max(2000),
  framing: Text.max(500),
  focus: Text.max(500),
  information: Text,
  durationSec: z.number().positive(),
}).strict();

export const AiStoryEpisodeProjectedDirectorShotSchema = ShotCameraSchema.extend({
  perspectiveChange: projectedEvidence(z.enum(["MINIMAL", "MODERATE", "LARGE"])),
  revealsUnseenProductSurface: projectedEvidence(z.boolean()),
  productIdentityTransformation: projectedEvidence(z.boolean()),
}).strict();

export const AiStoryEpisodeProjectedDifferentiationSchema = z.object({
  comparedToScriptSceneId: Id,
  dimensions: z.array(z.enum(AI_STORY_PROJECTED_DIFFERENTIATION_DIMENSIONS)).min(1),
  rationale: Text,
}).strict();

export const AiStoryEpisodeProjectedDirectorSceneSchema = z.object({
  scriptSceneId: Id,
  sceneOrder: z.number().int().nonnegative(),
  sceneFunction: Text.max(200),
  canonicalSceneId: Id,
  canonicalSceneVersionId: Id,
  canonicalSceneFingerprint: Hash,
  purpose: Text,
  continuityNotes: z.string().max(4000),
  mustKeep: projectedEvidence(z.array(Text)),
  mustAvoid: projectedEvidence(z.array(Text)),
  generationAuthority: projectedEvidence(AiStorySceneGenerationAuthoritySchema),
  productBindingIds: z.array(Id),
  actionEntryIds: z.array(Id),
  shots: z.array(AiStoryEpisodeProjectedDirectorShotSchema).min(1),
  differentiation: projectedEvidence(AiStoryEpisodeProjectedDifferentiationSchema),
}).strict();

export const AiStoryEpisodeProjectedDirectorPlanSchema = z.object({
  directorPlanId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  handoffId: Id,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  animationPackageId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_DIRECTOR_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION),
  sourceHandoffFingerprint: Hash,
  sceneDirections: z.array(AiStoryEpisodeProjectedDirectorSceneSchema).min(1),
  sourceHash: Hash,
  directorFingerprint: Hash,
  status: Status,
  supersedesDirectorPlanId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  approvedBy: Id.nullable(),
  approvedAt: z.string().datetime().nullable(),
  frozenAt: z.string().datetime().nullable(),
}).strict();

const ActionEvidenceSchema = z.object({
  entryId: Id,
  semanticAction: Text,
  subjectId: Id,
  objectId: Id.nullable(),
  stateDelta: StateFactSchema.nullable(),
}).strict();

export const AiStoryEpisodeProjectedMeasuredFactsSchema = z.object({
  actionCount: z.number().int().nonnegative(),
  shotCount: z.number().int().positive(),
  cameraBehaviorCount: z.number().int().positive(),
  durationSec: z.number().positive(),
  imageConditioned: z.boolean(),
  productIdentitySensitive: z.boolean(),
}).strict();

export const AiStoryEpisodeProjectedMotionSceneSchema = z.object({
  scriptSceneId: Id,
  sceneOrder: z.number().int().nonnegative(),
  actions: z.array(ActionEvidenceSchema),
  sceneStateIn: z.array(StateFactSchema),
  sceneStateDeltas: z.array(StateFactSchema),
  sceneStateOut: z.array(StateFactSchema),
  entryState: z.array(StateFactSchema),
  events: z.array(z.object({
    entryId: Id,
    type: z.literal("ACTION"),
    action: Text,
    subjectId: Id,
    objectId: Id.nullable(),
    stateDelta: StateFactSchema.nullable(),
  }).strict()),
  exitState: z.array(StateFactSchema),
  shots: z.array(ShotCameraSchema).min(1),
  productBindingIds: z.array(Id),
  generationAuthority: projectedEvidence(AiStorySceneGenerationAuthoritySchema),
  measuredFacts: AiStoryEpisodeProjectedMeasuredFactsSchema,
  physicalCompletion: projectedEvidence(z.object({
    dimension: Text.max(80),
    fromValue: Text,
    toValue: Text,
  }).strict()),
  cameraStateBoundary: projectedEvidence(z.object({
    startCameraState: Text,
    endCameraState: Text,
  }).strict()),
}).strict();

export const AiStoryEpisodeProjectedMotionPlanSchema = z.object({
  motionPlanId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  handoffId: Id,
  directorPlanId: Id,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  animationPackageId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_MOTION_PLAN_EPISODE_PROJECTED_CONTRACT_VERSION),
  sourceDirectorFingerprint: Hash,
  sceneMotionPlans: z.array(AiStoryEpisodeProjectedMotionSceneSchema).min(1),
  sourceHash: Hash,
  motionFingerprint: Hash,
  status: Status,
  supersedesMotionPlanId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  approvedBy: Id.nullable(),
  approvedAt: z.string().datetime().nullable(),
  frozenAt: z.string().datetime().nullable(),
}).strict();

export type AiStoryEpisodeProjectedDirectorPlan = z.infer<typeof AiStoryEpisodeProjectedDirectorPlanSchema>;
export type AiStoryEpisodeProjectedMotionPlan = z.infer<typeof AiStoryEpisodeProjectedMotionPlanSchema>;
export type AiStoryEpisodeProjectedDirectorScene = z.infer<typeof AiStoryEpisodeProjectedDirectorSceneSchema>;
export type AiStoryEpisodeProjectedMotionScene = z.infer<typeof AiStoryEpisodeProjectedMotionSceneSchema>;

export type EpisodeProjectedStateFact = z.infer<typeof StateFactSchema>;
export type EpisodeProjectedScriptAction = {
  entryId: string;
  action: string;
  subjectId: string;
  objectId?: string;
  stateDelta?: EpisodeProjectedStateFact | null;
};
export type EpisodeProjectedScriptScene = {
  scriptSceneId: string;
  order: number;
  sceneFunction: string;
  actions: readonly EpisodeProjectedScriptAction[];
  sceneStateIn: readonly EpisodeProjectedStateFact[];
  sceneStateDeltas: readonly EpisodeProjectedStateFact[];
  sceneStateOut: readonly EpisodeProjectedStateFact[];
  productEvidence: readonly string[];
  productAuthorityRefs: readonly string[];
  propIds: readonly string[];
};
export type EpisodeProjectedCanonicalEvent = {
  entryId: string;
  type: "ACTION";
  action: string;
  subjectId: string;
  objectId?: string | null;
  stateDelta?: EpisodeProjectedStateFact | null;
};
export type EpisodeProjectedCanonicalScene = {
  sceneId: string;
  sceneVersionId: string;
  fingerprint: string;
  order: number;
  sceneFunction: string;
  sourceScriptSceneIds: readonly string[];
  entryState: readonly EpisodeProjectedStateFact[];
  events: readonly EpisodeProjectedCanonicalEvent[];
  exitState: readonly EpisodeProjectedStateFact[];
  productBindingIds: readonly string[];
  mustKeep: readonly string[];
  mustAvoid: readonly string[];
  generationAuthority: z.infer<typeof AiStorySceneGenerationAuthoritySchema> | null;
};
export type EpisodeProjectedScenePlanItem = {
  id: string;
  order: number;
  purpose: string;
  continuityNotes: string;
  durationSec: number;
};
export type EpisodeProjectedShot = {
  id: string;
  sceneId: string;
  order: number;
  cameraType: string;
  cameraMovement: string;
  composition: string;
  framing: string;
  focus: string;
  information: string;
  durationSec: number;
  cameraSafety?: AiStoryShotCameraSafety;
};
export type EpisodeProjectedAuthoritySource = {
  animationPackageId: string;
  scriptScenes: readonly EpisodeProjectedScriptScene[];
  canonicalScenes: readonly EpisodeProjectedCanonicalScene[];
  scenePlan: readonly EpisodeProjectedScenePlanItem[];
  shotPlan: readonly EpisodeProjectedShot[];
};

export class EpisodeProjectedAuthorityError extends Error {
  constructor(readonly code: "EPISODE_PROJECTED_AUTHORITY_CONFLICT" | "EPISODE_DISPATCH_SOURCE_MISSING", message: string) {
    super(message);
    this.name = "EpisodeProjectedAuthorityError";
  }
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function shotField(shots: readonly { [key: string]: unknown }[], field: string) {
  return shots.map((shot) => String(shot[field] ?? "")).join("\n");
}

function productRole(scene: { productBindingIds: readonly string[]; generationAuthority: { state: string; value?: { strategy?: string; productVisualIdentityRequirement?: string } } }) {
  const authority = scene.generationAuthority.state === "KNOWN" ? scene.generationAuthority.value : null;
  return [
    [...scene.productBindingIds].sort().join(","),
    authority?.strategy ?? "",
    authority?.productVisualIdentityRequirement ?? "",
  ].join("|");
}

function differentiate(
  scene: AiStoryEpisodeProjectedDirectorScene,
  previous: AiStoryEpisodeProjectedDirectorScene | undefined,
) {
  if (!previous || scene.sceneOrder === 0) {
    return notApplicable("Opening Scene has no prior comparison baseline");
  }
  const dimensions: Array<(typeof AI_STORY_PROJECTED_DIFFERENTIATION_DIMENSIONS)[number]> = [];
  if (scene.sceneFunction !== previous.sceneFunction) dimensions.push("SCENE_FUNCTION");
  if (shotField(scene.shots, "composition") !== shotField(previous.shots, "composition")) dimensions.push("SHOT_COMPOSITION");
  if (shotField(scene.shots, "cameraMovement") !== shotField(previous.shots, "cameraMovement")) dimensions.push("CAMERA_MOVEMENT");
  if (shotField(scene.shots, "focus") !== shotField(previous.shots, "focus")) dimensions.push("FOCUS");
  if (shotField(scene.shots, "information") !== shotField(previous.shots, "information")) dimensions.push("AUDIENCE_INFORMATION");
  if (productRole(scene) !== productRole(previous)) dimensions.push("PRODUCT_ROLE");
  if (!dimensions.length) return notAsserted;
  return known({
    comparedToScriptSceneId: previous.scriptSceneId,
    dimensions,
    rationale: `Persisted Episode differences: ${dimensions.join(", ")}`,
  });
}

function assertAligned(condition: boolean, message: string) {
  if (!condition) throw new EpisodeProjectedAuthorityError("EPISODE_PROJECTED_AUTHORITY_CONFLICT", message);
}

export function projectEpisodeDirectorScenes(source: EpisodeProjectedAuthoritySource): AiStoryEpisodeProjectedDirectorScene[] {
  const scenes: AiStoryEpisodeProjectedDirectorScene[] = [];
  for (const scriptScene of [...source.scriptScenes].sort((left, right) => left.order - right.order)) {
    const canonical = source.canonicalScenes.filter((scene) => scene.sourceScriptSceneIds.includes(scriptScene.scriptSceneId));
    const planned = source.scenePlan.filter((scene) => scene.order === scriptScene.order);
    assertAligned(canonical.length === 1 && planned.length === 1, `Script scene ${scriptScene.scriptSceneId} does not bind one Canonical Scene and one Scene Plan row`);
    const scene = canonical[0]!;
    const scenePlan = planned[0]!;
    assertAligned(scene.order === scriptScene.order, `Canonical Scene order ${scene.order} contradicts Script order ${scriptScene.order}`);
    assertAligned(scene.sceneFunction === scriptScene.sceneFunction, `Canonical Scene function contradicts Script function for ${scriptScene.scriptSceneId}`);
    const shots = source.shotPlan.filter((shot) => shot.sceneId === scenePlan.id).sort((left, right) => left.order - right.order);
    assertAligned(shots.length > 0, `Scene Plan ${scenePlan.id} has no Shot Plan rows`);
    const projectedShots = shots.map((shot) => {
      const safety = provePersistedProductCameraSafety(shot);
      return {
        shotId: shot.id,
        order: shot.order,
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        focus: shot.focus,
        information: shot.information,
        durationSec: shot.durationSec,
        perspectiveChange: safety ? known(safety.perspectiveChange) : notAsserted,
        revealsUnseenProductSurface: safety ? known(safety.revealsUnseenProductSurface) : notAsserted,
        productIdentityTransformation: safety ? known(safety.productIdentityTransformation) : notAsserted,
      };
    });
    const projected: AiStoryEpisodeProjectedDirectorScene = {
      scriptSceneId: scriptScene.scriptSceneId,
      sceneOrder: scriptScene.order,
      sceneFunction: scriptScene.sceneFunction,
      canonicalSceneId: scene.sceneId,
      canonicalSceneVersionId: scene.sceneVersionId,
      canonicalSceneFingerprint: scene.fingerprint,
      purpose: scenePlan.purpose,
      continuityNotes: scenePlan.continuityNotes,
      mustKeep: known([...scene.mustKeep]),
      mustAvoid: known([...scene.mustAvoid]),
      generationAuthority: scene.generationAuthority ? known(scene.generationAuthority) : notAsserted,
      productBindingIds: [...scene.productBindingIds],
      actionEntryIds: scriptScene.actions.map((action) => action.entryId),
      shots: projectedShots,
      differentiation: notAsserted,
    };
    scenes.push(projected);
  }
  return scenes.map((scene, index) => ({ ...scene, differentiation: differentiate(scene, scenes[index - 1]) }));
}

function stateFact(fact: EpisodeProjectedStateFact): EpisodeProjectedStateFact {
  return {
    dimension: fact.dimension,
    subjectId: fact.subjectId,
    value: fact.value,
    ...(fact.fromValue !== undefined ? { fromValue: fact.fromValue } : {}),
    ...(fact.reason !== undefined ? { reason: fact.reason } : {}),
  };
}

export function projectEpisodeMotionScenes(
  source: EpisodeProjectedAuthoritySource,
  directorScenes: readonly AiStoryEpisodeProjectedDirectorScene[],
): AiStoryEpisodeProjectedMotionScene[] {
  return directorScenes.map((direction) => {
    const scriptScene = source.scriptScenes.find((scene) => scene.scriptSceneId === direction.scriptSceneId);
    const canonical = source.canonicalScenes.find((scene) => scene.sceneVersionId === direction.canonicalSceneVersionId);
    assertAligned(Boolean(scriptScene && canonical), `Projected Motion lost Script or Canonical Scene ${direction.scriptSceneId}`);
    const script = scriptScene!;
    const scene = canonical!;
    for (const event of scene.events) {
      const action = script.actions.find((entry) => entry.entryId === event.entryId);
      assertAligned(Boolean(action) && action!.action === event.action, `Canonical event action contradicts Script action ${event.entryId}`);
    }
    const cameraBehaviors = new Set(direction.shots.map((shot) => `${shot.cameraType}|${shot.cameraMovement}`));
    const durationSec = direction.shots.reduce((total, shot) => total + shot.durationSec, 0);
    const authority = direction.generationAuthority.state === "KNOWN" ? direction.generationAuthority.value : null;
    return {
      scriptSceneId: direction.scriptSceneId,
      sceneOrder: direction.sceneOrder,
      actions: script.actions.map((action) => ({
        entryId: action.entryId,
        semanticAction: action.action,
        subjectId: action.subjectId,
        objectId: action.objectId ?? null,
        stateDelta: action.stateDelta ? stateFact(action.stateDelta) : null,
      })),
      sceneStateIn: script.sceneStateIn.map(stateFact),
      sceneStateDeltas: script.sceneStateDeltas.map(stateFact),
      sceneStateOut: script.sceneStateOut.map(stateFact),
      entryState: scene.entryState.map(stateFact),
      events: scene.events.map((event) => ({
        entryId: event.entryId,
        type: "ACTION" as const,
        action: event.action,
        subjectId: event.subjectId,
        objectId: event.objectId ?? null,
        stateDelta: event.stateDelta ? stateFact(event.stateDelta) : null,
      })),
      exitState: scene.exitState.map(stateFact),
      shots: direction.shots.map((shot) => ({
        shotId: shot.shotId,
        order: shot.order,
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        focus: shot.focus,
        information: shot.information,
        durationSec: shot.durationSec,
      })),
      productBindingIds: [...direction.productBindingIds],
      generationAuthority: direction.generationAuthority,
      measuredFacts: {
        actionCount: script.actions.length,
        shotCount: direction.shots.length,
        cameraBehaviorCount: cameraBehaviors.size,
        durationSec,
        imageConditioned: authority ? authority.strategy !== "TEXT_TO_VIDEO" : false,
        productIdentitySensitive: authority?.productVisualIdentityRequirement === "REQUIRED",
      },
      physicalCompletion: proveEpisodeProjectedPhysicalCompletion({
        actions: script.actions.map((action) => ({
          entryId: action.entryId,
          semanticAction: action.action,
          stateDelta: action.stateDelta ? stateFact(action.stateDelta) : null,
        })),
        sceneStateDeltas: script.sceneStateDeltas.map(stateFact),
        entryState: scene.entryState.map(stateFact),
        exitState: scene.exitState.map(stateFact),
        events: scene.events.map((event) => ({
          entryId: event.entryId,
          action: event.action,
          stateDelta: event.stateDelta ? stateFact(event.stateDelta) : null,
        })),
      }),
      cameraStateBoundary: notAsserted,
    };
  });
}

type PhysicalFact = { dimension: string; subjectId: string; value: string; fromValue?: string | null };
type PhysicalLineage = {
  actions: readonly { entryId: string; semanticAction: string; stateDelta: PhysicalFact | null }[];
  sceneStateDeltas: readonly PhysicalFact[];
  entryState: readonly PhysicalFact[];
  exitState: readonly PhysicalFact[];
  events: readonly { entryId: string; action: string; stateDelta: PhysicalFact | null }[];
};

function isPhysicalChange(fact: PhysicalFact) {
  return PHYSICAL_SCRIPT_DIMENSIONS.has(fact.dimension) && fact.fromValue != null && fact.fromValue !== fact.value;
}

function samePhysicalChange(left: PhysicalFact, right: PhysicalFact) {
  return left.dimension === right.dimension && left.subjectId === right.subjectId && left.fromValue === right.fromValue && left.value === right.value;
}

/**
 * Narrative or physical product participation. A visual-generation binding
 * does not create this obligation by itself.
 */
export function projectedProductPersistenceSubjectIds(input: {
  productAuthorityRefs: readonly string[];
  actions: readonly { subjectId: string; objectId?: string | null; stateDelta: PhysicalFact | null }[];
  events: readonly { subjectId?: string; objectId?: string | null; stateDelta: PhysicalFact | null }[];
  sceneStateDeltas: readonly PhysicalFact[];
  entryState: readonly PhysicalFact[];
  exitState: readonly PhysicalFact[];
}): string[] {
  const physical = [
    ...input.sceneStateDeltas,
    ...input.entryState,
    ...input.exitState,
    ...input.actions.flatMap((action) => action.stateDelta ? [action.stateDelta] : []),
    ...input.events.flatMap((event) => event.stateDelta ? [event.stateDelta] : []),
  ].filter((fact) => PHYSICAL_SCRIPT_DIMENSIONS.has(fact.dimension));
  const productStateSubjects = physical
    .filter((fact) => fact.dimension === "PRODUCT_STATE")
    .map((fact) => fact.subjectId);
  const narrative = new Set(input.productAuthorityRefs);
  const obligated = new Set<string>([...narrative, ...productStateSubjects]);
  for (const action of [...input.actions, ...input.events]) {
    for (const subjectId of [action.subjectId, action.objectId]) {
      if (subjectId && (narrative.has(subjectId) || obligated.has(subjectId))) obligated.add(subjectId);
    }
  }
  return [...obligated];
}

/**
 * Object persistence is whether an obligated product remains present.
 * Physical completion is whether a physical state change finished.
 */
export function proveProjectedProductObjectPersistence(input: {
  productAuthorityRefs: readonly string[];
  actions: readonly { entryId: string; semanticAction: string; subjectId: string; objectId?: string | null; stateDelta: PhysicalFact | null }[];
  events: readonly { entryId: string; action: string; subjectId?: string; objectId?: string | null; stateDelta: PhysicalFact | null }[];
  sceneStateDeltas: readonly PhysicalFact[];
  entryState: readonly PhysicalFact[];
  exitState: readonly PhysicalFact[];
}) {
  const obligated = projectedProductPersistenceSubjectIds(input);
  if (obligated.length === 0) return notApplicable("No narrative or physical product persistence obligation");
  const productChanges = input.sceneStateDeltas.filter((fact) =>
    obligated.includes(fact.subjectId) && isPhysicalChange(fact),
  );
  if (productChanges.length > 0) {
    const completion = proveEpisodeProjectedPhysicalCompletion(input);
    const change = productChanges.length === 1 ? productChanges[0] : undefined;
    if (
      completion.state !== "KNOWN" ||
      !change ||
      completion.value.dimension !== change.dimension ||
      completion.value.fromValue !== change.fromValue ||
      completion.value.toValue !== change.value
    ) return notAsserted;
    return known({ outcome: "PRESERVED" as const });
  }
  const signature = (facts: readonly PhysicalFact[], subjectId: string) => facts
    .filter((fact) => PHYSICAL_SCRIPT_DIMENSIONS.has(fact.dimension) && fact.subjectId === subjectId)
    .map((fact) => `${fact.dimension}:${fact.value}`)
    .sort()
    .join("|");
  for (const subjectId of obligated) {
    const entry = signature(input.entryState, subjectId);
    const exit = signature(input.exitState, subjectId);
    if (!entry || !exit || entry !== exit) return notAsserted;
  }
  return known({ outcome: "PRESERVED" as const });
}

/**
 * Physical completion is known only when one Script physical delta, the
 * Canonical entry, the Canonical exit, and one matching ACTION event agree.
 * KNOWLEDGE is never a physical dimension.
 */
export function proveEpisodeProjectedPhysicalCompletion(input: PhysicalLineage) {
  const physicalFacts = input.sceneStateDeltas.filter((fact) => PHYSICAL_SCRIPT_DIMENSIONS.has(fact.dimension));
  const changes = physicalFacts.filter(isPhysicalChange);
  if (physicalFacts.length === 0) return notApplicable("No persisted physical state change requires a completion path");
  if (changes.length !== 1 || physicalFacts.length !== 1) return notAsserted;
  const change = changes[0]!;
  const entry = input.entryState.filter((fact) => fact.dimension === change.dimension && fact.subjectId === change.subjectId);
  const exit = input.exitState.filter((fact) => fact.dimension === change.dimension && fact.subjectId === change.subjectId);
  if (entry.length !== 1 || entry[0]!.value !== change.fromValue || exit.length !== 1 || exit[0]!.value !== change.value) return notAsserted;
  const actions = input.actions.filter((action) => action.stateDelta && isPhysicalChange(action.stateDelta) && samePhysicalChange(action.stateDelta, change));
  if (actions.length !== 1) return notAsserted;
  const action = actions[0]!;
  const events = input.events.filter((event) => event.entryId === action.entryId && event.action === action.semanticAction && event.stateDelta && samePhysicalChange(event.stateDelta, change));
  if (events.length !== 1) return notAsserted;
  const conflicting = [...input.actions.flatMap((item) => item.stateDelta ? [item.stateDelta] : []), ...input.events.flatMap((item) => item.stateDelta ? [item.stateDelta] : [])]
    .some((fact) => isPhysicalChange(fact) && !samePhysicalChange(fact, change));
  if (conflicting) return notAsserted;
  return known({ dimension: change.dimension, fromValue: change.fromValue!, toValue: change.value });
}

function normalizeCameraToken(value: string) {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function canonicalCameraFamily(value: string) {
  const normalized = normalizeCameraToken(value);
  return AI_STORY_CAMERA_FAMILIES.find((family) => normalizeCameraToken(family) === normalized) ?? null;
}

function boundedCameraFamily(family: (typeof AI_STORY_CAMERA_FAMILIES)[number]) {
  const intensity = cinematicCameraMovementIntensity(family);
  return intensity === "NONE" || intensity === "SUBTLE" || family === "SMALL_ARC";
}

/**
 * Episode-projected camera execution uses the frozen Shot's camera type and
 * movement. It never synthesizes start or end camera state.
 */
export function evaluateEpisodeProjectedCameraExecution(shots: readonly { cameraType: string; cameraMovement: string }[]) {
  const families: string[] = [];
  for (const shot of shots) {
    const movement = canonicalCameraFamily(shot.cameraMovement);
    const type = canonicalCameraFamily(shot.cameraType);
    const family = movement ?? (normalizeCameraToken(shot.cameraMovement) === "none" ? type : null);
    if (!family || !boundedCameraFamily(family)) return { outcome: "CAMERA_EXECUTION_NOT_PROVEN" as const };
    families.push(family);
  }
  if (families.length === 0) return { outcome: "CAMERA_EXECUTION_NOT_PROVEN" as const };
  return { outcome: "BOUNDED_CAMERA_EXECUTION_PROVEN" as const, families };
}

export function projectedProductCameraSafetyProven(shot: {
  perspectiveChange: { state: string };
  revealsUnseenProductSurface: { state: string };
  productIdentityTransformation: { state: string };
}) {
  return shot.perspectiveChange.state === "KNOWN"
    && shot.revealsUnseenProductSurface.state === "KNOWN"
    && shot.productIdentityTransformation.state === "KNOWN";
}

export function collectProjectedEvidenceStates(value: unknown, path = ""): { notAsserted: string[]; notApplicable: string[] } {
  const notAssertedFields: string[] = [];
  const notApplicableFields: string[] = [];
  if (!value || typeof value !== "object") return { notAsserted: notAssertedFields, notApplicable: notApplicableFields };
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const nested = collectProjectedEvidenceStates(item, `${path}[${index}]`);
      notAssertedFields.push(...nested.notAsserted);
      notApplicableFields.push(...nested.notApplicable);
    });
    return { notAsserted: notAssertedFields, notApplicable: notApplicableFields };
  }
  const record = value as Record<string, unknown>;
  if (record.state === "NOT_ASSERTED") notAssertedFields.push(path || "$");
  if (record.state === "NOT_APPLICABLE") notApplicableFields.push(path || "$");
  if (record.state === "KNOWN" || record.state === "NOT_ASSERTED" || record.state === "NOT_APPLICABLE") {
    return { notAsserted: notAssertedFields, notApplicable: notApplicableFields };
  }
  for (const [key, child] of Object.entries(record)) {
    const nested = collectProjectedEvidenceStates(child, path ? `${path}.${key}` : key);
    notAssertedFields.push(...nested.notAsserted);
    notApplicableFields.push(...nested.notApplicable);
  }
  return { notAsserted: notAssertedFields, notApplicable: notApplicableFields };
}

export function projectedAuthorityContradictsSource(left: unknown, right: unknown) {
  return !sameJson(left, right);
}
