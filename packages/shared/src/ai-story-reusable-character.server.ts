import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import { buildAiStoryCharacterVersion } from "./ai-story-character.server";
import type { AiStoryCharacterAuthorityVersion } from "./ai-story-character";
import {
  AI_STORY_REUSABLE_CHARACTER_CONTRACT_VERSION,
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryReusableCharacterCampaignProjectionSchema,
  AiStoryReusableCharacterLineageSchema,
  AiStoryReusableCharacterVersionSchema,
  emptyEpisodeLook,
  type AiStoryCharacterContinuityAnchor,
  type AiStoryCharacterEpisodeLook,
  type AiStoryEpisodeCharacterBinding,
  type AiStoryReusableCharacterCanonicalAsset,
  type AiStoryReusableCharacterCampaignProjection,
  type AiStoryReusableCharacterLineage,
  type AiStoryReusableCharacterVersion,
} from "./ai-story-reusable-character";

export function computeReusableCharacterIdentityFingerprint(input: {
  reusableCharacterId: string;
  identityCore: AiStoryReusableCharacterVersion["identityCore"];
  canonicalAssets: readonly AiStoryReusableCharacterCanonicalAsset[];
}) {
  return sha256CanonicalIntegrityHash({
    reusableCharacterId: input.reusableCharacterId,
    identityCore: input.identityCore,
    canonicalAssets: input.canonicalAssets,
  });
}

export function computeReusableCharacterFingerprint(
  input: Pick<
    AiStoryReusableCharacterVersion,
    | "reusableCharacterId"
    | "orgId"
    | "workspaceId"
    | "name"
    | "identityCore"
    | "defaultLook"
    | "mutableLookPolicy"
    | "canonicalAssets"
    | "status"
    | "version"
    | "supersedesReusableCharacterVersionId"
  >
) {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_REUSABLE_CHARACTER_CONTRACT_VERSION,
    ...input,
  });
}

export function buildAiStoryReusableCharacterVersion(input: {
  reusableCharacterId: string;
  orgId: string;
  workspaceId: string;
  name: string;
  identityCore: AiStoryReusableCharacterVersion["identityCore"];
  defaultLook: AiStoryReusableCharacterVersion["defaultLook"];
  mutableLookPolicy: AiStoryReusableCharacterVersion["mutableLookPolicy"];
  canonicalAssets: AiStoryReusableCharacterCanonicalAsset[];
  status: AiStoryReusableCharacterVersion["status"];
  version: number;
  supersedesReusableCharacterVersionId: string | null;
  createdBy: string;
  createdAt: string;
}): AiStoryReusableCharacterVersion {
  const identityFingerprint = computeReusableCharacterIdentityFingerprint(input);
  const fingerprint = computeReusableCharacterFingerprint({
    reusableCharacterId: input.reusableCharacterId,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    name: input.name,
    identityCore: input.identityCore,
    defaultLook: input.defaultLook,
    mutableLookPolicy: input.mutableLookPolicy,
    canonicalAssets: input.canonicalAssets,
    status: input.status,
    version: input.version,
    supersedesReusableCharacterVersionId: input.supersedesReusableCharacterVersionId,
  });
  return AiStoryReusableCharacterVersionSchema.parse({
    ...input,
    reusableCharacterVersionId: deterministicUuidFromFingerprint(
      "ai-story-reusable-character-version",
      `${input.reusableCharacterId}:${input.version}:${fingerprint}`
    ),
    contractVersion: AI_STORY_REUSABLE_CHARACTER_CONTRACT_VERSION,
    fingerprint,
    identityFingerprint,
  });
}

export function projectReusableCharacterToCampaignFacts(version: AiStoryReusableCharacterVersion) {
  const master = version.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER")!;
  return {
    name: version.name,
    identity: version.identityCore.identityDescription,
    appearance: [
      version.identityCore.faceIdentityDescription,
      version.identityCore.bodyIdentityDescription,
      ...version.identityCore.distinctiveVisualFacts,
      `Default wardrobe: ${version.defaultLook.wardrobe}`,
    ].join(" "),
    personality: "Reusable Workspace Character. Episode Story state is authorized separately.",
    emotionalArc: "May evolve only through authorized Episode Story state.",
    relationships: [] as AiStoryCharacterAuthorityVersion["canonicalFacts"]["relationships"],
    visualAssetReferences: version.canonicalAssets.map((asset) => ({
      assetId: asset.assetId,
      contentHash: asset.contentHash,
      purpose: asset.role === "IDENTITY_MASTER" ? "CHARACTER_IDENTITY_MASTER" : `CHARACTER_${asset.role}`,
    })),
    identityMaster: master,
  };
}

