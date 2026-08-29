import { z } from "zod";
import {
  AiStoryScriptActionEntrySchema,
  AiStoryScriptAuthorityReferenceSchema,
  AiStoryScriptBeatClaimSchema,
  AiStoryScriptDialogueEntrySchema,
  AiStoryScriptStateDeltaSchema,
  AiStoryScriptStateFactSchema,
  AiStoryScriptVoEntrySchema,
  type AiStoryScriptVersion,
} from "./ai-story-script";
import { AiStoryProductStorySceneContributionSchema } from "./ai-story-product-story-profile";

export const AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION = "ai-story-script-director-handoff.v1" as const;
const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);
const DurationRange = z.object({ minSeconds: z.number().positive(), maxSeconds: z.number().positive() }).strict()
  .refine((value) => value.minSeconds <= value.maxSeconds, "Duration minimum must not exceed maximum");

export const AiStoryDirectorHandoffProductBindingSchema = z.object({
  productAuthorityId: Id,
  sourceAssetId: Id,
  sourceAssetContentHash: Hash,
  requiredRoles: z.array(z.enum(["PRESENT", "PARTICIPATING", "EVIDENCE_REQUIRED"])).min(1),
}).strict();

export const AiStoryDirectorSceneHandoffSchema = z.object({
  scriptSceneId: Id,
  sceneOrder: z.number().int().nonnegative(),
  sceneFunction: Text,
  sceneFunctionRegistryVersion: z.number().int().positive(),
  outlineBeatClaims: z.array(AiStoryScriptBeatClaimSchema).min(1),
  sceneStateIn: z.array(AiStoryScriptStateFactSchema),
  sceneStateDeltas: z.array(AiStoryScriptStateDeltaSchema),
  sceneStateOut: z.array(AiStoryScriptStateFactSchema),
  actionEntries: z.array(AiStoryScriptActionEntrySchema),
  dialogueEntries: z.array(AiStoryScriptDialogueEntrySchema),
  voiceOverEntries: z.array(AiStoryScriptVoEntrySchema),
  entryOrder: z.array(Id).min(1),
  characterIds: z.array(Id),
  locationIds: z.array(Id),
  propIds: z.array(Id),
  assetIds: z.array(Id),
  productAuthorityRefs: z.array(Id),
  newInformation: z.array(Text.max(1000)),
  newEvidence: z.array(Text.max(1000)),
  newActionOutcomes: z.array(Text.max(1000)),
  productEvidence: z.array(Text.max(1000)),
  productStoryContributions: z.array(AiStoryProductStorySceneContributionSchema).optional(),
  targetDurationRange: DurationRange,
  mustKeep: z.array(Text.max(1000)),
  mustAvoid: z.array(Text.max(1000)),
}).strict();

export const AiStoryScriptDirectorHandoffSchema = z.object({
  handoffId: Id,
  storyId: Id,
  storyVersionId: Id,
  outlineVersionId: Id,
  scriptVersionId: Id,
  orgId: Id,
  workspaceId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_SCRIPT_DIRECTOR_HANDOFF_CONTRACT_VERSION),
  scriptSourceHash: Hash,
  sceneHandoffs: z.array(AiStoryDirectorSceneHandoffSchema).min(1),
  productAuthorityBindings: z.array(AiStoryDirectorHandoffProductBindingSchema),
  characterWorldRefs: z.array(AiStoryScriptAuthorityReferenceSchema),
  sourceHash: Hash,
  handoffFingerprint: Hash,
  supersedesHandoffId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  frozenAt: z.string().datetime(),
}).strict();

export type AiStoryScriptDirectorHandoff = z.infer<typeof AiStoryScriptDirectorHandoffSchema>;
export type AiStoryDirectorSceneHandoff = z.infer<typeof AiStoryDirectorSceneHandoffSchema>;
export type AiStoryDirectorHandoffProductBinding = z.infer<typeof AiStoryDirectorHandoffProductBindingSchema>;

export const AI_STORY_DIRECTOR_OWNERSHIP_MATRIX = Object.freeze({
  futureDirectorMayOwn: Object.freeze([
    "sceneVisualRole", "shotPurpose", "shotSize", "cameraIntent", "cameraFamily", "focusTarget",
    "compositionIntent", "blockingIntent", "productEmphasis", "newAudienceInformation", "differentiationRequirement",
  ]),
  directorMayNotOwn: Object.freeze([
    "exactDialogue", "exactVoiceOver", "outlineBeatClaims", "sceneFunction", "sceneStateDeltas",
    "productIdentity", "scriptActionTruth", "mustKeep", "mustAvoid",
  ]),
});

