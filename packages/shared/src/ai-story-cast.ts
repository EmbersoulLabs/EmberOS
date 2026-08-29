import { z } from "zod";
import { AiStoryCharacterVisualAssetReferenceSchema } from "./ai-story-character";

export const AI_STORY_CAST_CONTRACT_VERSION = "ai-story-cast.v1" as const;
export const AI_STORY_CAST_SCOPES = ["CAMPAIGN_CHARACTER", "STORY_SUPPORTING_CHARACTER", "EPHEMERAL_ACTOR"] as const;
export const AI_STORY_VISUAL_IDENTITY_REQUIREMENTS = ["NONE", "PREFERRED", "REQUIRED"] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

const PersistentBinding = z.object({
  authorityVersionId: Id,
  authorityFingerprint: Hash,
}).strict();

export const AiStoryCampaignCharacterCastReferenceSchema = PersistentBinding.extend({
  scope: z.literal("CAMPAIGN_CHARACTER"),
  id: Id,
  campaignId: Id,
  visualIdentityRequirement: z.enum(AI_STORY_VISUAL_IDENTITY_REQUIREMENTS),
}).strict();

export const AiStorySupportingCharacterCastReferenceSchema = PersistentBinding.extend({
  scope: z.literal("STORY_SUPPORTING_CHARACTER"),
  id: Id,
  storyId: Id,
  visualIdentityRequirement: z.enum(AI_STORY_VISUAL_IDENTITY_REQUIREMENTS),
}).strict();

export const AiStoryEphemeralActorCastReferenceSchema = z.object({
  scope: z.literal("EPHEMERAL_ACTOR"),
  id: Id,
  storyId: Id,
  scriptSceneId: Id,
  displayName: Text.max(200),
  semanticRole: Text.max(500),
  appearance: Text.max(2000),
  visualIdentityRequirement: z.enum(AI_STORY_VISUAL_IDENTITY_REQUIREMENTS),
}).strict();

export const AiStoryCastReferenceSchema = z.discriminatedUnion("scope", [
  AiStoryCampaignCharacterCastReferenceSchema,
  AiStorySupportingCharacterCastReferenceSchema,
  AiStoryEphemeralActorCastReferenceSchema,
]);

export const AiStoryCastRelationshipSchema = z.object({
  relationshipId: Id,
  relatedCast: AiStoryCastReferenceSchema,
  relationshipType: Text.max(200),
  baseline: Text.max(2000),
}).strict();

export const AiStorySceneCastRelationshipSchema = z.object({
  relationshipId: Id,
  sourceCast: AiStoryCastReferenceSchema,
  targetCast: AiStoryCastReferenceSchema,
  relationshipType: Text.max(200),
  state: Text.max(2000),
}).strict();

export const AiStorySupportingCharacterMutationInputSchema = z.object({
  displayName: Text.max(200),
  identity: Text.max(3000),
  storyRole: Text.max(1000).optional(),
  appearance: Text.max(3000),
  relationships: z.array(AiStoryCastRelationshipSchema).default([]),
  continuityFacts: z.array(Text.max(2000)).default([]),
  visualAssetIds: z.array(Id).default([]),
}).strict();

export const AiStorySupportingCharacterVersionSchema = z.object({
  supportingCharacterVersionId: Id,
  supportingCharacterId: Id,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_CAST_CONTRACT_VERSION),
  displayName: Text.max(200),
  identity: Text.max(3000),
  storyRole: Text.max(1000).optional(),
  appearance: Text.max(3000),
  relationships: z.array(AiStoryCastRelationshipSchema),
  continuityFacts: z.array(Text.max(2000)),
  visualAssetReferences: z.array(AiStoryCharacterVisualAssetReferenceSchema),
  status: z.enum(["ACTIVE", "DELETED"]),
  fingerprint: Hash,
  supersedesSupportingCharacterVersionId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
}).strict();

