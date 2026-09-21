import { z } from "zod";
import type { AiStoryDirectorSceneDirection } from "./ai-story-director-plan";
import type { AiStorySceneMotionPlan } from "./ai-story-motion-plan";

export const AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION = "ai-story-cinematic-execution-contract.v1" as const;
export const AI_STORY_PROMPT_TEAM_REPAIR_CONTRACT_VERSION = "ai-story-prompt-team-repair.v1" as const;
export const AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION = "ai-story-marketing-intent-bridge.v1" as const;
export const AI_STORY_POST_QC_CREATIVE_AUTHORITY = false as const;
export const AI_STORY_CINEMATIC_EXECUTION_IS_COMPILED_PROJECTION = true as const;
export const AI_STORY_SUBJECT_MOTION_SOURCE_OWNER = "SCRIPT" as const;
export const AI_STORY_PROMPT_TEAM_REPAIR = "CERTIFIED" as const;
export const AI_STORY_PRODUCT_IDENTITY_NOT_STILLNESS = "CERTIFIED" as const;
export const AI_STORY_CONTINUITY_NOT_DUPLICATION = "CERTIFIED" as const;
export const AI_STORY_SUBJECT_MOTION_NOT_CAMERA_SUBSTITUTION = "CERTIFIED" as const;
export const AI_STORY_ANTI_PPT_CREATIVE_CONTRACT = "CERTIFIED" as const;
export const AI_STORY_CINEMATIC_EXECUTION_FOUNDATION = "CERTIFIED" as const;
export const AI_STORY_STORY_PLUS_ADVERTISING_DIRECTION = "STORY_AUTHORITY_CERTIFIED" as const;
export const READY_FOR_PROVIDER_FREE_REVIEW = "PASS" as const;
export const READY_FOR_PRODUCTION_MERGE = "PENDING_PR140_AND_HUMAN_AUTHORIZATION" as const;
export const AI_STORY_SEEDANCE_CAPABILITY_EXPANDED = false as const;

export const AI_STORY_CINEMATIC_CAMERA_GRAMMAR_VOCABULARY = [
  "LOCKED", "SLOW_PUSH_IN", "SLOW_PULL_BACK", "MINOR_LATERAL_DOLLY", "RACK_FOCUS",
  "GENTLE_PARALLAX", "SMALL_ARC", "PAN", "TILT", "TRACKING", "HANDHELD",
  "ORBIT", "FOLLOW", "HANDHELD_SUBTLE", "REVEAL", "STATIC", "LOCKED_HERO",
] as const;

export const AI_STORY_CINEMATIC_DIRECTOR_GATES = [
  "CINEMATIC_CAMERA_GRAMMAR_GATE",
  "CONTINUITY_NOT_DUPLICATION_GATE",
  "ANTI_PPT_CREATIVE_GATE",
  "CINEMATIC_EXECUTION_CONTRACT_GATE",
  "MUST_KEEP_MUST_CHANGE_SEPARATION_GATE",
] as const;

export const AI_STORY_CINEMATIC_MOTION_GATES = [
  "SUBJECT_MOTION_FIRST_CLASS_GATE",
  "SUBJECT_MOTION_COMPLETION_GATE",
] as const;

export const AI_STORY_MARKETING_INTENT_CAMPAIGN_JOBS = [
  "PRODUCT_AD",
  "SERVICE_AD",
  "FOOD",
  "CHARACTER_STORY",
  "EMOTIONAL_STORY",
  "MINIMAL_HERO",
] as const;

export const AI_STORY_MARKETING_INTENT_ADVERTISING_FUNCTIONS = [
  "INTRO",
  "ESTABLISH",
  "REVEAL",
  "USAGE",
  "SERVICE",
  "EMOTION",
  "HERO_CLOSE",
  "PACKSHOT",
  "CTA",
] as const;

const Text = z.string().trim().min(1).max(2000);

export const AiStoryMarketingIntentSceneBridgeSchema = z.object({
  sceneOrder: z.number().int().nonnegative(),
  narrativeFunction: Text.max(300),
  advertisingFunction: z.enum(AI_STORY_MARKETING_INTENT_ADVERTISING_FUNCTIONS),
}).strict();

export const AiStoryMarketingIntentSnapshotSchema = z.object({
  contractVersion: z.literal(AI_STORY_MARKETING_INTENT_BRIDGE_CONTRACT_VERSION),
  campaignJob: z.enum(AI_STORY_MARKETING_INTENT_CAMPAIGN_JOBS),
  storyPlusAdvertising: z.literal(true),
  source: z.literal("UPSTREAM_READ_ONLY").default("UPSTREAM_READ_ONLY"),
  regeneratesMarketingPlan: z.literal(false).default(false),
  sceneIntents: z.array(AiStoryMarketingIntentSceneBridgeSchema).min(1),
  primaryGoal: z.enum(["awareness", "engagement", "sales", "lead_generation", "other"]).optional(),
  targetAudience: Text.max(1000).optional(),
  contentAngle: Text.max(1000).optional(),
  keyMessage: Text.max(1000).optional(),
  desiredEmotion: Text.max(500).optional(),
  ctaStrategy: z.enum(["REQUIRED", "OPTIONAL", "NOT_REQUIRED", "BRAND_RESOLUTION"]).optional(),
  platform: Text.max(200).optional(),
  distributionContext: Text.max(1000).optional(),
  brandTone: Text.max(500).optional(),
  commercialAuthorityRefs: z.array(z.string().uuid()).optional(),
}).strict();
export const AiStoryMarketingIntentBridgeSchema = AiStoryMarketingIntentSnapshotSchema;
export type AiStoryMarketingIntentSnapshot = z.infer<typeof AiStoryMarketingIntentSnapshotSchema>;
export type AiStoryMarketingIntentBridge = AiStoryMarketingIntentSnapshot;
export type AiStoryCinematicDirectorGate = (typeof AI_STORY_CINEMATIC_DIRECTOR_GATES)[number];
export type AiStoryCinematicMotionGate = (typeof AI_STORY_CINEMATIC_MOTION_GATES)[number];
export type AiStoryCinematicIssue = {
  gate: AiStoryCinematicDirectorGate | AiStoryCinematicMotionGate | "MARKETING_INTENT_BRIDGE_GATE";
  severity: "BLOCK" | "WARN";
  code: string;
  message: string;
  repairOwner: "DIRECTOR" | "MOTION";
  sceneOrder: number;
  comparedSceneOrder: number | null;
};

