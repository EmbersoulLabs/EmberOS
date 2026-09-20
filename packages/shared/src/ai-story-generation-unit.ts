import { z } from "zod";
import type { AiStoryDirectorSceneDirection, AiStoryDirectorShot } from "./ai-story-director-plan";
import type { AiStorySceneMotionPlan } from "./ai-story-motion-plan";

export const AI_STORY_GENERATION_UNIT_CONTRACT_VERSION = "ai-story-generation-unit.v1" as const;
export const AI_STORY_GENERATION_PLAN_CONTRACT_VERSION = "ai-story-generation-plan.v1" as const;

export const AI_STORY_GENERATION_UNIT_TYPES = [
  "PROVIDER_VIDEO",
  "EXISTING_VIDEO",
  "EXISTING_IMAGE",
  "LOCAL_ASSET_MOTION",
  "STATIC_HOLD",
  "TEXT_OR_GRAPHIC",
] as const;

export const AI_STORY_GENERATION_NECESSITY = [
  "REQUIRED_GENERATIVE_VIDEO",
  "PREFERRED_GENERATIVE_VIDEO",
  "NON_GENERATIVE_SUFFICIENT",
  "UNRESOLVED",
] as const;

export const AI_STORY_GENERATION_UNIT_SOURCE_KINDS = [
  "FROZEN_SCRIPT",
  "FROZEN_SCENE",
  "FROZEN_DIRECTOR_PLAN",
  "EXACT_DIRECTOR_SHOT",
] as const;

export const AI_STORY_MULTI_SHOT_SCENE_AUTHORITY = "CERTIFIED" as const;
export const SCENE_NOT_PROVIDER_CALL = "CERTIFIED" as const;
export const GENERATION_UNIT_ARCHITECTURE = "CERTIFIED" as const;
export const DIRECTOR_SHOT_EXECUTION_BINDING = "CERTIFIED" as const;
export const INTRA_SCENE_SHOT_PROGRESSION = "CERTIFIED" as const;
export const GENERATION_UNIT_COVERAGE = "CERTIFIED" as const;
export const SINGLE_SHOT_SCENE_BACKWARD_COMPATIBILITY = "CERTIFIED" as const;
export const PROVIDER_UNIT_SINGLE_SHOT_BOUNDARY = "CERTIFIED" as const;
export const MULTI_SHOT_PROVIDER_REQUEST = "NOT_CERTIFIED" as const;
export const NARRATIVE_EDITOR = "NOT_YET_CERTIFIED" as const;
export const AUDIO_PLAN = "NOT_YET_CERTIFIED" as const;
export const FINAL_STORY_ASSEMBLY_V2 = "NOT_YET_CERTIFIED" as const;
export const AI_STORY_MULTI_SHOT_SCENE_ALLOWED = true as const;
export const AI_STORY_MULTI_SHOT_PROVIDER_REQUEST_CERTIFIED = false as const;
export const AI_STORY_GENERATION_UNIT_OWNS_CREATIVE_AUTHORITY = false as const;
export const AI_STORY_GENERATION_UNIT_OWNS_BILLING = false as const;
export const AI_STORY_GENERATION_UNIT_DISPATCHES_PROVIDER = false as const;
export const AI_STORY_GENERATION_UNIT_PERSISTENCE = "CONTRACT_LAYER_ONLY" as const;
export const AI_STORY_SCENE_EXECUTION_IDENTITY_PRESERVED = true as const;
export const READY_FOR_PROVIDER_FREE_REVIEW_MULTI_SHOT = "PASS" as const;
export const READY_FOR_PRODUCTION_MERGE_MULTI_SHOT = "PENDING_PR140_PR141_AND_HUMAN_AUTHORIZATION" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(2000);

export const AiStoryGenerationExecutionRequirementSchema = z.object({
  materialSubjectAction: z.boolean(),
  characterPerformance: z.boolean(),
  physicalInteraction: z.boolean(),
  complexEnvironmentalMotion: z.boolean(),
  generatedWorldMotion: z.boolean(),
  cameraMovementAlone: z.boolean(),
  productPresenceAlone: z.boolean(),
}).strict();

