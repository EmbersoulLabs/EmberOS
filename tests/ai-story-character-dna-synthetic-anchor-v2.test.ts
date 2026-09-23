import { describe, expect, it } from "vitest";
import {
  AiStoryEpisodeCharacterBindingSchema,
  AiStoryReusableCharacterVersionSchema,
  CHARACTER_DNA_TEXT_ONLY_VISUAL_IDENTITY,
  assertAiStoryCompiledProviderWireModeCompatibility,
  resolveExplicitAiStorySceneGenerationAuthority,
  seedanceIdentityAssetIdsForCharacter,
} from "@ceo-agent/shared";
import {
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  computeCharacterDnaFingerprint,
  mapCharacterDnaToIdentityCore,
  mockCharacterDnaFixture,
} from "@ceo-agent/shared/server";
import {
  compileImmutableSeedanceRequestFromSceneCompilation,
  previewAiStorySeedanceWireRequest,
} from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";
import { isApprovedPrivateSyntheticIdentityAnchorAsset } from "../packages/db/src/queries/ai-story-reusable-character";

const IDS = {
  org: "82000000-0000-4000-8000-000000000001",
  workspace: "82000000-0000-4000-8000-000000000002",
  actor: "82000000-0000-4000-8000-000000000003",
  source: "82000000-0000-4000-8000-000000000004",
  anchor: "82000000-0000-4000-8000-000000000005",
  character: "82000000-0000-4000-8000-000000000006",
  campaign: "82000000-0000-4000-8000-000000000007",
  campaignCharacter: "82000000-0000-4000-8000-000000000008",
  story: "82000000-0000-4000-8000-000000000009",
};
const SOURCE_HASH = `sha256:${"1".repeat(64)}`;
const ANCHOR_HASH = `sha256:${"2".repeat(64)}`;
const DNA = mockCharacterDnaFixture({
  sourceAssetId: IDS.source,
  sourceContentHash: SOURCE_HASH,
});

function character(canonicalAssets: Array<{
  assetId: string;
  contentHash: string;
  role: "CHARACTER_SOURCE_PORTRAIT" | "SYNTHETIC_IDENTITY_ANCHOR";
  source: "USER_APPROVED";
}>, version = 1, supersedesReusableCharacterVersionId: string | null = null) {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.character,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    name: "Alicia DNA Certification",
    identityCore: mapCharacterDnaToIdentityCore(DNA),
    defaultLook: {
      wardrobe: "default commercial wardrobe",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
    },
    mutableLookPolicy: {
      wardrobeAllowed: true,
      makeupAllowed: true,
      accessoriesAllowed: true,
      hairstyleAllowed: false,
      hairColorAllowed: false,
    },
    canonicalAssets,
    status: "ACTIVE",
    version,
    supersedesReusableCharacterVersionId,
    createdBy: IDS.actor,
    createdAt: `2026-09-23T0${version}:00:00.000Z`,
    identityMode: "CHARACTER_DNA",
    characterDna: DNA,
  });
}

function sourceAsset() {
  return {
    assetId: IDS.source,
    contentHash: SOURCE_HASH,
    role: "CHARACTER_SOURCE_PORTRAIT" as const,
    source: "USER_APPROVED" as const,
  };
}

function anchorAsset() {
  return {
    assetId: IDS.anchor,
    contentHash: ANCHOR_HASH,
    role: "SYNTHETIC_IDENTITY_ANCHOR" as const,
    source: "USER_APPROVED" as const,
  };
}

function hybridFixture() {
  const soft = character([sourceAsset()]);
  const hybrid = character([sourceAsset(), anchorAsset()], 2, soft.reusableCharacterVersionId);
  const { projection, campaignCharacter } = buildCampaignProjectionFromReusableCharacter({
    reusable: hybrid,
    campaignId: IDS.campaign,
    campaignCharacterId: IDS.campaignCharacter,
    createdBy: IDS.actor,
    createdAt: "2026-09-23T03:00:00.000Z",
  });
  const binding = buildEpisodeCharacterBinding({
    storyId: IDS.story,
    reusable: hybrid,
    projection,
    episodeLook: {
      wardrobe: "white blouse",
      makeup: null,
      accessories: null,
      hairstyle: null,
      hairColor: null,
      expression: "gentle smile",
      pose: "natural standing posture",
      location: "warm modern café",
      action: "small natural turn toward camera",
      product: null,
      dialogue: null,
    },
    createdBy: IDS.actor,
    createdAt: "2026-09-23T03:01:00.000Z",
  });
  return { soft, hybrid, projection, campaignCharacter, binding };
}

