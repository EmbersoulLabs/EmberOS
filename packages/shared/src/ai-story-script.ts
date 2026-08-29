import { z } from "zod";
import { type AiStoryOutlineVersion } from "./ai-story-outline";
import { AiStoryProductStorySceneContributionSchema } from "./ai-story-product-story-profile";

export const AI_STORY_SCRIPT_CONTRACT_VERSION = "ai-story-script.v1" as const;
export const AI_STORY_SCRIPT_STATUSES = ["DRAFT", "VALIDATED", "APPROVED", "FROZEN", "SUPERSEDED"] as const;
export const AI_STORY_SCENE_FUNCTION_REGISTRY_VERSION = 1 as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
const DurationRange = z.object({ minSeconds: z.number().positive(), maxSeconds: z.number().positive() }).strict()
  .refine((value) => value.minSeconds <= value.maxSeconds, "Duration minimum must not exceed maximum");

export const AI_STORY_SCENE_FUNCTION_REGISTRY = Object.freeze({
  INTRODUCE: { visibleActionRequired: true }, REVEAL: { visibleActionRequired: true },
  DEMONSTRATE: { visibleActionRequired: true }, ESCALATE: { visibleActionRequired: true },
  CONFRONT: { visibleActionRequired: true }, DECIDE: { visibleActionRequired: true },
  TRANSITION: { visibleActionRequired: false }, PAYOFF: { visibleActionRequired: true },
  RESOLVE: { visibleActionRequired: true }, CLIFFHANGER: { visibleActionRequired: true },
  PRODUCT_INTRODUCTION: { visibleActionRequired: true }, PRODUCT_DETAIL_REVEAL: { visibleActionRequired: true },
  PRODUCT_USAGE: { visibleActionRequired: true }, PRODUCT_BENEFIT_PROOF: { visibleActionRequired: true },
  PRODUCT_PAYOFF: { visibleActionRequired: true }, PACKSHOT: { visibleActionRequired: true },
} as const);

export const AiStoryScriptAuthorityReferenceSchema = z.object({
  authorityType: z.enum(["CHARACTER", "LOCATION", "PROP", "ASSET", "PRODUCT"]),
  authorityId: Id,
  authorityVersionId: Id.optional(),
}).strict();

export const AiStoryScriptStateFactSchema = z.object({
  dimension: z.enum(["KNOWLEDGE", "POSSESSION", "RELATIONSHIP", "LOCATION", "COMMITMENT", "PHYSICAL_CONDITION", "OPTION_SET", "DEADLINE", "COST", "PRODUCT_STATE"]),
  subjectId: Id,
  value: Text.max(1000),
}).strict();

export const AiStoryScriptStateDeltaSchema = AiStoryScriptStateFactSchema.extend({
  fromValue: Text.max(1000).nullable(),
  reason: Text.max(1000),
}).strict();

export const AiStoryScriptBeatClaimSchema = z.object({
  outlineBeatId: Id,
  subclaimId: Id.optional(),
  subclaimOrder: z.number().int().nonnegative().optional(),
  claim: Text.max(1000),
}).strict().refine((value) => Boolean(value.subclaimId) === (value.subclaimOrder !== undefined), {
  message: "Split Beat claims require both stable identity and order",
});

const EntryBase = z.object({ entryId: Id, order: z.number().int().nonnegative(), durationRange: DurationRange });
export const AiStoryScriptActionEntrySchema = EntryBase.extend({
  type: z.literal("ACTION"), subjectId: Id, action: Text.max(2000), objectId: Id.optional(),
  storyEffect: Text.max(1000), stateDelta: AiStoryScriptStateDeltaSchema.optional(),
}).strict();
export const AiStoryScriptDialogueEntrySchema = EntryBase.extend({
  type: z.literal("DIALOGUE"), speakerId: Id, line: Text.max(4000), deliveryOrSubtext: Text.max(1000).optional(), language: Text.max(50),
}).strict();
export const AiStoryScriptVoEntrySchema = EntryBase.extend({
  type: z.literal("VO"), voiceOwnerId: Id, line: Text.max(4000), narrativePurpose: Text.max(1000), language: Text.max(50),
}).strict();
export const AiStoryScriptEntrySchema = z.discriminatedUnion("type", [
  AiStoryScriptActionEntrySchema, AiStoryScriptDialogueEntrySchema, AiStoryScriptVoEntrySchema,
]);

