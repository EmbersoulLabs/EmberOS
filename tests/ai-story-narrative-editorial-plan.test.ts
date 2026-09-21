import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_ASSEMBLY_V1_UNCHANGED,
  AI_STORY_COMMERCIAL_STORY_PROFILE,
  AI_STORY_NARRATIVE_EDITOR_AUTHORITY,
  AI_STORY_NARRATIVE_EDITOR_DISPATCHES_PROVIDER,
  AI_STORY_NARRATIVE_EDITOR_EXECUTES_MEDIA,
  AI_STORY_NARRATIVE_EDITOR_OWNS_BILLING,
  AI_STORY_NARRATIVE_EDITOR_OWNS_STORY_TRUTH,
  AI_STORY_NARRATIVE_EDITOR_PERSISTENCE,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V3,
  AUDIO_PLAN,
  AUDIO_PLAN_EXECUTION,
  COMMERCIAL_INTEGRATION_CAUSALITY,
  COMMERCIAL_PAYOFF_AUTHORITY,
  COMMERCIAL_PAYOFF_EDITING_AUTHORITY,
  CUT_ON_ACTION_AUTHORITY,
  EDITORIAL_CAUSAL_ORDER,
  EDITORIAL_DUPLICATION_PROTECTION,
  EDITORIAL_RHYTHM_AUTHORITY,
  EDITORIAL_TIMELINE_AUTHORITY,
  FINAL_STORY_ASSEMBLY_V2,
  FINAL_STORY_ASSEMBLY_V2_EXECUTION,
  GENERATION_UNIT_TO_EDITORIAL_BINDING,
  NARRATIVE_EDITOR,
  NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY,
  REACTION_TIMING_AUTHORITY,
  READY_FOR_PRODUCTION_MERGE_NARRATIVE_EDITOR,
  READY_FOR_PROVIDER_FREE_REVIEW_NARRATIVE_EDITOR,
  SCENE_BRIDGE_AUTHORITY,
  STORY_FIRST_NARRATIVE_AUTHORITY,
  AiStoryDirectorSceneDirectionSchema,
  AiStoryNarrativeEditorialPlanSchema,
  AiStorySceneMotionPlanSchema,
  assertAiStoryNarrativeEditorialPlanTransition,
  projectLegacyStoryToNarrativeEditorialPlanCompatibility,
  type AiStoryDirectorSceneDirection,
  type AiStoryNarrativeEditorialIssue,
  type AiStoryNarrativeEditorialPlan,
  type AiStoryNarrativeEditorialSceneInput,
  type AiStorySceneMotionPlan,
} from "@ceo-agent/shared";
import {
  compileAiStoryGenerationPlan,
  compileAiStoryNarrativeEditorialPlan,
  compileAndValidateAiStoryNarrativeEditorialPlan,
  validateAiStoryNarrativeEditorialPlan,
} from "@ceo-agent/shared/server";