export const AI_STORY_SCRIPT_DIRECTOR_HANDOFF_GATES = [
  "SCRIPT_FROZEN_GATE", "SCRIPT_VERSION_BINDING_GATE", "HANDOFF_FINGERPRINT_GATE",
  "SCENE_IDENTITY_GATE", "BEAT_BINDING_GATE", "SCENE_FUNCTION_BINDING_GATE",
  "ACTION_TRUTH_BINDING_GATE", "DIALOGUE_BINDING_GATE", "STATE_BINDING_GATE",
  "PRODUCT_AUTHORITY_BINDING_GATE", "DURATION_BINDING_GATE", "PRESERVATION_CONSTRAINT_GATE",
  "STALE_HANDOFF_GATE",
] as const;

export type AiStoryScriptDirectorHandoffIssue = {
  gate: (typeof AI_STORY_SCRIPT_DIRECTOR_HANDOFF_GATES)[number];
  severity: "BLOCK";
  message: string;
};

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function projectAiStoryScriptSceneHandoffs(script: AiStoryScriptVersion): AiStoryDirectorSceneHandoff[] {
  return script.scenes.map((scene) => ({
    scriptSceneId: scene.scriptSceneId,
    sceneOrder: scene.order,
    sceneFunction: scene.sceneFunction,
    sceneFunctionRegistryVersion: scene.sceneFunctionRegistryVersion,
    outlineBeatClaims: structuredClone(scene.outlineBeatClaims),
    sceneStateIn: structuredClone(scene.sceneStateIn),
    sceneStateDeltas: structuredClone(scene.sceneStateDeltas),
    sceneStateOut: structuredClone(scene.sceneStateOut),
    actionEntries: structuredClone(scene.entries.filter((entry) => entry.type === "ACTION")),
    dialogueEntries: structuredClone(scene.entries.filter((entry) => entry.type === "DIALOGUE")),
    voiceOverEntries: structuredClone(scene.entries.filter((entry) => entry.type === "VO")),
    entryOrder: scene.entries.map((entry) => entry.entryId),
    characterIds: [...scene.characterIds], locationIds: [...scene.locationIds], propIds: [...scene.propIds],
    assetIds: [...scene.assetIds], productAuthorityRefs: [...scene.productAuthorityRefs],
    newInformation: [...scene.newInformation], newEvidence: [...scene.newEvidence],
    newActionOutcomes: [...scene.newActionOutcomes], productEvidence: [...scene.productEvidence],
    ...(scene.productStoryContributions ? { productStoryContributions: structuredClone(scene.productStoryContributions) } : {}),
    targetDurationRange: { ...scene.targetDurationRange }, mustKeep: [...scene.mustKeep], mustAvoid: [...scene.mustAvoid],
  }));
}

