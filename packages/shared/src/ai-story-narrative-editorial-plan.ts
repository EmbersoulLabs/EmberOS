import { z } from "zod";
import type { AiStoryDirectorSceneDirection, AiStoryDirectorShot } from "./ai-story-director-plan";
import type { AiStoryGenerationPlan, AiStoryGenerationUnit } from "./ai-story-generation-unit";
import type { AiStorySceneMotionPlan } from "./ai-story-motion-plan";

export const AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION = "ai-story-narrative-editorial-plan.v1" as const;
export const AI_STORY_NARRATIVE_EDITORIAL_PLAN_STATUSES = ["DRAFT", "VALIDATED", "APPROVED", "FROZEN", "SUPERSEDED"] as const;

export const AI_STORY_NARRATIVE_EDITOR_AUTHORITY = "CERTIFIED" as const;
export const EDITORIAL_TIMELINE_AUTHORITY = "CERTIFIED" as const;
export const GENERATION_UNIT_TO_EDITORIAL_BINDING = "CERTIFIED" as const;
export const EDITORIAL_CAUSAL_ORDER = "CERTIFIED" as const;
export const CUT_ON_ACTION_AUTHORITY = "CERTIFIED" as const;
export const REACTION_TIMING_AUTHORITY = "CERTIFIED" as const;
export const EDITORIAL_DUPLICATION_PROTECTION = "CERTIFIED" as const;
export const EDITORIAL_RHYTHM_AUTHORITY = "CERTIFIED" as const;
export const SCENE_BRIDGE_AUTHORITY = "CERTIFIED" as const;
export const COMMERCIAL_PAYOFF_EDITING_AUTHORITY = "CERTIFIED" as const;
export const NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY = "CERTIFIED" as const;
export const AI_STORY_NARRATIVE_EDITOR_OWNS_STORY_TRUTH = false as const;
export const AI_STORY_NARRATIVE_EDITOR_OWNS_BILLING = false as const;
export const AI_STORY_NARRATIVE_EDITOR_DISPATCHES_PROVIDER = false as const;
export const AI_STORY_NARRATIVE_EDITOR_EXECUTES_MEDIA = false as const;
export const AI_STORY_NARRATIVE_EDITOR_PERSISTENCE = "CONTRACT_LAYER_ONLY" as const;
export const AI_STORY_ASSEMBLY_V1_UNCHANGED = true as const;
export const FINAL_STORY_ASSEMBLY_V2_EXECUTION = "CERTIFIED" as const;
export const AUDIO_PLAN_EXECUTION = "CERTIFIED" as const;
export const READY_FOR_PROVIDER_FREE_REVIEW_NARRATIVE_EDITOR = "PASS" as const;
export const READY_FOR_PRODUCTION_MERGE_NARRATIVE_EDITOR = "PENDING_PR140_PR141_PR142_AND_HUMAN_AUTHORIZATION" as const;

