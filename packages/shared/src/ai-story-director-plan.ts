import { z } from "zod";
import type { AiStoryScriptDirectorHandoff } from "./ai-story-script-director-handoff";

export const AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION = "ai-story-director-plan.v1" as const;
export const AI_STORY_DIRECTOR_REGISTRY_VERSION = 1 as const;
export const AI_STORY_DIRECTOR_PLAN_STATUSES = ["DRAFT", "VALIDATED", "APPROVED", "FROZEN", "SUPERSEDED"] as const;

export const AI_STORY_SCENE_VISUAL_ROLES = Object.freeze([
  "HERO_INTRODUCTION", "DETAIL_REVEAL", "RELATIONSHIP", "USAGE_DEMONSTRATION", "REACTION",
  "ENVIRONMENT_ESTABLISH", "TRANSITION", "TEXTURE_MACRO", "PAYOFF", "PACKSHOT", "CTA_ENDING",
] as const);
export const AI_STORY_SHOT_PURPOSES = Object.freeze([
  "ESTABLISH_CONTEXT", "REVEAL_SUBJECT", "SHOW_DETAIL", "SHOW_RELATIONSHIP", "SHOW_ACTION",
  "SHOW_REACTION", "SHOW_EVIDENCE", "EMPHASIZE_PRODUCT", "SHOW_SCALE", "SHOW_ENVIRONMENT", "TRANSITION", "RESOLVE",
] as const);
export const AI_STORY_SHOT_SIZES = Object.freeze(["EXTREME_WIDE", "WIDE", "MEDIUM", "MEDIUM_CLOSE", "CLOSE", "EXTREME_CLOSE", "MACRO"] as const);
export const AI_STORY_CAMERA_FAMILIES = Object.freeze([
  "LOCKED", "SLOW_PUSH_IN", "SLOW_PULL_BACK", "MINOR_LATERAL_DOLLY", "RACK_FOCUS",
  "GENTLE_PARALLAX", "SMALL_ARC", "PAN", "TILT", "TRACKING", "HANDHELD",
] as const);
export const AI_STORY_COMPOSITION_INTENTS = Object.freeze([
  "PRODUCT_DOMINANT", "RELATIONSHIP_BALANCED", "ENVIRONMENT_CONTEXTUAL", "DETAIL_ISOLATION",
  "SUBJECT_PRODUCT_RELATIONSHIP", "ACTION_CENTERED", "REACTION_CENTERED", "SCALE_CONTEXT",
] as const);
export const AI_STORY_PRODUCT_EMPHASIS = Object.freeze([
  "PRIMARY_HERO", "DETAIL_EVIDENCE", "USAGE_CONTEXT", "RELATIONSHIP_CONTEXT",
  "ENVIRONMENT_CONTEXT", "BACKGROUND_CONTEXT", "PACKSHOT",
] as const);

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(2000);
const SemanticId = z.string().regex(/^(?:[A-Z][A-Z0-9_]{1,63}|EXT:[a-z0-9.-]+:[A-Z][A-Z0-9_]{1,63})$/);
const Registered = (values: readonly string[]) => SemanticId.refine((value) => values.includes(value) || value.startsWith("EXT:"), "Use a registered or namespaced extension semantic ID");

export const AiStoryDirectorFocusTargetSchema = z.object({
  kind: z.enum(["PRODUCT", "PRODUCT_COMPONENT", "CHARACTER", "CHARACTER_PRODUCT_INTERACTION", "PROP", "ENVIRONMENT", "EVIDENCE_DETAIL", "REACTION", "ACTION_CONSEQUENCE", "CUSTOM"]),
  authorityRefs: z.array(Id),
  semanticLabel: Text,
}).strict();

export const AiStoryDirectorBlockingIntentSchema = z.object({
  blockingIntentId: Id,
  subjectRefs: z.array(Id).min(1),
  semanticIntent: Text,
  supportedActionEntryIds: z.array(Id),
  spatialRelationship: Text,
}).strict();