export function buildCampaignProjectionFromReusableCharacter(input: {
  reusable: AiStoryReusableCharacterVersion;
  campaignId: string;
  campaignCharacterId: string;
  campaignCharacterVersionNumber?: number;
  supersedesCharacterVersionId?: string | null;
  createdBy: string;
  createdAt: string;
}): {
  campaignCharacter: AiStoryCharacterAuthorityVersion;
  projection: AiStoryReusableCharacterCampaignProjection;
} {
  const facts = projectReusableCharacterToCampaignFacts(input.reusable);
  const campaignCharacter = buildAiStoryCharacterVersion({
    characterId: input.campaignCharacterId,
    orgId: input.reusable.orgId,
    workspaceId: input.reusable.workspaceId,
    campaignId: input.campaignId,
    version: input.campaignCharacterVersionNumber ?? 1,
    status: "ACTIVE",
    facts: {
      name: facts.name,
      identity: facts.identity,
      appearance: facts.appearance,
      personality: facts.personality,
      emotionalArc: facts.emotionalArc,
      relationships: [],
      visualAssetIds: facts.visualAssetReferences.map((asset) => asset.assetId),
    },
    visualAssetReferences: facts.visualAssetReferences,
    supersedesCharacterVersionId: input.supersedesCharacterVersionId ?? null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
  const projectionFingerprint = sha256CanonicalIntegrityHash({
    reusableCharacterVersionId: input.reusable.reusableCharacterVersionId,
    reusableCharacterFingerprint: input.reusable.fingerprint,
    campaignId: input.campaignId,
    campaignCharacterVersionId: campaignCharacter.characterVersionId,
    campaignCharacterFingerprint: campaignCharacter.fingerprint,
  });
  return {
    campaignCharacter,
    projection: AiStoryReusableCharacterCampaignProjectionSchema.parse({
      projectionId: deterministicUuidFromFingerprint(
        "ai-story-reusable-character-campaign-projection",
        projectionFingerprint
      ),
      reusableCharacterId: input.reusable.reusableCharacterId,
      reusableCharacterVersionId: input.reusable.reusableCharacterVersionId,
      reusableCharacterFingerprint: input.reusable.fingerprint,
      campaignId: input.campaignId,
      campaignCharacterId: campaignCharacter.characterId,
      campaignCharacterVersionId: campaignCharacter.characterVersionId,
      campaignCharacterFingerprint: campaignCharacter.fingerprint,
      projectionFingerprint,
      createdAt: input.createdAt,
    }),
  };
}

export function buildEpisodeCharacterBinding(input: {
  storyId: string;
  episodeId?: string;
  reusable: AiStoryReusableCharacterVersion;
  projection: AiStoryReusableCharacterCampaignProjection;
  episodeLook?: AiStoryCharacterEpisodeLook;
  continuityAnchorIds?: string[];
  createdBy: string;
  createdAt: string;
}): AiStoryEpisodeCharacterBinding {
  const episodeLook = input.episodeLook ?? emptyEpisodeLook();
  const canonicalAssetIds = input.reusable.canonicalAssets.map((asset) => asset.assetId);
  const bindingFingerprint = sha256CanonicalIntegrityHash({
    storyId: input.storyId,
    reusableCharacterVersionId: input.reusable.reusableCharacterVersionId,
    identityFingerprint: input.reusable.identityFingerprint,
    campaignCharacterVersionId: input.projection.campaignCharacterVersionId,
    episodeLook,
    canonicalAssetIds,
    continuityAnchorIds: input.continuityAnchorIds ?? [],
  });
  return AiStoryEpisodeCharacterBindingSchema.parse({
    episodeCharacterBindingId: deterministicUuidFromFingerprint(
      "ai-story-episode-character-binding",
      bindingFingerprint
    ),
    storyId: input.storyId,
    episodeId: input.episodeId ?? input.storyId,
    reusableCharacterId: input.reusable.reusableCharacterId,
    reusableCharacterVersionId: input.reusable.reusableCharacterVersionId,
    campaignCharacterId: input.projection.campaignCharacterId,
    campaignCharacterVersionId: input.projection.campaignCharacterVersionId,
    identityFingerprint: input.reusable.identityFingerprint,
    episodeLook,
    canonicalAssetIds,
    continuityAnchorIds: input.continuityAnchorIds ?? [],
    bindingFingerprint,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
  });
}

export function compileReusableCharacterLineage(input: {
  reusable: AiStoryReusableCharacterVersion;
  projection: AiStoryReusableCharacterCampaignProjection;
  binding: AiStoryEpisodeCharacterBinding;
  continuityAnchor?: Pick<AiStoryCharacterContinuityAnchor, "anchorId" | "contentHash"> | null;
  groundingPath: AiStoryReusableCharacterLineage["groundingPath"];
  grounding: "PASS" | "FAIL";
}): AiStoryReusableCharacterLineage {
  const master = input.reusable.canonicalAssets.find((asset) => asset.role === "IDENTITY_MASTER")!;
  return AiStoryReusableCharacterLineageSchema.parse({
    reusableCharacterId: input.reusable.reusableCharacterId,
    reusableCharacterVersionId: input.reusable.reusableCharacterVersionId,
    campaignCharacterId: input.projection.campaignCharacterId,
    campaignCharacterVersionId: input.projection.campaignCharacterVersionId,
    identityFingerprint: input.reusable.identityFingerprint,
    name: input.reusable.name,
    primaryIdentityAssetId: master.assetId,
    primaryIdentityContentHash: master.contentHash,
    continuityAnchorId: input.continuityAnchor?.anchorId ?? null,
    continuityAnchorContentHash: input.continuityAnchor?.contentHash ?? null,
    episodeLook: input.binding.episodeLook,
    groundingPath: input.groundingPath,
    grounding: input.grounding,
  });
}