export type AiStoryCinematicShotSizeFamily = "CLOSE" | "MID" | "WIDE" | "OTHER";
export type AiStoryCinematicCameraIntensity = "NONE" | "SUBTLE" | "MODERATE" | "MATERIAL";
export type AiStoryCinematicSubjectMotionMagnitude = "NONE" | "SUBTLE" | "MATERIAL";

export type AiStoryCinematicSceneSignature = {
  sceneOrder: number;
  scriptSceneId: string;
  narrativePurpose: string;
  visualRole: string;
  shotPurpose: string;
  shotSize: string;
  shotSizeFamily: AiStoryCinematicShotSizeFamily;
  cameraFamily: string;
  cameraMovementIntensity: AiStoryCinematicCameraIntensity;
  subjectMotionMagnitude: AiStoryCinematicSubjectMotionMagnitude;
  subjectActionFingerprint: string;
  compositionIntent: string;
  productEmphasis: string | null;
  focusKind: string;
  semanticIntent: string;
  audienceInformationCount: number;
  productEvidenceCount: number;
  entryVisualStateFingerprint: string;
  exitVisualStateFingerprint: string;
  visualInformationRevealed: string;
  productVisibilityProgression: string;
  negativeSpaceIntent: string;
  transitionIntent: string;
  continuityAxes: readonly string[];
  differentiationAxes: readonly string[];
  realizedMustKeep: readonly string[];
  realizedMustChange: readonly string[];
};

export type AiStoryCinematicPromptFacts = {
  narrativePurpose: readonly string[];
  subjectAction: readonly string[];
  camera: readonly string[];
  entryState: readonly string[];
  endState: readonly string[];
  continuity: readonly string[];
  mustKeep: readonly string[];
  mustChange: readonly string[];
  mustAvoid: readonly string[];
  transition: readonly string[];
  cinematicProgression: readonly string[];
};

export type AiStorySubjectMotionScriptTruth = {
  scriptSceneId: string;
  sceneOrder: number;
  sceneFunction: string;
  sceneStateIn: ReadonlyArray<{ dimension: string; subjectId: string; value: string }>;
  sceneStateDeltas: readonly unknown[];
  sceneStateOut: ReadonlyArray<{ dimension: string; subjectId: string; value: string }>;
  actionEntries: ReadonlyArray<{ action: string; storyEffect: string }>;
  newActionOutcomes: readonly string[];
};

export type AiStorySubjectMotionRequirement = {
  subjectMotionRequired: boolean;
  sourceOwner: "SCRIPT";
  evidence: readonly string[];
};

export type AiStoryMarketingIntentResolution =
  | { kind: "MARKETING_INTENT_ABSENT_LEGACY"; snapshot: null; bridge: null }
  | { kind: "MARKETING_INTENT_SNAPSHOT"; snapshot: AiStoryMarketingIntentSnapshot; bridge: AiStoryMarketingIntentSnapshot }
  | { kind: "INVALID"; issues: readonly AiStoryCinematicIssue[] };

const CLOSE_SIZES = new Set(["CLOSE", "MEDIUM_CLOSE", "EXTREME_CLOSE", "MACRO"]);
const MID_SIZES = new Set(["MEDIUM"]);
const WIDE_SIZES = new Set(["EXTREME_WIDE", "WIDE"]);
const PRODUCT_CLOSE_ROLES = new Set(["DETAIL_REVEAL", "TEXTURE_MACRO", "PACKSHOT", "HERO_INTRODUCTION"]);
const PRODUCT_CLOSE_COMPOSITION = new Set(["PRODUCT_DOMINANT", "DETAIL_ISOLATION"]);
const PRODUCT_CLOSE_EMPHASIS = new Set(["PRIMARY_HERO", "DETAIL_EVIDENCE", "PACKSHOT"]);
const HERO_STILL_ROLES = new Set(["HERO_INTRODUCTION", "PACKSHOT", "CTA_ENDING", "PAYOFF"]);
const CINEMATIC_DIMENSIONS = new Set(["VISUAL_ROLE", "SHOT_PURPOSE", "SHOT_SIZE", "CAMERA_FAMILY", "COMPOSITION", "PRODUCT_EMPHASIS", "FOCUS"]);
const IDENTITY_STILLNESS = new Set(["identity-intact", "unchanged", "static", "still"]);
const CAMERA_ONLY_MOTION_FAMILIES = new Set([
  "SLOW_PUSH_IN", "SLOW_PULL_BACK", "PAN", "TILT", "TRACKING", "ORBIT", "FOLLOW",
  "MINOR_LATERAL_DOLLY", "GENTLE_PARALLAX", "SMALL_ARC", "HANDHELD", "HANDHELD_SUBTLE", "REVEAL",
]);
const STILL_CAMERA_FAMILIES = new Set(["LOCKED", "STATIC", "LOCKED_HERO", "RACK_FOCUS"]);