export const AiStoryDirectorShotSchema = z.object({
  directorShotId: Id,
  order: z.number().int().nonnegative(),
  shotPurpose: Registered(AI_STORY_SHOT_PURPOSES),
  shotPurposeRegistryVersion: z.literal(AI_STORY_DIRECTOR_REGISTRY_VERSION),
  shotSize: Registered(AI_STORY_SHOT_SIZES),
  cameraIntent: Text,
  cameraFamily: Registered(AI_STORY_CAMERA_FAMILIES),
  focusTarget: AiStoryDirectorFocusTargetSchema,
  focusProgression: z.array(AiStoryDirectorFocusTargetSchema).min(1),
  compositionIntent: Registered(AI_STORY_COMPOSITION_INTENTS),
  productEmphasis: Registered(AI_STORY_PRODUCT_EMPHASIS).nullable(),
  newAudienceInformation: z.array(Text),
  blockingIntents: z.array(AiStoryDirectorBlockingIntentSchema),
  perspectiveChange: z.enum(["MINIMAL", "MODERATE", "LARGE"]),
  revealsUnseenProductSurface: z.boolean(),
  productIdentityTransformation: z.boolean(),
}).strict();

export const AiStoryDirectorSceneDirectionSchema = z.object({
  directorSceneId: Id,
  scriptSceneId: Id,
  sceneOrder: z.number().int().nonnegative(),
  servedScriptSceneFunction: Text,
  sceneVisualRole: Registered(AI_STORY_SCENE_VISUAL_ROLES),
  sceneVisualRoleRegistryVersion: z.literal(AI_STORY_DIRECTOR_REGISTRY_VERSION),
  contextualTreatment: z.object({
    semanticIntent: Text,
    supportedActionEntryIds: z.array(Id),
    supportedStateDeltaIndexes: z.array(z.number().int().nonnegative()),
    physicalPlausibility: z.literal("NOT_CONTRADICTED"),
  }).strict(),
  shots: z.array(AiStoryDirectorShotSchema).min(1),
  newAudienceInformation: z.array(Text),
  servedProductEvidence: z.array(Text),
  differentiationRequirement: z.object({
    comparedToScriptSceneIds: z.array(Id),
    dimensions: z.array(z.enum(["VISUAL_ROLE", "SHOT_PURPOSE", "SHOT_SIZE", "CAMERA_FAMILY", "FOCUS", "COMPOSITION", "PRODUCT_EMPHASIS", "SCRIPT_ACTION", "BLOCKING", "AUDIENCE_INFORMATION", "PRODUCT_EVIDENCE"])).min(1),
    rationale: Text,
  }).strict(),
}).strict();

export const AiStoryDirectorPlanSchema = z.object({
  directorPlanId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  handoffId: Id,
  orgId: Id,
  workspaceId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_DIRECTOR_PLAN_CONTRACT_VERSION),
  sourceHandoffFingerprint: Hash,
  sceneDirections: z.array(AiStoryDirectorSceneDirectionSchema).min(1),
  sourceHash: Hash,
  directorFingerprint: Hash,
  status: z.enum(AI_STORY_DIRECTOR_PLAN_STATUSES),
  supersedesDirectorPlanId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  approvedBy: Id.nullable(),
  approvedAt: z.string().datetime().nullable(),
  frozenAt: z.string().datetime().nullable(),
}).strict();

export type AiStoryDirectorPlan = z.infer<typeof AiStoryDirectorPlanSchema>;
export type AiStoryDirectorSceneDirection = z.infer<typeof AiStoryDirectorSceneDirectionSchema>;
export type AiStoryDirectorPlanIssue = { gate: AiStoryDirectorPlanGate; severity: "BLOCK" | "WARN"; message: string };

