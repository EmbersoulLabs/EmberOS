import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import type { AiStoryDirectorSceneDirection, AiStoryDirectorShot } from "./ai-story-director-plan";
import type { AiStorySceneMotionPlan } from "./ai-story-motion-plan";
import type { AiStoryCinematicPromptFacts } from "./ai-story-cinematic-execution-contract";
import {
  AI_STORY_GENERATION_PLAN_CONTRACT_VERSION,
  AI_STORY_GENERATION_UNIT_CONTRACT_VERSION,
  AiStoryGenerationPlanSchema,
  AiStoryGenerationUnitSchema,
  classifyAiStoryGenerationExecutionRequirement,
  classifyAiStoryGenerationNecessity,
  classifyAiStoryGenerationUnitType,
  directorShotActionEntryIds,
  evaluateIntraSceneShotProgression,
  type AiStoryGenerationPlan,
  type AiStoryGenerationUnit,
  type AiStoryGenerationUnitIssue,
} from "./ai-story-generation-unit";

export type AiStoryGenerationPlanSceneInput = {
  sceneId: string;
  sceneVersionId: string;
  fingerprint: string;
  locationBinding: { id: string };
  castBindings: ReadonlyArray<{ id: string }>;
  productBindings: ReadonlyArray<{ productAuthorityId: string; sourceAssetId: string; sourceAssetContentHash: string }>;
  sourceScriptEntryIds: readonly string[];
  discontinuity: { kind: string } | null;
};

export type AiStoryGenerationPlanInput = {
  storyId: string;
  storyVersionId: string;
  scriptVersionId: string;
  directorPlanId: string;
  scene: AiStoryGenerationPlanSceneInput;
  directorDirection: AiStoryDirectorSceneDirection;
  motionScenePlan: AiStorySceneMotionPlan;
  cinematicProjection?: Pick<AiStoryCinematicPromptFacts, "narrativePurpose" | "mustKeep" | "mustChange"> | null;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function characterIdsOf(scene: AiStoryGenerationPlanInput["scene"]): string[] {
  return [...scene.castBindings.map((binding) => binding.id)].sort();
}

function productAuthorityOf(scene: AiStoryGenerationPlanInput["scene"]) {
  const products = [...scene.productBindings].sort((a, b) => a.productAuthorityId.localeCompare(b.productAuthorityId));
  return {
    productAuthorityIds: products.map((item) => item.productAuthorityId),
    productSourceAssetIds: products.map((item) => item.sourceAssetId),
    productContentHashes: products.map((item) => item.sourceAssetContentHash),
  };
}

function shotPhaseIds(shot: AiStoryDirectorShot, motion: AiStorySceneMotionPlan): string[] {
  if (shot.supportedActionPhaseIds?.length) return [...shot.supportedActionPhaseIds];
  const actionIds = new Set(directorShotActionEntryIds(shot));
  return motion.actionExecutions
    .filter((execution) => actionIds.has(execution.scriptActionEntryId))
    .flatMap((execution) => execution.actionPath.map((phase) => phase.phaseId));
}

export function computeAiStoryGenerationUnitFingerprint(input: Omit<AiStoryGenerationUnit, "generationUnitId" | "fingerprint">): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_GENERATION_UNIT_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    sceneId: input.sceneId,
    sceneVersionId: input.sceneVersionId,
    directorPlanId: input.directorPlanId,
    directorShotId: input.directorShotId,
    directorShotIds: input.directorShotIds,
    order: input.order,
    unitType: input.unitType,
    sourceAuthority: input.sourceAuthority,
    executionRequirement: input.executionRequirement,
    necessity: input.necessity,
    necessityEvidence: input.necessityEvidence,
    supportedActionEntryIds: input.supportedActionEntryIds,
    supportedActionPhaseIds: input.supportedActionPhaseIds,
    supportedStateDeltaIndexes: input.supportedStateDeltaIndexes,
    servedAudienceInformation: input.servedAudienceInformation,
    inheritedContinuity: input.inheritedContinuity,
    retryOwnership: input.retryOwnership,
  });
}

