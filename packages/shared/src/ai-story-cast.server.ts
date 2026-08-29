import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CAST_CONTRACT_VERSION,
  AiStorySupportingCharacterVersionSchema,
  type AiStorySupportingCharacterMutationInput,
  type AiStorySupportingCharacterVersion,
} from "./ai-story-cast";

export function computeAiStorySupportingCharacterFingerprint(input: Pick<AiStorySupportingCharacterVersion,
  "supportingCharacterId" | "orgId" | "workspaceId" | "campaignId" | "storyId" | "version" | "displayName" | "identity" | "storyRole" | "appearance" | "relationships" | "continuityFacts" | "visualAssetReferences" | "status" | "supersedesSupportingCharacterVersionId"
>) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_CAST_CONTRACT_VERSION,
    supportingCharacterId: input.supportingCharacterId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    version: input.version,
    displayName: input.displayName,
    identity: input.identity,
    storyRole: input.storyRole,
    appearance: input.appearance,
    relationships: input.relationships,
    continuityFacts: input.continuityFacts,
    visualAssetReferences: input.visualAssetReferences,
    status: input.status,
    supersedesSupportingCharacterVersionId: input.supersedesSupportingCharacterVersionId,
  });
}

export function buildAiStorySupportingCharacterVersion(input: {
  supportingCharacterId: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string;
  version: number;
  status: "ACTIVE" | "DELETED";
  facts: AiStorySupportingCharacterMutationInput;
  visualAssetReferences: AiStorySupportingCharacterVersion["visualAssetReferences"];
  supersedesSupportingCharacterVersionId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStorySupportingCharacterVersion {
  const base = {
    supportingCharacterId: input.supportingCharacterId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    storyId: input.storyId,
    version: input.version,
    displayName: input.facts.displayName,
    identity: input.facts.identity,
    ...(input.facts.storyRole ? { storyRole: input.facts.storyRole } : {}),
    appearance: input.facts.appearance,
    relationships: input.facts.relationships,
    continuityFacts: input.facts.continuityFacts,
    visualAssetReferences: input.visualAssetReferences,
    status: input.status,
    supersedesSupportingCharacterVersionId: input.supersedesSupportingCharacterVersionId,
  };
  const fingerprint = computeAiStorySupportingCharacterFingerprint(base);
  return AiStorySupportingCharacterVersionSchema.parse({
    ...base,
    supportingCharacterVersionId: deterministicUuidFromFingerprint("ai-story-supporting-character-version", `${input.supportingCharacterId}:${input.version}:${fingerprint}`),
    contractVersion: AI_STORY_CAST_CONTRACT_VERSION,
    fingerprint,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}