export function cinematicShotSizeFamily(shotSize: string): AiStoryCinematicShotSizeFamily {
  if (CLOSE_SIZES.has(shotSize)) return "CLOSE";
  if (MID_SIZES.has(shotSize)) return "MID";
  if (WIDE_SIZES.has(shotSize)) return "WIDE";
  return "OTHER";
}

export function resolveMarketingIntentBridge(input: { marketingIntent?: unknown | null }): AiStoryMarketingIntentResolution {
  if (input.marketingIntent == null) return { kind: "MARKETING_INTENT_ABSENT_LEGACY", snapshot: null, bridge: null };
  const parsed = AiStoryMarketingIntentSnapshotSchema.safeParse(input.marketingIntent);
  if (!parsed.success) {
    return {
      kind: "INVALID",
      issues: [{
        gate: "MARKETING_INTENT_BRIDGE_GATE",
        severity: "BLOCK",
        code: "MARKETING_INTENT_SNAPSHOT_INVALID",
        message: "Marketing intent snapshot does not match the certified read-only schema",
        repairOwner: "DIRECTOR",
        sceneOrder: 0,
        comparedSceneOrder: null,
      }],
    };
  }
  return { kind: "MARKETING_INTENT_SNAPSHOT", snapshot: parsed.data, bridge: parsed.data };
}

export function deriveSubjectMotionRequirement(truth: AiStorySubjectMotionScriptTruth): AiStorySubjectMotionRequirement {
  const start = new Map(truth.sceneStateIn.map((fact) => [`${fact.subjectId}:${fact.dimension}`, fact.value]));
  const stateProgressed = truth.sceneStateOut.some((fact) => start.get(`${fact.subjectId}:${fact.dimension}`) !== fact.value);
  const required = truth.sceneStateDeltas.length > 0 || stateProgressed || truth.newActionOutcomes.length > 0;
  const evidence = [
    ...(truth.sceneStateDeltas.length ? [`Script declares ${truth.sceneStateDeltas.length} state delta(s)`] : []),
    ...(stateProgressed ? ["Script entry state differs from required exit state"] : []),
    ...truth.newActionOutcomes.map((item) => `Script action outcome: ${item}`),
    ...(required ? [] : ["Script does not require observable subject-state progression; justified stillness remains valid"]),
  ];
  return { subjectMotionRequired: required, sourceOwner: "SCRIPT", evidence };
}

function shotOf(scene: AiStoryDirectorSceneDirection) {
  return [...scene.shots].sort((a, b) => a.order - b.order)[0]!;
}

export function cinematicCameraMovementIntensity(cameraFamily: string): AiStoryCinematicCameraIntensity {
  if (STILL_CAMERA_FAMILIES.has(cameraFamily)) return "NONE";
  if (["SLOW_PUSH_IN", "SLOW_PULL_BACK", "MINOR_LATERAL_DOLLY", "GENTLE_PARALLAX", "HANDHELD_SUBTLE", "RACK_FOCUS"].includes(cameraFamily)) return "SUBTLE";
  if (["PAN", "TILT", "TRACKING", "FOLLOW", "SMALL_ARC", "HANDHELD"].includes(cameraFamily)) return "MODERATE";
  return "MATERIAL";
}

function fingerprintFacts(values: readonly string[]): string {
  return [...values].map((item) => item.trim().toLowerCase()).sort().join("|");
}

export function cinematicSceneSignature(
  scene: AiStoryDirectorSceneDirection,
  options: { motion?: AiStorySceneMotionPlan | null; previous?: AiStoryDirectorSceneDirection | null } = {},
): AiStoryCinematicSceneSignature {
  const shot = shotOf(scene);
  const motion = options.motion ?? null;
  const subjectChanged = motion ? hasVisibleSubjectStateChange(motion) : false;
  const entryFacts = motion
    ? motion.actionExecutions.flatMap((action) => action.startState.map((fact) => `${fact.property}:${fact.value}`))
    : [];
  const exitFacts = motion
    ? motion.actionExecutions.flatMap((action) => action.endState.map((fact) => `${fact.property}:${fact.value}`))
    : [];
  const previous = options.previous ? cinematicSceneSignature(options.previous) : null;
  const currentPartial = {
    narrativePurpose: `${scene.servedScriptSceneFunction}:${scene.sceneVisualRole}`,
    visualRole: scene.sceneVisualRole,
    shotPurpose: shot.shotPurpose,
    shotSize: shot.shotSize,
    shotSizeFamily: cinematicShotSizeFamily(shot.shotSize),
    cameraFamily: shot.cameraFamily,
    compositionIntent: shot.compositionIntent,
    productEmphasis: shot.productEmphasis,
    focusKind: shot.focusTarget.kind,
  };
  const differentiationAxes = previous
    ? [
        ...(previous.narrativePurpose !== currentPartial.narrativePurpose ? ["NARRATIVE_PURPOSE"] : []),
        ...(previous.visualRole !== currentPartial.visualRole ? ["VISUAL_ROLE"] : []),
        ...(previous.shotPurpose !== currentPartial.shotPurpose ? ["SHOT_PURPOSE"] : []),
        ...(previous.shotSizeFamily !== currentPartial.shotSizeFamily || previous.shotSize !== currentPartial.shotSize ? ["SHOT_SIZE"] : []),
        ...(previous.cameraFamily !== currentPartial.cameraFamily ? ["CAMERA_FAMILY"] : []),
        ...(previous.compositionIntent !== currentPartial.compositionIntent ? ["COMPOSITION"] : []),
        ...(previous.productEmphasis !== currentPartial.productEmphasis ? ["PRODUCT_EMPHASIS"] : []),
        ...(previous.focusKind !== currentPartial.focusKind ? ["FOCUS"] : []),
        ...(subjectChanged ? ["SUBJECT_ACTION"] : []),
      ]
    : ["NARRATIVE_PURPOSE", "VISUAL_ROLE"];
  return {
    sceneOrder: scene.sceneOrder,
    scriptSceneId: scene.scriptSceneId,
    ...currentPartial,
    cameraMovementIntensity: cinematicCameraMovementIntensity(shot.cameraFamily),
    subjectMotionMagnitude: subjectChanged ? "MATERIAL" : "NONE",
    subjectActionFingerprint: fingerprintFacts(motion ? motion.actionExecutions.map((action) => action.semanticAction) : []),
    semanticIntent: scene.contextualTreatment.semanticIntent,
    audienceInformationCount: scene.newAudienceInformation.length + shot.newAudienceInformation.length,
    productEvidenceCount: scene.servedProductEvidence.length,
    entryVisualStateFingerprint: fingerprintFacts(entryFacts),
    exitVisualStateFingerprint: fingerprintFacts(exitFacts),
    visualInformationRevealed: fingerprintFacts([...scene.newAudienceInformation, ...shot.newAudienceInformation, ...scene.servedProductEvidence]),
    productVisibilityProgression: `${shot.productEmphasis ?? "NONE"}:${subjectChanged ? "PROGRESSING" : "STABLE"}`,
    negativeSpaceIntent: currentPartial.shotSizeFamily === "WIDE" || shot.compositionIntent === "SCALE_CONTEXT" ? "CTA_READY_NEGATIVE_SPACE" : "FRAMED_SUBJECT",
    transitionIntent: previous ? `${previous.visualRole}->${scene.sceneVisualRole}` : "OPENING",
    continuityAxes: ["PRODUCT_IDENTITY", "PALETTE_FAMILY", "LIGHTING_FAMILY"],
    differentiationAxes,
    realizedMustKeep: ["Product identity remains canonical", "Product identity is not stillness"],
    realizedMustChange: differentiationAxes,
  };
}