export const AiStoryGenerationNecessityEvidenceSchema = z.object({
  code: Text.max(160),
  dimension: z.enum([
    "MATERIAL_SUBJECT_ACTION",
    "CHARACTER_PERFORMANCE",
    "PHYSICAL_INTERACTION",
    "COMPLEX_ENVIRONMENTAL_MOTION",
    "GENERATED_WORLD_MOTION",
    "CAMERA_MOVEMENT_ALONE",
    "PRODUCT_PRESENCE_ALONE",
    "PACKSHOT_OR_CTA",
    "STATIC_DETAIL",
    "LOCAL_PARALLAX",
  ]),
  present: z.boolean(),
  safeEvidence: Text.max(1000),
}).strict();

export const AiStoryGenerationUnitSourceAuthoritySchema = z.object({
  lineage: z.array(z.enum(AI_STORY_GENERATION_UNIT_SOURCE_KINDS)).min(4),
  scriptVersionId: Id,
  sceneFingerprint: Hash,
  directorPlanId: Id,
  directorShotId: Id,
  productAuthorityIds: z.array(Id),
  productSourceAssetIds: z.array(Id),
  productContentHashes: z.array(Hash),
  locationId: Id,
  characterIds: z.array(Id),
}).strict();

export const AiStoryGenerationUnitRetryOwnershipSchema = z.object({
  retryScope: z.literal("GENERATION_UNIT"),
  siblingUnitsRemainValid: z.literal(true),
  sceneRetryDoesNotRegenerateEveryShot: z.literal(true),
}).strict();

export const AiStoryGenerationUnitSchema = z.object({
  generationUnitId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneId: Id,
  sceneVersionId: Id,
  directorPlanId: Id,
  directorShotId: Id,
  directorShotIds: z.array(Id).min(1),
  order: z.number().int().nonnegative(),
  unitType: z.enum(AI_STORY_GENERATION_UNIT_TYPES),
  sourceAuthority: AiStoryGenerationUnitSourceAuthoritySchema,
  executionRequirement: AiStoryGenerationExecutionRequirementSchema,
  necessity: z.enum(AI_STORY_GENERATION_NECESSITY),
  necessityEvidence: z.array(AiStoryGenerationNecessityEvidenceSchema).min(1),
  supportedActionEntryIds: z.array(Id),
  supportedActionPhaseIds: z.array(Id),
  supportedStateDeltaIndexes: z.array(z.number().int().nonnegative()),
  servedAudienceInformation: z.array(Text),
  inheritedContinuity: z.object({
    locationId: Id,
    characterIds: z.array(Id),
    productAuthorityIds: z.array(Id),
  }).strict(),
  retryOwnership: AiStoryGenerationUnitRetryOwnershipSchema,
  fingerprint: Hash,
}).strict().superRefine((value, ctx) => {
  if (value.directorShotId !== value.directorShotIds[0]) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "directorShotId must equal the first bound Director Shot" });
  }
  if (value.sourceAuthority.directorShotId !== value.directorShotId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Generation Unit source authority must bind the exact Director Shot" });
  }
});

export const AiStoryGenerationPlanSchema = z.object({
  generationPlanId: Id,
  contractVersion: z.literal(AI_STORY_GENERATION_PLAN_CONTRACT_VERSION),
  storyId: Id,
  storyVersionId: Id,
  sceneId: Id,
  sceneVersionId: Id,
  directorPlanId: Id,
  units: z.array(AiStoryGenerationUnitSchema).min(1),
  fingerprint: Hash,
}).strict();