export function computeAiStoryGenerationPlanFingerprint(input: Pick<AiStoryGenerationPlan, "storyId" | "storyVersionId" | "sceneId" | "sceneVersionId" | "directorPlanId" | "units">): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_GENERATION_PLAN_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    sceneId: input.sceneId,
    sceneVersionId: input.sceneVersionId,
    directorPlanId: input.directorPlanId,
    units: input.units.map((unit) => unit.fingerprint),
  });
}

function compileUnit(input: AiStoryGenerationPlanInput, shot: AiStoryDirectorShot): AiStoryGenerationUnit {
  const requirement = classifyAiStoryGenerationExecutionRequirement({
    shot,
    scene: input.directorDirection,
    motion: input.motionScenePlan,
  });
  const unitType = classifyAiStoryGenerationUnitType({
    shot,
    scene: input.directorDirection,
    requirement,
  });
  const necessity = classifyAiStoryGenerationNecessity({ unitType, requirement });
  const products = productAuthorityOf(input.scene);
  const characters = characterIdsOf(input.scene);
  const locationId = input.scene.locationBinding.id;
  const actionEntryIds = directorShotActionEntryIds(shot);
  const withoutId = {
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    sceneId: input.scene.sceneId,
    sceneVersionId: input.scene.sceneVersionId,
    directorPlanId: input.directorPlanId,
    directorShotId: shot.directorShotId,
    directorShotIds: [shot.directorShotId],
    order: shot.order,
    unitType,
    sourceAuthority: {
      lineage: ["FROZEN_SCRIPT", "FROZEN_SCENE", "FROZEN_DIRECTOR_PLAN", "EXACT_DIRECTOR_SHOT"] as Array<"FROZEN_SCRIPT" | "FROZEN_SCENE" | "FROZEN_DIRECTOR_PLAN" | "EXACT_DIRECTOR_SHOT">,
      scriptVersionId: input.scriptVersionId,
      sceneFingerprint: input.scene.fingerprint,
      directorPlanId: input.directorPlanId,
      directorShotId: shot.directorShotId,
      ...products,
      locationId,
      characterIds: characters,
    },
    executionRequirement: requirement,
    necessity: necessity.necessity,
    necessityEvidence: necessity.evidence,
    supportedActionEntryIds: actionEntryIds,
    supportedActionPhaseIds: shotPhaseIds(shot, input.motionScenePlan),
    supportedStateDeltaIndexes: shot.supportedStateDeltaIndexes ?? [...input.directorDirection.contextualTreatment.supportedStateDeltaIndexes],
    servedAudienceInformation: shot.servedAudienceInformation ?? [...shot.newAudienceInformation],
    inheritedContinuity: {
      locationId,
      characterIds: characters,
      productAuthorityIds: products.productAuthorityIds,
    },
    retryOwnership: {
      retryScope: "GENERATION_UNIT" as const,
      siblingUnitsRemainValid: true as const,
      sceneRetryDoesNotRegenerateEveryShot: true as const,
    },
  };
  const fingerprint = computeAiStoryGenerationUnitFingerprint(withoutId);
  return AiStoryGenerationUnitSchema.parse({
    ...withoutId,
    generationUnitId: deterministicUuidFromFingerprint("ai-story-generation-unit", fingerprint),
    fingerprint,
  });
}

export function compileAiStoryGenerationPlan(input: AiStoryGenerationPlanInput): AiStoryGenerationPlan {
  const shots = [...input.directorDirection.shots].sort((a, b) => a.order - b.order);
  const units = shots.map((shot) => compileUnit(input, shot));
  const withoutId = {
    contractVersion: AI_STORY_GENERATION_PLAN_CONTRACT_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    sceneId: input.scene.sceneId,
    sceneVersionId: input.scene.sceneVersionId,
    directorPlanId: input.directorPlanId,
    units,
  };
  const fingerprint = computeAiStoryGenerationPlanFingerprint(withoutId);
  return AiStoryGenerationPlanSchema.parse({
    ...withoutId,
    generationPlanId: deterministicUuidFromFingerprint("ai-story-generation-plan", fingerprint),
    fingerprint,
  });
}