export const AI_STORY_EDITORIAL_SOURCE_MATERIAL_KINDS = [
  "GENERATED_VIDEO", "EXISTING_VIDEO", "EXISTING_IMAGE", "LOCAL_MOTION", "STATIC_HOLD", "GRAPHIC",
] as const;
export const AI_STORY_EDITORIAL_ROLES = [
  "ESTABLISH", "ACTION", "DETAIL", "DISCOVERY", "REACTION", "CONSEQUENCE",
  "TRANSITION", "PAYOFF", "HERO", "CTA", "BREATH", "BRIDGE",
] as const;
export const AI_STORY_EDITORIAL_DISPOSITIONS = ["USE", "OMIT", "OPTIONAL"] as const;
export const AI_STORY_EDITORIAL_OMISSION_REASONS = [
  "REDUNDANT", "FAILED_TO_ADD_INFORMATION", "ALTERNATE_COVERAGE", "CONTINUITY_RISK", "EDITORIAL_COMPRESSION",
] as const;
export const AI_STORY_EDITORIAL_SOURCE_IN_INTENTS = [
  "FIRST_VALID_FRAME", "ACTION_ONSET", "REACTION_ONSET", "MOTION_ESTABLISHED", "CUSTOM_SEMANTIC",
] as const;
export const AI_STORY_EDITORIAL_SOURCE_OUT_INTENTS = [
  "ACTION_COMPLETE", "REACTION_READABLE", "BEFORE_DEAD_AIR", "BEFORE_REDUNDANT_HOLD", "HERO_SETTLED", "CUSTOM_SEMANTIC",
] as const;
export const AI_STORY_EDITORIAL_CUT_REASONS = [
  "ACTION_CONTINUES", "ACTION_COMPLETES", "REACTION", "NEW_INFORMATION", "DISCOVERY",
  "PERSPECTIVE_CHANGE", "SPATIAL_CLARITY", "EMOTIONAL_CHANGE", "TEMPORAL_ADVANCE",
  "PAYOFF", "CTA_RESOLUTION", "BREATH",
] as const;
export const AI_STORY_EDITORIAL_PACING_FUNCTIONS = [
  "HOOK_FAST", "BUILD", "ACCELERATE", "HOLD_FOR_DISCOVERY", "REACTION_BREATH",
  "ESCALATE", "PAYOFF_HOLD", "CTA_SETTLE",
] as const;
export const AI_STORY_EDITORIAL_TRANSITIONS = [
  "HARD_CUT", "MATCH_CUT", "DISSOLVE", "FADE", "DIP", "SMASH_CUT", "CONTINUOUS_ACTION", "NONE",
] as const;
export const AI_STORY_EDITORIAL_BRIDGE_TYPES = [
  "CONTINUOUS_ACTION", "REACTION_BRIDGE", "MATCH_STATE", "MATCH_COMPOSITION",
  "TEMPORAL_ADVANCE", "LOCATION_CHANGE", "EMOTIONAL_BRIDGE", "HARD_BREAK",
] as const;
export const AI_STORY_EDITORIAL_CONTINUITY_RELATIONSHIPS = [
  "CONTINUOUS_ACTION", "MATCH_STATE", "REACTION_TO_CAUSE", "TEMPORAL_ADVANCE", "LOCATION_CHANGE", "HARD_BREAK", "NONE",
] as const;
export const AI_STORY_DECORATIVE_TRANSITIONS = ["DISSOLVE", "FADE", "DIP"] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(2000);
const Registered = (values: readonly string[]) => z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/).refine((value) => values.includes(value) || value.startsWith("EXT:"), "Use a registered or namespaced extension semantic ID");

export const AiStoryEditorialDurationRangeSchema = z.object({
  minSeconds: z.number().positive(),
  maxSeconds: z.number().positive(),
}).strict().superRefine((value, ctx) => {
  if (value.maxSeconds < value.minSeconds) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "targetDurationRange max must be >= min" });
});

export const AiStoryEditorialDispositionSchema = z.object({
  generationUnitId: Id,
  directorShotId: Id,
  sceneId: Id,
  disposition: z.enum(AI_STORY_EDITORIAL_DISPOSITIONS),
  omissionReason: z.enum(AI_STORY_EDITORIAL_OMISSION_REASONS).nullable(),
  requiredNarrativeShot: z.boolean(),
}).strict();

export const AiStoryEditorialTimelineEntrySchema = z.object({
  timelineEntryId: Id,
  order: z.number().int().nonnegative(),
  sceneId: Id,
  sceneVersionId: Id,
  directorShotId: Id,
  generationUnitId: Id,
  sourceMaterialKind: z.enum(AI_STORY_EDITORIAL_SOURCE_MATERIAL_KINDS),
  editorialRole: Registered(AI_STORY_EDITORIAL_ROLES),
  sourceInIntent: z.enum(AI_STORY_EDITORIAL_SOURCE_IN_INTENTS),
  sourceOutIntent: z.enum(AI_STORY_EDITORIAL_SOURCE_OUT_INTENTS),
  usesFullSourceDuration: z.boolean(),
  targetDurationRange: AiStoryEditorialDurationRangeSchema,
  cutInReason: z.enum(AI_STORY_EDITORIAL_CUT_REASONS),
  cutOutReason: z.enum(AI_STORY_EDITORIAL_CUT_REASONS),
  continuityRelationship: z.enum(AI_STORY_EDITORIAL_CONTINUITY_RELATIONSHIPS),
  pacingFunction: Registered(AI_STORY_EDITORIAL_PACING_FUNCTIONS),
  transitionIntent: z.enum(AI_STORY_EDITORIAL_TRANSITIONS),
  transitionRationale: Text.max(500).nullable(),
  requiredNarrativeInformation: z.array(Text),
  mustPreserve: z.array(Text),
  mustAvoid: z.array(Text),
  supportedActionEntryIds: z.array(Id),
  supportedActionPhaseIds: z.array(Id),
  audioBridgeIntent: Text.max(500).optional(),
}).strict();

export const AiStoryEditorialSceneBridgeSchema = z.object({
  fromSceneId: Id,
  toSceneId: Id,
  bridgeType: z.enum(AI_STORY_EDITORIAL_BRIDGE_TYPES),
  continuityFacts: z.array(Text),
  carriedAction: Text.nullable(),
  carriedObjectState: Text.nullable(),
  carriedCharacterState: Text.nullable(),
  carriedLocationState: Text.nullable(),
  visualBridgeIntent: Text,
  temporalRelation: z.enum(["CONTINUOUS", "LATER", "UNSPECIFIED"]),
  cutMotivation: z.enum(AI_STORY_EDITORIAL_CUT_REASONS),
}).strict();

