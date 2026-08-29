import { z } from "zod";
import { StoryBeatSchema } from "./ai-story";
import {
  AI_STORY_PRODUCT_STORY_PROFILE_ID,
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
  AiStoryProductStoryOutlinePolicySchema,
  AiStoryProductStoryProfileReferenceSchema,
} from "./ai-story-product-story-profile";

export const AI_STORY_OUTLINE_CONTRACT_VERSION = "ai-story-outline.v1" as const;
export const AI_STORY_OUTLINE_STATUSES = [
  "DRAFT", "VALIDATED", "APPROVED", "FROZEN", "SUPERSEDED",
] as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);

export const AiStoryOutlineAuthorityReferenceSchema = z.object({
  authorityType: z.enum(["CAMPAIGN", "PRODUCT", "ASSET", "CHARACTER", "WORLD"]),
  authorityId: Id,
  authorityVersionId: Id.optional(),
}).strict();

export const AiStoryOutlineBeatSchema = StoryBeatSchema.extend({
  id: Id,
  storyUnitId: Id.optional(),
  order: z.number().int().nonnegative(),
  classification: z.enum(["MAJOR", "MINOR"]),
  name: Text.max(200),
  purpose: Text.max(1000),
  summary: Text.max(4000),
  required: z.boolean(),
  ownershipPolicy: z.enum(["EXCLUSIVE", "SPLITTABLE"]),
  authorityReferences: z.array(AiStoryOutlineAuthorityReferenceSchema).default([]),
}).strict();

export const AiStoryOutlineStoryUnitSchema = z.object({
  storyUnitId: Id,
  order: z.number().int().nonnegative(),
  purpose: Text.max(1000),
  summary: Text.max(4000),
  requiredBeatIds: z.array(Id),
  hookId: Id.optional(),
  terminalPayoffId: Id.optional(),
}).strict();

export const AiStoryOutlineHookSchema = z.object({
  hookId: Id,
  semantics: Text.max(200),
  promiseOrQuestion: Text.max(1000),
  beatId: Id.optional(),
  storyUnitId: Id.optional(),
  requiredByProfile: z.boolean().default(false),
}).strict().refine((v) => Number(Boolean(v.beatId)) + Number(Boolean(v.storyUnitId)) === 1, {
  message: "Hook must bind exactly one Beat or Story Unit",
});

export const AiStoryOutlineSetupPayoffSchema = z.object({
  relationshipId: Id,
  setupBeatId: Id,
  payoffBeatId: Id,
  relationshipType: Text.max(100),
  required: z.boolean(),
  intent: Text.max(1000),
}).strict();

export const AiStoryRequiredSceneOutcomeSchema = z.object({
  outcomeId: Id,
  order: z.number().int().nonnegative(),
  outcomeType: z.enum([
    "REVEAL_FACT", "DEMONSTRATE_CONSEQUENCE", "ESTABLISH_CONFLICT",
    "DELIVER_PRODUCT_EVIDENCE", "RESOLVE_SETUP", "CREATE_DECISION_OR_CHANGE",
  ]),
  description: Text.max(1000),
  beatIds: z.array(Id).min(1),
  authorityReferences: z.array(AiStoryOutlineAuthorityReferenceSchema).default([]),
}).strict();

export const AiStoryOutlineCoreProfileReferenceSchema = z.object({
  profileId: z.literal("CORE"),
  profileVersion: z.literal(1),
}).strict();

export const AiStoryOutlineProfileReferenceSchema = z.union([
  AiStoryOutlineCoreProfileReferenceSchema,
  AiStoryProductStoryProfileReferenceSchema,
]);

export const AI_STORY_OUTLINE_PROFILE_REGISTRY = Object.freeze({
  CORE: Object.freeze({ profileId: "CORE" as const, profileVersion: 1 as const, hookRequired: false }),
  PRODUCT_STORY: Object.freeze({
    profileId: AI_STORY_PRODUCT_STORY_PROFILE_ID,
    profileVersion: AI_STORY_PRODUCT_STORY_PROFILE_VERSION,
    policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
    hookRequired: false,
  }),
});

