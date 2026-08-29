import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CHARACTER_CONTRACT_VERSION,
  AiStoryCharacterAuthorityVersionSchema,
  type AiStoryCharacterAuthorityVersion,
  type AiStoryCharacterMutationInput,
} from "./ai-story-character";

export function computeAiStoryCharacterFingerprint(input: Pick<AiStoryCharacterAuthorityVersion,
  "characterId" | "orgId" | "workspaceId" | "campaignId" | "version" | "name" | "canonicalFacts" | "visualAssetReferences" | "status" | "supersedesCharacterVersionId"
>) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_CHARACTER_CONTRACT_VERSION,
    characterId: input.characterId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    version: input.version,
    name: input.name,
    canonicalFacts: input.canonicalFacts,
    visualAssetReferences: input.visualAssetReferences,
    status: input.status,
    supersedesCharacterVersionId: input.supersedesCharacterVersionId,
  });
}

export function buildAiStoryCharacterVersion(input: {
  characterId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  version: number;
  status: "ACTIVE" | "DELETED";
  facts: AiStoryCharacterMutationInput;
  visualAssetReferences: AiStoryCharacterAuthorityVersion["visualAssetReferences"];
  supersedesCharacterVersionId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStoryCharacterAuthorityVersion {
  const base = {
    characterId: input.characterId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    version: input.version,
    name: input.facts.name,
    canonicalFacts: {
      identity: input.facts.identity,
      appearance: input.facts.appearance,
      personality: input.facts.personality,
      emotionalArc: input.facts.emotionalArc,
      relationships: input.facts.relationships,
    },
    visualAssetReferences: input.visualAssetReferences,
    status: input.status,
    supersedesCharacterVersionId: input.supersedesCharacterVersionId,
  };
  const fingerprint = computeAiStoryCharacterFingerprint(base);
  return AiStoryCharacterAuthorityVersionSchema.parse({
    ...base,
    characterVersionId: deterministicUuidFromFingerprint("ai-story-character-version", `${input.characterId}:${input.version}:${fingerprint}`),
    contractVersion: AI_STORY_CHARACTER_CONTRACT_VERSION,
    fingerprint,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}