function realizedDeltas(previous: AiStoryCinematicSceneSignature, current: AiStoryCinematicSceneSignature): string[] {
  const deltas: string[] = [];
  if (previous.narrativePurpose !== current.narrativePurpose) deltas.push("NARRATIVE_PURPOSE");
  if (previous.visualRole !== current.visualRole) deltas.push("VISUAL_ROLE");
  if (previous.shotPurpose !== current.shotPurpose) deltas.push("SHOT_PURPOSE");
  if (previous.shotSizeFamily !== current.shotSizeFamily || previous.shotSize !== current.shotSize) deltas.push("SHOT_SIZE");
  if (previous.cameraFamily !== current.cameraFamily) deltas.push("CAMERA_FAMILY");
  if (previous.compositionIntent !== current.compositionIntent) deltas.push("COMPOSITION");
  if (previous.productEmphasis !== current.productEmphasis) deltas.push("PRODUCT_EMPHASIS");
  if (previous.focusKind !== current.focusKind) deltas.push("FOCUS");
  if (previous.subjectMotionMagnitude !== current.subjectMotionMagnitude) deltas.push("SUBJECT_ACTION");
  if (previous.productVisibilityProgression !== current.productVisibilityProgression) deltas.push("PRODUCT_VISIBILITY");
  if (previous.negativeSpaceIntent !== current.negativeSpaceIntent) deltas.push("NEGATIVE_SPACE");
  return deltas;
}

function structuredDuplicate(previous: AiStoryCinematicSceneSignature, current: AiStoryCinematicSceneSignature): boolean {
  return previous.visualRole === current.visualRole
    && previous.shotSizeFamily === current.shotSizeFamily
    && previous.cameraFamily === current.cameraFamily
    && previous.compositionIntent === current.compositionIntent
    && previous.focusKind === current.focusKind
    && previous.subjectMotionMagnitude === current.subjectMotionMagnitude
    && previous.subjectActionFingerprint === current.subjectActionFingerprint
    && previous.productVisibilityProgression === current.productVisibilityProgression;
}

function isProductClosePack(signature: AiStoryCinematicSceneSignature): boolean {
  return signature.shotSizeFamily === "CLOSE"
    && (PRODUCT_CLOSE_COMPOSITION.has(signature.compositionIntent) || PRODUCT_CLOSE_EMPHASIS.has(signature.productEmphasis ?? "") || PRODUCT_CLOSE_ROLES.has(signature.visualRole));
}

function advertisingFunctionsForRole(visualRole: string): readonly string[] {
  switch (visualRole) {
    case "HERO_INTRODUCTION":
    case "ENVIRONMENT_ESTABLISH":
      return ["INTRO", "ESTABLISH", "HERO_CLOSE"];
    case "DETAIL_REVEAL":
    case "TEXTURE_MACRO":
      return ["REVEAL"];
    case "USAGE_DEMONSTRATION":
    case "RELATIONSHIP":
      return ["USAGE", "SERVICE"];
    case "REACTION":
      return ["EMOTION"];
    case "PAYOFF":
    case "PACKSHOT":
    case "CTA_ENDING":
      return ["HERO_CLOSE", "PACKSHOT", "CTA"];
    default:
      return AI_STORY_MARKETING_INTENT_ADVERTISING_FUNCTIONS;
  }
}

function factKey(fact: { entityId: string; property: string }): string {
  return `${fact.entityId}:${fact.property}`;
}