export const AiStoryCastPromotionSchema = z.object({
  promotionId: Id,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  storyId: Id,
  source: AiStoryCastReferenceSchema,
  target: AiStoryCastReferenceSchema,
  promotedBy: Id,
  promotedAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  const valid = value.source.scope === "EPHEMERAL_ACTOR"
    ? value.target.scope === "STORY_SUPPORTING_CHARACTER"
    : value.source.scope === "STORY_SUPPORTING_CHARACTER" && value.target.scope === "CAMPAIGN_CHARACTER";
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Only Ephemeral-to-Supporting and Supporting-to-Campaign promotion are allowed" });
});

export type AiStoryCastReference = z.infer<typeof AiStoryCastReferenceSchema>;
export type AiStoryEphemeralActorCastReference = z.infer<typeof AiStoryEphemeralActorCastReferenceSchema>;
export type AiStorySupportingCharacterMutationInput = z.infer<typeof AiStorySupportingCharacterMutationInputSchema>;
export type AiStorySupportingCharacterVersion = z.infer<typeof AiStorySupportingCharacterVersionSchema>;
export type AiStoryCastPromotion = z.infer<typeof AiStoryCastPromotionSchema>;

export const AI_STORY_CAST_QC_GATES = [
  "CAST_REFERENCE_GATE", "CAST_SCOPE_GATE", "CAMPAIGN_CHARACTER_SCOPE_GATE",
  "SUPPORTING_CHARACTER_STORY_SCOPE_GATE", "EPHEMERAL_ACTOR_SCENE_SCOPE_GATE",
  "CAST_VERSION_GATE", "CAST_FINGERPRINT_GATE", "DIALOGUE_CAST_GATE",
  "ACTION_CAST_GATE", "RELATIONSHIP_CAST_GATE", "CAST_CONTINUITY_GATE",
  "CAST_VISUAL_REFERENCE_GATE",
] as const;

export type AiStoryCastQcIssue = { gate: (typeof AI_STORY_CAST_QC_GATES)[number]; severity: "BLOCK"; message: string };

export function castReferenceKey(reference: AiStoryCastReference) { return `${reference.scope}:${reference.id}`; }