export function validateAiStoryGenerationPlan(plan: AiStoryGenerationPlan, input: AiStoryGenerationPlanInput): AiStoryGenerationUnitIssue[] {
  const issues: AiStoryGenerationUnitIssue[] = [...evaluateIntraSceneShotProgression(input.directorDirection)];
  const shots = [...input.directorDirection.shots].sort((a, b) => a.order - b.order);
  const shotIds = shots.map((shot) => shot.directorShotId);
  const activeUnits = [...plan.units].sort((a, b) => a.order - b.order);
  const covered = activeUnits.map((unit) => unit.directorShotId);
  const missing = shotIds.filter((id) => !covered.includes(id));
  if (missing.length) {
    issues.push({ gate: "GENERATION_UNIT_COVERAGE_GATE", severity: "BLOCK", message: `Director Shot ${missing.join(", ")} has no Generation Unit` });
  }
  const counts = new Map<string, number>();
  for (const unit of activeUnits) counts.set(unit.directorShotId, (counts.get(unit.directorShotId) ?? 0) + 1);
  for (const [shotId, count] of counts) {
    if (count > 1) issues.push({ gate: "GENERATION_UNIT_COVERAGE_GATE", severity: "BLOCK", message: `Director Shot ${shotId} is bound to ${count} active Generation Units without an explicit composite model` });
  }
  const orphan = covered.filter((id) => !shotIds.includes(id));
  if (orphan.length) {
    issues.push({ gate: "GENERATION_UNIT_COVERAGE_GATE", severity: "BLOCK", message: `Generation Unit references orphan Director Shot ${orphan.join(", ")}` });
  }
  const scriptActionIds = new Set(input.scene.sourceScriptEntryIds);
  const products = productAuthorityOf(input.scene);
  const characters = characterIdsOf(input.scene);
  const locationId = input.scene.locationBinding.id;
  for (const unit of activeUnits) {
    const shot = shots.find((candidate) => candidate.directorShotId === unit.directorShotId);
    if (!shot || unit.directorShotIds.length !== 1 || unit.directorShotIds[0] !== shot.directorShotId) {
      issues.push({ gate: "GENERATION_UNIT_BINDING_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} does not bind exactly one Director Shot` });
      continue;
    }
    if (unit.sceneId !== input.scene.sceneId || unit.sceneVersionId !== input.scene.sceneVersionId || unit.sourceAuthority.sceneFingerprint !== input.scene.fingerprint) {
      issues.push({ gate: "GENERATION_UNIT_BINDING_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} does not bind exact frozen Scene authority` });
    }
    if (unit.supportedActionEntryIds.some((id) => !scriptActionIds.has(id))) {
      issues.push({ gate: "SCRIPT_ACTION_SUPPORT_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} invents Script action outside frozen Scene truth` });
    }
    if (!same(unit.sourceAuthority.productAuthorityIds, products.productAuthorityIds)
      || !same(unit.sourceAuthority.productSourceAssetIds, products.productSourceAssetIds)
      || !same(unit.sourceAuthority.productContentHashes, products.productContentHashes)
      || !same(unit.inheritedContinuity.productAuthorityIds, products.productAuthorityIds)) {
      issues.push({ gate: "PRODUCT_AUTHORITY_BINDING_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} does not inherit exact Product authority` });
    }
    if (unit.inheritedContinuity.locationId !== locationId || unit.sourceAuthority.locationId !== locationId) {
      if (!input.scene.discontinuity) {
        issues.push({ gate: "LOCATION_CONTINUITY_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} resets Location without Scene discontinuity authority` });
      }
    }
    if (!same(unit.inheritedContinuity.characterIds, characters) || !same(unit.sourceAuthority.characterIds, characters)) {
      issues.push({ gate: "CAST_BINDING_GATE", severity: "BLOCK", message: `Generation Unit ${unit.generationUnitId} resets Character continuity without Scene authority` });
    }
  }
  return issues;
}

export function validateCompiledAiStoryGenerationPlan(input: AiStoryGenerationPlanInput): { plan: AiStoryGenerationPlan; issues: AiStoryGenerationUnitIssue[] } {
  const plan = compileAiStoryGenerationPlan(input);
  return { plan, issues: validateAiStoryGenerationPlan(plan, input) };
}