export const AiStoryOutlineVersionSchema = z.object({
  outlineVersionId: Id,
  storyId: Id,
  storyVersionId: Id,
  orgId: Id,
  workspaceId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_OUTLINE_CONTRACT_VERSION),
  profile: AiStoryOutlineProfileReferenceSchema,
  productStoryProfile: AiStoryProductStoryOutlinePolicySchema.optional(),
  premise: Text.max(4000),
  coreClaim: Text.max(2000),
  storyUnits: z.array(AiStoryOutlineStoryUnitSchema),
  beats: z.array(AiStoryOutlineBeatSchema).min(1),
  hooks: z.array(AiStoryOutlineHookSchema),
  setupPayoffs: z.array(AiStoryOutlineSetupPayoffSchema),
  requiredSceneOutcomes: z.array(AiStoryRequiredSceneOutcomeSchema),
  authorityReferences: z.array(AiStoryOutlineAuthorityReferenceSchema),
  upstreamAuthorityId: Text.max(500),
  sourceHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  status: z.enum(AI_STORY_OUTLINE_STATUSES),
  supersedesOutlineVersionId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
  approvedBy: Id.nullable(),
  approvedAt: z.string().datetime().nullable(),
  frozenAt: z.string().datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.profile.profileId === "PRODUCT_STORY" && !value.productStoryProfile) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productStoryProfile"], message: "PRODUCT_STORY requires its versioned Outline policy" });
  }
  if (value.profile.profileId === "CORE" && value.productStoryProfile) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["productStoryProfile"], message: "Core Outline cannot claim PRODUCT_STORY authority" });
  }
});

export type AiStoryOutlineVersion = z.infer<typeof AiStoryOutlineVersionSchema>;
export type AiStoryOutlineStatus = AiStoryOutlineVersion["status"];

export const AI_STORY_OUTLINE_VALIDATION_GATES = [
  "OUTLINE_REFERENCE_INTEGRITY_GATE", "BEAT_ID_UNIQUENESS_GATE", "BEAT_ORDER_GATE",
  "STORY_UNIT_REFERENCE_GATE", "HOOK_BINDING_GATE", "SETUP_PAYOFF_REFERENCE_GATE",
  "SETUP_BEFORE_PAYOFF_GATE", "PROFILE_REFERENCE_GATE", "AUTHORITY_REFERENCE_GATE",
  "OUTLINE_FREEZE_MUTATION_GATE",
] as const;

export type AiStoryOutlineValidationIssue = {
  gate: (typeof AI_STORY_OUTLINE_VALIDATION_GATES)[number];
  message: string;
};

function duplicates(values: readonly string[]) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function orderIsDeterministic(values: readonly { order: number }[]) {
  return values.every((value, index) => value.order === index);
}