export const AiStoryStoryPacingIntentSchema = z.object({
  storyPacingIntentId: Id,
  functions: z.array(Registered(AI_STORY_EDITORIAL_PACING_FUNCTIONS)).min(1),
  defaultTransition: z.literal("HARD_CUT"),
  notes: z.array(Text),
}).strict();

export const AiStoryNarrativeEditorialPlanSchema = z.object({
  editorialPlanId: Id,
  storyId: Id,
  storyVersionId: Id,
  scriptVersionId: Id,
  directorPlanId: Id,
  sourceGenerationPlanFingerprints: z.array(Hash).min(1),
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_NARRATIVE_EDITORIAL_PLAN_CONTRACT_VERSION),
  profileId: z.enum(["CORE", "PRODUCT_STORY", "COMMERCIAL_STORY"]),
  nonlinearNarrativeAuthority: z.literal(false),
  timeline: z.array(AiStoryEditorialTimelineEntrySchema).min(1),
  dispositions: z.array(AiStoryEditorialDispositionSchema).min(1),
  storyPacingIntent: AiStoryStoryPacingIntentSchema,
  sceneBridges: z.array(AiStoryEditorialSceneBridgeSchema),
  editorialReviewRequired: z.boolean(),
  sourceHash: Hash,
  editorialFingerprint: Hash,
  status: z.enum(AI_STORY_NARRATIVE_EDITORIAL_PLAN_STATUSES),
  supersedesEditorialPlanId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  approvedBy: Id.nullable(),
  approvedAt: z.string().datetime().nullable(),
  frozenAt: z.string().datetime().nullable(),
}).strict();

export type AiStoryNarrativeEditorialPlan = z.infer<typeof AiStoryNarrativeEditorialPlanSchema>;
export type AiStoryEditorialTimelineEntry = z.infer<typeof AiStoryEditorialTimelineEntrySchema>;
export type AiStoryEditorialSceneBridge = z.infer<typeof AiStoryEditorialSceneBridgeSchema>;
export type AiStoryEditorialDisposition = z.infer<typeof AiStoryEditorialDispositionSchema>;
export type AiStoryStoryPacingIntent = z.infer<typeof AiStoryStoryPacingIntentSchema>;
export type AiStoryNarrativeEditorialIssue = {
  gate:
    | "EDITORIAL_COVERAGE_GATE"
    | "EDITORIAL_CAUSAL_ORDER_GATE"
    | "CUT_ON_ACTION_CONTINUITY_GATE"
    | "REACTION_TIMING_GATE"
    | "REDUNDANT_HOLD_GATE"
    | "EDITORIAL_RHYTHM_GATE"
    | "UNJUSTIFIED_TRANSITION_GATE"
    | "EDITORIAL_DUPLICATION_GATE"
    | "EDITORIAL_COMMERCIAL_PAYOFF_GATE"
    | "GENERATION_UNIT_BINDING_GATE";
  severity: "BLOCK" | "WARN";
  message: string;
};

export const AI_STORY_NARRATIVE_EDITORIAL_GATES = [
  "EDITORIAL_COVERAGE_GATE",
  "EDITORIAL_CAUSAL_ORDER_GATE",
  "CUT_ON_ACTION_CONTINUITY_GATE",
  "REACTION_TIMING_GATE",
  "REDUNDANT_HOLD_GATE",
  "EDITORIAL_RHYTHM_GATE",
  "UNJUSTIFIED_TRANSITION_GATE",
  "EDITORIAL_DUPLICATION_GATE",
  "EDITORIAL_COMMERCIAL_PAYOFF_GATE",
] as const;

export function mapGenerationUnitToSourceMaterialKind(unitType: AiStoryGenerationUnit["unitType"]): (typeof AI_STORY_EDITORIAL_SOURCE_MATERIAL_KINDS)[number] {
  if (unitType === "PROVIDER_VIDEO") return "GENERATED_VIDEO";
  if (unitType === "EXISTING_VIDEO") return "EXISTING_VIDEO";
  if (unitType === "EXISTING_IMAGE") return "EXISTING_IMAGE";
  if (unitType === "LOCAL_ASSET_MOTION") return "LOCAL_MOTION";
  if (unitType === "TEXT_OR_GRAPHIC") return "GRAPHIC";
  return "STATIC_HOLD";
}