export type AiStoryGenerationUnitType = (typeof AI_STORY_GENERATION_UNIT_TYPES)[number];
export type AiStoryGenerationNecessity = (typeof AI_STORY_GENERATION_NECESSITY)[number];
export type AiStoryGenerationExecutionRequirement = z.infer<typeof AiStoryGenerationExecutionRequirementSchema>;
export type AiStoryGenerationUnit = z.infer<typeof AiStoryGenerationUnitSchema>;
export type AiStoryGenerationPlan = z.infer<typeof AiStoryGenerationPlanSchema>;
export type AiStoryGenerationUnitIssue = {
  gate: "INTRA_SCENE_SHOT_PROGRESSION_GATE" | "GENERATION_UNIT_COVERAGE_GATE" | "GENERATION_UNIT_BINDING_GATE" | "SHOT_IDENTITY_GATE" | "PRODUCT_AUTHORITY_BINDING_GATE" | "LOCATION_CONTINUITY_GATE" | "CAST_BINDING_GATE" | "SCRIPT_ACTION_SUPPORT_GATE";
  severity: "BLOCK" | "WARN";
  message: string;
};

export const AI_STORY_GENERATION_UNIT_GATES = [
  "INTRA_SCENE_SHOT_PROGRESSION_GATE",
  "GENERATION_UNIT_COVERAGE_GATE",
  "GENERATION_UNIT_BINDING_GATE",
] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function directorShotActionEntryIds(shot: AiStoryDirectorShot): string[] {
  return [...new Set([
    ...(shot.supportedActionEntryIds ?? []),
    ...shot.blockingIntents.flatMap((blocking) => blocking.supportedActionEntryIds),
  ])];
}

export function intraSceneShotProgressionSignature(shot: AiStoryDirectorShot) {
  return {
    shotPurpose: shot.shotPurpose,
    shotSize: shot.shotSize,
    cameraFamily: shot.cameraFamily,
    focusKind: shot.focusTarget.kind,
    compositionIntent: shot.compositionIntent,
    subjectActionPhase: shot.subjectActionPhase ?? shot.blockingIntents.map((item) => item.semanticIntent).join("|"),
    actionEntryIds: [...directorShotActionEntryIds(shot)].sort(),
    actionPhaseIds: [...(shot.supportedActionPhaseIds ?? [])].sort(),
    stateDeltaIndexes: [...(shot.supportedStateDeltaIndexes ?? [])].sort((a, b) => a - b),
    newVisualInformation: [...shot.newAudienceInformation, ...(shot.servedAudienceInformation ?? [])].map((item) => item.trim().toLowerCase()).sort(),
    entryVisualResponsibility: shot.entryVisualResponsibility ?? "",
    exitVisualResponsibility: shot.exitVisualResponsibility ?? "",
  };
}

export function evaluateIntraSceneShotProgression(scene: AiStoryDirectorSceneDirection): AiStoryGenerationUnitIssue[] {
  const issues: AiStoryGenerationUnitIssue[] = [];
  const shots = [...scene.shots].sort((a, b) => a.order - b.order);
  if (shots.length <= 1) return issues;
  const ids = shots.map((shot) => shot.directorShotId);
  if (new Set(ids).size !== ids.length) {
    issues.push({ gate: "SHOT_IDENTITY_GATE", severity: "BLOCK", message: `Director Scene ${scene.scriptSceneId} contains duplicated Director Shot identity` });
  }
  const orders = shots.map((shot) => shot.order);
  if (new Set(orders).size !== orders.length) {
    issues.push({ gate: "SHOT_IDENTITY_GATE", severity: "BLOCK", message: `Director Scene ${scene.scriptSceneId} contains duplicated Shot order` });
  }
  if (orders.some((order, index) => order !== index)) {
    issues.push({ gate: "SHOT_IDENTITY_GATE", severity: "BLOCK", message: `Director Scene ${scene.scriptSceneId} Shot order must be contiguous from 0` });
  }
  const signatures = shots.map(intraSceneShotProgressionSignature);
  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1]!;
    const current = signatures[index]!;
    const duplicateVisual = previous.shotPurpose === current.shotPurpose
      && previous.shotSize === current.shotSize
      && previous.cameraFamily === current.cameraFamily
      && previous.focusKind === current.focusKind
      && previous.compositionIntent === current.compositionIntent;
    const noActionDelta = same(previous.actionEntryIds, current.actionEntryIds)
      && same(previous.actionPhaseIds, current.actionPhaseIds)
      && same(previous.stateDeltaIndexes, current.stateDeltaIndexes)
      && previous.subjectActionPhase === current.subjectActionPhase;
    const noInformationDelta = current.newVisualInformation.length === 0 || same(previous.newVisualInformation, current.newVisualInformation);
    const noEntryExitDelta = previous.entryVisualResponsibility === current.entryVisualResponsibility
      && previous.exitVisualResponsibility === current.exitVisualResponsibility;
    if (duplicateVisual && noActionDelta && noInformationDelta && noEntryExitDelta) {
      issues.push({
        gate: "INTRA_SCENE_SHOT_PROGRESSION_GATE",
        severity: "BLOCK",
        message: `Director Scene ${scene.scriptSceneId} Shot ${shots[index]!.directorShotId} duplicates Shot ${shots[index - 1]!.directorShotId} without new action, framing, focus, or visual information`,
      });
    }
  }
  return issues;
}

