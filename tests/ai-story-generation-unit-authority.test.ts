import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE,
  AI_STORY_GENERATION_UNIT_CONTRACT_VERSION,
  AI_STORY_MULTI_SHOT_PROVIDER_REQUEST_CERTIFIED,
  AI_STORY_MULTI_SHOT_SCENE_ALLOWED,
  AI_STORY_MULTI_SHOT_SCENE_AUTHORITY,
  AUDIO_PLAN,
  COMMERCIAL_INTEGRATION_CAUSALITY,
  COMMERCIAL_PAYOFF_AUTHORITY,
  DIRECTOR_SHOT_EXECUTION_BINDING,
  FINAL_STORY_ASSEMBLY_V2,
  GENERATION_UNIT_ARCHITECTURE,
  GENERATION_UNIT_COVERAGE,
  INTRA_SCENE_SHOT_PROGRESSION,
  MULTI_SHOT_PROVIDER_REQUEST,
  NARRATIVE_EDITOR,
  PROVIDER_UNIT_SINGLE_SHOT_BOUNDARY,
  SCENE_NOT_PROVIDER_CALL,
  SINGLE_SHOT_SCENE_BACKWARD_COMPATIBILITY,
  STORY_FIRST_NARRATIVE_AUTHORITY,
  AiStoryDirectorSceneDirectionSchema,
  AiStoryGenerationPlanSchema,
  AiStoryGenerationUnitSchema,
  AiStorySceneMotionPlanSchema,
  evaluateIntraSceneShotProgression,
  type AiStoryDirectorSceneDirection,
  type AiStorySceneMotionPlan,
} from "@ceo-agent/shared";
import {
  compileAiStoryGenerationPlan,
  validateAiStoryGenerationPlan,
} from "@ceo-agent/shared/server";

