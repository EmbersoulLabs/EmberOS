import { z } from "zod";

export const AI_STORY_CHARACTER_CONTRACT_VERSION = "ai-story-character.v1" as const;
export const AI_STORY_CHARACTER_STATUSES = ["ACTIVE", "DELETED"] as const;

const Id = z.string().uuid();
const Text = z.string().trim().min(1);
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const AiStoryCharacterRelationshipSchema = z.object({
  relationshipId: Id,
  relatedCharacterId: Id,
  relationshipType: Text.max(200),
  baseline: Text.max(2000),
}).strict();
const CharacterRelationshipsSchema = z.array(AiStoryCharacterRelationshipSchema).refine(
  (relationships) => new Set(relationships.map((relationship) => relationship.relationshipId)).size === relationships.length,
  "Character relationship IDs must be unique",
);

export const AiStoryCharacterVisualAssetReferenceSchema = z.object({
  assetId: Id,
  contentHash: Hash,
  purpose: Text.max(500),
}).strict();

export const AiStoryCharacterCanonicalFactsSchema = z.object({
  identity: Text.max(4000),
  appearance: Text.max(4000),
  personality: Text.max(4000),
  emotionalArc: Text.max(4000),
  relationships: CharacterRelationshipsSchema,
}).strict();

export const AiStoryCharacterAuthorityVersionSchema = z.object({
  characterVersionId: Id,
  characterId: Id,
  orgId: Id,
  workspaceId: Id,
  campaignId: Id,
  version: z.number().int().positive(),
  contractVersion: z.literal(AI_STORY_CHARACTER_CONTRACT_VERSION),
  name: Text.max(200),
  canonicalFacts: AiStoryCharacterCanonicalFactsSchema,
  visualAssetReferences: z.array(AiStoryCharacterVisualAssetReferenceSchema),
  status: z.enum(AI_STORY_CHARACTER_STATUSES),
  fingerprint: Hash,
  supersedesCharacterVersionId: Id.nullable(),
  createdBy: Id,
  createdAt: z.string().datetime(),
}).strict();

export const AiStoryCharacterAuthorityBindingSchema = z.object({
  characterId: Id,
  characterVersionId: Id,
  characterFingerprint: Hash,
}).strict();

export const AiStoryCharacterMutationInputSchema = z.object({
  name: Text.max(200),
  identity: Text.max(4000),
  appearance: Text.max(4000),
  personality: Text.max(4000),
  emotionalArc: Text.max(4000),
  relationships: CharacterRelationshipsSchema.default([]),
  visualAssetIds: z.array(Id).default([]),
}).strict();

export const AiStoryCharacterProposalSchema = AiStoryCharacterMutationInputSchema.extend({
  proposalId: Id,
  proposalOnly: z.literal(true),
}).strict();

export type AiStoryCharacterAuthorityVersion = z.infer<typeof AiStoryCharacterAuthorityVersionSchema>;
export type AiStoryCharacterAuthorityBinding = z.infer<typeof AiStoryCharacterAuthorityBindingSchema>;
export type AiStoryCharacterMutationInput = z.infer<typeof AiStoryCharacterMutationInputSchema>;
export type AiStoryCharacterProposal = z.infer<typeof AiStoryCharacterProposalSchema>;

export const AI_STORY_CHARACTER_LEGACY_FIELD_CLASSIFICATION = Object.freeze({
  role: "COMPATIBILITY_METADATA",
  description: "COMPATIBILITY_METADATA",
  motivation: "COMPATIBILITY_METADATA",
  visualNotes: "CANONICAL_PROJECTION_APPEARANCE",
  costume: "STORY_STATE",
  accessories: "STORY_STATE",
  age: "NON_AUTHORITATIVE_LEGACY_DATA",
  pose: "STORY_STATE",
  emotion: "STORY_STATE",
} as const);

export const AI_STORY_CHARACTER_QC_GATES = [
  "CHARACTER_EXISTS_GATE",
  "CHARACTER_CAMPAIGN_SCOPE_GATE",
  "CHARACTER_VERSION_GATE",
  "CHARACTER_FINGERPRINT_GATE",
  "DIALOGUE_SPEAKER_CHARACTER_GATE",
  "ACTION_CHARACTER_GATE",
  "RELATIONSHIP_CHARACTER_GATE",
  "CHARACTER_CONTINUITY_GATE",
  "CHARACTER_ASSET_REFERENCE_GATE",
] as const;