function hasVisibleSubjectStateChange(scene: AiStorySceneMotionPlan): boolean {
  return scene.actionExecutions.some((action) => {
    const start = new Map(action.startState.map((fact) => [factKey(fact), fact.value]));
    return action.endState.some((fact) => {
      const prior = start.get(factKey(fact));
      if (prior === undefined) return !IDENTITY_STILLNESS.has(fact.value.toLowerCase());
      if (prior === fact.value) return false;
      if (fact.property === "PRODUCT_STATE" && IDENTITY_STILLNESS.has(fact.value.toLowerCase()) && IDENTITY_STILLNESS.has(prior.toLowerCase())) return false;
      return true;
    }) || action.actionPath.some((phase) => phase.stateChanges.some((change) => change.fromValue !== change.toValue && !(change.property === "PRODUCT_STATE" && IDENTITY_STILLNESS.has(change.toValue.toLowerCase()))));
  });
}

export function compileCinematicPromptFacts(input: {
  directorDirection: AiStoryDirectorSceneDirection;
  motionScenePlan?: AiStorySceneMotionPlan | null;
  previousDirectorDirection?: AiStoryDirectorSceneDirection | null;
  scriptTruth?: AiStorySubjectMotionScriptTruth | null;
}): AiStoryCinematicPromptFacts {
  const current = cinematicSceneSignature(input.directorDirection);
  const previous = input.previousDirectorDirection ? cinematicSceneSignature(input.previousDirectorDirection) : null;
  const deltas = previous ? realizedDeltas(previous, current) : ["NARRATIVE_PURPOSE", "VISUAL_ROLE", "CAMERA_FAMILY", "SHOT_SIZE"];
  const requirement = input.scriptTruth ? deriveSubjectMotionRequirement(input.scriptTruth) : null;
  const mustKeep = [
    "Product identity remains canonical",
    "Product identity is not stillness",
    "Preserve wrapping, product type, palette family, and lighting family",
  ];
  const mustChange = previous
    ? [
        `Change these cinematic axes: ${deltas.join(", ") || "NONE"}`,
        "Do not duplicate the previous Scene visual treatment",
        `Visual role ${current.visualRole} must progress from ${previous.visualRole}`,
        `Framing ${current.shotSize} and camera ${current.cameraFamily} must differ from ${previous.shotSize} / ${previous.cameraFamily} when those axes are must-change`,
      ]
    : [
        `Establish narrative purpose ${current.visualRole}`,
        `Camera ${current.cameraFamily} with shot size ${current.shotSize}`,
      ];
  const motion = input.motionScenePlan;
  const subjectAction = motion
    ? motion.actionExecutions.map((action) => action.semanticAction)
    : input.scriptTruth?.actionEntries.map((entry) => entry.action) ?? [];
  const entryState = motion
    ? motion.actionExecutions.flatMap((action) => action.startState.map((fact) => `${fact.property}: ${fact.value}`))
    : input.scriptTruth?.sceneStateIn.map((fact) => `${fact.dimension}: ${fact.value}`) ?? [];
  const endState = motion
    ? motion.actionExecutions.flatMap((action) => action.endState.map((fact) => `${fact.property}: ${fact.value}`))
    : input.scriptTruth?.sceneStateOut.map((fact) => `${fact.dimension}: ${fact.value}`) ?? [];
  const continuity = previous
    ? ["Keep product identity, palette family, and lighting family continuous", "Continuity is not duplication"]
    : ["Establish the visual world that later Scenes may continue"];
  const transition = previous
    ? [`Progress ${previous.visualRole} into ${current.visualRole}`]
    : ["Open the Story without a prior transition"];
  const cinematicProgression = [
    `Narrative purpose ${current.visualRole}`,
    `Camera grammar ${current.cameraFamily}`,
    `Shot size ${current.shotSize}`,
    `Composition ${current.compositionIntent}`,
    ...(requirement?.subjectMotionRequired ? ["Subject/world motion is required; camera motion is insufficient"] : ["Justified stillness is valid when Script requires no subject-state change"]),
  ];
  return {
    narrativePurpose: [`${input.directorDirection.servedScriptSceneFunction} as ${current.visualRole}`],
    subjectAction: [...new Set(subjectAction.filter(Boolean))],
    camera: [`${current.cameraFamily} / ${current.shotSize}`],
    entryState: [...new Set(entryState.filter(Boolean))],
    endState: [...new Set(endState.filter(Boolean))],
    continuity: [...new Set(continuity)],
    mustKeep: [...new Set(mustKeep)],
    mustChange: [...new Set(mustChange)],
    mustAvoid: ["Do not convert product identity into a still slide", "Do not invent a new beat"],
    transition: [...new Set(transition)],
    cinematicProgression: [...new Set(cinematicProgression)],
  };
}