export function providerGenerationUnitShotCount(unit: Pick<AiStoryGenerationUnit, "directorShotIds" | "unitType">): number {
  return unit.unitType === "PROVIDER_VIDEO" ? unit.directorShotIds.length : 0;
}

export function assertProviderGenerationUnitSingleShot(unit: Pick<AiStoryGenerationUnit, "directorShotId" | "directorShotIds" | "unitType">): void {
  if (unit.unitType !== "PROVIDER_VIDEO") return;
  if (unit.directorShotIds.length !== 1 || unit.directorShotId !== unit.directorShotIds[0]) {
    throw new Error("MULTI_SHOT_UNCERTIFIED");
  }
}

export function classifyAiStoryGenerationExecutionRequirement(input: {
  shot: AiStoryDirectorShot;
  scene: AiStoryDirectorSceneDirection;
  motion?: AiStorySceneMotionPlan | null;
}): AiStoryGenerationExecutionRequirement {
  const actionIds = new Set(directorShotActionEntryIds(input.shot));
  const executions = (input.motion?.actionExecutions ?? []).filter((execution) => actionIds.has(execution.scriptActionEntryId));
  const materialSubjectAction = executions.some((execution) =>
    execution.dominance === "DOMINANT"
    && execution.actionPath.some((phase) => phase.stateChanges.length > 0),
  );
  const physicalInteraction = executions.some((execution) => execution.objectInteractions.some((item) => item.contactRequired));
  const characterPerformance = input.shot.shotPurpose === "SHOW_REACTION"
    || input.shot.focusTarget.kind === "CHARACTER"
    || input.shot.focusTarget.kind === "REACTION"
    || executions.some((execution) => execution.semanticAction.length > 0 && execution.dominance === "DOMINANT" && (input.shot.shotPurpose === "SHOW_ACTION" || input.shot.shotPurpose === "SHOW_REACTION"));
  const complexEnvironmentalMotion = (input.motion?.environmentalMotions ?? []).length > 1;
  const generatedWorldMotion = materialSubjectAction || complexEnvironmentalMotion;
  const cameraMoves = !["LOCKED", "STATIC", "LOCKED_HERO"].includes(input.shot.cameraFamily);
  const productPresent = Boolean(input.shot.productEmphasis);
  const cameraMovementAlone = cameraMoves && !materialSubjectAction && !physicalInteraction && !characterPerformance && !complexEnvironmentalMotion;
  const productPresenceAlone = productPresent && !materialSubjectAction && !physicalInteraction && !characterPerformance && !complexEnvironmentalMotion;
  return {
    materialSubjectAction,
    characterPerformance: characterPerformance && (materialSubjectAction || physicalInteraction || input.shot.shotPurpose === "SHOW_REACTION" || input.shot.focusTarget.kind === "REACTION" || input.shot.focusTarget.kind === "CHARACTER"),
    physicalInteraction,
    complexEnvironmentalMotion,
    generatedWorldMotion,
    cameraMovementAlone,
    productPresenceAlone,
  };
}