export const AI_STORY_DIRECTOR_PLAN_GATES = [
  "HANDOFF_FROZEN_GATE", "HANDOFF_BINDING_GATE", "DIRECTOR_FINGERPRINT_GATE", "SCENE_IDENTITY_GATE",
  "SCRIPT_TRUTH_BINDING_GATE", "SCRIPT_ACTION_SUPPORT_GATE", "FOCUS_REFERENCE_GATE", "PRODUCT_AUTHORITY_BINDING_GATE",
  "PRODUCT_CAMERA_SAFETY_GATE", "NEW_AUDIENCE_INFORMATION_GATE", "DIFFERENTIATION_REQUIREMENT_GATE",
  "DIRECTOR_VISUAL_DUPLICATION_GATE", "DIRECTOR_VALID_REPETITION_WARNING", "DIRECTOR_FREEZE_MUTATION_GATE", "STALE_DIRECTOR_PLAN_GATE",
] as const;
export type AiStoryDirectorPlanGate = (typeof AI_STORY_DIRECTOR_PLAN_GATES)[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const focusSignature = (scene: AiStoryDirectorSceneDirection) => JSON.stringify(scene.shots.map((shot) => [shot.focusTarget.kind, [...shot.focusTarget.authorityRefs].sort()]));
const allAudienceInformation = (scene: AiStoryDirectorSceneDirection) => [...scene.newAudienceInformation, ...scene.shots.flatMap((shot) => shot.newAudienceInformation)];

export function validateAiStoryDirectorPlan(
  plan: AiStoryDirectorPlan,
  handoff: AiStoryScriptDirectorHandoff,
  options: { expectedSourceHash?: string; expectedFingerprint?: string; currentHandoffId?: string } = {},
): AiStoryDirectorPlanIssue[] {
  const issues: AiStoryDirectorPlanIssue[] = [];
  const issue = (gate: AiStoryDirectorPlanGate, severity: "BLOCK" | "WARN", message: string) => issues.push({ gate, severity, message });
  if (!handoff.frozenAt) issue("HANDOFF_FROZEN_GATE", "BLOCK", "Canonical Director authority requires a frozen Script handoff");
  if (plan.handoffId !== handoff.handoffId || plan.scriptVersionId !== handoff.scriptVersionId || plan.storyId !== handoff.storyId || plan.storyVersionId !== handoff.storyVersionId || plan.outlineVersionId !== handoff.outlineVersionId || plan.orgId !== handoff.orgId || plan.workspaceId !== handoff.workspaceId || plan.sourceHandoffFingerprint !== handoff.handoffFingerprint) issue("HANDOFF_BINDING_GATE", "BLOCK", "Director plan does not bind the exact immutable handoff");
  if ((options.expectedSourceHash && plan.sourceHash !== options.expectedSourceHash) || (options.expectedFingerprint && plan.directorFingerprint !== options.expectedFingerprint)) issue("DIRECTOR_FINGERPRINT_GATE", "BLOCK", "Director source hash or fingerprint does not match canonical content");
  if (options.currentHandoffId && options.currentHandoffId !== plan.handoffId) issue("STALE_DIRECTOR_PLAN_GATE", "BLOCK", "Director plan is bound to a superseded handoff");
  if (!same(plan.sceneDirections.map((scene) => [scene.scriptSceneId, scene.sceneOrder]), handoff.sceneHandoffs.map((scene) => [scene.scriptSceneId, scene.sceneOrder]))) issue("SCENE_IDENTITY_GATE", "BLOCK", "Director Scene identity, count, or order differs from Script truth");

  for (const scene of plan.sceneDirections) {
    const source = handoff.sceneHandoffs.find((candidate) => candidate.scriptSceneId === scene.scriptSceneId);
    if (!source) continue;
    if (scene.servedScriptSceneFunction !== source.sceneFunction) issue("SCRIPT_TRUTH_BINDING_GATE", "BLOCK", `Director changed Scene Function for ${scene.scriptSceneId}`);
    const actionIds = new Set(source.actionEntries.map((entry) => entry.entryId));
    const stateIndexes = new Set(source.sceneStateDeltas.map((_entry, index) => index));
    const supportedActionIds = [...scene.contextualTreatment.supportedActionEntryIds, ...scene.shots.flatMap((shot) => shot.blockingIntents.flatMap((blocking) => blocking.supportedActionEntryIds))];
    if (supportedActionIds.some((id) => !actionIds.has(id)) || scene.contextualTreatment.supportedStateDeltaIndexes.some((index) => !stateIndexes.has(index))) issue("SCRIPT_ACTION_SUPPORT_GATE", "BLOCK", `Director contextual/action intent is not supported by frozen Script truth for ${scene.scriptSceneId}`);
    const refs = new Set([...source.characterIds, ...source.locationIds, ...source.propIds, ...source.assetIds, ...source.productAuthorityRefs]);
    const focusRefs = scene.shots.flatMap((shot) => [shot.focusTarget, ...shot.focusProgression]).flatMap((target) => target.authorityRefs);
    if (focusRefs.some((ref) => !refs.has(ref))) issue("FOCUS_REFERENCE_GATE", "BLOCK", `Focus references unknown authority for ${scene.scriptSceneId}`);
    const productRefs = new Set(source.productAuthorityRefs);
    if (scene.shots.some((shot) => shot.productEmphasis && ![shot.focusTarget, ...shot.focusProgression].some((target) => target.authorityRefs.some((ref) => productRefs.has(ref))))) issue("PRODUCT_AUTHORITY_BINDING_GATE", "BLOCK", `Product emphasis is not bound to Product authority for ${scene.scriptSceneId}`);
    if (scene.servedProductEvidence.some((value) => !source.productEvidence.includes(value))) issue("PRODUCT_AUTHORITY_BINDING_GATE", "BLOCK", `Director invented Product evidence for ${scene.scriptSceneId}`);
    if (scene.shots.some((shot) => shot.productEmphasis && (shot.perspectiveChange === "LARGE" || shot.revealsUnseenProductSurface || shot.productIdentityTransformation))) issue("PRODUCT_CAMERA_SAFETY_GATE", "BLOCK", `Director camera treatment threatens Product identity for ${scene.scriptSceneId}`);
    if (scene.newAudienceInformation.length === 0 || scene.shots.some((shot) => shot.newAudienceInformation.length === 0)) issue("NEW_AUDIENCE_INFORMATION_GATE", "BLOCK", `Director Scene ${scene.scriptSceneId} and every Shot must declare new audience information`);
    if (scene.sceneOrder > 0 && scene.differentiationRequirement.comparedToScriptSceneIds.length === 0) issue("DIFFERENTIATION_REQUIREMENT_GATE", "BLOCK", `Director Scene ${scene.scriptSceneId} does not identify a differentiation baseline`);
  }

  for (let index = 1; index < plan.sceneDirections.length; index += 1) {
    const current = plan.sceneDirections[index]!;
    for (const previous of plan.sceneDirections.slice(0, index)) {
      const comparable = current.differentiationRequirement.comparedToScriptSceneIds.includes(previous.scriptSceneId);
      if (!comparable) continue;
      const visualEquivalent = current.sceneVisualRole === previous.sceneVisualRole
        && focusSignature(current) === focusSignature(previous)
        && current.shots[0]?.compositionIntent === previous.shots[0]?.compositionIntent
        && current.shots[0]?.productEmphasis === previous.shots[0]?.productEmphasis
        && current.contextualTreatment.semanticIntent === previous.contextualTreatment.semanticIntent;
      const currentSource = handoff.sceneHandoffs.find((scene) => scene.scriptSceneId === current.scriptSceneId)!;
      const previousSource = handoff.sceneHandoffs.find((scene) => scene.scriptSceneId === previous.scriptSceneId)!;
      const currentActions = currentSource.actionEntries.map((entry) => [entry.action, entry.storyEffect]);
      const previousActions = previousSource.actionEntries.map((entry) => [entry.action, entry.storyEffect]);
      const hasDelta = allAudienceInformation(current).length > 0 || current.servedProductEvidence.length > 0
        || !same(currentActions, previousActions)
        || current.contextualTreatment.semanticIntent !== previous.contextualTreatment.semanticIntent
        || current.shots[0]?.compositionIntent !== previous.shots[0]?.compositionIntent;
      if (visualEquivalent && !hasDelta) issue("DIRECTOR_VISUAL_DUPLICATION_GATE", "BLOCK", `Director Scene ${current.scriptSceneId} materially duplicates ${previous.scriptSceneId}`);
      else if (visualEquivalent && hasDelta) issue("DIRECTOR_VALID_REPETITION_WARNING", "WARN", `Director Scene ${current.scriptSceneId} repeats visual dimensions but carries a certified delta`);
    }
  }
  return issues;
}

export function assertAiStoryDirectorPlanTransition(from: AiStoryDirectorPlan["status"], to: AiStoryDirectorPlan["status"]) {
  const allowed: Record<AiStoryDirectorPlan["status"], AiStoryDirectorPlan["status"][]> = { DRAFT:["VALIDATED"], VALIDATED:["APPROVED"], APPROVED:["FROZEN"], FROZEN:["SUPERSEDED"], SUPERSEDED:[] };
  if (!allowed[from].includes(to)) throw new Error(`DIRECTOR_PLAN_TRANSITION_DENIED:${from}->${to}`);
}

export function resolveDirectorPlanningAuthority(input: { canonicalDirectorPlan?: AiStoryDirectorPlan | null; legacyPlanning?: unknown }) {
  if (input.canonicalDirectorPlan) return { kind: "CANONICAL_DIRECTOR_PLAN" as const, directorPlan: AiStoryDirectorPlanSchema.parse(input.canonicalDirectorPlan) };
  return { kind: "LEGACY_DIRECTOR_PLANNING_COMPATIBILITY" as const, legacyPlanning: input.legacyPlanning ?? null };
}