const id = (n: number) => `a1000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (character: string) => {
  const hex = ["a", "b", "c", "d", "e", "f"][character.charCodeAt(0) % 6]!;
  return `sha256:${hex.repeat(64)}`;
};

const I = {
  story: id(1), storyVersion: id(2), script: id(3), director: id(4),
  location: id(7), location2: id(17), character: id(8), product: id(9), productAsset: id(10),
  createdBy: id(99),
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

type SceneCtx = {
  scene: string;
  sceneVersion: string;
  directorScene: string;
  sceneOrder: number;
  location: string;
  fingerprint: string;
  visualRole?: string;
  functionName?: string;
  products?: boolean;
  characters?: boolean;
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

function direction(specs: ShotSpec[], ctx: SceneCtx): AiStoryDirectorSceneDirection {
  return AiStoryDirectorSceneDirectionSchema.parse({
    directorSceneId: ctx.directorScene,
    scriptSceneId: ctx.scene,
    sceneOrder: ctx.sceneOrder,
    servedScriptSceneFunction: ctx.functionName ?? "NARRATIVE_BEAT",
    sceneVisualRole: ctx.visualRole ?? "RELATIONSHIP",
    sceneVisualRoleRegistryVersion: 1,
    contextualTreatment: {
      semanticIntent: ctx.functionName ?? "Advance the Scene purpose through ordered Shots",
      supportedActionEntryIds: specs.filter((item) => item.bindAction !== false).map((item) => item.entryId),
      supportedStateDeltaIndexes: specs.map((_, index) => index),
      physicalPlausibility: "NOT_CONTRADICTED",
    },
    shots: specs.map(shot),
    newAudienceInformation: specs.map((item) => item.audience),
    servedProductEvidence: ctx.products === false ? [] : specs.some((item) => item.productEmphasis) ? ["Product remains the authorized subject"] : [],
    differentiationRequirement: { comparedToScriptSceneIds: [], dimensions: ["SCRIPT_ACTION"], rationale: "Scene carries ordered Shot progression" },
  });
}

function motion(specs: ShotSpec[], ctx: SceneCtx): AiStorySceneMotionPlan {
  return AiStorySceneMotionPlanSchema.parse({
    sceneMotionPlanId: id(70 + ctx.sceneOrder),
    directorSceneId: ctx.directorScene,
    scriptSceneId: ctx.scene,
    sceneOrder: ctx.sceneOrder,
    actionExecutions: specs.filter((item) => item.bindAction !== false).map((item, index) => ({
      actionExecutionId: id(50 + ctx.sceneOrder * 10 + index),
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
        interactionId: id(80 + ctx.sceneOrder * 10 + index),
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

function sceneInput(specs: ShotSpec[], ctx: SceneCtx) {
  return {
    sceneId: ctx.scene,
    sceneVersionId: ctx.sceneVersion,
    fingerprint: ctx.fingerprint,
    locationBinding: { id: ctx.location },
    castBindings: ctx.characters === false ? [] : [{ id: I.character }],
    productBindings: ctx.products === false ? [] : [{ productAuthorityId: I.product, sourceAssetId: I.productAsset, sourceAssetContentHash: hash("p") }],
    sourceScriptEntryIds: specs.map((item) => item.entryId),
    discontinuity: null as { kind: string } | null,
  };
}

function editorialScene(specs: ShotSpec[], ctx: SceneCtx): AiStoryNarrativeEditorialSceneInput {
  const directorDirection = direction(specs, ctx);
  const motionScenePlan = motion(specs, ctx);
  const generationPlan = compileAiStoryGenerationPlan({
    storyId: I.story,
    storyVersionId: I.storyVersion,
    scriptVersionId: I.script,
    directorPlanId: I.director,
    scene: sceneInput(specs, ctx),
    directorDirection,
    motionScenePlan,
  });
  return {
    sceneId: ctx.scene,
    sceneVersionId: ctx.sceneVersion,
    sceneFunction: ctx.functionName ?? "NARRATIVE_BEAT",
    sceneVisualRole: ctx.visualRole ?? "RELATIONSHIP",
    locationId: ctx.location,
    characterIds: ctx.characters === false ? [] : [I.character],
    productAuthorityIds: ctx.products === false ? [] : [I.product],
    directorDirection,
    motionScenePlan,
    generationPlan,
  };
}

function compileEditorial(scenes: AiStoryNarrativeEditorialSceneInput[], profileId: "CORE" | "PRODUCT_STORY" | "COMMERCIAL_STORY" = "COMMERCIAL_STORY") {
  const input = {
    storyId: I.story,
    storyVersionId: I.storyVersion,
    scriptVersionId: I.script,
    directorPlanId: I.director,
    version: 1,
    supersedesEditorialPlanId: null,
    createdBy: I.createdBy,
    createdAt: "2026-09-21T01:00:00.000Z",
    profileId,
    scenes,
  };
  return { input, ...compileAndValidateAiStoryNarrativeEditorialPlan(input) };
}

function blocked(issues: AiStoryNarrativeEditorialIssue[], gate: AiStoryNarrativeEditorialIssue["gate"]) {
  return issues.filter((issue) => issue.gate === gate && issue.severity === "BLOCK");
}

function warned(issues: AiStoryNarrativeEditorialIssue[], gate: AiStoryNarrativeEditorialIssue["gate"]) {
  return issues.filter((issue) => issue.gate === gate && issue.severity === "WARN");
}

function clonePlan(plan: AiStoryNarrativeEditorialPlan): AiStoryNarrativeEditorialPlan {
  return AiStoryNarrativeEditorialPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
}

function group(prefix: number) {
  return {
    ctx: (sceneOrder: number, extra: Partial<SceneCtx> = {}): SceneCtx => ({
      scene: id(prefix + 5 + sceneOrder),
      sceneVersion: id(prefix + 6 + sceneOrder),
      directorScene: id(prefix + 11 + sceneOrder),
      sceneOrder,
      location: extra.location ?? I.location,
      fingerprint: hash(String(prefix + sceneOrder)),
      ...extra,
    }),
    spec: (offset: number, rest: Omit<ShotSpec, "shotId" | "order" | "blockingId" | "entryId"> & { order: number }): ShotSpec => ({
      shotId: id(prefix + 30 + offset),
      blockingId: id(prefix + 40 + offset),
      entryId: id(prefix + 20 + offset),
      ...rest,
    }),
  };
}

const flower = group(100);
const bloom = group(200);
const service = group(300);
const food = group(400);
const brand = group(500);
const product = group(600);
const hero = group(700);
const dup = group(800);

const commercialShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: null, audience: "Character enters the home", phase: "Entry into the room", entryVisual: "Doorway arrival", exitVisual: "Inside the room", action: "The person returns home and enters the room.", dominant: true, contact: false }),
  g.spec(1, { order: 1, purpose: "REVEAL_SUBJECT", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: "RELATIONSHIP_CONTEXT", audience: "Character notices the table", phase: "Discovery of the bouquet", entryVisual: "Inside the room", exitVisual: "Attention on the table", action: "The person notices flowers on the table.", dominant: true, contact: false }),
  g.spec(2, { order: 2, purpose: "EMPHASIZE_PRODUCT", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Product bouquet becomes established", phase: "Product reveal", entryVisual: "Attention on the table", exitVisual: "Bouquet readable", action: "The bouquet becomes the established subject.", dominant: true, contact: false }),
  g.spec(3, { order: 3, purpose: "SHOW_ACTION", size: "MEDIUM_CLOSE", camera: "LOCKED", focusKind: "CHARACTER_PRODUCT_INTERACTION", composition: "ACTION_CENTERED", productEmphasis: "USAGE_CONTEXT", audience: "Character reads the card", phase: "Card interaction", entryVisual: "Bouquet readable", exitVisual: "Card in hand", action: "The person lifts and reads the card.", dominant: true, contact: true }),
  g.spec(4, { order: 4, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: "RELATIONSHIP_CONTEXT", audience: "Emotional reaction lands", phase: "Emotional reaction", entryVisual: "Card in hand", exitVisual: "Felt reaction", action: "The person reacts to the message.", dominant: true, contact: false }),
];

const bloomScene1 = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "SHOW_DETAIL", size: "MACRO", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Closed bud is isolated", phase: "Static closed bud", entryVisual: "Closed bud", exitVisual: "Closed bud held", action: "A closed bud occupies the frame.", dominant: false, contact: false, bindAction: false }),
  g.spec(1, { order: 1, purpose: "SHOW_ACTION", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Petals materially open", phase: "Petals opening", entryVisual: "Closed bud", exitVisual: "Open bloom", action: "Petals open from bud to bloom.", dominant: true, contact: false }),
  g.spec(2, { order: 2, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "SLOW_PULL_BACK", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: "ENVIRONMENT_CONTEXT", audience: "Wider established bloom", phase: "Established bloom in context", entryVisual: "Open bloom", exitVisual: "Bloom in setting", action: "The bloom is established in the wider setting.", dominant: false, contact: false, bindAction: false }),
];

const bloomScene2 = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(3, { order: 0, purpose: "ESTABLISH_CONTEXT", size: "MEDIUM", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: "ENVIRONMENT_CONTEXT", audience: "Partial product context", phase: "Partial context", entryVisual: "Partial product", exitVisual: "Context held", action: "The Product is only partially established.", dominant: false, contact: false, bindAction: false }),
  g.spec(4, { order: 1, purpose: "REVEAL_SUBJECT", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Product reveal information", phase: "Reveal", entryVisual: "Partial product", exitVisual: "Revealed product", action: "The Product is revealed.", dominant: true, contact: false }),
  g.spec(5, { order: 2, purpose: "SHOW_DETAIL", size: "MACRO", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Surface detail becomes readable", phase: "Detail", entryVisual: "Revealed product", exitVisual: "Detail readable", action: "A Product detail is isolated.", dominant: false, contact: false, bindAction: false }),
];

const bloomScene3 = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(6, { order: 0, purpose: "EMPHASIZE_PRODUCT", size: "MEDIUM", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Full hero presentation", phase: "Full hero", entryVisual: "Revealed product", exitVisual: "Hero settled", action: "The Product occupies the hero frame.", dominant: false, contact: false, bindAction: false }),
  g.spec(7, { order: 1, purpose: "RESOLVE", size: "MEDIUM", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PACKSHOT", audience: "CTA-ready settle", phase: "CTA settle", entryVisual: "Hero settled", exitVisual: "CTA hold", action: "The ending settles for CTA.", dominant: false, contact: false, bindAction: false }),
];

const serviceShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: null, audience: "Broken appliance state", phase: "Broken state", entryVisual: "Broken appliance", exitVisual: "Technician arrives", action: "The technician sees the broken appliance.", dominant: true, contact: false }),
  g.spec(1, { order: 1, purpose: "SHOW_ACTION", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: null, audience: "Diagnostic action", phase: "Diagnosis", entryVisual: "Technician arrives", exitVisual: "Fault identified", action: "The technician diagnoses the fault.", dominant: true, contact: true }),
  g.spec(2, { order: 2, purpose: "SHOW_ACTION", size: "MEDIUM_CLOSE", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: null, audience: "Repair interaction", phase: "Repair", entryVisual: "Fault identified", exitVisual: "Repair complete", action: "The technician repairs the appliance.", dominant: true, contact: true }),
  g.spec(3, { order: 3, purpose: "SHOW_EVIDENCE", size: "CLOSE", camera: "LOCKED", focusKind: "EVIDENCE_DETAIL", composition: "DETAIL_ISOLATION", productEmphasis: null, audience: "Restored function", phase: "Restored function", entryVisual: "Repair complete", exitVisual: "Working appliance", action: "The appliance resumes function.", dominant: true, contact: false }),
  g.spec(4, { order: 4, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: null, audience: "Customer reaction", phase: "Customer reaction", entryVisual: "Working appliance", exitVisual: "Satisfied customer", action: "The customer reacts to the restored function.", dominant: true, contact: false }),
];

const foodShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: "ENVIRONMENT_CONTEXT", audience: "Raw ingredient state", phase: "Raw ingredient", entryVisual: "Raw ingredient", exitVisual: "Prep begins", action: "Raw ingredients occupy the workspace.", dominant: true, contact: false }),
  g.spec(1, { order: 1, purpose: "SHOW_ACTION", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER_PRODUCT_INTERACTION", composition: "ACTION_CENTERED", productEmphasis: "USAGE_CONTEXT", audience: "Cooking action", phase: "Cooking", entryVisual: "Prep begins", exitVisual: "Food cooked", action: "The cook transforms the ingredient.", dominant: true, contact: true }),
  g.spec(2, { order: 2, purpose: "SHOW_ACTION", size: "MEDIUM_CLOSE", camera: "LOCKED", focusKind: "CHARACTER_PRODUCT_INTERACTION", composition: "ACTION_CENTERED", productEmphasis: "USAGE_CONTEXT", audience: "Plating action", phase: "Plating", entryVisual: "Food cooked", exitVisual: "Plated dish", action: "The cook plates the dish.", dominant: true, contact: true }),
  g.spec(3, { order: 3, purpose: "SHOW_EVIDENCE", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Finished dish", phase: "Finished dish", entryVisual: "Plated dish", exitVisual: "Dish established", action: "The finished dish is established.", dominant: true, contact: false }),
  g.spec(4, { order: 4, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: "RELATIONSHIP_CONTEXT", audience: "Customer experience", phase: "Customer experience", entryVisual: "Dish established", exitVisual: "Satisfied guest", action: "The guest experiences the dish.", dominant: true, contact: false }),
];

const emotionalShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "ESTABLISH_CONTEXT", size: "WIDE", camera: "LOCKED", focusKind: "ENVIRONMENT", composition: "ENVIRONMENT_CONTEXTUAL", productEmphasis: null, audience: "Quiet home interior", phase: "Arrival", entryVisual: "Empty room", exitVisual: "Person present", action: "The person arrives home.", dominant: true, contact: false }),
  g.spec(1, { order: 1, purpose: "SHOW_ACTION", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "ACTION_CENTERED", productEmphasis: null, audience: "Reads a handwritten note", phase: "Note reading", entryVisual: "Person present", exitVisual: "Note in hand", action: "The person reads the note.", dominant: true, contact: true }),
  g.spec(2, { order: 2, purpose: "SHOW_REACTION", size: "CLOSE", camera: "LOCKED", focusKind: "REACTION", composition: "REACTION_CENTERED", productEmphasis: null, audience: "Emotion becomes readable", phase: "Felt reaction", entryVisual: "Note in hand", exitVisual: "Emotion readable", action: "The person reacts to the note.", dominant: true, contact: false }),
  g.spec(3, { order: 3, purpose: "RESOLVE", size: "MEDIUM", camera: "LOCKED", focusKind: "CHARACTER", composition: "RELATIONSHIP_BALANCED", productEmphasis: null, audience: "Brand feeling settles", phase: "Brand settle", entryVisual: "Emotion readable", exitVisual: "Settled feeling", action: "The feeling settles as the Story payoff.", dominant: false, contact: false, bindAction: false }),
];

const productShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "SHOW_DETAIL", size: "MACRO", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Material evidence", phase: "Detail evidence", entryVisual: "Surface", exitVisual: "Surface readable", action: "A Product detail is isolated.", dominant: false, contact: false, bindAction: false }),
  g.spec(1, { order: 1, purpose: "EMPHASIZE_PRODUCT", size: "CLOSE", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Hero presentation", phase: "Hero", entryVisual: "Surface readable", exitVisual: "Hero product", action: "The Product occupies the hero frame.", dominant: false, contact: false, bindAction: false }),
  g.spec(2, { order: 2, purpose: "SHOW_EVIDENCE", size: "MEDIUM", camera: "LOCKED", focusKind: "EVIDENCE_DETAIL", composition: "DETAIL_ISOLATION", productEmphasis: "USAGE_CONTEXT", audience: "Usage evidence", phase: "Usage", entryVisual: "Hero product", exitVisual: "Usage readable", action: "Usage evidence is established.", dominant: false, contact: false, bindAction: false }),
];

const minimalShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "SHOW_DETAIL", size: "MACRO", camera: "LOCKED", focusKind: "PRODUCT", composition: "DETAIL_ISOLATION", productEmphasis: "DETAIL_EVIDENCE", audience: "Quiet detail", phase: "Detail", entryVisual: "Detail", exitVisual: "Detail held", action: "A quiet Product detail is isolated.", dominant: false, contact: false, bindAction: false }),
  g.spec(1, { order: 1, purpose: "EMPHASIZE_PRODUCT", size: "MEDIUM", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Full hero", phase: "Hero", entryVisual: "Detail held", exitVisual: "Hero", action: "The Product occupies the hero frame.", dominant: false, contact: false, bindAction: false }),
  g.spec(2, { order: 2, purpose: "RESOLVE", size: "MEDIUM", camera: "LOCKED", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PACKSHOT", audience: "CTA settle", phase: "CTA", entryVisual: "Hero", exitVisual: "CTA hold", action: "The ending settles for CTA.", dominant: false, contact: false, bindAction: false }),
];

const duplicateShots = (g: ReturnType<typeof group>): ShotSpec[] => [
  g.spec(0, { order: 0, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false }),
  g.spec(1, { order: 1, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false }),
  g.spec(2, { order: 2, purpose: "SHOW_DETAIL", size: "CLOSE", camera: "SLOW_PUSH_IN", focusKind: "PRODUCT", composition: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO", audience: "Bouquet close-up", phase: "Slow push on bouquet", entryVisual: "Bouquet", exitVisual: "Bouquet", action: "Hold the bouquet.", dominant: false, contact: false, bindAction: false }),
];

function flowerStory() {
  return compileEditorial([editorialScene(commercialShots(flower), flower.ctx(0))], "COMMERCIAL_STORY");
}

function bloomStory() {
  return compileEditorial([
    editorialScene(bloomScene1(bloom), bloom.ctx(0, { visualRole: "TEXTURE_MACRO" })),
    editorialScene(bloomScene2(bloom), bloom.ctx(1, { visualRole: "DETAIL_REVEAL" })),
    editorialScene(bloomScene3(bloom), bloom.ctx(2, { visualRole: "CTA_ENDING" })),
  ], "PRODUCT_STORY");
}

function serviceStory() {
  return compileEditorial([editorialScene(serviceShots(service), service.ctx(0, { products: false, visualRole: "USAGE_DEMONSTRATION" }))], "CORE");
}

function foodStory() {
  return compileEditorial([editorialScene(foodShots(food), food.ctx(0, { visualRole: "USAGE_DEMONSTRATION" }))], "CORE");
}

function emotionalStory() {
  return compileEditorial([editorialScene(emotionalShots(brand), brand.ctx(0, { products: false, visualRole: "PAYOFF" }))], "COMMERCIAL_STORY");
}

function productStory() {
  return compileEditorial([editorialScene(productShots(product), product.ctx(0, { visualRole: "DETAIL_REVEAL", characters: false }))], "PRODUCT_STORY");
}

function minimalStory() {
  return compileEditorial([editorialScene(minimalShots(hero), hero.ctx(0, { visualRole: "CTA_ENDING", characters: false }))], "PRODUCT_STORY");
}

describe("AI Story Narrative Editor authority", () => {
  it("certifies Narrative Editor without claiming Assembly V2 or audio execution", () => {
    expect(AI_STORY_NARRATIVE_EDITOR_AUTHORITY).toBe("CERTIFIED");
    expect(EDITORIAL_TIMELINE_AUTHORITY).toBe("CERTIFIED");
    expect(GENERATION_UNIT_TO_EDITORIAL_BINDING).toBe("CERTIFIED");
    expect(EDITORIAL_CAUSAL_ORDER).toBe("CERTIFIED");
    expect(CUT_ON_ACTION_AUTHORITY).toBe("CERTIFIED");
    expect(REACTION_TIMING_AUTHORITY).toBe("CERTIFIED");
    expect(EDITORIAL_DUPLICATION_PROTECTION).toBe("CERTIFIED");
    expect(EDITORIAL_RHYTHM_AUTHORITY).toBe("CERTIFIED");
    expect(SCENE_BRIDGE_AUTHORITY).toBe("CERTIFIED");
    expect(COMMERCIAL_PAYOFF_EDITING_AUTHORITY).toBe("CERTIFIED");
    expect(NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY).toBe("CERTIFIED");
    expect(NARRATIVE_EDITOR).toBe("CERTIFIED");
    expect(AI_STORY_NARRATIVE_EDITOR_OWNS_STORY_TRUTH).toBe(false);
    expect(AI_STORY_NARRATIVE_EDITOR_OWNS_BILLING).toBe(false);
    expect(AI_STORY_NARRATIVE_EDITOR_DISPATCHES_PROVIDER).toBe(false);
    expect(AI_STORY_NARRATIVE_EDITOR_EXECUTES_MEDIA).toBe(false);
    expect(AI_STORY_NARRATIVE_EDITOR_PERSISTENCE).toBe("CONTRACT_LAYER_ONLY");
    expect(FINAL_STORY_ASSEMBLY_V2).toBe("CERTIFIED");
    expect(FINAL_STORY_ASSEMBLY_V2_EXECUTION).toBe("CERTIFIED");
    expect(AUDIO_PLAN).toBe("CERTIFIED");
    expect(AUDIO_PLAN_EXECUTION).toBe("CERTIFIED");
    expect(AI_STORY_ASSEMBLY_V1_UNCHANGED).toBe(true);
    expect(STORY_FIRST_NARRATIVE_AUTHORITY).toBe("CERTIFIED");
    expect(AI_STORY_COMMERCIAL_STORY_PROFILE).toBe("CERTIFIED");
    expect(COMMERCIAL_INTEGRATION_CAUSALITY).toBe("CERTIFIED");
    expect(COMMERCIAL_PAYOFF_AUTHORITY).toBe("CERTIFIED");
    expect(READY_FOR_PROVIDER_FREE_REVIEW_NARRATIVE_EDITOR).toBe("PASS");
    expect(READY_FOR_PRODUCTION_MERGE_NARRATIVE_EDITOR).toBe("PENDING_PR140_PR141_PR142_AND_HUMAN_AUTHORIZATION");
    expect(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION).toBe(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V3);
  });

  it("NARRATIVE_EDITORIAL_PLAN_SCHEMA PASS and does not auto-approve", () => {
    const { plan, issues } = flowerStory();
    expect(AiStoryNarrativeEditorialPlanSchema.parse(plan).status).toBe("DRAFT");
    expect(plan.approvedBy).toBeNull();
    expect(plan.nonlinearNarrativeAuthority).toBe(false);
    expect(plan.storyPacingIntent.defaultTransition).toBe("HARD_CUT");
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(() => assertAiStoryNarrativeEditorialPlanTransition("DRAFT", "APPROVED")).toThrow(/EDITORIAL_PLAN_TRANSITION_DENIED/);
    assertAiStoryNarrativeEditorialPlanTransition("DRAFT", "VALIDATED");
  });

  it("EDITORIAL_PLAN_FINGERPRINT DETERMINISM PASS", () => {
    const first = flowerStory().plan;
    const second = compileAiStoryNarrativeEditorialPlan(flowerStory().input);
    expect(first.editorialFingerprint).toBe(second.editorialFingerprint);
    expect(first.editorialPlanId).toBe(second.editorialPlanId);
    expect(first.sourceHash).toBe(second.sourceHash);
  });

  it("EDITORIAL_PLAN_IS_NOT_CREATIVE_SOURCE_OF_TRUTH PASS", () => {
    const { plan, input } = flowerStory();
    const shotPurposes = input.scenes.flatMap((scene) => scene.directorDirection.shots.map((shot) => shot.shotPurpose)).sort();
    expect(plan.timeline.every((entry) => input.scenes.some((scene) => scene.directorDirection.shots.some((shot) => shot.directorShotId === entry.directorShotId)))).toBe(true);
    expect(shotPurposes).toEqual(["EMPHASIZE_PRODUCT", "ESTABLISH_CONTEXT", "REVEAL_SUBJECT", "SHOW_ACTION", "SHOW_REACTION"].sort());
    expect(AI_STORY_NARRATIVE_EDITOR_OWNS_STORY_TRUTH).toBe(false);
  });

  it("GENERATION_UNIT → EDITORIAL_BINDING PASS", () => {
    const { plan, issues, input } = flowerStory();
    expect(blocked(issues, "GENERATION_UNIT_BINDING_GATE")).toEqual([]);
    for (const entry of plan.timeline) {
      const unit = input.scenes.flatMap((scene) => scene.generationPlan.units).find((item) => item.generationUnitId === entry.generationUnitId);
      expect(unit?.directorShotId).toBe(entry.directorShotId);
      expect(entry.sourceMaterialKind).toBe("GENERATED_VIDEO");
    }
  });

  it("EDITORIAL_COVERAGE_GATE PASS", () => {
    const { issues } = flowerStory();
    expect(blocked(issues, "EDITORIAL_COVERAGE_GATE")).toEqual([]);
  });

  it("REQUIRED_SHOT_OMISSION BLOCKED", () => {
    const { plan, input } = flowerStory();
    const discovery = plan.dispositions.find((item) => {
      const shot = input.scenes[0]!.directorDirection.shots.find((candidate) => candidate.directorShotId === item.directorShotId);
      return shot?.shotPurpose === "REVEAL_SUBJECT";
    })!;
    const broken = clonePlan(plan);
    broken.dispositions = broken.dispositions.map((item) => item.generationUnitId === discovery.generationUnitId ? { ...item, disposition: "OMIT", omissionReason: "EDITORIAL_COMPRESSION" } : item);
    broken.timeline = broken.timeline.filter((entry) => entry.generationUnitId !== discovery.generationUnitId);
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, input), "EDITORIAL_COVERAGE_GATE").length).toBeGreaterThan(0);
  });

  it("AUTHORIZED_REDUNDANT_SHOT_OMISSION PASS", () => {
    const scene = editorialScene(duplicateShots(dup), dup.ctx(0, { visualRole: "DETAIL_REVEAL" }));
    const { plan, issues } = compileEditorial([scene], "PRODUCT_STORY");
    expect(plan.dispositions.filter((item) => item.disposition === "OMIT" && item.omissionReason === "REDUNDANT")).toHaveLength(2);
    expect(plan.timeline).toHaveLength(1);
    expect(blocked(issues, "EDITORIAL_COVERAGE_GATE")).toEqual([]);
    expect(blocked(issues, "EDITORIAL_DUPLICATION_GATE")).toEqual([]);
  });

  it("EDITORIAL_CAUSAL_ORDER_GATE PASS", () => {
    expect(blocked(flowerStory().issues, "EDITORIAL_CAUSAL_ORDER_GATE")).toEqual([]);
    expect(blocked(foodStory().issues, "EDITORIAL_CAUSAL_ORDER_GATE")).toEqual([]);
  });

  it("REACTION_BEFORE_CAUSE BLOCKED", () => {
    const { plan, input } = flowerStory();
    const reaction = plan.timeline.find((entry) => entry.editorialRole === "REACTION")!;
    const rest = plan.timeline.filter((entry) => entry.timelineEntryId !== reaction.timelineEntryId);
    const broken = clonePlan(plan);
    broken.timeline = [reaction, ...rest].map((entry, order) => ({ ...entry, order }));
    const issues = validateAiStoryNarrativeEditorialPlan(broken, input);
    expect(blocked(issues, "EDITORIAL_CAUSAL_ORDER_GATE").length).toBeGreaterThan(0);
    expect(blocked(issues, "REACTION_TIMING_GATE").length).toBeGreaterThan(0);
  });

  it("CUT_ON_ACTION_CONTINUITY PASS", () => {
    const { plan, issues } = serviceStory();
    const actionCuts = plan.timeline.filter((entry) => entry.transitionIntent === "CONTINUOUS_ACTION");
    expect(actionCuts.length).toBeGreaterThan(0);
    expect(blocked(issues, "CUT_ON_ACTION_CONTINUITY_GATE")).toEqual([]);
  });

  it("INVALID_CUT_ON_ACTION BLOCKED", () => {
    const { plan, input } = flowerStory();
    const broken = clonePlan(plan);
    const reaction = broken.timeline.find((entry) => entry.editorialRole === "REACTION")!;
    reaction.transitionIntent = "CONTINUOUS_ACTION";
    reaction.cutInReason = "ACTION_CONTINUES";
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, input), "CUT_ON_ACTION_CONTINUITY_GATE").length).toBeGreaterThan(0);
  });

  it("REACTION_TIMING PASS", () => {
    const { plan, issues } = flowerStory();
    expect(plan.timeline.some((entry) => entry.editorialRole === "ACTION")).toBe(true);
    expect(plan.timeline.some((entry) => entry.editorialRole === "REACTION")).toBe(true);
    expect(blocked(issues, "REACTION_TIMING_GATE")).toEqual([]);
  });

  it("EDITORIAL_DUPLICATION_GATE PASS and REDUNDANT_FINAL_TIMELINE SHOTS BLOCKED", () => {
    const scene = editorialScene(duplicateShots(dup), dup.ctx(0, { visualRole: "DETAIL_REVEAL" }));
    const compiled = compileEditorial([scene], "PRODUCT_STORY");
    expect(blocked(compiled.issues, "EDITORIAL_DUPLICATION_GATE")).toEqual([]);
    const omitted = compiled.plan.dispositions.filter((item) => item.disposition === "OMIT");
    const extra = omitted.map((item, index) => {
      const unit = scene.generationPlan.units.find((candidate) => candidate.generationUnitId === item.generationUnitId)!;
      const template = compiled.plan.timeline[0]!;
      return {
        ...template,
        timelineEntryId: id(900 + index),
        order: compiled.plan.timeline.length + index,
        directorShotId: unit.directorShotId,
        generationUnitId: unit.generationUnitId,
      };
    });
    const broken = clonePlan(compiled.plan);
    broken.dispositions = broken.dispositions.map((item) => ({ ...item, disposition: "USE", omissionReason: null }));
    broken.timeline = [...broken.timeline, ...extra];
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, compiled.input), "EDITORIAL_DUPLICATION_GATE").length).toBeGreaterThan(0);
  });

  it("EDITORIAL_RHYTHM_GATE PASS and FULL-CLIP SLIDESHOW BLOCKED", () => {
    const { plan, input, issues } = flowerStory();
    expect(plan.timeline.every((entry) => entry.usesFullSourceDuration === false)).toBe(true);
    expect(blocked(issues, "EDITORIAL_RHYTHM_GATE")).toEqual([]);
    const broken = clonePlan(plan);
    broken.timeline = broken.timeline.map((entry) => ({
      ...entry,
      usesFullSourceDuration: true,
      pacingFunction: "BUILD",
      transitionIntent: "HARD_CUT",
      sourceInIntent: "FIRST_VALID_FRAME",
      sourceOutIntent: "BEFORE_DEAD_AIR",
    }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, input), "EDITORIAL_RHYTHM_GATE").length).toBeGreaterThan(0);
  });

  it("INTENTIONAL_SLOW_MINIMALISM PASS", () => {
    const { plan, issues } = minimalStory();
    expect(plan.timeline.map((entry) => entry.editorialRole)).toEqual(["DETAIL", "CTA", "CTA"]);
    const slow = clonePlan(plan);
    slow.timeline = slow.timeline.map((entry) => ({
      ...entry,
      usesFullSourceDuration: true,
      pacingFunction: "PAYOFF_HOLD",
      transitionIntent: "HARD_CUT",
      sourceInIntent: "MOTION_ESTABLISHED",
      sourceOutIntent: "HERO_SETTLED",
    }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(slow, minimalStory().input), "EDITORIAL_RHYTHM_GATE")).toEqual([]);
    expect(blocked(issues, "EDITORIAL_RHYTHM_GATE")).toEqual([]);
  });

  it("UNJUSTIFIED_TRANSITION WARN/BLOCK and HARD_CUT DEFAULT PASS", () => {
    const { plan, input, issues } = flowerStory();
    expect(plan.storyPacingIntent.defaultTransition).toBe("HARD_CUT");
    expect(plan.timeline.every((entry) => entry.transitionIntent === "HARD_CUT" || entry.transitionIntent === "CONTINUOUS_ACTION")).toBe(true);
    expect(blocked(issues, "UNJUSTIFIED_TRANSITION_GATE")).toEqual([]);
    const warnedPlan = clonePlan(plan);
    warnedPlan.timeline[1]!.transitionIntent = "DISSOLVE";
    warnedPlan.timeline[1]!.transitionRationale = null;
    expect(warned(validateAiStoryNarrativeEditorialPlan(warnedPlan, input), "UNJUSTIFIED_TRANSITION_GATE").length).toBeGreaterThan(0);
    const blockedPlan = clonePlan(plan);
    blockedPlan.timeline = blockedPlan.timeline.map((entry) => ({ ...entry, transitionIntent: "DISSOLVE", transitionRationale: "Decorative" }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(blockedPlan, input), "UNJUSTIFIED_TRANSITION_GATE").length).toBeGreaterThan(0);
  });

  it("SCENE_BRIDGE_CONTINUITY PASS", () => {
    const { plan, issues } = bloomStory();
    expect(plan.sceneBridges).toHaveLength(2);
    expect(plan.sceneBridges.every((bridge) => bridge.bridgeType === "MATCH_STATE" || bridge.bridgeType === "LOCATION_CHANGE")).toBe(true);
    expect(plan.sceneBridges.every((bridge) => !["DISSOLVE", "FADE"].includes(bridge.bridgeType))).toBe(true);
    expect(blocked(issues, "EDITORIAL_COVERAGE_GATE")).toEqual([]);
  });

  it("COMMERCIAL_PAYOFF_EDITING PASS and UNRELATED_AD_ENDING BLOCKED", () => {
    const { plan, input, issues } = emotionalStory();
    expect(plan.timeline.some((entry) => entry.editorialRole === "PAYOFF" || entry.editorialRole === "CTA")).toBe(true);
    expect(blocked(issues, "EDITORIAL_COMMERCIAL_PAYOFF_GATE")).toEqual([]);
    const broken = clonePlan(plan);
    const last = broken.timeline.at(-1)!;
    last.continuityRelationship = "HARD_BREAK";
    last.editorialRole = "PAYOFF";
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, input), "EDITORIAL_COMMERCIAL_PAYOFF_GATE").length).toBeGreaterThan(0);
  });

  it("PRODUCT_STORY EDITING PASS", () => {
    const { plan, issues } = productStory();
    expect(plan.profileId).toBe("PRODUCT_STORY");
    expect(plan.timeline.some((entry) => entry.editorialRole === "DETAIL" || entry.editorialRole === "HERO")).toBe(true);
    expect(blocked(issues, "EDITORIAL_COMMERCIAL_PAYOFF_GATE")).toEqual([]);
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("COMMERCIAL_STORY EDITING PASS", () => {
    const { plan, issues } = flowerStory();
    expect(plan.profileId).toBe("COMMERCIAL_STORY");
    expect(plan.timeline.map((entry) => entry.editorialRole)).toEqual(["ESTABLISH", "DISCOVERY", "HERO", "ACTION", "REACTION"]);
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("SERVICE STORY EDITING PASS", () => {
    const { plan, issues } = serviceStory();
    expect(plan.timeline.map((entry) => entry.editorialRole)).toEqual(["ESTABLISH", "ACTION", "ACTION", "CONSEQUENCE", "REACTION"]);
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    const broken = clonePlan(plan);
    const reaction = broken.timeline.find((entry) => entry.editorialRole === "REACTION")!;
    broken.timeline = [reaction, ...broken.timeline.filter((entry) => entry.timelineEntryId !== reaction.timelineEntryId)].map((entry, order) => ({ ...entry, order }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, serviceStory().input), "EDITORIAL_CAUSAL_ORDER_GATE").length).toBeGreaterThan(0);
  });

  it("FOOD STORY EDITING PASS and STORY PAYOFF BEFORE REQUIRED ACTION BLOCKED", () => {
    const { plan, issues, input } = foodStory();
    expect(plan.timeline[0]!.editorialRole).toBe("ESTABLISH");
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    const finished = plan.timeline.find((entry) => entry.editorialRole === "CONSEQUENCE")!;
    const raw = plan.timeline.find((entry) => entry.editorialRole === "ESTABLISH")!;
    const cooking = plan.timeline.filter((entry) => entry.editorialRole === "ACTION");
    const broken = clonePlan(plan);
    broken.timeline = [finished, raw, ...cooking, ...plan.timeline.filter((entry) => entry.editorialRole === "REACTION")].map((entry, order) => ({ ...entry, order }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(broken, input), "EDITORIAL_CAUSAL_ORDER_GATE").length).toBeGreaterThan(0);
    const bloom = bloomStory();
    const payoff = bloom.plan.timeline.find((entry) => entry.editorialRole === "CTA")!;
    const payoffFirst = clonePlan(bloom.plan);
    payoffFirst.timeline = [payoff, ...bloom.plan.timeline.filter((entry) => entry.timelineEntryId !== payoff.timelineEntryId)].map((entry, order) => ({ ...entry, order }));
    expect(blocked(validateAiStoryNarrativeEditorialPlan(payoffFirst, bloom.input), "EDITORIAL_CAUSAL_ORDER_GATE").length).toBeGreaterThan(0);
  });

  it("MINIMAL HERO EDITING PASS", () => {
    const { issues } = minimalStory();
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("FROM BUD TO BLOOM EDITORIAL PASS", () => {
    const { plan, issues } = bloomStory();
    expect(plan.timeline.some((entry) => entry.editorialRole === "DETAIL")).toBe(true);
    expect(plan.timeline.some((entry) => entry.editorialRole === "ACTION")).toBe(true);
    expect(plan.timeline.at(-1)?.editorialRole).toBe("CTA");
    expect(plan.timeline.every((entry) => entry.usesFullSourceDuration === false)).toBe(true);
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY PASS", () => {
    const compatibility = projectLegacyStoryToNarrativeEditorialPlanCompatibility({ assembly: "v1" });
    expect(compatibility.kind).toBe("NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY");
    expect(compatibility.canonicalEditorialPlan).toBeNull();
  });

  it("does not change Assembly V1 concatenation or embed audio execution in the Narrative Editor", () => {
    const assembly = readFileSync("packages/shared/src/ai-story-assembly-runtime-execution.ts", "utf8");
    expect(assembly).toContain("Deterministic scene concatenation failed.");
    expect(assembly).toContain('binaryName: z.literal("ffmpeg")');
    const editorial = readFileSync("packages/shared/src/ai-story-narrative-editorial-plan.ts", "utf8")
      + readFileSync("packages/shared/src/ai-story-narrative-editorial-plan.server.ts", "utf8");
    expect(editorial).not.toMatch(/xfade|J-cut|L-cut|tts|ffmpeg/i);
    expect(editorial).toContain('AUDIO_PLAN_EXECUTION = "CERTIFIED"');
  });
});