export function evaluateCinematicDirectorContract(input: {
  sceneDirections: readonly AiStoryDirectorSceneDirection[];
  sceneMotionPlans?: readonly AiStorySceneMotionPlan[] | null;
  scriptScenes?: readonly AiStorySubjectMotionScriptTruth[] | null;
  marketingIntent?: unknown | null;
}): AiStoryCinematicIssue[] {
  const issues: AiStoryCinematicIssue[] = [];
  const add = (issue: AiStoryCinematicIssue) => issues.push(issue);
  const ordered = [...input.sceneDirections].sort((a, b) => a.sceneOrder - b.sceneOrder);
  const signatures = ordered.map((scene, index) => cinematicSceneSignature(scene, {
    motion: input.sceneMotionPlans?.find((item) => item.directorSceneId === scene.directorSceneId) ?? null,
    previous: index > 0 ? ordered[index - 1] : null,
  }));

  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1]!;
    const current = signatures[index]!;
    const scene = input.sceneDirections.find((item) => item.scriptSceneId === current.scriptSceneId)!;
    const deltas = realizedDeltas(previous, current);
    const grammarChanged = deltas.some((dimension) => ["VISUAL_ROLE", "CAMERA_FAMILY", "SHOT_SIZE", "COMPOSITION", "PRODUCT_EMPHASIS", "FOCUS", "NEGATIVE_SPACE"].includes(dimension));
    const grammarUnchanged = previous.cameraFamily === current.cameraFamily
      && previous.shotSizeFamily === current.shotSizeFamily
      && previous.visualRole === current.visualRole;
    if (grammarUnchanged) {
      add({
        gate: "CINEMATIC_CAMERA_GRAMMAR_GATE",
        severity: "BLOCK",
        code: "CAMERA_GRAMMAR_UNCHANGED",
        message: `Scene ${current.sceneOrder + 1} repeats camera ${current.cameraFamily}, ${current.shotSizeFamily} framing, and visual role ${current.visualRole} from Scene ${previous.sceneOrder + 1}`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    } else if (previous.cameraFamily === current.cameraFamily && previous.shotSizeFamily === current.shotSizeFamily) {
      add({
        gate: "CINEMATIC_CAMERA_GRAMMAR_GATE",
        severity: "WARN",
        code: "CAMERA_FAMILY_REPEATED_WITH_VALID_DELTA",
        message: `Scene ${current.sceneOrder + 1} repeats camera family ${current.cameraFamily} inside the same ${current.shotSizeFamily} family but changes ${deltas.join(", ")}`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    }

    const duplicateClose = isProductClosePack(previous) && isProductClosePack(current)
      && previous.cameraFamily === current.cameraFamily
      && previous.shotSizeFamily === current.shotSizeFamily
      && previous.compositionIntent === current.compositionIntent;
    if (duplicateClose || structuredDuplicate(previous, current)) {
      add({
        gate: "CONTINUITY_NOT_DUPLICATION_GATE",
        severity: "BLOCK",
        code: "CONTINUITY_COLLAPSED_INTO_DUPLICATION",
        message: `Scene ${current.sceneOrder + 1} is a visual duplicate of Scene ${previous.sceneOrder + 1}; product continuity is not a license to repeat the same close-up`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    }

    if (!grammarChanged) {
      add({
        gate: "CINEMATIC_EXECUTION_CONTRACT_GATE",
        severity: "BLOCK",
        code: "CINEMATIC_PROGRESSION_MISSING",
        message: `Scene ${current.sceneOrder + 1} declares no realized cinematic must-change against Scene ${previous.sceneOrder + 1}`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    } else {
      const claimed = scene.differentiationRequirement.dimensions.filter((dimension) => CINEMATIC_DIMENSIONS.has(dimension));
      const realizedClaimed = claimed.filter((dimension) => deltas.includes(dimension));
      if (claimed.length && !realizedClaimed.length && !grammarChanged) {
        add({
          gate: "CINEMATIC_EXECUTION_CONTRACT_GATE",
          severity: "BLOCK",
          code: "CLAIMED_CINEMATIC_CHANGE_NOT_REALIZED",
          message: `Scene ${current.sceneOrder + 1} claims cinematic differentiation that is not realized in shot grammar`,
          repairOwner: "DIRECTOR",
          sceneOrder: current.sceneOrder,
          comparedSceneOrder: previous.sceneOrder,
        });
      }
    }

    const keep = new Set(["PRODUCT_IDENTITY", "PRODUCT_MATERIAL"]);
    const change = new Set(deltas);
    if ([...keep].some((item) => change.has(item))) {
      add({
        gate: "MUST_KEEP_MUST_CHANGE_SEPARATION_GATE",
        severity: "BLOCK",
        code: "MUST_KEEP_MUST_CHANGE_COLLISION",
        message: `Scene ${current.sceneOrder + 1} collides must-keep product identity with a must-change identity rewrite`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    } else if (!deltas.length) {
      add({
        gate: "MUST_KEEP_MUST_CHANGE_SEPARATION_GATE",
        severity: "BLOCK",
        code: "MUST_CHANGE_MISSING",
        message: `Scene ${current.sceneOrder + 1} keeps continuity but does not declare a cinematic must-change`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    }
  }

  for (let index = 1; index < signatures.length; index += 1) {
    const previous = signatures[index - 1]!;
    const current = signatures[index]!;
    const currentDirection = ordered[index]!;
    const justifiedStillness = HERO_STILL_ROLES.has(current.visualRole)
      && current.subjectMotionMagnitude === "NONE"
      && (STILL_CAMERA_FAMILIES.has(current.cameraFamily) || current.cameraMovementIntensity === "SUBTLE")
      && current.differentiationAxes.some((axis) => ["NARRATIVE_PURPOSE", "VISUAL_ROLE", "SHOT_SIZE", "CAMERA_FAMILY", "COMPOSITION", "NEGATIVE_SPACE"].includes(axis));
    const repeatedCameraOnly = previous.cameraFamily === current.cameraFamily
      && previous.shotSizeFamily === current.shotSizeFamily
      && CAMERA_ONLY_MOTION_FAMILIES.has(current.cameraFamily)
      && current.subjectMotionMagnitude === "NONE"
      && previous.subjectMotionMagnitude === "NONE";
    const repeatedEstablishedProduct = previous.productVisibilityProgression.endsWith(":STABLE")
      && current.productVisibilityProgression.endsWith(":STABLE")
      && previous.shotSizeFamily === current.shotSizeFamily
      && previous.cameraFamily === current.cameraFamily
      && previous.visualRole === current.visualRole;
    if (isProductClosePack(previous) && isProductClosePack(current) && previous.cameraFamily === current.cameraFamily && previous.shotSizeFamily === current.shotSizeFamily) {
      add({
        gate: "ANTI_PPT_CREATIVE_GATE",
        severity: "BLOCK",
        code: "ANTI_PPT_SLIDE_PAIR",
        message: `Scenes ${previous.sceneOrder + 1} and ${current.sceneOrder + 1} read as independent product slides rather than a cinematic progression`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    } else if (repeatedCameraOnly || repeatedEstablishedProduct) {
      add({
        gate: "ANTI_PPT_CREATIVE_GATE",
        severity: "BLOCK",
        code: "ANTI_PPT_CAMERA_ONLY_OR_STATIC_REPEAT",
        message: `Scene ${current.sceneOrder + 1} repeats framing, camera family, and static Product behavior from Scene ${previous.sceneOrder + 1}`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    } else if (justifiedStillness && /justif/i.test(currentDirection.differentiationRequirement.rationale)) {
      add({
        gate: "ANTI_PPT_CREATIVE_GATE",
        severity: "WARN",
        code: "ANTI_PPT_JUSTIFIED_MINIMAL_REPETITION",
        message: `Scene ${current.sceneOrder + 1} uses justified minimalism; adjacent progression remains semantically distinct`,
        repairOwner: "DIRECTOR",
        sceneOrder: current.sceneOrder,
        comparedSceneOrder: previous.sceneOrder,
      });
    }
  }
  if (signatures.length >= 3 && signatures.every((item) => item.compositionIntent === "PRODUCT_DOMINANT" && item.shotSizeFamily === "CLOSE")) {
    add({
      gate: "ANTI_PPT_CREATIVE_GATE",
      severity: "BLOCK",
      code: "ANTI_PPT_STORY_IS_SLIDESHOW",
      message: "The Story is a sequence of product-dominant close-ups without cinematic scale change",
      repairOwner: "DIRECTOR",
      sceneOrder: signatures[signatures.length - 1]!.sceneOrder,
      comparedSceneOrder: signatures[0]!.sceneOrder,
    });
  } else if (signatures.length >= 3 && new Set(signatures.map((item) => item.visualRole)).size === 1 && new Set(signatures.map((item) => item.shotSizeFamily)).size === 1) {
    add({
      gate: "ANTI_PPT_CREATIVE_GATE",
      severity: "WARN",
      code: "ANTI_PPT_FLAT_VISUAL_ROLE",
      message: "Every Scene shares one visual role and shot-size family; the Story risks reading as slides",
      repairOwner: "DIRECTOR",
      sceneOrder: signatures[signatures.length - 1]!.sceneOrder,
      comparedSceneOrder: signatures[0]!.sceneOrder,
    });
  }

  const marketing = resolveMarketingIntentBridge({ marketingIntent: input.marketingIntent });
  if (marketing.kind === "INVALID") issues.push(...marketing.issues);
  if (marketing.kind === "MARKETING_INTENT_SNAPSHOT") {
    for (const intent of marketing.snapshot.sceneIntents) {
      const signature = signatures.find((item) => item.sceneOrder === intent.sceneOrder);
      if (!signature) {
        add({
          gate: "MARKETING_INTENT_BRIDGE_GATE",
          severity: "WARN",
          code: "MARKETING_INTENT_SCENE_UNBOUND",
          message: `Marketing intent for sceneOrder ${intent.sceneOrder} has no Director Scene`,
          repairOwner: "DIRECTOR",
          sceneOrder: intent.sceneOrder,
          comparedSceneOrder: null,
        });
        continue;
      }
      if (!advertisingFunctionsForRole(signature.visualRole).includes(intent.advertisingFunction)) {
        add({
          gate: "MARKETING_INTENT_BRIDGE_GATE",
          severity: "BLOCK",
          code: "MARKETING_INTENT_ROLE_MISMATCH",
          message: `Scene ${signature.sceneOrder + 1} advertising function ${intent.advertisingFunction} is incompatible with visual role ${signature.visualRole}`,
          repairOwner: "DIRECTOR",
          sceneOrder: signature.sceneOrder,
          comparedSceneOrder: null,
        });
      }
    }
  }

  return issues;
}

export function evaluateSubjectMotionContract(input: {
  sceneDirections: readonly AiStoryDirectorSceneDirection[];
  sceneMotionPlans: readonly AiStorySceneMotionPlan[];
  scriptScenes?: readonly AiStorySubjectMotionScriptTruth[] | null;
}): AiStoryCinematicIssue[] {
  const issues: AiStoryCinematicIssue[] = [];
  const ordered = [...input.sceneMotionPlans].sort((a, b) => a.sceneOrder - b.sceneOrder);
  for (const motion of ordered) {
    const truth = input.scriptScenes?.find((scene) => scene.scriptSceneId === motion.scriptSceneId)
      ?? input.scriptScenes?.find((scene) => scene.sceneOrder === motion.sceneOrder);
    const requirement = truth
      ? deriveSubjectMotionRequirement(truth)
      : { subjectMotionRequired: false, sourceOwner: "SCRIPT" as const, evidence: ["No Script truth supplied; subject motion is not inferred from Director or camera"] };
    const subjectChanged = hasVisibleSubjectStateChange(motion);
    const cameraOnly = motion.cameraExecutions.some((camera) => CAMERA_ONLY_MOTION_FAMILIES.has(camera.cameraFamily));
    if (requirement.subjectMotionRequired && !subjectChanged) {
      issues.push({
        gate: "SUBJECT_MOTION_FIRST_CLASS_GATE",
        severity: "BLOCK",
        code: "CAMERA_MOTION_SUBSTITUTED_FOR_SUBJECT",
        message: `Scene ${motion.sceneOrder + 1} Script requires observable subject/world progression; camera execution cannot satisfy it`,
        repairOwner: "MOTION",
        sceneOrder: motion.sceneOrder,
        comparedSceneOrder: null,
      });
      issues.push({
        gate: "SUBJECT_MOTION_COMPLETION_GATE",
        severity: "BLOCK",
        code: "SUBJECT_MOTION_COMPLETION_CAMERA_ONLY",
        message: `Scene ${motion.sceneOrder + 1} has no completed subject-state path; ${cameraOnly ? "push/pull/pan/track/orbit" : "camera execution"} cannot stand in for the required action`,
        repairOwner: "MOTION",
        sceneOrder: motion.sceneOrder,
        comparedSceneOrder: null,
      });
    }
  }
  return issues;
}

export function compileCinematicExecutionProjection(input: {
  sceneDirections: readonly AiStoryDirectorSceneDirection[];
  sceneMotionPlans?: readonly AiStorySceneMotionPlan[] | null;
  scriptScenes?: readonly AiStorySubjectMotionScriptTruth[] | null;
  lineage?: {
    scriptFingerprint?: string | null;
    sceneFingerprint?: string | null;
    directorFingerprint?: string | null;
    motionFingerprint?: string | null;
  };
}): {
  contractVersion: typeof AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION;
  creativeAuthority: false;
  compiledProjection: true;
  lineage: {
    scriptFingerprint: string | null;
    sceneFingerprint: string | null;
    directorFingerprint: string | null;
    motionFingerprint: string | null;
  };
  scenes: Array<{
    sceneOrder: number;
    narrativePurpose: string;
    entryVisualState: string;
    subjectAction: string;
    cameraAction: string;
    visualProgression: string;
    exitVisualState: string;
    transitionIntent: string;
    mustKeep: readonly string[];
    mustChange: readonly string[];
    mustAvoid: readonly string[];
    continuityAxes: readonly string[];
    differentiationAxes: readonly string[];
    subjectMotionRequired: boolean;
    subjectMotionSourceOwner: "SCRIPT";
  }>;
} {
  const ordered = [...input.sceneDirections].sort((a, b) => a.sceneOrder - b.sceneOrder);
  return {
    contractVersion: AI_STORY_CINEMATIC_EXECUTION_CONTRACT_VERSION,
    creativeAuthority: false,
    compiledProjection: true,
    lineage: {
      scriptFingerprint: input.lineage?.scriptFingerprint ?? null,
      sceneFingerprint: input.lineage?.sceneFingerprint ?? null,
      directorFingerprint: input.lineage?.directorFingerprint ?? null,
      motionFingerprint: input.lineage?.motionFingerprint ?? null,
    },
    scenes: ordered.map((scene, index) => {
      const previous = index > 0 ? ordered[index - 1] : null;
      const motion = input.sceneMotionPlans?.find((item) => item.directorSceneId === scene.directorSceneId);
      const truth = input.scriptScenes?.find((item) => item.scriptSceneId === scene.scriptSceneId);
      const facts = compileCinematicPromptFacts({
        directorDirection: scene,
        motionScenePlan: motion,
        previousDirectorDirection: previous,
        scriptTruth: truth,
      });
      const requirement = truth ? deriveSubjectMotionRequirement(truth) : { subjectMotionRequired: false, sourceOwner: "SCRIPT" as const };
      const deltas = previous ? realizedDeltas(cinematicSceneSignature(previous), cinematicSceneSignature(scene)) : [];
      return {
        sceneOrder: scene.sceneOrder,
        narrativePurpose: facts.narrativePurpose[0] ?? scene.sceneVisualRole,
        entryVisualState: facts.entryState.join("; ") || "unspecified",
        subjectAction: facts.subjectAction.join("; ") || "unspecified",
        cameraAction: facts.camera[0] ?? scene.shots[0]!.cameraFamily,
        visualProgression: facts.cinematicProgression.join("; "),
        exitVisualState: facts.endState.join("; ") || "unspecified",
        transitionIntent: facts.transition[0] ?? "none",
        mustKeep: facts.mustKeep,
        mustChange: facts.mustChange,
        mustAvoid: facts.mustAvoid,
        continuityAxes: ["PRODUCT_IDENTITY", "PALETTE_FAMILY", "LIGHTING_FAMILY"],
        differentiationAxes: deltas.length ? deltas : ["NARRATIVE_PURPOSE"],
        subjectMotionRequired: requirement.subjectMotionRequired,
        subjectMotionSourceOwner: "SCRIPT",
      };
    }),
  };
}

export function evaluateCinematicExecutionContract(input: {
  sceneDirections: readonly AiStoryDirectorSceneDirection[];
  sceneMotionPlans?: readonly AiStorySceneMotionPlan[] | null;
  scriptScenes?: readonly AiStorySubjectMotionScriptTruth[] | null;
  marketingIntent?: unknown | null;
}): AiStoryCinematicIssue[] {
  return [
    ...evaluateCinematicDirectorContract({
      sceneDirections: input.sceneDirections,
      sceneMotionPlans: input.sceneMotionPlans,
      scriptScenes: input.scriptScenes,
      marketingIntent: input.marketingIntent,
    }),
    ...(input.sceneMotionPlans?.length
      ? evaluateSubjectMotionContract({
        sceneDirections: input.sceneDirections,
        sceneMotionPlans: input.sceneMotionPlans,
        scriptScenes: input.scriptScenes,
      })
      : []),
  ];
}

export const PRODUCT_IDENTITY_NOT_STILLNESS = AI_STORY_PRODUCT_IDENTITY_NOT_STILLNESS;
export const CONTINUITY_NOT_DUPLICATION = AI_STORY_CONTINUITY_NOT_DUPLICATION;
export const ANTI_PPT_CREATIVE_CONTRACT = AI_STORY_ANTI_PPT_CREATIVE_CONTRACT;