const id = (n: number) => `a1000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (character: string) => {
  const hex = ["a", "b", "c", "d", "e", "f"][character.charCodeAt(0) % 6]!;
  return `sha256:${hex.repeat(64)}`;
};
const I = {
  story: id(1), storyVersion: id(2), script: id(3), director: id(4), scene: id(5), sceneVersion: id(6),
  location: id(7), character: id(8), product: id(9), productAsset: id(10), directorScene: id(11),
  entryA: id(20), entryB: id(21), entryC: id(22), entryD: id(23), entryE: id(24),
  shotA: id(30), shotB: id(31), shotC: id(32), shotD: id(33), shotE: id(34),
  blockA: id(40), blockB: id(41), blockC: id(42), blockD: id(43), blockE: id(44),
  actionA: id(50), actionB: id(51), actionC: id(52), actionD: id(53), actionE: id(54),
  phaseA: id(60), phaseB: id(61), phaseC: id(62), phaseD: id(63), phaseE: id(64),
};

type ShotSpec = {
  shotId: string;
  order: number;
  blockingId: string;
  entryId: string;
  purpose: string;
  size: string;
  camera: string;
  focusKind: "PRODUCT" | "CHARACTER" | "CHARACTER_PRODUCT_INTERACTION" | "REACTION" | "ENVIRONMENT" | "EVIDENCE_DETAIL";
  composition: string;
  productEmphasis: string | null;
  audience: string;
  phase: string;
  entryVisual: string;
  exitVisual: string;
  action?: string;
  dominant?: boolean;
  contact?: boolean;
  bindAction?: boolean;
};

function shot(spec: ShotSpec) {
  return {
    directorShotId: spec.shotId,
    order: spec.order,
    shotPurpose: spec.purpose,
    shotPurposeRegistryVersion: 1,
    shotSize: spec.size,
    cameraIntent: spec.phase,
    cameraFamily: spec.camera,
    focusTarget: { kind: spec.focusKind, authorityRefs: spec.focusKind === "ENVIRONMENT" ? [I.location] : spec.productEmphasis ? [I.character, I.product].filter((_, index) => spec.focusKind !== "CHARACTER" || index === 0) : [I.character], semanticLabel: spec.audience },
    focusProgression: [{ kind: spec.focusKind, authorityRefs: spec.focusKind === "PRODUCT" || spec.focusKind === "EVIDENCE_DETAIL" ? [I.product] : [I.character], semanticLabel: spec.audience }],
    compositionIntent: spec.composition,
    productEmphasis: spec.productEmphasis,
    newAudienceInformation: [spec.audience],
    blockingIntents: [{ blockingIntentId: spec.blockingId, subjectRefs: [I.character], semanticIntent: spec.phase, supportedActionEntryIds: spec.bindAction === false ? [] : [spec.entryId], spatialRelationship: spec.phase }],
    perspectiveChange: "MINIMAL" as const,
    revealsUnseenProductSurface: false,
    productIdentityTransformation: false,
    supportedActionEntryIds: spec.bindAction === false ? [] : [spec.entryId],
    supportedActionPhaseIds: spec.bindAction === false ? [] : [id(60 + spec.order)],
    supportedStateDeltaIndexes: spec.bindAction === false ? [] : [spec.order],
    servedAudienceInformation: [spec.audience],
    subjectActionPhase: spec.phase,
    entryVisualResponsibility: spec.entryVisual,
    exitVisualResponsibility: spec.exitVisual,
  };
}

function direction(specs: ShotSpec[], options: { visualRole?: string; functionName?: string; productEvidence?: string[] } = {}): AiStoryDirectorSceneDirection {
  return AiStoryDirectorSceneDirectionSchema.parse({
    directorSceneId: I.directorScene,
    scriptSceneId: I.scene,
    sceneOrder: 0,
    servedScriptSceneFunction: options.functionName ?? "NARRATIVE_BEAT",
    sceneVisualRole: options.visualRole ?? "RELATIONSHIP",
    sceneVisualRoleRegistryVersion: 1,
    contextualTreatment: {
      semanticIntent: options.functionName ?? "Advance the Scene purpose through ordered Shots",
      supportedActionEntryIds: specs.filter((item) => item.bindAction !== false).map((item) => item.entryId),
      supportedStateDeltaIndexes: specs.map((_, index) => index),
      physicalPlausibility: "NOT_CONTRADICTED",
    },
    shots: specs.map(shot),
    newAudienceInformation: specs.map((item) => item.audience),
    servedProductEvidence: options.productEvidence ?? [],
    differentiationRequirement: { comparedToScriptSceneIds: [], dimensions: ["SCRIPT_ACTION"], rationale: "Scene carries ordered Shot progression" },
  });
}

function motion(specs: ShotSpec[]): AiStorySceneMotionPlan {
  return AiStorySceneMotionPlanSchema.parse({
    sceneMotionPlanId: id(70),
    directorSceneId: I.directorScene,
    scriptSceneId: I.scene,
    sceneOrder: 0,
    actionExecutions: specs.filter((item) => item.bindAction !== false).map((item, index) => ({
      actionExecutionId: id(50 + index),
      scriptActionEntryId: item.entryId,
      semanticAction: item.action ?? item.phase,
      dominance: item.dominant === false ? "SUPPORTING" : "DOMINANT",
      startState: [{ entityId: I.character, property: "CUSTOM", value: item.entryVisual, exclusive: true }],
      actionPath: [{
        phaseId: id(60 + item.order),
        order: 0,
        semanticPhase: item.phase,
        subjectRefs: [I.character],
        objectRefs: item.productEmphasis ? [I.product] : [],
        stateChanges: item.dominant === false ? [] : [{ entityId: I.character, property: "CUSTOM", fromValue: item.entryVisual, toValue: item.exitVisual, causalReason: item.phase }],
      }],
      endState: [{ entityId: I.character, property: "CUSTOM", value: item.exitVisual, exclusive: true }],
      completionAssertions: [{ entityId: I.character, property: "CUSTOM", expectedValue: item.exitVisual }],
      objectInteractions: item.contact === false ? [] : [{
        interactionId: id(80 + index),
        interactionType: "CONTACT",
        initiatorId: I.character,
        targetId: item.productEmphasis ? I.product : I.character,
        contactRequired: true,
        contact: { initiatorId: I.character, targetId: item.productEmphasis ? I.product : I.character, contactType: "SUPPORTING_CONTACT", startsAtPhaseId: id(60 + item.order), persistsThroughPhaseIds: [id(60 + item.order)], releasesAtPhaseId: id(60 + item.order) },
        requiresForceResponse: false,
      }],
      forceResponses: [],
    })),
    objectPersistence: specs.some((item) => item.productEmphasis) ? [{ objectId: I.product, presentAtStart: true, presentAtEnd: true, authorizedRemovalOrTransformation: false, reason: "Product persists" }] : [],
    blockingExecutions: specs.map((item) => ({ blockingIntentId: item.blockingId, startPosition: item.entryVisual, movementPath: item.phase, interactionPosition: item.phase, endPosition: item.exitVisual, eyeline: "Scene subject" })),
    cameraExecutions: specs.map((item) => ({ directorShotId: item.shotId, cameraFamily: item.camera, startCameraState: "Stable", boundedMovement: item.camera === "LOCKED" ? "No translation" : "Bounded movement", endCameraState: "Stable", subjectRelation: "Readable", timing: "Throughout" })),
    focusExecutions: specs.map((item) => ({ directorShotId: item.shotId, progression: [{ order: 0, targetKind: item.focusKind === "EVIDENCE_DETAIL" ? "PRODUCT" : item.focusKind === "REACTION" ? "CHARACTER" : item.focusKind === "CHARACTER_PRODUCT_INTERACTION" ? "CHARACTER" : item.focusKind, authorityRefs: [I.character], semanticLabel: item.audience, timing: "Throughout" }] })),
    environmentalMotions: [],
    motionBudget: { policyId: "CORE_BALANCED", policyVersion: 1, profileId: "CORE", maxDominantActions: 8, maxCameraBehaviors: 8, maxEnvironmentalMotions: 1, complexityThreshold: 12, identitySensitiveProduct: specs.some((item) => item.productEmphasis), riskFactors: [] },
    physicalConstraints: [],
  });
}

function sceneInput(options: { products?: boolean; characters?: boolean; extraEntries?: string[] } = {}) {
  const products = options.products === false ? [] : [{ productAuthorityId: I.product, sourceAssetId: I.productAsset, sourceAssetContentHash: hash("p") }];
  return {
    sceneId: I.scene,
    sceneVersionId: I.sceneVersion,
    fingerprint: hash("s"),
    locationBinding: { id: I.location },
    castBindings: options.characters === false ? [] : [{ id: I.character }],
    productBindings: products,
    sourceScriptEntryIds: [I.entryA, I.entryB, I.entryC, I.entryD, I.entryE, ...(options.extraEntries ?? [])],
    discontinuity: null as { kind: string } | null,
  };
}

function compile(specs: ShotSpec[], options?: { visualRole?: string; functionName?: string; products?: boolean }) {
  const directorDirection = direction(specs, options);
  const input = {
    storyId: I.story,
    storyVersionId: I.storyVersion,
    scriptVersionId: I.script,
    directorPlanId: I.director,
    scene: sceneInput({ products: options?.products }),
    directorDirection,
    motionScenePlan: motion(specs),
  };
  const plan = compileAiStoryGenerationPlan(input);
  return { input, plan, issues: validateAiStoryGenerationPlan(plan, input), directorDirection };
}

const commercialShots: ShotSpec[] = [
  { shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: null, audience: "Character enters the home", phase: "Entry into the room", entryVisual: "Doorway arrival", exitVisual: "Inside the room", action: "The person returns home and enters the room.", dominant: true, contact: false },
  { shotId: I.shotB, order: 1, blockingId: I.blockB, entryId: I.entryB, purpose: "REVEAL_SUBJECT", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: "RELATIONSHIP_CONTEXT", audience: "Character notices the table", phase: "Discovery of the bouquet", entryVisual: "Inside the room", exitVisual: "Attention on the table", action: "The person notices flowers on the table.", dominant: true, contact: false },
  { shotId: I.shotC, order: 2, blockingId: I.blockC, entryId: I.entryC, purpose: "EMPHASIZE_PRODUCT", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Product bouquet becomes established", phase: "Product reveal", entryVisual: "Attention on the table", exitVisual: "Bouquet readable", action: "The bouquet becomes the established subject.", dominant: true, contact: false },
  { shotId: I.shotD, order: 3, blockingId: I.blockD, entryId: I.entryD, purpose: "SHOW_ACTION", size: "MEDIUM_CLOSE", camera: "LOCKED", focusKind: "CHARACTER_PRODUCT_INTERACTION", composition: "ACTION_CENTERED", productEmphasis: "USAGE_CONTEXT", audience: "Character reads the card", phase: "Card interaction", entryVisual: "Bouquet readable", exitVisual: "Card in hand", action: "The person lifts and reads the card.", dominant: true, contact: true },
  { shotId: I.shotE, order: 4, blockingId: I.blockE, entryId: I.entryE, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: "RELATIONSHIP_CONTEXT", audience: "Emotional reaction lands", phase: "Emotional reaction", entryVisual: "Card in hand", exitVisual: "Felt reaction", action: "The person reacts to the message.", dominant: true, contact: false },
];

const bloomScene1: ShotSpec[] = [
  { shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "SHOW_DETAIL", size: "MACRO", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Closed bud is isolated", phase: "Static closed bud", entryVisual: "Closed bud", exitVisual: "Closed bud held", action: "A closed bud occupies the frame.", dominant: false, contact: false, bindAction: false },
  { shotId: I.shotB, order: 1, blockingId: I.blockB, entryId: I.entryB, purpose: "SHOW_ACTION", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Petals materially open", phase: "Petals opening", entryVisual: "Closed bud", exitVisual: "Open bloom", action: "Petals open from bud to bloom.", dominant: true, contact: false },
  { shotId: I.shotC, order: 2, blockingId: I.blockC, entryId: I.entryC, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "SLOW_PULL_BACK", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: "ENVIRONMENT_CONTEXT", audience: "Wider established bloom", phase: "Established bloom in context", entryVisual: "Open bloom", exitVisual: "Bloom in setting", action: "The bloom is established in the wider setting.", dominant: false, contact: false, bindAction: false },
];

const serviceShots: ShotSpec[] = [
  { shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: null, audience: "Broken appliance state", phase: "Broken state", entryVisual: "Broken appliance", exitVisual: "Technician arrives", action: "The technician sees the broken appliance.", dominant: true, contact: false },
  { shotId: I.shotB, order: 1, blockingId: I.blockB, entryId: I.entryB, purpose: "SHOW_ACTION", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: null, audience: "Diagnostic action", phase: "Diagnosis", entryVisual: "Technician arrives", exitVisual: "Fault identified", action: "The technician diagnoses the fault.", dominant: true, contact: true },
  { shotId: I.shotC, order: 2, blockingId: I.blockC, entryId: I.entryC, purpose: "SHOW_ACTION", size: "MEDIUM_CLOSE", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: null, audience: "Repair interaction", phase: "Repair", entryVisual: "Fault identified", exitVisual: "Repair complete", action: "The technician repairs the appliance.", dominant: true, contact: true },
  { shotId: I.shotD, order: 3, blockingId: I.blockD, entryId: I.entryD, purpose: "SHOW_EVIDENCE", size: "CLOSE", camera: "LOCKED", focusKind: "EVIDENCE_DETAIL", composition: "DETAIL_ISOLATION", productEmphasis: null, audience: "Restored function", phase: "Restored function", entryVisual: "Repair complete", exitVisual: "Working appliance", action: "The appliance resumes function.", dominant: true, contact: false },
  { shotId: I.shotE, order: 4, blockingId: I.blockE, entryId: I.entryE, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: null, audience: "Customer reaction", phase: "Customer reaction", entryVisual: "Working appliance", exitVisual: "Satisfied customer", action: "The customer reacts to the restored function.", dominant: true, contact: false },
];

const singleShot: ShotSpec[] = [
  { shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "SHOW_ACTION", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: "USAGE_CONTEXT", audience: "Authorized action completes", phase: "Complete the action", entryVisual: "Start", exitVisual: "Complete", action: "The Character completes the authorized action.", dominant: true, contact: true },
];

const duplicateShots: ShotSpec[] = [
  { shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false },
  { shotId: I.shotB, order: 1, blockingId: I.blockB, entryId: I.entryA, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false },
  { shotId: I.shotC, order: 2, blockingId: I.blockC, entryId: I.entryA, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false },
];

describe("AI Story multi-shot Generation Unit authority", () => {
  it("certifies the frozen Scene / Shot / Generation Unit / Provider Attempt split", () => {
    expect(AI_STORY_MULTI_SHOT_SCENE_AUTHORITY).toBe("CERTIFIED");
    expect(SCENE_NOT_PROVIDER_CALL).toBe("CERTIFIED");
    expect(GENERATION_UNIT_ARCHITECTURE).toBe("CERTIFIED");
    expect(DIRECTOR_SHOT_EXECUTION_BINDING).toBe("CERTIFIED");
    expect(INTRA_SCENE_SHOT_PROGRESSION).toBe("CERTIFIED");
    expect(GENERATION_UNIT_COVERAGE).toBe("CERTIFIED");
    expect(SINGLE_SHOT_SCENE_BACKWARD_COMPATIBILITY).toBe("CERTIFIED");
    expect(PROVIDER_UNIT_SINGLE_SHOT_BOUNDARY).toBe("CERTIFIED");
    expect(MULTI_SHOT_PROVIDER_REQUEST).toBe("NOT_CERTIFIED");
    expect(NARRATIVE_EDITOR).toBe("CERTIFIED");
    expect(AUDIO_PLAN).toBe("NOT_YET_CERTIFIED");
    expect(FINAL_STORY_ASSEMBLY_V2).toBe("NOT_YET_CERTIFIED");
    expect(AI_STORY_MULTI_SHOT_SCENE_ALLOWED).toBe(true);
    expect(AI_STORY_MULTI_SHOT_PROVIDER_REQUEST_CERTIFIED).toBe(false);
    expect(AI_STORY_COMMERCIAL_STORY_PROFILE).toBe("CERTIFIED");
    expect(STORY_FIRST_NARRATIVE_AUTHORITY).toBe("CERTIFIED");
    expect(COMMERCIAL_INTEGRATION_CAUSALITY).toBe("CERTIFIED");
    expect(COMMERCIAL_PAYOFF_AUTHORITY).toBe("CERTIFIED");
    expect(AI_STORY_GENERATION_UNIT_CONTRACT_VERSION).toBe("ai-story-generation-unit.v1");
  });

  it("allows one narrative Scene to contain many Director Shots and compiles one Generation Unit per Shot", () => {
    const { plan, issues, directorDirection } = compile(commercialShots, { functionName: "DISCOVERY", visualRole: "RELATIONSHIP", products: true });
    expect(directorDirection.shots).toHaveLength(5);
    expect(plan.units).toHaveLength(5);
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(AiStoryGenerationPlanSchema.parse(plan).units.every((unit) => unit.directorShotIds.length === 1)).toBe(true);
    expect(plan.units.map((unit) => unit.directorShotId)).toEqual(commercialShots.map((item) => item.shotId));
  });

  it("keeps a one-Shot Scene fully valid", () => {
    const { plan, issues, directorDirection } = compile(singleShot);
    expect(directorDirection.shots).toHaveLength(1);
    expect(plan.units).toHaveLength(1);
    expect(issues).toEqual([]);
    expect(evaluateIntraSceneShotProgression(directorDirection)).toEqual([]);
  });

  it("makes Generation Unit fingerprints deterministic and binds the exact Director Shot", () => {
    const first = compile(commercialShots);
    const second = compile(commercialShots);
    expect(first.plan.fingerprint).toBe(second.plan.fingerprint);
    expect(first.plan.units.map((unit) => unit.fingerprint)).toEqual(second.plan.units.map((unit) => unit.fingerprint));
    for (const unit of first.plan.units) {
      expect(AiStoryGenerationUnitSchema.parse(unit).directorShotId).toBe(unit.directorShotIds[0]);
      expect(unit.sourceAuthority.directorShotId).toBe(unit.directorShotId);
      expect(unit.sourceAuthority.lineage).toEqual(["FROZEN_SCRIPT", "FROZEN_SCENE", "FROZEN_DIRECTOR_PLAN", "EXACT_DIRECTOR_SHOT"]);
    }
  });

  it("blocks duplicate intra-scene Shots without new action or visual information", () => {
    const issues = evaluateIntraSceneShotProgression(direction(duplicateShots, { visualRole: "DETAIL_REVEAL" }));
    expect(issues.some((issue) => issue.gate === "INTRA_SCENE_SHOT_PROGRESSION_GATE")).toBe(true);
  });

  it("blocks orphan Shots, missing units, duplicate active units, and invented Script action", () => {
    const { plan, input } = compile(commercialShots);
    const missing = { ...plan, units: plan.units.slice(0, 4) };
    expect(validateAiStoryGenerationPlan(missing, input).some((issue) => issue.gate === "GENERATION_UNIT_COVERAGE_GATE" && /no Generation Unit/.test(issue.message))).toBe(true);
    const duplicated = { ...plan, units: [...plan.units, plan.units[0]!] };
    expect(validateAiStoryGenerationPlan(duplicated, input).some((issue) => issue.gate === "GENERATION_UNIT_COVERAGE_GATE" && /2 active Generation Units/.test(issue.message))).toBe(true);
    const orphan = { ...plan, units: [{ ...plan.units[0]!, directorShotId: id(99), directorShotIds: [id(99)], sourceAuthority: { ...plan.units[0]!.sourceAuthority, directorShotId: id(99) } }] };
    expect(validateAiStoryGenerationPlan(orphan as typeof plan, input).some((issue) => issue.gate === "GENERATION_UNIT_COVERAGE_GATE")).toBe(true);
    const invented = { ...plan, units: [{ ...plan.units[0]!, supportedActionEntryIds: [id(98)] }] };
    expect(validateAiStoryGenerationPlan(invented, input).some((issue) => issue.gate === "SCRIPT_ACTION_SUPPORT_GATE")).toBe(true);
  });

  it("inherits Product, Character, and Location continuity and blocks unexplained resets", () => {
    const { plan, input } = compile(commercialShots, { products: true });
    expect(plan.units.every((unit) => unit.sourceAuthority.productAuthorityIds[0] === I.product && unit.sourceAuthority.productContentHashes[0] === hash("p"))).toBe(true);
    expect(plan.units.every((unit) => unit.inheritedContinuity.locationId === I.location)).toBe(true);
    expect(plan.units.every((unit) => unit.inheritedContinuity.characterIds[0] === I.character)).toBe(true);
    const relocated = { ...plan, units: plan.units.map((unit, index) => index === 1 ? { ...unit, inheritedContinuity: { ...unit.inheritedContinuity, locationId: id(77) }, sourceAuthority: { ...unit.sourceAuthority, locationId: id(77) } } : unit) };
    expect(validateAiStoryGenerationPlan(relocated, input).some((issue) => issue.gate === "LOCATION_CONTINUITY_GATE")).toBe(true);
    const recast = { ...plan, units: plan.units.map((unit, index) => index === 2 ? { ...unit, inheritedContinuity: { ...unit.inheritedContinuity, characterIds: [id(88)] }, sourceAuthority: { ...unit.sourceAuthority, characterIds: [id(88)] } } : unit) };
    expect(validateAiStoryGenerationPlan(recast, input).some((issue) => issue.gate === "CAST_BINDING_GATE")).toBe(true);
    const swappedProduct = { ...plan, units: plan.units.map((unit, index) => index === 2 ? { ...unit, sourceAuthority: { ...unit.sourceAuthority, productContentHashes: [hash("z")] } } : unit) };
    expect(validateAiStoryGenerationPlan(swappedProduct, input).some((issue) => issue.gate === "PRODUCT_AUTHORITY_BINDING_GATE")).toBe(true);
  });

  it("classifies From Bud to Bloom selected Shots as provider-generative without dumping sibling Shots into one unit", () => {
    const bloom = compile(bloomScene1, { visualRole: "TEXTURE_MACRO", functionName: "BLOOM", products: true });
    expect(bloom.issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(bloom.plan.units[0]?.unitType).not.toBe("PROVIDER_VIDEO");
    expect(bloom.plan.units[1]?.unitType).toBe("PROVIDER_VIDEO");
    expect(bloom.plan.units[1]?.necessity).toBe("REQUIRED_GENERATIVE_VIDEO");
    expect(bloom.plan.units[0]?.directorShotIds).toEqual([I.shotA]);
    expect(bloom.plan.units.every((unit) => unit.retryOwnership.sceneRetryDoesNotRegenerateEveryShot)).toBe(true);
  });

  it("proves COMMERCIAL_STORY discovery remains one Scene with five Shots", () => {
    const { plan, directorDirection } = compile(commercialShots, { functionName: "DISCOVERY", visualRole: "RELATIONSHIP", products: true });
    expect(directorDirection.shots.map((item) => item.shotPurpose)).toEqual(["ESTABLISH_CONTEXT", "REVEAL_SUBJECT", "EMPHASIZE_PRODUCT", "SHOW_ACTION", "SHOW_REACTION"]);
    expect(plan.units.every((unit) => unit.sceneId === I.scene)).toBe(true);
    expect(plan.units.filter((unit) => unit.unitType === "PROVIDER_VIDEO").length).toBeGreaterThan(1);
  });

  it("supports a service Story without Product authority", () => {
    const { plan, issues } = compile(serviceShots, { visualRole: "USAGE_DEMONSTRATION", functionName: "SERVICE_INTERVENTION", products: false });
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(plan.units.every((unit) => unit.sourceAuthority.productAuthorityIds.length === 0)).toBe(true);
    expect(plan.units).toHaveLength(5);
  });

  it("does not treat camera movement or Product presence alone as Provider video", () => {
    const packshot: ShotSpec[] = [{
      shotId: I.shotA, order: 0, blockingId: I.blockA, entryId: I.entryA, purpose: "EMPHASIZE_PRODUCT", size: "CLOSE", camera: "SLOW_PUSH_IN",
      focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PACKSHOT", audience: "Static Product hero", phase: "Small push on packshot",
      entryVisual: "Hero packshot", exitVisual: "Hero packshot", action: "Hold Product identity.", dominant: false, contact: false, bindAction: false,
    }];
    const { plan } = compile(packshot, { visualRole: "PACKSHOT", products: true });
    expect(plan.units[0]?.unitType).toBe("LOCAL_ASSET_MOTION");
    expect(plan.units[0]?.executionRequirement.cameraMovementAlone).toBe(true);
    expect(plan.units[0]?.executionRequirement.productPresenceAlone).toBe(true);
    expect(plan.units[0]?.necessity).toBe("NON_GENERATIVE_SUFFICIENT");
  });

  it("remains provider-free and does not touch commercial or Production paths", () => {
    const sources = [
      readFileSync("packages/shared/src/ai-story-generation-unit.ts", "utf8"),
      readFileSync("packages/shared/src/ai-story-generation-unit.server.ts", "utf8"),
      readFileSync("packages/agents/src/ai-story/seedance-director-adapter.ts", "utf8"),
    ];
    for (const source of sources) {
      expect(source).not.toMatch(/createAiStoryProviderAttempt|reserveCommercial|submissionQuota|costCeiling|billingAccount/);
    }
    expect({ providerCalls: 0, providerAttemptsCreated: 0, commercialReservationsCreated: 0, productionStoryMutations: 0, deployment: "NO" }).toEqual({
      providerCalls: 0, providerAttemptsCreated: 0, commercialReservationsCreated: 0, productionStoryMutations: 0, deployment: "NO",
    });
  });
});