export const AiStoryScriptSceneSchema = z.object({
  scriptSceneId: Id,
  order: z.number().int().nonnegative(),
  outlineBeatClaims: z.array(AiStoryScriptBeatClaimSchema).min(1),
  sceneFunction: z.enum(Object.keys(AI_STORY_SCENE_FUNCTION_REGISTRY) as [keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY, ...(keyof typeof AI_STORY_SCENE_FUNCTION_REGISTRY)[]]),
  sceneFunctionRegistryVersion: z.literal(AI_STORY_SCENE_FUNCTION_REGISTRY_VERSION),
  sceneStateIn: z.array(AiStoryScriptStateFactSchema),
  sceneStateDeltas: z.array(AiStoryScriptStateDeltaSchema),
  sceneStateOut: z.array(AiStoryScriptStateFactSchema),
  entries: z.array(AiStoryScriptEntrySchema).min(1),
  characterIds: z.array(Id), locationIds: z.array(Id), propIds: z.array(Id), assetIds: z.array(Id), productAuthorityRefs: z.array(Id),
  targetDurationRange: DurationRange,
  mustKeep: z.array(Text.max(1000)), mustAvoid: z.array(Text.max(1000)),
  newInformation: z.array(Text.max(1000)), newEvidence: z.array(Text.max(1000)),
  newActionOutcomes: z.array(Text.max(1000)), productEvidence: z.array(Text.max(1000)),
  productStoryContributions: z.array(AiStoryProductStorySceneContributionSchema).optional(),
}).strict();

export const AiStoryScriptVersionSchema = z.object({
  scriptVersionId: Id, storyId: Id, storyVersionId: Id, outlineVersionId: Id,
  orgId: Id, workspaceId: Id, version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_SCRIPT_CONTRACT_VERSION),
  profileId: z.enum(["CORE", "PRODUCT_STORY"]), profileVersion: z.literal(1),
  outlineSourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  scenes: z.array(AiStoryScriptSceneSchema).min(1),
  authorityReferences: z.array(AiStoryScriptAuthorityReferenceSchema),
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(AI_STORY_SCRIPT_STATUSES), supersedesScriptVersionId: Id.nullable(),
  createdBy: Id, createdAt: z.string().datetime(), approvedBy: Id.nullable(), approvedAt: z.string().datetime().nullable(), frozenAt: z.string().datetime().nullable(),
}).strict();

export type AiStoryScriptVersion = z.infer<typeof AiStoryScriptVersionSchema>;
export type AiStoryScriptStatus = AiStoryScriptVersion["status"];
export type AiStoryScriptValidationIssue = { gate: (typeof AI_STORY_SCRIPT_VALIDATION_GATES)[number]; severity: "BLOCK" | "WARN"; message: string };

export const AI_STORY_SCRIPT_VALIDATION_GATES = [
  "SCRIPT_REFERENCE_INTEGRITY_GATE", "BEAT_CLAIM_GATE", "EXCLUSIVE_BEAT_CARDINALITY_GATE",
  "SCRIPT_SCENE_FUNCTION_GATE", "SCRIPT_SCENE_DUPLICATION_GATE", "STATE_CONTINUITY_GATE",
  "ACTION_BEAT_PRESENCE_GATE", "DIALOGUE_SPEAKER_GATE", "TIMING_FEASIBILITY_GATE",
  "SCRIPT_FREEZE_MUTATION_GATE", "OUTLINE_LINEAGE_GATE",
] as const;

const keyOfFact = (fact: { dimension: string; subjectId: string }) => `${fact.dimension}:${fact.subjectId}`;
const isContiguous = (values: readonly { order: number }[]) => values.every((value, index) => value.order === index);