export function validateCastReferences(input: {
  campaignId: string;
  storyId: string;
  sceneIds: ReadonlySet<string>;
  references: readonly AiStoryCastReference[];
  campaignCharacters: readonly { characterId: string; characterVersionId: string; campaignId: string; fingerprint: string; status: string; visualAssetReferences: readonly { assetId: string }[] }[];
  supportingCharacters: readonly AiStorySupportingCharacterVersion[];
  availableAssetIds?: ReadonlySet<string>;
  dialogueReferences?: readonly AiStoryCastReference[];
  actionReferences?: readonly AiStoryCastReference[];
  sceneRelationships?: readonly z.infer<typeof AiStorySceneCastRelationshipSchema>[];
}): AiStoryCastQcIssue[] {
  const issues: AiStoryCastQcIssue[] = [];
  const block = (gate: AiStoryCastQcIssue["gate"], message: string) => issues.push({ gate, severity: "BLOCK", message });
  const seen = new Set<string>();
  for (const reference of input.references) {
    const key = castReferenceKey(reference);
    if (seen.has(key)) block("CAST_REFERENCE_GATE", `Duplicate Cast reference ${key}`);
    seen.add(key);
    if (reference.scope === "CAMPAIGN_CHARACTER") {
      const character = input.campaignCharacters.find((item) => item.characterId === reference.id && item.characterVersionId === reference.authorityVersionId);
      if (!character) block("CAST_VERSION_GATE", `Campaign Character ${reference.id} version does not resolve`);
      else {
        if (character.campaignId !== input.campaignId || reference.campaignId !== input.campaignId) block("CAMPAIGN_CHARACTER_SCOPE_GATE", `Campaign Character ${reference.id} belongs to another Campaign`);
        if (character.fingerprint !== reference.authorityFingerprint) block("CAST_FINGERPRINT_GATE", `Campaign Character ${reference.id} fingerprint mismatch`);
        if (character.status !== "ACTIVE") block("CAST_REFERENCE_GATE", `Campaign Character ${reference.id} is not active`);
        if (input.availableAssetIds && character.visualAssetReferences.some((asset) => !input.availableAssetIds!.has(asset.assetId))) block("CAST_VISUAL_REFERENCE_GATE", `Campaign Character ${reference.id} has an unresolved visual Asset`);
      }
    } else if (reference.scope === "STORY_SUPPORTING_CHARACTER") {
      const character = input.supportingCharacters.find((item) => item.supportingCharacterId === reference.id && item.supportingCharacterVersionId === reference.authorityVersionId);
      if (!character) block("CAST_VERSION_GATE", `Supporting Character ${reference.id} version does not resolve`);
      else {
        if (character.storyId !== input.storyId || reference.storyId !== input.storyId) block("SUPPORTING_CHARACTER_STORY_SCOPE_GATE", `Supporting Character ${reference.id} belongs to another Story`);
        if (character.campaignId !== input.campaignId) block("CAST_SCOPE_GATE", `Supporting Character ${reference.id} belongs to another Campaign`);
        if (character.fingerprint !== reference.authorityFingerprint) block("CAST_FINGERPRINT_GATE", `Supporting Character ${reference.id} fingerprint mismatch`);
        if (character.status !== "ACTIVE") block("CAST_REFERENCE_GATE", `Supporting Character ${reference.id} is not active`);
        if (input.availableAssetIds && character.visualAssetReferences.some((asset) => !input.availableAssetIds!.has(asset.assetId))) block("CAST_VISUAL_REFERENCE_GATE", `Supporting Character ${reference.id} has an unresolved visual Asset`);
      }
    } else if (reference.storyId !== input.storyId || !input.sceneIds.has(reference.scriptSceneId)) {
      block("EPHEMERAL_ACTOR_SCENE_SCOPE_GATE", `Ephemeral Actor ${reference.id} is outside its Scene or Story scope`);
    }
  }
  const bound = new Set(input.references.map(castReferenceKey));
  for (const reference of input.dialogueReferences ?? []) if (!bound.has(castReferenceKey(reference))) block("DIALOGUE_CAST_GATE", `Dialogue Cast ${castReferenceKey(reference)} is not bound`);
  for (const reference of input.actionReferences ?? []) if (!bound.has(castReferenceKey(reference))) block("ACTION_CAST_GATE", `Action Cast ${castReferenceKey(reference)} is not bound`);
  for (const relationship of input.sceneRelationships ?? []) if (!bound.has(castReferenceKey(relationship.sourceCast)) || !bound.has(castReferenceKey(relationship.targetCast))) block("RELATIONSHIP_CAST_GATE", `Scene relationship ${relationship.relationshipId} has an unresolved Cast reference`);
  return issues;
}

export function projectLegacyCastCompatibility(input: unknown) {
  return { kind: "LEGACY_CAST_COMPATIBILITY" as const, canonicalCastReferences: null, legacyPayload: input };
}

export const AI_STORY_CAST_SCOPE_POLICY = Object.freeze({
  roleNameDeterminesScope: false,
  genreDeterminesScope: false,
  automaticPromotion: false,
  automaticDemotion: false,
  castScopeForcesGenerationMode: false,
  campaignCharacterOwner: "CAMPAIGN",
  supportingCharacterOwner: "STORY",
  ephemeralActorOwner: "SCENE_EXECUTION_CONTEXT",
});

export function selectCastScopeFromContinuityHorizon(input: {
  continuityHorizon: "CAMPAIGN" | "STORY" | "SCENE";
  roleLabel?: string;
  genre?: string;
  userRequestedScope?: AiStoryCastReference["scope"];
}) {
  const required = input.continuityHorizon === "CAMPAIGN" ? "CAMPAIGN_CHARACTER" : input.continuityHorizon === "STORY" ? "STORY_SUPPORTING_CHARACTER" : "EPHEMERAL_ACTOR";
  if (input.userRequestedScope && input.userRequestedScope !== required) throw new Error("CAST_SCOPE_INTENT_CONFLICTS_WITH_CONTINUITY_HORIZON");
  return required;
}
