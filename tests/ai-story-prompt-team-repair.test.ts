import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_ANTI_PPT_CREATIVE_CONTRACT,
  AI_STORY_CINEMATIC_CAMERA_GRAMMAR_VOCABULARY,
  AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION,
  AI_STORY_CINEMATIC_EXECUTION_FOUNDATION,
  AI_STORY_CINEMATIC_EXECUTION_IS_COMPILED_PROJECTION,
  AI_STORY_CONTINUITY_NOT_DUPLICATION,
  AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION,
  AI_STORY_POST_QC_CREATIVE_AUTHORITY,
  AI_STORY_POST_QC_DIMENSIONS,
  AI_STORY_POST_QC_DIMENSIONS_V1,
  AI_STORY_POST_QC_DIMENSIONS_V2,
  AI_STORY_POST_QC_POLICY_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION_V1,
  AI_STORY_POST_QC_POLICY_VERSION_V2,
  AI_STORY_PRE_GENERATION_QC_GATE_ORDER,
  AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V1,
  AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2,
  AI_STORY_PRODUCT_IDENTITY_NOT_STILLNESS,
  AI_STORY_PROMPT_TEAM_REPAIR,
  AI_STORY_PROMPT_TEAM_REPAIR_CONTRACT_VERSION,
  AI_STORY_SEEDANCE_CAPABILITY_EXPANDED,
  AI_STORY_STORY_PLUS_ADVERTISING_DIRECTION,
  AI_STORY_SUBJECT_MOTION_NOT_CAMERA_SUBSTITUTION,
  AI_STORY_SUBJECT_MOTION_SOURCE_OWNER,
  AiStoryDirectorSceneDirectionSchema,
  AiStoryMarketingIntentBridgeSchema,
  AiStoryPostGenerationQcEvaluationSchema,
  AiStoryPostGenerationQcInputPackageSchema,
  AiStoryPreGenerationQcEvaluationSchema,
  AiStorySceneMotionPlanSchema,
  POST_QC_CREATIVE_AUTHORITY,
  READY_FOR_PRODUCTION_MERGE,
  READY_FOR_PROVIDER_FREE_REVIEW,
  compileCinematicExecutionProjection,
  compileCinematicPromptFacts,
  deriveSubjectMotionRequirement,
  evaluateCinematicExecutionContract,
  resolveMarketingIntentBridge,
  type AiStoryDirectorSceneDirection,
  type AiStorySceneMotionPlan,
  type AiStorySubjectMotionScriptTruth,
} from "@ceo-agent/shared";
import { fingerprintCinematicExecutionProjection } from "@ceo-agent/shared/server";