export type AiStoryCharacterQcGate = (typeof AI_STORY_CHARACTER_QC_GATES)[number];
export type AiStoryCharacterQcIssue = {
  gate: AiStoryCharacterQcGate;
  severity: "BLOCK";
  message: string;
};

export function characterAuthorityBinding(version: AiStoryCharacterAuthorityVersion): AiStoryCharacterAuthorityBinding {
  return {
    characterId: version.characterId,
    characterVersionId: version.characterVersionId,
    characterFingerprint: version.fingerprint,
  };
}

export function validateCharacterAuthorityBindings(input: {
  campaignId: string;
  bindings: readonly AiStoryCharacterAuthorityBinding[];
  versions: readonly AiStoryCharacterAuthorityVersion[];
  referencedCharacterIds?: readonly string[];
  dialogueSpeakerIds?: readonly string[];
  actionCharacterIds?: readonly string[];
  availableAssetIds?: ReadonlySet<string>;
}): AiStoryCharacterQcIssue[] {
  const issues: AiStoryCharacterQcIssue[] = [];
  const block = (gate: AiStoryCharacterQcGate, message: string) => issues.push({ gate, severity: "BLOCK", message });
  const versions = new Map(input.versions.map((version) => [version.characterVersionId, version]));
  const versionsByCharacter = new Map(input.versions.map((version) => [version.characterId, version]));
  const bindings = new Map(input.bindings.map((binding) => [binding.characterId, binding]));
  for (const binding of input.bindings) {
    const version = versions.get(binding.characterVersionId);
    if (!version) {
      if (versionsByCharacter.has(binding.characterId)) block("CHARACTER_VERSION_GATE", `Character ${binding.characterId} version does not resolve`);
      else block("CHARACTER_EXISTS_GATE", `Character ${binding.characterId} does not resolve`);
    }
    else if (version.characterId !== binding.characterId) block("CHARACTER_VERSION_GATE", `Character ${binding.characterId} version belongs to another Character`);
    else {
      if (version.campaignId !== input.campaignId) block("CHARACTER_CAMPAIGN_SCOPE_GATE", `Character ${binding.characterId} belongs to another Campaign`);
      if (version.fingerprint !== binding.characterFingerprint) {
        block("CHARACTER_FINGERPRINT_GATE", `Character ${binding.characterId} fingerprint mismatch`);
        block("CHARACTER_CONTINUITY_GATE", `Character ${binding.characterId} canonical facts drift from the bound snapshot`);
      }
      for (const relationship of version.canonicalFacts.relationships) {
        const related = versionsByCharacter.get(relationship.relatedCharacterId);
        if (!related || related.campaignId !== input.campaignId) block("RELATIONSHIP_CHARACTER_GATE", `Relationship ${relationship.relationshipId} references an unknown or cross-Campaign Character`);
      }
      if (input.availableAssetIds && version.visualAssetReferences.some((asset) => !input.availableAssetIds!.has(asset.assetId))) block("CHARACTER_ASSET_REFERENCE_GATE", `Character ${binding.characterId} has an unresolved visual Asset`);
    }
  }
  for (const id of input.referencedCharacterIds ?? []) if (!bindings.has(id)) block("CHARACTER_EXISTS_GATE", `Unknown Character ${id}`);
  for (const id of input.dialogueSpeakerIds ?? []) if (!bindings.has(id)) block("DIALOGUE_SPEAKER_CHARACTER_GATE", `Dialogue speaker ${id} is not bound to Character authority`);
  for (const id of input.actionCharacterIds ?? []) if (!bindings.has(id)) block("ACTION_CHARACTER_GATE", `Action Character ${id} is not bound to Character authority`);
  return issues;
}

export function projectLegacyCharacterCompatibility(input: unknown) {
  return { kind: "LEGACY_CHARACTER_COMPATIBILITY" as const, canonicalCharacter: null, legacyPayload: input };
}