export function mapShotPurposeToEditorialRole(shot: Pick<AiStoryDirectorShot, "shotPurpose">, sceneVisualRole: string): (typeof AI_STORY_EDITORIAL_ROLES)[number] {
  if (shot.shotPurpose === "ESTABLISH_CONTEXT" || shot.shotPurpose === "SHOW_ENVIRONMENT") return "ESTABLISH";
  if (shot.shotPurpose === "REVEAL_SUBJECT") return "DISCOVERY";
  if (shot.shotPurpose === "SHOW_ACTION") return "ACTION";
  if (shot.shotPurpose === "SHOW_DETAIL") return "DETAIL";
  if (shot.shotPurpose === "SHOW_REACTION") return "REACTION";
  if (shot.shotPurpose === "SHOW_EVIDENCE") return "CONSEQUENCE";
  if (shot.shotPurpose === "EMPHASIZE_PRODUCT" && (sceneVisualRole === "PAYOFF" || sceneVisualRole === "PACKSHOT" || sceneVisualRole === "CTA_ENDING")) return sceneVisualRole === "CTA_ENDING" ? "CTA" : "PAYOFF";
  if (shot.shotPurpose === "EMPHASIZE_PRODUCT") return "HERO";
  if (shot.shotPurpose === "RESOLVE") return sceneVisualRole === "CTA_ENDING" ? "CTA" : "PAYOFF";
  if (shot.shotPurpose === "TRANSITION") return "TRANSITION";
  return "DETAIL";
}

export function mapEditorialRoleToPacing(role: string, index: number): (typeof AI_STORY_EDITORIAL_PACING_FUNCTIONS)[number] {
  if (role === "ESTABLISH" && index === 0) return "HOOK_FAST";
  if (role === "DISCOVERY") return "HOLD_FOR_DISCOVERY";
  if (role === "ACTION") return "ACCELERATE";
  if (role === "REACTION") return "REACTION_BREATH";
  if (role === "PAYOFF" || role === "HERO") return "PAYOFF_HOLD";
  if (role === "CTA") return "CTA_SETTLE";
  if (role === "CONSEQUENCE") return "ESCALATE";
  return "BUILD";
}

export function pacingDurationRange(pacing: string): { minSeconds: number; maxSeconds: number } {
  if (pacing === "HOOK_FAST") return { minSeconds: 1, maxSeconds: 2 };
  if (pacing === "REACTION_BREATH") return { minSeconds: 1, maxSeconds: 3 };
  if (pacing === "ACCELERATE") return { minSeconds: 1, maxSeconds: 3 };
  if (pacing === "CTA_SETTLE") return { minSeconds: 1, maxSeconds: 3 };
  if (pacing === "HOLD_FOR_DISCOVERY") return { minSeconds: 2, maxSeconds: 4 };
  if (pacing === "PAYOFF_HOLD") return { minSeconds: 2, maxSeconds: 4 };
  if (pacing === "ESCALATE") return { minSeconds: 2, maxSeconds: 4 };
  return { minSeconds: 2, maxSeconds: 5 };
}

export function isRequiredNarrativeShot(shot: Pick<AiStoryDirectorShot, "shotPurpose">): boolean {
  return ["ESTABLISH_CONTEXT", "REVEAL_SUBJECT", "SHOW_ACTION", "SHOW_REACTION", "RESOLVE"].includes(shot.shotPurpose);
}

export function projectLegacyStoryToNarrativeEditorialPlanCompatibility(value: unknown) {
  return { kind: "NARRATIVE_EDITORIAL_PLAN_ABSENT_LEGACY" as const, canonicalEditorialPlan: null, legacyAssembly: value ?? null };
}

export function assertAiStoryNarrativeEditorialPlanTransition(from: AiStoryNarrativeEditorialPlan["status"], to: AiStoryNarrativeEditorialPlan["status"]) {
  const allowed: Record<AiStoryNarrativeEditorialPlan["status"], AiStoryNarrativeEditorialPlan["status"][]> = {
    DRAFT: ["VALIDATED"], VALIDATED: ["APPROVED"], APPROVED: ["FROZEN"], FROZEN: ["SUPERSEDED"], SUPERSEDED: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`EDITORIAL_PLAN_TRANSITION_DENIED:${from}->${to}`);
}

export type AiStoryNarrativeEditorialSceneInput = {
  sceneId: string;
  sceneVersionId: string;
  sceneFunction: string;
  sceneVisualRole: string;
  locationId: string;
  characterIds: readonly string[];
  productAuthorityIds: readonly string[];
  directorDirection: AiStoryDirectorSceneDirection;
  motionScenePlan: AiStorySceneMotionPlan;
  generationPlan: AiStoryGenerationPlan;
};