function compileHybrid() {
  const { hybrid, binding } = hybridFixture();
  const compilation = makePhase2aCompilation({ sceneOrder: [0] });
  const baseIntent = compilation.intents[0]!;
  const baseInstructions = compilation.instructionsBySceneExecutionId[
    baseIntent.identity.sceneExecutionId
  ]!;
  const generationAuthority = {
    strategy: "TEXT_TO_VIDEO" as const,
    referenceSource: "CHARACTER_SYNTHETIC_ANCHOR" as const,
    effectiveReferenceIds: [IDS.anchor],
    firstFrameAssetId: null,
    productVisualIdentityRequirement: "NONE" as const,
  };
  return compileImmutableSeedanceRequestFromSceneCompilation({
    intent: {
      ...baseIntent,
      referencedAssetIds: [IDS.anchor],
      generationAuthority,
    },
    instructions: {
      ...baseInstructions,
      referencedAssetIds: [IDS.anchor],
      generationAuthority,
    },
    authority: {
      qcEvaluationId: "82000000-0000-4000-8000-000000000010",
      qcFingerprint: `sha256:${"3".repeat(64)}`,
      qcCapabilityVersion: "seedance-modelark-test.v1",
      directorFingerprint: `sha256:${"4".repeat(64)}`,
      motionFingerprint: `sha256:${"5".repeat(64)}`,
    },
    adapterVersion: "1.0.0",
    compiledAt: "2026-09-23T03:02:00.000Z",
    resolution: "480p",
    referenceAssets: [{
      assetId: IDS.anchor,
      mediaType: "image/png",
      storagePath: `${IDS.workspace}/library/${IDS.anchor}.png`,
      contentHash: ANCHOR_HASH,
      characterAssetRole: "SYNTHETIC_IDENTITY_ANCHOR",
      characterAuthorityId: IDS.character,
    }],
    characterDnaAuthority: {
      reusableCharacterId: IDS.character,
      reusableCharacterVersionId: hybrid.reusableCharacterVersionId,
      identityFingerprint: hybrid.identityFingerprint,
      characterDnaFingerprint: hybrid.characterDnaFingerprint!,
      characterConsistencyMode: "DNA_PLUS_SYNTHETIC_ANCHOR",
      dna: DNA,
      episodeLook: binding.episodeLook,
      sourcePortraitAssetId: IDS.source,
      syntheticIdentityAnchorAssetId: IDS.anchor,
    },
  });
}