export function validateAiStoryScriptDirectorHandoff(
  handoff: AiStoryScriptDirectorHandoff,
  script: AiStoryScriptVersion,
  options: { expectedSourceHash?: string; expectedFingerprint?: string; currentScriptVersionId?: string } = {},
): AiStoryScriptDirectorHandoffIssue[] {
  const issues: AiStoryScriptDirectorHandoffIssue[] = [];
  const block = (gate: AiStoryScriptDirectorHandoffIssue["gate"], message: string) => issues.push({ gate, severity: "BLOCK", message });
  if (script.status !== "FROZEN") block("SCRIPT_FROZEN_GATE", "Canonical Director handoff requires a frozen Script");
  if (handoff.scriptVersionId !== script.scriptVersionId || handoff.storyId !== script.storyId || handoff.storyVersionId !== script.storyVersionId || handoff.outlineVersionId !== script.outlineVersionId || handoff.orgId !== script.orgId || handoff.workspaceId !== script.workspaceId || handoff.scriptSourceHash !== script.sourceHash) block("SCRIPT_VERSION_BINDING_GATE", "Handoff lineage does not bind the exact Script authority");
  if ((options.expectedSourceHash && handoff.sourceHash !== options.expectedSourceHash) || (options.expectedFingerprint && handoff.handoffFingerprint !== options.expectedFingerprint)) block("HANDOFF_FINGERPRINT_GATE", "Handoff source hash or fingerprint does not match canonical content");
  if (script.status === "SUPERSEDED" || (options.currentScriptVersionId && options.currentScriptVersionId !== handoff.scriptVersionId)) block("STALE_HANDOFF_GATE", "Handoff does not reference the current frozen Script authority");
  const expected = projectAiStoryScriptSceneHandoffs(script);
  if (handoff.sceneHandoffs.length !== expected.length || !same(handoff.sceneHandoffs.map((scene) => [scene.scriptSceneId, scene.sceneOrder]), expected.map((scene) => [scene.scriptSceneId, scene.sceneOrder]))) block("SCENE_IDENTITY_GATE", "Script Scene identity, count, or order changed across the handoff");
  for (const scene of expected) {
    const actual = handoff.sceneHandoffs.find((candidate) => candidate.scriptSceneId === scene.scriptSceneId);
    if (!actual) continue;
    if (!same(actual.outlineBeatClaims, scene.outlineBeatClaims)) block("BEAT_BINDING_GATE", `Beat claims changed for Scene ${scene.scriptSceneId}`);
    if (actual.sceneFunction !== scene.sceneFunction || actual.sceneFunctionRegistryVersion !== scene.sceneFunctionRegistryVersion) block("SCENE_FUNCTION_BINDING_GATE", `Scene Function changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.actionEntries, scene.actionEntries) || !same(actual.entryOrder, scene.entryOrder)) block("ACTION_TRUTH_BINDING_GATE", `Script ACTION truth or entry order changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.dialogueEntries, scene.dialogueEntries) || !same(actual.voiceOverEntries, scene.voiceOverEntries) || !same(actual.entryOrder, scene.entryOrder)) block("DIALOGUE_BINDING_GATE", `Dialogue, VO, speaker, language, or order changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.sceneStateIn, scene.sceneStateIn) || !same(actual.sceneStateDeltas, scene.sceneStateDeltas) || !same(actual.sceneStateOut, scene.sceneStateOut)) block("STATE_BINDING_GATE", `State truth changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.productAuthorityRefs, scene.productAuthorityRefs) || !same(actual.productEvidence, scene.productEvidence) || !same(actual.assetIds, scene.assetIds)) block("PRODUCT_AUTHORITY_BINDING_GATE", `Product or source-asset authority changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.productStoryContributions, scene.productStoryContributions)) block("PRODUCT_AUTHORITY_BINDING_GATE", `Product Story profile contribution changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.targetDurationRange, scene.targetDurationRange)) block("DURATION_BINDING_GATE", `Target duration changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.mustKeep, scene.mustKeep) || !same(actual.mustAvoid, scene.mustAvoid)) block("PRESERVATION_CONSTRAINT_GATE", `mustKeep/mustAvoid changed for Scene ${scene.scriptSceneId}`);
    if (!same(actual.newInformation, scene.newInformation) || !same(actual.newEvidence, scene.newEvidence) || !same(actual.newActionOutcomes, scene.newActionOutcomes)) block("ACTION_TRUTH_BINDING_GATE", `Certified information/evidence/action outcome changed for Scene ${scene.scriptSceneId}`);
  }
  const productRefs = [...new Set(expected.flatMap((scene) => scene.productAuthorityRefs))].sort();
  const boundRefs = handoff.productAuthorityBindings.map((binding) => binding.productAuthorityId).sort();
  if (!same(productRefs, boundRefs) || handoff.productAuthorityBindings.some((binding) => binding.productAuthorityId !== binding.sourceAssetId)) block("PRODUCT_AUTHORITY_BINDING_GATE", "Product authority is missing, duplicated, or rebound to another source asset");
  return issues;
}

export function projectLegacyPlanningToDirectorCompatibility(input: { storyId: string; storyVersionId: string; directorThinking?: unknown; scenePlan?: unknown; shotPlan?: unknown }) {
  return { kind: "LEGACY_DIRECTOR_INPUT_COMPATIBILITY" as const, ...input, canonicalScriptDirectorHandoff: null };
}

export function resolveDirectorInputAuthority(input: {
  canonicalHandoff?: AiStoryScriptDirectorHandoff | null;
  legacyPlanning?: ReturnType<typeof projectLegacyPlanningToDirectorCompatibility> | null;
}) {
  if (input.canonicalHandoff) return { kind: "CANONICAL_SCRIPT_DIRECTOR_HANDOFF" as const, handoff: AiStoryScriptDirectorHandoffSchema.parse(input.canonicalHandoff) };
  if (input.legacyPlanning) return input.legacyPlanning;
  throw new Error("DIRECTOR_INPUT_AUTHORITY_ABSENT");
}