export function validateAiStoryOutline(
  outline: AiStoryOutlineVersion,
  options: { knownAuthorityReferences?: ReadonlySet<string> } = {}
): AiStoryOutlineValidationIssue[] {
  const issues: AiStoryOutlineValidationIssue[] = [];
  const beatIds = new Set(outline.beats.map((beat) => beat.id));
  const unitIds = new Set(outline.storyUnits.map((unit) => unit.storyUnitId));
  const hookIds = new Set(outline.hooks.map((hook) => hook.hookId));
  const payoffIds = new Set(outline.setupPayoffs.map((item) => item.relationshipId));
  const beatOrder = new Map(outline.beats.map((beat) => [beat.id, beat.order]));
  if (duplicates(outline.beats.map((beat) => beat.id)).length) {
    issues.push({ gate: "BEAT_ID_UNIQUENESS_GATE", message: "Beat IDs must be unique" });
  }
  if (!orderIsDeterministic(outline.beats) || !orderIsDeterministic(outline.storyUnits)) {
    issues.push({ gate: "BEAT_ORDER_GATE", message: "Beat and Story Unit order must be contiguous from zero" });
  }
  if (duplicates(outline.storyUnits.map((unit) => unit.storyUnitId)).length ||
      duplicates(outline.hooks.map((hook) => hook.hookId)).length ||
      duplicates(outline.setupPayoffs.map((item) => item.relationshipId)).length) {
    issues.push({ gate: "OUTLINE_REFERENCE_INTEGRITY_GATE", message: "Story Unit, Hook, and setup/payoff identities must be unique" });
  }
  if (!orderIsDeterministic(outline.requiredSceneOutcomes)) {
    issues.push({ gate: "BEAT_ORDER_GATE", message: "Required Scene Outcome order must be contiguous from zero" });
  }
  for (const beat of outline.beats) {
    if (beat.storyUnitId && !unitIds.has(beat.storyUnitId)) issues.push({ gate: "STORY_UNIT_REFERENCE_GATE", message: `Unknown Story Unit ${beat.storyUnitId}` });
    if (outline.storyUnits.length && beat.required && !beat.storyUnitId) issues.push({ gate: "STORY_UNIT_REFERENCE_GATE", message: `Required Beat ${beat.id} must belong to a Story Unit` });
  }
  for (const unit of outline.storyUnits) {
    for (const beatId of unit.requiredBeatIds) if (!beatIds.has(beatId)) issues.push({ gate: "OUTLINE_REFERENCE_INTEGRITY_GATE", message: `Unknown required Beat ${beatId}` });
    if (unit.hookId && !hookIds.has(unit.hookId)) issues.push({ gate: "HOOK_BINDING_GATE", message: `Unknown Hook ${unit.hookId}` });
    if (unit.terminalPayoffId && !payoffIds.has(unit.terminalPayoffId)) issues.push({ gate: "SETUP_PAYOFF_REFERENCE_GATE", message: `Unknown payoff ${unit.terminalPayoffId}` });
  }
  for (const beat of outline.beats.filter((item) => item.ownershipPolicy === "EXCLUSIVE")) {
    const structuralAssignments = outline.storyUnits.filter((unit) => unit.requiredBeatIds.includes(beat.id));
    if (structuralAssignments.length > 1) issues.push({ gate: "STORY_UNIT_REFERENCE_GATE", message: `Exclusive Beat ${beat.id} cannot belong to multiple Story Units` });
  }
  for (const hook of outline.hooks) {
    if ((hook.beatId && !beatIds.has(hook.beatId)) || (hook.storyUnitId && !unitIds.has(hook.storyUnitId))) issues.push({ gate: "HOOK_BINDING_GATE", message: `Hook ${hook.hookId} has a dangling reference` });
  }
  for (const relation of outline.setupPayoffs) {
    if (!beatIds.has(relation.setupBeatId) || !beatIds.has(relation.payoffBeatId)) issues.push({ gate: "SETUP_PAYOFF_REFERENCE_GATE", message: `Relationship ${relation.relationshipId} has a dangling Beat` });
    else if ((beatOrder.get(relation.setupBeatId) ?? 0) >= (beatOrder.get(relation.payoffBeatId) ?? 0)) issues.push({ gate: "SETUP_BEFORE_PAYOFF_GATE", message: `Setup must precede payoff for ${relation.relationshipId}` });
  }
  for (const outcome of outline.requiredSceneOutcomes) for (const beatId of outcome.beatIds) if (!beatIds.has(beatId)) issues.push({ gate: "OUTLINE_REFERENCE_INTEGRITY_GATE", message: `Outcome ${outcome.outcomeId} references unknown Beat` });
  const profile = AI_STORY_OUTLINE_PROFILE_REGISTRY[outline.profile.profileId];
  if (!profile || profile.profileVersion !== outline.profile.profileVersion) issues.push({ gate: "PROFILE_REFERENCE_GATE", message: "Unknown Outline profile" });
  if (outline.profile.profileId === "PRODUCT_STORY" && outline.profile.policyFingerprint !== AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT) issues.push({ gate: "PROFILE_REFERENCE_GATE", message: "PRODUCT_STORY policy fingerprint mismatch" });
  if (options.knownAuthorityReferences) {
    for (const ref of [...outline.authorityReferences, ...outline.beats.flatMap((beat) => beat.authorityReferences), ...outline.requiredSceneOutcomes.flatMap((outcome) => outcome.authorityReferences)]) {
      if (!options.knownAuthorityReferences.has(`${ref.authorityType}:${ref.authorityId}`)) issues.push({ gate: "AUTHORITY_REFERENCE_GATE", message: `Unknown authority reference ${ref.authorityType}:${ref.authorityId}` });
    }
  }
  return issues;
}

export function assertAiStoryOutlineLifecycleTransition(from: AiStoryOutlineStatus, to: AiStoryOutlineStatus) {
  const allowed: Record<AiStoryOutlineStatus, readonly AiStoryOutlineStatus[]> = {
    DRAFT: ["VALIDATED"], VALIDATED: ["APPROVED"], APPROVED: ["FROZEN"],
    FROZEN: ["SUPERSEDED"], SUPERSEDED: [],
  };
  if (!allowed[from].includes(to)) throw new Error(`Invalid Outline lifecycle transition: ${from} -> ${to}`);
}

export function projectLegacyStoryToOutlineCompatibility(story: { storyId: string; storyVersionId: string; structuredContent: unknown }) {
  return { kind: "LEGACY_STORY_COMPATIBILITY" as const, storyId: story.storyId, storyVersionId: story.storyVersionId, structuredContent: story.structuredContent, outlineVersion: null };
}