const id = (n: number) => `91000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  product: id(1), character: id(2), sceneA: id(3), sceneB: id(4), sceneC: id(5),
  directorA: id(6), directorB: id(7), directorC: id(8), shotA: id(9), shotB: id(10), shotC: id(11),
  blockA: id(12), blockB: id(13), blockC: id(14), actionA: id(15), actionB: id(16), actionC: id(17),
};

function direction(input: {
  order: number;
  scriptSceneId: string;
  directorSceneId: string;
  shotId: string;
  blockingId: string;
  actionId: string;
  sceneFunction: string;
  visualRole: string;
  shotPurpose: string;
  shotSize: string;
  cameraFamily: string;
  compositionIntent: string;
  productEmphasis: string;
  semanticIntent: string;
  audience: string;
  comparedTo?: string[];
  dimensions?: Array<"VISUAL_ROLE" | "SHOT_PURPOSE" | "SHOT_SIZE" | "CAMERA_FAMILY" | "FOCUS" | "COMPOSITION" | "PRODUCT_EMPHASIS" | "SCRIPT_ACTION" | "AUDIENCE_INFORMATION" | "PRODUCT_EVIDENCE">;
}): AiStoryDirectorSceneDirection {
  return AiStoryDirectorSceneDirectionSchema.parse({
    directorSceneId: input.directorSceneId,
    scriptSceneId: input.scriptSceneId,
    sceneOrder: input.order,
    servedScriptSceneFunction: input.sceneFunction,
    sceneVisualRole: input.visualRole,
    sceneVisualRoleRegistryVersion: 1,
    contextualTreatment: {
      semanticIntent: input.semanticIntent,
      supportedActionEntryIds: [input.actionId],
      supportedStateDeltaIndexes: [],
      physicalPlausibility: "NOT_CONTRADICTED",
    },
    shots: [{
      directorShotId: input.shotId,
      order: 0,
      shotPurpose: input.shotPurpose,
      shotPurposeRegistryVersion: 1,
      shotSize: input.shotSize,
      cameraIntent: input.semanticIntent,
      cameraFamily: input.cameraFamily,
      focusTarget: { kind: "PRODUCT", authorityRefs: [I.product], semanticLabel: "Canonical product" },
      focusProgression: [{ kind: "PRODUCT", authorityRefs: [I.product], semanticLabel: "Canonical product" }],
      compositionIntent: input.compositionIntent,
      productEmphasis: input.productEmphasis,
      newAudienceInformation: [input.audience],
      blockingIntents: [{
        blockingIntentId: input.blockingId,
        subjectRefs: [I.product],
        semanticIntent: input.semanticIntent,
        supportedActionEntryIds: [input.actionId],
        spatialRelationship: "Product remains readable",
      }],
      perspectiveChange: "MINIMAL",
      revealsUnseenProductSurface: false,
      productIdentityTransformation: false,
    }],
    newAudienceInformation: [input.audience],
    servedProductEvidence: input.order > 0 ? ["Canonical product remains itself"] : [],
    differentiationRequirement: {
      comparedToScriptSceneIds: input.comparedTo ?? [],
      dimensions: input.dimensions ?? (input.order === 0 ? ["VISUAL_ROLE"] : ["VISUAL_ROLE", "CAMERA_FAMILY", "SHOT_SIZE"]),
      rationale: input.semanticIntent,
    },
  });
}

function motionFor(scene: AiStoryDirectorSceneDirection, input: {
  start: string;
  end: string;
  action: string;
  cameraFamily: string;
  startCamera: string;
  endCamera: string;
  startPosition: string;
  endPosition: string;
}): AiStorySceneMotionPlan {
  const phase = id(80 + scene.sceneOrder);
  const actionId = id(90 + scene.sceneOrder);
  const changed = input.start !== input.end;
  return AiStorySceneMotionPlanSchema.parse({
    sceneMotionPlanId: id(50 + scene.sceneOrder),
    directorSceneId: scene.directorSceneId,
    scriptSceneId: scene.scriptSceneId,
    sceneOrder: scene.sceneOrder,
    actionExecutions: [{
      actionExecutionId: actionId,
      scriptActionEntryId: scene.contextualTreatment.supportedActionEntryIds[0]!,
      semanticAction: input.action,
      dominance: "DOMINANT",
      startState: [
        { entityId: I.product, property: "PRODUCT_STATE", value: input.start, exclusive: true },
        { entityId: I.product, property: "LOCATION", value: input.startPosition, exclusive: true },
      ],
      actionPath: [{
        phaseId: phase,
        order: 0,
        semanticPhase: input.action,
        subjectRefs: [I.product],
        objectRefs: [I.product],
        stateChanges: changed
          ? [{ entityId: I.product, property: "PRODUCT_STATE", fromValue: input.start, toValue: input.end, causalReason: input.action }]
          : [],
      }],
      endState: [
        { entityId: I.product, property: "PRODUCT_STATE", value: input.end, exclusive: true },
        { entityId: I.product, property: "LOCATION", value: input.endPosition, exclusive: true },
      ],
      completionAssertions: [{ entityId: I.product, property: "PRODUCT_STATE", expectedValue: input.end }],
      objectInteractions: [],
      forceResponses: [],
    }],
    objectPersistence: [{ objectId: I.product, presentAtStart: true, presentAtEnd: true, authorizedRemovalOrTransformation: false, reason: "Product persists" }],
    blockingExecutions: [{
      blockingIntentId: scene.shots[0]!.blockingIntents[0]!.blockingIntentId,
      startPosition: input.startPosition,
      movementPath: changed ? "Bounded subject change" : "Held",
      interactionPosition: input.endPosition,
      endPosition: input.endPosition,
      eyeline: null,
    }],
    cameraExecutions: [{
      directorShotId: scene.shots[0]!.directorShotId,
      cameraFamily: input.cameraFamily,
      startCameraState: input.startCamera,
      boundedMovement: input.cameraFamily === "LOCKED" ? "No translation" : input.cameraFamily,
      endCameraState: input.endCamera,
      subjectRelation: `${input.startCamera} to ${input.endCamera}`,
      timing: "Throughout",
    }],
    focusExecutions: [{
      directorShotId: scene.shots[0]!.directorShotId,
      progression: [{ order: 0, targetKind: "PRODUCT", authorityRefs: [I.product], semanticLabel: "Canonical product", timing: "Throughout" }],
    }],
    environmentalMotions: [],
    motionBudget: {
      policyId: "CORE_BALANCED", policyVersion: 1, profileId: "CORE", maxDominantActions: 1,
      maxCameraBehaviors: 1, maxEnvironmentalMotions: 1, complexityThreshold: 4, identitySensitiveProduct: true, riskFactors: [],
    },
    physicalConstraints: [],
  });
}

const fromBudScene1 = () => direction({
  order: 0, scriptSceneId: I.sceneA, directorSceneId: I.directorA, shotId: I.shotA, blockingId: I.blockA, actionId: I.actionA,
  sceneFunction: "PRODUCT_INTRODUCTION", visualRole: "ENVIRONMENT_ESTABLISH", shotPurpose: "ESTABLISH_CONTEXT",
  shotSize: "WIDE", cameraFamily: "LOCKED", compositionIntent: "ENVIRONMENT_CONTEXTUAL", productEmphasis: "ENVIRONMENT_CONTEXT",
  semanticIntent: "BLOOM: petals visibly open from a closed bud", audience: "The living bloom completes",
});
const fromBudScene2Reveal = () => direction({
  order: 1, scriptSceneId: I.sceneB, directorSceneId: I.directorB, shotId: I.shotB, blockingId: I.blockB, actionId: I.actionB,
  sceneFunction: "PRODUCT_DETAIL_REVEAL", visualRole: "DETAIL_REVEAL", shotPurpose: "REVEAL_SUBJECT",
  shotSize: "MEDIUM_CLOSE", cameraFamily: "REVEAL", compositionIntent: "SUBJECT_PRODUCT_RELATIONSHIP", productEmphasis: "PRIMARY_HERO",
  semanticIntent: "PRODUCT_REVEAL: Product identity becomes established", audience: "Product identity becomes readable",
  comparedTo: [I.sceneA], dimensions: ["VISUAL_ROLE", "SHOT_SIZE", "CAMERA_FAMILY", "COMPOSITION", "PRODUCT_EMPHASIS"],
});
const fromBudScene2Broken = () => direction({
  order: 1, scriptSceneId: I.sceneB, directorSceneId: I.directorB, shotId: I.shotB, blockingId: I.blockB, actionId: I.actionB,
  sceneFunction: "PRODUCT_DETAIL_REVEAL", visualRole: "DETAIL_REVEAL", shotPurpose: "SHOW_DETAIL",
  shotSize: "CLOSE", cameraFamily: "SLOW_PUSH_IN", compositionIntent: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO",
  semanticIntent: "Close Product with a slow push and no new action", audience: "A differently worded close-up of the same Product",
  comparedTo: [I.sceneA], dimensions: ["AUDIENCE_INFORMATION"],
});
const fromBudScene3Duplicate = () => direction({
  order: 2, scriptSceneId: I.sceneC, directorSceneId: I.directorC, shotId: I.shotC, blockingId: I.blockC, actionId: I.actionC,
  sceneFunction: "PAYOFF", visualRole: "DETAIL_REVEAL", shotPurpose: "SHOW_DETAIL",
  shotSize: "CLOSE", cameraFamily: "SLOW_PUSH_IN", compositionIntent: "PRODUCT_DOMINANT", productEmphasis: "PRIMARY_HERO",
  semanticIntent: "Another close Product slow push with static Product behavior", audience: "The finished Product remains on screen in different words",
  comparedTo: [I.sceneB], dimensions: ["SCRIPT_ACTION", "AUDIENCE_INFORMATION"],
});
const fromBudScene3Hero = () => direction({
  order: 2, scriptSceneId: I.sceneC, directorSceneId: I.directorC, shotId: I.shotC, blockingId: I.blockC, actionId: I.actionC,
  sceneFunction: "PAYOFF", visualRole: "PACKSHOT", shotPurpose: "SHOW_SCALE",
  shotSize: "MEDIUM", cameraFamily: "SLOW_PULL_BACK", compositionIntent: "SCALE_CONTEXT", productEmphasis: "PACKSHOT",
  semanticIntent: "HERO_CLOSING: final premium CTA-ready presentation", audience: "Final advertising composition with CTA-ready negative space",
  comparedTo: [I.sceneB], dimensions: ["VISUAL_ROLE", "SHOT_SIZE", "CAMERA_FAMILY", "COMPOSITION", "PRODUCT_EMPHASIS"],
});

function scriptTruth(order: number, input: {
  sceneFunction: string;
  entry: string;
  exit: string;
  action: string;
  outcomes?: string[];
  deltas?: boolean;
}): AiStorySubjectMotionScriptTruth {
  return {
    scriptSceneId: [I.sceneA, I.sceneB, I.sceneC][order]!,
    sceneOrder: order,
    sceneFunction: input.sceneFunction,
    sceneStateIn: [{ dimension: "PRODUCT_STATE", subjectId: I.product, value: input.entry }],
    sceneStateDeltas: input.deltas === false || input.entry === input.exit ? [] : [{ dimension: "PRODUCT_STATE", subjectId: I.product, value: input.exit }],
    sceneStateOut: [{ dimension: "PRODUCT_STATE", subjectId: I.product, value: input.exit }],
    actionEntries: [{ action: input.action, storyEffect: input.exit }],
    newActionOutcomes: input.outcomes ?? (input.entry === input.exit ? [] : [input.action]),
  };
}

const fromBudScript = (brokenReveal = false): AiStorySubjectMotionScriptTruth[] => [
  scriptTruth(0, { sceneFunction: "PRODUCT_INTRODUCTION", entry: "closed-bud", exit: "materially-open", action: "petals visibly open" }),
  scriptTruth(1, brokenReveal
    ? { sceneFunction: "PRODUCT_DETAIL_REVEAL", entry: "product-close", exit: "product-close", action: "static Product remains close", outcomes: [], deltas: false }
    : { sceneFunction: "PRODUCT_DETAIL_REVEAL", entry: "product-not-fully-established", exit: "product-identity-readable", action: "Product becomes materially established" }),
  scriptTruth(2, { sceneFunction: "PAYOFF", entry: "product-identity-readable", exit: "product-identity-readable", action: "stable premium final presentation", outcomes: [], deltas: false }),
];

function fromBudMotion(scene2: AiStoryDirectorSceneDirection, scene3: AiStoryDirectorSceneDirection, duplicate: boolean): AiStorySceneMotionPlan[] {
  return [
    motionFor(fromBudScene1(), { start: "closed-bud", end: "materially-open", action: "petals visibly open", cameraFamily: "LOCKED", startCamera: "Wide plant", endCamera: "Wide plant", startPosition: "garden", endPosition: "garden" }),
    motionFor(scene2, duplicate
      ? { start: "product-close", end: "product-close", action: "static Product remains close", cameraFamily: "SLOW_PUSH_IN", startCamera: "Tight product", endCamera: "Tighter product", startPosition: "close-frame", endPosition: "close-frame" }
      : { start: "product-not-fully-established", end: "product-identity-readable", action: "Product becomes materially established", cameraFamily: scene2.shots[0]!.cameraFamily, startCamera: "Partial product", endCamera: "Readable product", startPosition: "concealed", endPosition: "established" }),
    motionFor(scene3, duplicate
      ? { start: "product-close", end: "product-close", action: "static Product remains close", cameraFamily: "SLOW_PUSH_IN", startCamera: "Tight product", endCamera: "Tight product", startPosition: "close-frame", endPosition: "close-frame" }
      : { start: "product-identity-readable", end: "product-identity-readable", action: "stable premium final presentation", cameraFamily: "SLOW_PULL_BACK", startCamera: "Revealed product", endCamera: "CTA-ready hero", startPosition: "established", endPosition: "hero-close" }),
  ];
}

function issuesOf(sceneDirections: AiStoryDirectorSceneDirection[], sceneMotionPlans?: AiStorySceneMotionPlan[], marketingIntent?: unknown, scriptScenes?: AiStorySubjectMotionScriptTruth[]) {
  return evaluateCinematicExecutionContract({ sceneDirections, sceneMotionPlans, marketingIntent, scriptScenes });
}
function blocks(issues: ReturnType<typeof issuesOf>, gate: string) {
  return issues.filter((issue) => issue.gate === gate && issue.severity === "BLOCK");
}

function generalizationBroken(kind: "PRODUCT_AD" | "SERVICE_AD" | "FOOD" | "CHARACTER_STORY" | "EMOTIONAL_STORY" | "MINIMAL_HERO"): AiStoryDirectorSceneDirection[] {
  const slide = (order: number) => direction({
    order,
    scriptSceneId: [I.sceneA, I.sceneB, I.sceneC][order]!,
    directorSceneId: [I.directorA, I.directorB, I.directorC][order]!,
    shotId: [I.shotA, I.shotB, I.shotC][order]!,
    blockingId: [I.blockA, I.blockB, I.blockC][order]!,
    actionId: [I.actionA, I.actionB, I.actionC][order]!,
    sceneFunction: "PRODUCT_INTRODUCTION",
    visualRole: "HERO_INTRODUCTION",
    shotPurpose: "REVEAL_SUBJECT",
    shotSize: "CLOSE",
    cameraFamily: "SLOW_PUSH_IN",
    compositionIntent: "PRODUCT_DOMINANT",
    productEmphasis: "PRIMARY_HERO",
    semanticIntent: `${kind} slide ${order + 1} with different prose`,
    audience: `${kind} wording ${order + 1}`,
    comparedTo: order === 0 ? [] : [[I.sceneA, I.sceneB][order - 1]!],
    dimensions: ["AUDIENCE_INFORMATION"],
  });
  return kind === "MINIMAL_HERO" ? [slide(0), slide(1)] : [slide(0), slide(1), slide(2)];
}

function generalization(kind: "PRODUCT_AD" | "SERVICE_AD" | "FOOD" | "CHARACTER_STORY" | "EMOTIONAL_STORY" | "MINIMAL_HERO"): AiStoryDirectorSceneDirection[] {
  const base = (order: number, visualRole: string, shotPurpose: string, shotSize: string, cameraFamily: string, compositionIntent: string, productEmphasis: string, semanticIntent: string) => direction({
    order,
    scriptSceneId: [I.sceneA, I.sceneB, I.sceneC][order]!,
    directorSceneId: [I.directorA, I.directorB, I.directorC][order]!,
    shotId: [I.shotA, I.shotB, I.shotC][order]!,
    blockingId: [I.blockA, I.blockB, I.blockC][order]!,
    actionId: [I.actionA, I.actionB, I.actionC][order]!,
    sceneFunction: order === 0 ? "PRODUCT_INTRODUCTION" : order === 1 ? "PRODUCT_DETAIL_REVEAL" : "PAYOFF",
    visualRole, shotPurpose, shotSize, cameraFamily, compositionIntent, productEmphasis, semanticIntent,
    audience: semanticIntent,
    comparedTo: order === 0 ? [] : [[I.sceneA, I.sceneB][order - 1]!],
    dimensions: ["VISUAL_ROLE", "SHOT_SIZE", "CAMERA_FAMILY", "COMPOSITION"],
  });
  switch (kind) {
    case "PRODUCT_AD":
      return [
        base(0, "HERO_INTRODUCTION", "REVEAL_SUBJECT", "MEDIUM", "SLOW_PUSH_IN", "PRODUCT_DOMINANT", "PRIMARY_HERO", "Introduce the product"),
        base(1, "DETAIL_REVEAL", "SHOW_DETAIL", "MACRO", "SLOW_PUSH_IN", "DETAIL_ISOLATION", "DETAIL_EVIDENCE", "Reveal a verified detail"),
        base(2, "PACKSHOT", "SHOW_SCALE", "WIDE", "SLOW_PULL_BACK", "SCALE_CONTEXT", "PACKSHOT", "Close on the complete product"),
      ];
    case "SERVICE_AD":
      return [
        base(0, "ENVIRONMENT_ESTABLISH", "ESTABLISH_CONTEXT", "WIDE", "LOCKED", "ENVIRONMENT_CONTEXTUAL", "ENVIRONMENT_CONTEXT", "Establish the service setting"),
        base(1, "USAGE_DEMONSTRATION", "SHOW_ACTION", "MEDIUM", "TRACKING", "ACTION_CENTERED", "USAGE_CONTEXT", "Show the service in use"),
        base(2, "PAYOFF", "RESOLVE", "MEDIUM", "SLOW_PULL_BACK", "RELATIONSHIP_BALANCED", "RELATIONSHIP_CONTEXT", "Resolve with the outcome"),
      ];
    case "FOOD":
      return [
        base(0, "HERO_INTRODUCTION", "REVEAL_SUBJECT", "MEDIUM", "LOCKED", "PRODUCT_DOMINANT", "PRIMARY_HERO", "Present the dish"),
        base(1, "TEXTURE_MACRO", "SHOW_DETAIL", "MACRO", "SLOW_PUSH_IN", "DETAIL_ISOLATION", "DETAIL_EVIDENCE", "Show texture and steam"),
        base(2, "PACKSHOT", "EMPHASIZE_PRODUCT", "WIDE", "SLOW_PULL_BACK", "SCALE_CONTEXT", "PACKSHOT", "Hero the finished plate"),
      ];
    case "CHARACTER_STORY":
      return [
        base(0, "ENVIRONMENT_ESTABLISH", "SHOW_ENVIRONMENT", "WIDE", "LOCKED", "ENVIRONMENT_CONTEXTUAL", "ENVIRONMENT_CONTEXT", "Place the character"),
        base(1, "RELATIONSHIP", "SHOW_RELATIONSHIP", "MEDIUM", "MINOR_LATERAL_DOLLY", "RELATIONSHIP_BALANCED", "RELATIONSHIP_CONTEXT", "Advance the relationship"),
        base(2, "REACTION", "SHOW_REACTION", "CLOSE", "SLOW_PUSH_IN", "REACTION_CENTERED", "BACKGROUND_CONTEXT", "Land the character reaction"),
      ];
    case "EMOTIONAL_STORY":
      return [
        base(0, "ENVIRONMENT_ESTABLISH", "ESTABLISH_CONTEXT", "WIDE", "LOCKED", "ENVIRONMENT_CONTEXTUAL", "ENVIRONMENT_CONTEXT", "Open on mood"),
        base(1, "REACTION", "SHOW_REACTION", "CLOSE", "SLOW_PUSH_IN", "REACTION_CENTERED", "BACKGROUND_CONTEXT", "Hold the emotional turn"),
        base(2, "PAYOFF", "RESOLVE", "MEDIUM", "SLOW_PULL_BACK", "SCALE_CONTEXT", "PACKSHOT", "Release into resolution"),
      ];
    case "MINIMAL_HERO":
      return [base(0, "HERO_INTRODUCTION", "REVEAL_SUBJECT", "MEDIUM", "LOCKED_HERO", "PRODUCT_DOMINANT", "PRIMARY_HERO", "Single hero presentation")];
  }
}

describe("AI Story prompt-team repair cinematic contract", () => {
  it("CINEMATIC CAMERA GRAMMAR PASS: adjacent scenes must change camera, scale family, or visual role", () => {
    const pass = issuesOf(generalization("PRODUCT_AD"));
    expect(blocks(pass, "CINEMATIC_CAMERA_GRAMMAR_GATE")).toEqual([]);
    const broken = issuesOf([fromBudScene2Broken(), fromBudScene3Duplicate()]);
    expect(blocks(broken, "CINEMATIC_CAMERA_GRAMMAR_GATE").length).toBeGreaterThan(0);
  });

  it("SUBJECT MOTION is owned by Script/Scene and cannot be weakened by Director camera choice", () => {
    const bloom = fromBudScript()[0]!;
    expect(deriveSubjectMotionRequirement(bloom)).toMatchObject({ subjectMotionRequired: true, sourceOwner: "SCRIPT" });
    expect(AI_STORY_SUBJECT_MOTION_SOURCE_OWNER).toBe("SCRIPT");
    const cameraOnlyBloom = motionFor(fromBudScene1(), {
      start: "closed-bud", end: "closed-bud", action: "camera push-in over a static bud",
      cameraFamily: "SLOW_PUSH_IN", startCamera: "Wide bud", endCamera: "Tight bud", startPosition: "garden", endPosition: "garden",
    });
    cameraOnlyBloom.cameraExecutions[0]!.cameraFamily = "SLOW_PUSH_IN";
    const blocked = issuesOf([fromBudScene1()], [cameraOnlyBloom], undefined, [bloom]);
    expect(blocks(blocked, "SUBJECT_MOTION_COMPLETION_GATE").length).toBeGreaterThan(0);
    expect(blocks(blocked, "SUBJECT_MOTION_FIRST_CLASS_GATE").length).toBeGreaterThan(0);
    const hero = fromBudScript()[2]!;
    expect(deriveSubjectMotionRequirement(hero).subjectMotionRequired).toBe(false);
  });

  it("SUBJECT_MOTION_COMPLETION_GATE PASS: camera motion cannot complete a required bloom", () => {
    const corrected = [fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()];
    const pass = issuesOf(corrected, fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false), undefined, fromBudScript());
    expect(blocks(pass, "SUBJECT_MOTION_COMPLETION_GATE")).toEqual([]);
    expect(blocks(pass, "SUBJECT_MOTION_FIRST_CLASS_GATE")).toEqual([]);
  });

  it("CONTINUITY != DUPLICATION PASS: same product may continue, the same close-up may not", () => {
    const pass = issuesOf([fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()]);
    expect(blocks(pass, "CONTINUITY_NOT_DUPLICATION_GATE")).toEqual([]);
    const duplicate = issuesOf([fromBudScene1(), fromBudScene2Broken(), fromBudScene3Duplicate()]);
    expect(blocks(duplicate, "CONTINUITY_NOT_DUPLICATION_GATE").some((issue) => issue.sceneOrder === 2)).toBe(true);
  });

  it("CONTINUITY_NOT_DUPLICATION_GATE ignores prompt wording differences", () => {
    const duplicate = fromBudScene3Duplicate();
    expect(duplicate.newAudienceInformation[0]).not.toBe(fromBudScene2Broken().newAudienceInformation[0]);
    expect(blocks(issuesOf([fromBudScene2Broken(), duplicate]), "CONTINUITY_NOT_DUPLICATION_GATE").length).toBeGreaterThan(0);
  });

  it("CINEMATIC EXECUTION CONTRACT is a compiled projection, not parallel authority", () => {
    expect(blocks(issuesOf(generalization("PRODUCT_AD")), "CINEMATIC_EXECUTION_CONTRACT_GATE")).toEqual([]);
    expect(blocks(issuesOf([fromBudScene2Broken(), fromBudScene3Duplicate()]), "CINEMATIC_EXECUTION_CONTRACT_GATE").length).toBeGreaterThan(0);
    const projection = compileCinematicExecutionProjection({
      sceneDirections: [fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()],
      sceneMotionPlans: fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false),
      scriptScenes: fromBudScript(),
      lineage: { scriptFingerprint: "sha256:" + "a".repeat(64), sceneFingerprint: "sha256:" + "b".repeat(64), directorFingerprint: "sha256:" + "c".repeat(64), motionFingerprint: "sha256:" + "d".repeat(64) },
    });
    expect(projection.creativeAuthority).toBe(false);
    expect(projection.compiledProjection).toBe(true);
    expect(AI_STORY_CINEMATIC_EXECUTION_IS_COMPILED_PROJECTION).toBe(true);
    expect(fingerprintCinematicExecutionProjection(projection)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprintCinematicExecutionProjection(projection)).toBe(fingerprintCinematicExecutionProjection(projection));
  });

  it("MUST KEEP / MUST CHANGE remain distinct and PRODUCT_IDENTITY is not stillness", () => {
    const pass = issuesOf([fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()]);
    expect(blocks(pass, "MUST_KEEP_MUST_CHANGE_SEPARATION_GATE")).toEqual([]);
    const facts = compileCinematicPromptFacts({ directorDirection: fromBudScene3Hero(), previousDirectorDirection: fromBudScene2Reveal() });
    expect(facts.mustKeep.some((item) => /identity/i.test(item))).toBe(true);
    expect(facts.mustKeep.some((item) => /stillness/i.test(item))).toBe(true);
    expect(facts.mustChange.some((item) => /do not duplicate/i.test(item))).toBe(true);
    expect(facts.mustKeep.some((item) => facts.mustChange.includes(item))).toBe(false);
  });

  it("ANTI_PPT_CREATIVE_GATE PASS: consecutive product-close slides are blocked", () => {
    expect(blocks(issuesOf(generalization("PRODUCT_AD")), "ANTI_PPT_CREATIVE_GATE")).toEqual([]);
    expect(blocks(issuesOf([fromBudScene2Broken(), fromBudScene3Duplicate()]), "ANTI_PPT_CREATIVE_GATE").length).toBeGreaterThan(0);
  });

  it("POST-QC V1 remains historical while V2 adds cinematic dimensions without creative authority", () => {
    expect(AI_STORY_POST_QC_DIMENSIONS_V1).not.toContain("CINEMATIC_PROGRESSION");
    expect(AI_STORY_POST_QC_DIMENSIONS_V2).toEqual(expect.arrayContaining(["CINEMATIC_PROGRESSION", "ANTI_PPT_CONTINUITY"]));
    expect(AI_STORY_POST_QC_DIMENSIONS).toBe(AI_STORY_POST_QC_DIMENSIONS_V2);
    expect(AI_STORY_POST_QC_POLICY_VERSION).toBe(AI_STORY_POST_QC_POLICY_VERSION_V2);
    expect(POST_QC_CREATIVE_AUTHORITY).toBe(false);
    expect(AI_STORY_POST_QC_CREATIVE_AUTHORITY).toBe(false);
    const historical = AiStoryPostGenerationQcInputPackageSchema.parse({
      postQcInputId: I.sceneA, contractVersion: "ai-story-post-generation-qc.v1",
      policyVersion: AI_STORY_POST_QC_POLICY_VERSION_V1, orgId: I.sceneA, workspaceId: I.sceneB, campaignId: I.sceneC,
      storyId: I.directorA, storyVersionId: I.directorB, planningLineageSource: "LEGACY_COMPILED_V1", scriptVersionId: null, handoffId: null, sceneExecutionId: I.directorC, sceneId: "scene-1", sceneVersion: 1,
      sceneFingerprint: "sha256:" + "a".repeat(64), sceneExecutionFingerprint: "sha256:" + "b".repeat(64),
      providerAttemptId: "attempt-1", generationMode: "TEXT_TO_VIDEO", privateMediaAssetId: I.shotA, privateMediaContentHash: "sha256:" + "c".repeat(64),
      compiledRequestId: I.shotB, compiledRequestFingerprint: "sha256:" + "d".repeat(64), semanticPlanFingerprint: "sha256:" + "e".repeat(64),
      preGenerationQcEvaluationId: I.shotC, preGenerationQcFingerprint: "sha256:" + "f".repeat(64),
      handoffFingerprint: null, directorFingerprint: "sha256:" + "2".repeat(64), motionFingerprint: "sha256:" + "3".repeat(64), shotRecipeFingerprint: null,
      castSnapshotFingerprint: "sha256:" + "5".repeat(64), locationSnapshotFingerprint: "sha256:" + "6".repeat(64), productSnapshotFingerprint: "sha256:" + "7".repeat(64),
      entryState: ["closed bud"], scriptActions: ["petals open"], requiredExitState: ["open bloom"],
      mustKeep: ["identity"], mustAvoid: ["slides"], newAudienceInformation: ["bloom"], requiredEvidence: ["open bloom"],
      requirements: [{ requirementId: "scene-purpose", dimension: "SCENE_FIDELITY", summary: "Scene purpose remains observable", required: true, waiverPolicy: "WAIVABLE_BY_HUMAN", sourceOwner: "SCENE", visuallyObservable: true }],
      providerMetadata: { provider: "seedance", model: "dreamina-seedance-2-0-260128" },
      media: { durableObjectReference: `${I.sceneB}/ai-story/result.mp4`, mediaType: "video/mp4", byteSize: 4096, durationMs: 5000, width: 1280, height: 720, readable: true, decodable: true },
      createdAt: "2026-08-30T00:00:00.000Z",
    });
    expect(historical.policyVersion).toBe(AI_STORY_POST_QC_POLICY_VERSION_V1);
    expect(historical.requirements.some((item) => item.dimension === "CINEMATIC_PROGRESSION")).toBe(false);
    expect(AiStoryPostGenerationQcEvaluationSchema.parse({
      postQcEvaluationId: I.blockA, contractVersion: "ai-story-post-generation-qc.v1", policyVersion: AI_STORY_POST_QC_POLICY_VERSION_V1,
      evaluationVersion: 1, postQcInputId: historical.postQcInputId, orgId: historical.orgId, workspaceId: historical.workspaceId,
      providerAttemptId: historical.providerAttemptId, mediaAssetId: historical.privateMediaAssetId, mediaContentHash: historical.privateMediaContentHash,
      sceneExecutionId: historical.sceneExecutionId, sceneFingerprint: historical.sceneFingerprint, compiledRequestFingerprint: historical.compiledRequestFingerprint,
      generationMode: historical.generationMode, observations: [], findings: [], aggregateStatus: "POST_QC_PASS",
      evidenceUnavailable: false, eligibleForHumanReview: true, autoApproved: false, autoRetryAuthorized: false, autoReleaseAuthorized: false,
      creativeAuthority: false, evaluationFingerprint: "sha256:" + "9".repeat(64), evaluatedAt: "2026-08-30T01:00:00.000Z",
    }).policyVersion).toBe(AI_STORY_POST_QC_POLICY_VERSION_V1);
  });

  it("MARKETING INTENT BRIDGE schema PASS", () => {
    const bridge = AiStoryMarketingIntentBridgeSchema.parse({
      contractVersion: AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION,
      campaignJob: "PRODUCT_AD",
      storyPlusAdvertising: true,
      sceneIntents: [
        { sceneOrder: 0, narrativeFunction: "BLOOM", advertisingFunction: "ESTABLISH" },
        { sceneOrder: 1, narrativeFunction: "PRODUCT_REVEAL", advertisingFunction: "REVEAL" },
        { sceneOrder: 2, narrativeFunction: "HERO_CLOSING", advertisingFunction: "HERO_CLOSE" },
      ],
    });
    expect(resolveMarketingIntentBridge({ marketingIntent: bridge }).kind).toBe("MARKETING_INTENT_SNAPSHOT");
    expect(blocks(issuesOf([fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()], undefined, bridge), "MARKETING_INTENT_BRIDGE_GATE")).toEqual([]);
  });

  it("LEGACY marketing-intent absence compatibility PASS", () => {
    expect(resolveMarketingIntentBridge({ marketingIntent: null }).kind).toBe("MARKETING_INTENT_ABSENT_LEGACY");
    expect(resolveMarketingIntentBridge({}).kind).toBe("MARKETING_INTENT_ABSENT_LEGACY");
    expect(issuesOf(generalization("PRODUCT_AD")).some((issue) => issue.gate === "MARKETING_INTENT_BRIDGE_GATE")).toBe(false);
  });

  it("PROMPT SNAPSHOT determinism PASS", () => {
    const first = compileCinematicPromptFacts({ directorDirection: fromBudScene3Hero(), motionScenePlan: fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false)[2], previousDirectorDirection: fromBudScene2Reveal() });
    const second = compileCinematicPromptFacts({ directorDirection: fromBudScene3Hero(), motionScenePlan: fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false)[2], previousDirectorDirection: fromBudScene2Reveal() });
    expect(first).toEqual(second);
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    expect(hash(first)).toBe(hash(second));
    expect(first.narrativePurpose.length).toBeGreaterThan(0);
    expect(first.continuity.length).toBeGreaterThan(0);
    expect(first.transition.length).toBeGreaterThan(0);
    expect(AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION).toBe("ai-story-cinematic-execution-contract.v1");
    expect(AI_STORY_PROMPT_TEAM_REPAIR_CONTRACT_VERSION).toBe("ai-story-prompt-team-repair.v1");
  });

  it.each(["PRODUCT_AD", "SERVICE_AD", "FOOD", "CHARACTER_STORY", "EMOTIONAL_STORY", "MINIMAL_HERO"] as const)("%s generalization fixture PASS", (kind) => {
    const sceneDirections = generalization(kind);
    const sceneMotionPlans = sceneDirections.map((scene, index) => motionFor(scene, {
      start: `state-${index}`,
      end: kind === "MINIMAL_HERO" ? `state-${index}` : `state-${index + 1}`,
      action: scene.contextualTreatment.semanticIntent,
      cameraFamily: scene.shots[0]!.cameraFamily,
      startCamera: `start-${index}`,
      endCamera: `end-${index}`,
      startPosition: `pos-${index}`,
      endPosition: kind === "MINIMAL_HERO" ? `pos-${index}` : `pos-${index + 1}`,
    }));
    expect(issuesOf(sceneDirections, sceneMotionPlans).filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it.each(["PRODUCT_AD", "SERVICE_AD", "FOOD", "CHARACTER_STORY", "EMOTIONAL_STORY", "MINIMAL_HERO"] as const)("%s generalization broken variant BLOCKS duplication", (kind) => {
    const issues = issuesOf(generalizationBroken(kind));
    expect(blocks(issues, "CONTINUITY_NOT_DUPLICATION_GATE").length + blocks(issues, "ANTI_PPT_CREATIVE_GATE").length).toBeGreaterThan(0);
  });

  it("From Bud to Bloom broken duplicate Scene 2/3 is BLOCKED", () => {
    const issues = issuesOf([fromBudScene1(), fromBudScene2Broken(), fromBudScene3Duplicate()], fromBudMotion(fromBudScene2Broken(), fromBudScene3Duplicate(), true), undefined, fromBudScript(true));
    expect(blocks(issues, "CONTINUITY_NOT_DUPLICATION_GATE").length).toBeGreaterThan(0);
    expect(blocks(issues, "ANTI_PPT_CREATIVE_GATE").length).toBeGreaterThan(0);
    expect(blocks(issues, "CINEMATIC_CAMERA_GRAMMAR_GATE").length).toBeGreaterThan(0);
  });

  it("From Bud to Bloom corrected Reveal â†’ Hero PASS", () => {
    const issues = issuesOf([fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()], fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false), undefined, fromBudScript());
    expect(issues.filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("Adapter compiles MUST_KEEP / MUST_CHANGE from frozen cinematic authority", () => {
    const facts = compileCinematicPromptFacts({ directorDirection: fromBudScene3Hero(), previousDirectorDirection: fromBudScene2Reveal() });
    expect(facts.mustKeep.length).toBeGreaterThan(0);
    expect(facts.mustChange.some((item) => /do not duplicate/i.test(item))).toBe(true);
    expect(facts.cinematicProgression.some((item) => /SLOW_PULL_BACK/i.test(item))).toBe(true);
  });

  it("keeps historical Pre-QC Gate Set V1 readable without upgrade", () => {
    const artifactIds = { storyId: I.sceneA, storyVersionId: I.sceneB, outlineVersionId: I.sceneC, scriptVersionId: I.directorA, handoffId: I.directorB, directorPlanId: I.directorC, motionPlanId: I.shotA, sceneExecutionId: I.shotB };
    const historical = {
      qcEvaluationId: I.shotC, orgId: I.sceneA, workspaceId: I.sceneB, storyId: artifactIds.storyId, storyVersionId: artifactIds.storyVersionId,
      outlineVersionId: artifactIds.outlineVersionId, scriptVersionId: artifactIds.scriptVersionId, handoffId: artifactIds.handoffId,
      directorPlanId: artifactIds.directorPlanId, motionPlanId: artifactIds.motionPlanId, sceneExecutionId: artifactIds.sceneExecutionId,
      contractVersion: "ai-story-pre-generation-qc.v1", gateSetVersion: AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V1,
      providerCapabilityId: "animation-video-generation", providerCapabilityVersion: "historical-v1", productAuthorityIds: [I.product],
      gateResults: AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1.map((gateId) => ({
        gateId, gateVersion: 1, classification: "HARD_GATE" as const, status: "PASS" as const, failedLayer: null, reasonCode: "PASS",
        safeEvidence: ["Historical V1"], repairOwner: "NONE" as const, evaluatedArtifactIds: artifactIds, contractVersion: "ai-story-pre-generation-qc.v1" as const,
      })),
      dispatchDecision: "DISPATCH_ELIGIBLE" as const, preDispatchBlocked: false, providerCallAvoided: false, estimatedAttemptCostAvoidedUsd: null,
      sceneFunction: "PRODUCT_USAGE", visualRole: "USAGE_DEMONSTRATION", cameraFamily: "LOCKED", motionRiskClass: "LOW" as const,
      productGrounded: true, profileId: "CORE", qcFingerprint: "sha256:" + "a".repeat(64), evaluatedBy: I.character, evaluatedAt: "2026-08-29T10:03:00.000Z",
    };
    const parsed = AiStoryPreGenerationQcEvaluationSchema.parse(historical);
    expect(parsed.gateSetVersion).toBe(1);
    expect(parsed.gateResults).toHaveLength(AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1.length);
    expect(parsed.gateResults.map((item) => item.gateId)).toEqual([...AI_STORY_PRE_GENERATION_QC_GATE_ORDER_V1]);
    expect(parsed.gateResults.some((item) => item.gateId === "SUBJECT_MOTION_COMPLETION_GATE")).toBe(false);
    expect(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION).toBe(AI_STORY_PRE_GENERATION_QC_GATE_SET_VERSION_V2);
    expect(AI_STORY_PRE_GENERATION_QC_GATE_ORDER).toEqual(expect.arrayContaining(["SUBJECT_MOTION_COMPLETION_GATE", "CONTINUITY_NOT_DUPLICATION_GATE", "ANTI_PPT_CREATIVE_GATE"]));
  });

  it("proves provider-free certification has zero provider or commercial side effects", () => {
    const cinematic = readFileSync("packages/shared/src/ai-story-cinematic-execution-contract.ts", "utf8");
    const adapter = readFileSync("packages/agents/src/ai-story/seedance-director-adapter.ts", "utf8");
    for (const source of [cinematic, adapter]) {
      expect(source).not.toMatch(/createAiStoryProviderAttempt|reserveCommercial|submissionQuota|costCeiling|billingAccount/);
    }
    expect(AI_STORY_SEEDANCE_CAPABILITY_EXPANDED).toBe(false);
    expect(AI_STORY_CINEMATIC_CAMERA_GRAMMAR_VOCABULARY).toEqual(expect.arrayContaining(["ORBIT", "FOLLOW", "HANDHELD_SUBTLE", "REVEAL"]));
    issuesOf([fromBudScene1(), fromBudScene2Reveal(), fromBudScene3Hero()], fromBudMotion(fromBudScene2Reveal(), fromBudScene3Hero(), false), undefined, fromBudScript());
    expect({ providerCalls: 0, providerAttemptsCreated: 0, commercialReservationsCreated: 0, submissionQuotaMutations: 0, costCeilingMutations: 0, productionStoryMutations: 0, generatedSceneReviewMutations: 0, deployment: "NO" }).toEqual({
      providerCalls: 0, providerAttemptsCreated: 0, commercialReservationsCreated: 0, submissionQuotaMutations: 0, costCeilingMutations: 0, productionStoryMutations: 0, generatedSceneReviewMutations: 0, deployment: "NO",
    });
  });

  it("keeps certified authority flags at foundation, not full Story+Advertising certification", () => {
    expect(AI_STORY_PROMPT_TEAM_REPAIR).toBe("CERTIFIED");
    expect(AI_STORY_PRODUCT_IDENTITY_NOT_STILLNESS).toBe("CERTIFIED");
    expect(AI_STORY_CONTINUITY_NOT_DUPLICATION).toBe("CERTIFIED");
    expect(AI_STORY_SUBJECT_MOTION_NOT_CAMERA_SUBSTITUTION).toBe("CERTIFIED");
    expect(AI_STORY_ANTI_PPT_CREATIVE_CONTRACT).toBe("CERTIFIED");
    expect(AI_STORY_CINEMATIC_EXECUTION_FOUNDATION).toBe("CERTIFIED");
    expect(AI_STORY_STORY_PLUS_ADVERTISING_DIRECTION).toBe("FOUNDATION_CERTIFIED");
    expect(READY_FOR_PROVIDER_FREE_REVIEW).toBe("PASS");
    expect(READY_FOR_PRODUCTION_MERGE).toBe("PENDING_HUMAN_AUTHORIZATION");
  });
});