export function validateAiStoryScript(
  script: AiStoryScriptVersion,
  outline: AiStoryOutlineVersion,
  options: { knownAuthorityReferences?: ReadonlySet<string> } = {},
): AiStoryScriptValidationIssue[] {
  const issues: AiStoryScriptValidationIssue[] = [];
  const block = (gate: AiStoryScriptValidationIssue["gate"], message: string) => issues.push({ gate, severity: "BLOCK", message });
  if (outline.status !== "FROZEN" || script.outlineVersionId !== outline.outlineVersionId || script.storyId !== outline.storyId || script.storyVersionId !== outline.storyVersionId || script.outlineSourceHash !== outline.sourceHash) {
    block("OUTLINE_LINEAGE_GATE", "Canonical Script must bind the exact frozen Outline and source hash");
  }
  if (script.profileId !== outline.profile.profileId || script.profileVersion !== outline.profile.profileVersion) block("OUTLINE_LINEAGE_GATE", "Script profile must bind the exact selected Outline profile version");
  if (!isContiguous(script.scenes) || new Set(script.scenes.map((scene) => scene.scriptSceneId)).size !== script.scenes.length) block("SCRIPT_REFERENCE_INTEGRITY_GATE", "Script Scene identity and ordering must be unique and contiguous");
  const beats = new Map(outline.beats.map((beat) => [beat.id, beat]));
  const claims = script.scenes.flatMap((scene) => scene.outlineBeatClaims.map((claim) => ({ ...claim, sceneId: scene.scriptSceneId })));
  for (const claim of claims) {
    const beat = beats.get(claim.outlineBeatId);
    if (!beat) block("BEAT_CLAIM_GATE", `Unknown Outline Beat ${claim.outlineBeatId}`);
    else if (beat.ownershipPolicy === "EXCLUSIVE" && claim.subclaimId) block("EXCLUSIVE_BEAT_CARDINALITY_GATE", `Exclusive Beat ${beat.id} cannot use split claims`);
    else if (beat.ownershipPolicy === "SPLITTABLE" && !claim.subclaimId) block("BEAT_CLAIM_GATE", `Splittable Beat ${beat.id} requires an explicit ordered subclaim`);
  }
  for (const beat of outline.beats.filter((beat) => beat.required)) {
    const beatClaims = claims.filter((claim) => claim.outlineBeatId === beat.id);
    if (!beatClaims.length) block("BEAT_CLAIM_GATE", `Required Outline Beat ${beat.id} is unclaimed`);
    if (beat.ownershipPolicy === "EXCLUSIVE" && beatClaims.length !== 1) block("EXCLUSIVE_BEAT_CARDINALITY_GATE", `Exclusive Beat ${beat.id} must be claimed exactly once`);
    if (beat.ownershipPolicy === "SPLITTABLE") {
      const orders = beatClaims.map((claim) => claim.subclaimOrder!).sort((a, b) => a - b);
      if (new Set(beatClaims.map((claim) => claim.subclaimId)).size !== beatClaims.length || orders.some((order, index) => order !== index)) block("BEAT_CLAIM_GATE", `Splittable Beat ${beat.id} subclaims must be unique and contiguous`);
    }
  }
  for (const scene of script.scenes) {
    if (!AI_STORY_SCENE_FUNCTION_REGISTRY[scene.sceneFunction]) block("SCRIPT_SCENE_FUNCTION_GATE", `Unknown Scene Function ${scene.sceneFunction}`);
    if (!isContiguous(scene.entries)) block("SCRIPT_REFERENCE_INTEGRITY_GATE", `Entries in Scene ${scene.scriptSceneId} must be contiguous`);
    if (AI_STORY_SCENE_FUNCTION_REGISTRY[scene.sceneFunction].visibleActionRequired && !scene.entries.some((entry) => entry.type === "ACTION")) block("ACTION_BEAT_PRESENCE_GATE", `Scene ${scene.scriptSceneId} requires visible ACTION`);
    const refs = new Set(script.authorityReferences.map((ref) => `${ref.authorityType}:${ref.authorityId}`));
    const expected = [
      ...scene.characterIds.map((id) => `CHARACTER:${id}`), ...scene.locationIds.map((id) => `LOCATION:${id}`),
      ...scene.propIds.map((id) => `PROP:${id}`), ...scene.assetIds.map((id) => `ASSET:${id}`),
      ...scene.productAuthorityRefs.map((id) => `PRODUCT:${id}`),
    ];
    for (const ref of expected) if (!refs.has(ref) || (options.knownAuthorityReferences && !options.knownAuthorityReferences.has(ref))) block("SCRIPT_REFERENCE_INTEGRITY_GATE", `Unknown authority reference ${ref}`);
    for (const entry of scene.entries) {
      if (entry.type === "DIALOGUE" && !scene.characterIds.includes(entry.speakerId)) block("DIALOGUE_SPEAKER_GATE", `Dialogue speaker ${entry.speakerId} is not a Scene character`);
      if (entry.type === "VO" && !scene.characterIds.includes(entry.voiceOwnerId)) block("DIALOGUE_SPEAKER_GATE", `VO owner ${entry.voiceOwnerId} is not a Scene character`);
      if (entry.type === "ACTION" && ![...scene.characterIds, ...scene.propIds, ...scene.assetIds, ...scene.productAuthorityRefs].includes(entry.subjectId)) block("SCRIPT_REFERENCE_INTEGRITY_GATE", `Action subject ${entry.subjectId} is unresolved`);
    }
    const entryMinimum = scene.entries.reduce((sum, entry) => sum + entry.durationRange.minSeconds, 0);
    if (entryMinimum > scene.targetDurationRange.maxSeconds) block("TIMING_FEASIBILITY_GATE", `Scene ${scene.scriptSceneId} cannot fit its minimum entry estimates`);
    const stateIn = new Map(scene.sceneStateIn.map((fact) => [keyOfFact(fact), fact.value]));
    const stateOut = new Map(scene.sceneStateOut.map((fact) => [keyOfFact(fact), fact.value]));
    for (const delta of scene.sceneStateDeltas) {
      if (delta.fromValue !== null && stateIn.get(keyOfFact(delta)) !== delta.fromValue) block("STATE_CONTINUITY_GATE", `State delta precondition is false in Scene ${scene.scriptSceneId}`);
      if (stateOut.get(keyOfFact(delta)) !== delta.value) block("STATE_CONTINUITY_GATE", `State delta is not reflected in Scene state-out ${scene.scriptSceneId}`);
    }
  }
  for (let index = 0; index < script.scenes.length - 1; index++) {
    const current = new Map(script.scenes[index]!.sceneStateOut.map((fact) => [keyOfFact(fact), fact.value]));
    for (const next of script.scenes[index + 1]!.sceneStateIn) if (current.has(keyOfFact(next)) && current.get(keyOfFact(next)) !== next.value) block("STATE_CONTINUITY_GATE", `Unexplained state reset before Scene ${script.scenes[index + 1]!.scriptSceneId}`);
  }
  for (let left = 0; left < script.scenes.length; left++) for (let right = left + 1; right < script.scenes.length; right++) {
    const a = script.scenes[left]!; const b = script.scenes[right]!;
    const sameClaims = [...a.outlineBeatClaims.map((claim) => `${claim.outlineBeatId}:${claim.subclaimId ?? ""}`)].sort().join("|") === [...b.outlineBeatClaims.map((claim) => `${claim.outlineBeatId}:${claim.subclaimId ?? ""}`)].sort().join("|");
    if (sameClaims && a.sceneFunction === b.sceneFunction) {
      const hasDelta = b.sceneStateDeltas.length + b.newInformation.length + b.newEvidence.length + b.newActionOutcomes.length + b.productEvidence.length > 0;
      if (!hasDelta) block("SCRIPT_SCENE_DUPLICATION_GATE", `Scene ${b.scriptSceneId} duplicates claimed story work without a certified delta`);
    }
  }
  return issues;
}

export function assertAiStoryScriptLifecycleTransition(from: AiStoryScriptStatus, to: AiStoryScriptStatus) {
  const allowed: Record<AiStoryScriptStatus, readonly AiStoryScriptStatus[]> = { DRAFT: ["VALIDATED"], VALIDATED: ["APPROVED"], APPROVED: ["FROZEN"], FROZEN: ["SUPERSEDED"], SUPERSEDED: [] };
  if (!allowed[from].includes(to)) throw new Error(`Invalid Script lifecycle transition: ${from} -> ${to}`);
}

export function projectLegacyStoryToScriptCompatibility(story: { storyId: string; storyVersionId: string; structuredContent: unknown; dialogue?: unknown; scenePlan?: unknown }) {
  return { kind: "LEGACY_SCRIPT_COMPATIBILITY" as const, ...story, scriptVersion: null };
}