describe("Character DNA + Synthetic Identity Anchor V2", () => {
  it("keeps historical soft DNA readable and creates a new hybrid version", () => {
    const { soft, hybrid } = hybridFixture();
    expect(CHARACTER_DNA_TEXT_ONLY_VISUAL_IDENTITY).toBe("FAIL");
    expect(AiStoryReusableCharacterVersionSchema.parse(soft).characterConsistencyMode)
      .toBe("SOFT_DESCRIPTION_BASED");
    expect(hybrid.version).toBe(2);
    expect(hybrid.supersedesReusableCharacterVersionId).toBe(soft.reusableCharacterVersionId);
    expect(hybrid.characterConsistencyMode).toBe("DNA_PLUS_SYNTHETIC_ANCHOR");
    expect(hybrid.characterDnaFingerprint).toBe(soft.characterDnaFingerprint);
    expect(hybrid.characterDnaFingerprint).toBe(computeCharacterDnaFingerprint(DNA));
    expect(hybrid.identityFingerprint).not.toBe(soft.identityFingerprint);
    expect(hybrid.reusableCharacterVersionId).not.toBe(soft.reusableCharacterVersionId);
  });

  it("requires one distinct approved anchor role and never uses the source portrait", () => {
    expect(() => character([sourceAsset()], 2)).not.toThrow();
    expect(() => character([sourceAsset(), { ...anchorAsset(), assetId: IDS.source }], 2))
      .toThrow(/cannot be used/i);
    expect(() => character([sourceAsset(), anchorAsset(), {
      ...anchorAsset(),
      assetId: "82000000-0000-4000-8000-000000000011",
    }], 2)).toThrow(/consistency|exactly one/i);
    expect(seedanceIdentityAssetIdsForCharacter({
      identityMode: "CHARACTER_DNA",
      characterDnaFingerprint: computeCharacterDnaFingerprint(DNA),
      canonicalAssets: [
        { assetId: IDS.source, role: "CHARACTER_SOURCE_PORTRAIT" },
        { assetId: IDS.anchor, role: "SYNTHETIC_IDENTITY_ANCHOR" },
      ],
    })).toEqual([IDS.anchor]);
  });

  it("accepts only a human-approved private anchor in the same Workspace", () => {
    const approved = {
      orgId: IDS.org,
      workspaceId: IDS.workspace,
      campaignId: null,
      type: "image",
      mimeType: "image/png",
      storagePath: `${IDS.workspace}/library/${IDS.anchor}.png`,
      status: "ready",
      contentHash: ANCHOR_HASH,
      metadata: {
        characterAssetSemantic: "SYNTHETIC_IDENTITY_ANCHOR",
        humanApproved: true,
      },
      deletedAt: null,
      expectedOrgId: IDS.org,
      expectedWorkspaceId: IDS.workspace,
    };
    expect(isApprovedPrivateSyntheticIdentityAnchorAsset(approved)).toBe(true);
    expect(isApprovedPrivateSyntheticIdentityAnchorAsset({
      ...approved,
      workspaceId: "82000000-0000-4000-8000-000000000012",
    })).toBe(false);
    expect(isApprovedPrivateSyntheticIdentityAnchorAsset({
      ...approved,
      metadata: {
        characterAssetSemantic: "SYNTHETIC_IDENTITY_ANCHOR",
        humanApproved: false,
      },
    })).toBe(false);
    expect(isApprovedPrivateSyntheticIdentityAnchorAsset({
      ...approved,
      metadata: {
        characterAssetSemantic: "CHARACTER_SOURCE_PORTRAIT",
        humanApproved: true,
      },
    })).toBe(false);
  });

  it("pins hybrid Episode lineage and projects only its synthetic anchor", () => {
    const { hybrid, campaignCharacter, binding } = hybridFixture();
    expect(campaignCharacter.visualAssetReferences.map((asset) => asset.assetId))
      .toEqual([IDS.anchor]);
    expect(AiStoryEpisodeCharacterBindingSchema.parse(binding)).toMatchObject({
      reusableCharacterVersionId: hybrid.reusableCharacterVersionId,
      identityFingerprint: hybrid.identityFingerprint,
      characterDnaFingerprint: hybrid.characterDnaFingerprint,
      compiledCharacterIdentityFingerprint: hybrid.compiledCharacterIdentityFingerprint,
      syntheticIdentityAnchorAssetId: IDS.anchor,
      sourcePhotoSentToVideoProvider: false,
      canonicalAssetIds: [IDS.anchor],
    });
  });

  it("resolves immutable reference-image T2V without first-frame or Product authority", () => {
    expect(resolveExplicitAiStorySceneGenerationAuthority({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "CHARACTER_SYNTHETIC_ANCHOR",
      referenceAssetIds: [IDS.anchor],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    })).toEqual({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "CHARACTER_SYNTHETIC_ANCHOR",
      effectiveReferenceIds: [IDS.anchor],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    });
  });

  it("compiles DNA text plus exactly one synthetic reference and excludes the source", async () => {
    const request = compileHybrid();
    expect(request.generationMode).toBe("TEXT_TO_VIDEO");
    expect(request.compiledPrompt).toContain("CHARACTER IDENTITY — LOCKED");
    expect(request.referenceMappings).toEqual([
      expect.objectContaining({
        assetId: IDS.anchor,
        wireRole: "reference_image",
      }),
    ]);
    expect(request.storyReferenceMappings).toEqual([
      expect.objectContaining({
        assetId: IDS.anchor,
        semanticRole: "PROVIDER_IMAGE_REFERENCE",
      }),
    ]);
    expect(request.referenceMappings.some((mapping) => mapping.assetId === IDS.source)).toBe(false);
    expect(() => assertAiStoryCompiledProviderWireModeCompatibility(request)).not.toThrow();
    const payload = await previewAiStorySeedanceWireRequest({
      request,
      assetAccess: {
        resolveHttpsAsset: async ({ assetId }) =>
          `https://private.invalid/${assetId}`,
      },
    });
    expect(payload.content.filter((entry) => entry.type === "text")).toHaveLength(1);
    expect(payload.content.filter((entry) => entry.type === "image_url")).toEqual([
      expect.objectContaining({ role: "reference_image" }),
    ]);
    expect(JSON.stringify(payload)).not.toContain(IDS.source);
  });

  it("fails closed if the source portrait appears in Provider mappings", () => {
    const request = compileHybrid();
    try {
      assertAiStoryCompiledProviderWireModeCompatibility({
        ...request,
        referenceMappings: request.referenceMappings.map((mapping) => ({
          ...mapping,
          assetId: IDS.source,
        })),
      });
      throw new Error("Expected source-photo leak gate to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "CHARACTER_DNA_SOURCE_PHOTO_PROVIDER_LEAK_BLOCKED",
      });
    }
  });

  it("keeps historical text-only DNA binding and request reference-free", () => {
    const soft = character([sourceAsset()]);
    const { projection, campaignCharacter } = buildCampaignProjectionFromReusableCharacter({
      reusable: soft,
      campaignId: IDS.campaign,
      campaignCharacterId: IDS.campaignCharacter,
      createdBy: IDS.actor,
      createdAt: "2026-09-23T04:00:00.000Z",
    });
    const binding = buildEpisodeCharacterBinding({
      storyId: IDS.story,
      reusable: soft,
      projection,
      episodeLook: {
        wardrobe: "white blouse",
        makeup: null,
        accessories: null,
        hairstyle: null,
        hairColor: null,
        expression: null,
        pose: null,
        location: "café",
        action: null,
        product: null,
        dialogue: null,
      },
      createdBy: IDS.actor,
      createdAt: "2026-09-23T04:01:00.000Z",
    });
    expect(binding.canonicalAssetIds).toEqual([]);
    expect(binding.syntheticIdentityAnchorAssetId).toBeUndefined();
    expect(campaignCharacter.visualAssetReferences).toEqual([]);
  });
});