export function classifyAiStoryGenerationUnitType(input: {
  shot: AiStoryDirectorShot;
  scene: AiStoryDirectorSceneDirection;
  requirement: AiStoryGenerationExecutionRequirement;
}): AiStoryGenerationUnitType {
  if (input.requirement.materialSubjectAction || input.requirement.physicalInteraction || input.requirement.complexEnvironmentalMotion || input.requirement.generatedWorldMotion) {
    return "PROVIDER_VIDEO";
  }
  if (input.requirement.characterPerformance && (input.shot.shotPurpose === "SHOW_REACTION" || input.shot.shotPurpose === "SHOW_ACTION")) {
    return "PROVIDER_VIDEO";
  }
  if (input.scene.sceneVisualRole === "CTA_ENDING" || input.shot.shotPurpose === "RESOLVE") return "TEXT_OR_GRAPHIC";
  if (input.scene.sceneVisualRole === "PACKSHOT" || input.shot.productEmphasis === "PACKSHOT") {
    return input.requirement.cameraMovementAlone ? "LOCAL_ASSET_MOTION" : "EXISTING_IMAGE";
  }
  if (input.shot.shotPurpose === "SHOW_DETAIL" || input.shot.shotPurpose === "SHOW_EVIDENCE" || input.scene.sceneVisualRole === "TEXTURE_MACRO") {
    return input.requirement.cameraMovementAlone ? "LOCAL_ASSET_MOTION" : "EXISTING_IMAGE";
  }
  if (input.requirement.cameraMovementAlone) return "LOCAL_ASSET_MOTION";
  if (["LOCKED", "STATIC", "LOCKED_HERO"].includes(input.shot.cameraFamily)) return "STATIC_HOLD";
  return "EXISTING_IMAGE";
}

export function classifyAiStoryGenerationNecessity(input: {
  unitType: AiStoryGenerationUnitType;
  requirement: AiStoryGenerationExecutionRequirement;
}): { necessity: AiStoryGenerationNecessity; evidence: z.infer<typeof AiStoryGenerationNecessityEvidenceSchema>[] } {
  const evidence: z.infer<typeof AiStoryGenerationNecessityEvidenceSchema>[] = [
    { code: "MATERIAL_SUBJECT_ACTION", dimension: "MATERIAL_SUBJECT_ACTION", present: input.requirement.materialSubjectAction, safeEvidence: input.requirement.materialSubjectAction ? "Shot serves material subject action" : "Shot does not require material subject action" },
    { code: "CHARACTER_PERFORMANCE", dimension: "CHARACTER_PERFORMANCE", present: input.requirement.characterPerformance, safeEvidence: input.requirement.characterPerformance ? "Shot serves character performance" : "Shot does not require character performance" },
    { code: "PHYSICAL_INTERACTION", dimension: "PHYSICAL_INTERACTION", present: input.requirement.physicalInteraction, safeEvidence: input.requirement.physicalInteraction ? "Shot serves physical interaction" : "Shot does not require physical interaction" },
    { code: "CAMERA_MOVEMENT_ALONE", dimension: "CAMERA_MOVEMENT_ALONE", present: input.requirement.cameraMovementAlone, safeEvidence: "Camera movement alone does not require Provider video" },
    { code: "PRODUCT_PRESENCE_ALONE", dimension: "PRODUCT_PRESENCE_ALONE", present: input.requirement.productPresenceAlone, safeEvidence: "Product presence alone does not require Provider video" },
  ];
  if (input.unitType === "PROVIDER_VIDEO") {
    return { necessity: "REQUIRED_GENERATIVE_VIDEO", evidence };
  }
  if (input.requirement.cameraMovementAlone || input.requirement.productPresenceAlone) {
    evidence.push({ code: "NON_GENERATIVE_CAMERA_OR_PRODUCT", dimension: input.requirement.cameraMovementAlone ? "LOCAL_PARALLAX" : "PACKSHOT_OR_CTA", present: true, safeEvidence: "Non-generative material is sufficient for this Shot" });
  }
  return { necessity: "NON_GENERATIVE_SUFFICIENT", evidence };
}
