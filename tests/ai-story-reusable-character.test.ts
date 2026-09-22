import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_REUSABLE_CHARACTER_LIBRARY,
  CANONICAL_IDENTITY_ROOT,
  CHARACTER_VOICE_CONTINUITY,
  SEEDANCE_CERTIFIED_MAX_REFERENCE_IMAGES,
  VOICE_CONTINUITY_STATUS,
  WORKSPACE_CHARACTER_LIBRARY,
  CAMPAIGN_CHARACTER_AUTHORITY,
  applyEpisodeLookPolicy,
  evaluateCrossEpisodeTechnicalIdentity,
  evaluateReusableCharacterGenerationAuthority,
  planReusableCharacterReferenceBudget,
  publicReusableCharacterCard,
  rejectIdentityDriftUnit,
  reviewVisualIdentity,
  validateCanonicalIdentityRoot,
  validateCharacterAnchorDrift,
  validateCharacterAuthorityBindings,
  validateCharacterVersionPinning,
  validateReusableCharacterReference,
  validateReusableCharacterWorkspaceScope,
  characterAuthorityBinding,
  AI_STORY_REUSABLE_CHARACTER_COPY,
} from "@ceo-agent/shared";
import {
  buildAiStoryReusableCharacterVersion,
  buildCampaignProjectionFromReusableCharacter,
  buildEpisodeCharacterBinding,
  compileReusableCharacterLineage,
} from "@ceo-agent/shared/server";
import { SEEDANCE_MAX_REFERENCE_IMAGES } from "../../packages/agents/src/ai-story/seedance-capability";

const IDS = {
  org: "61000000-0000-4000-8000-000000000001",
  workspace: "61000000-0000-4000-8000-000000000002",
  otherWorkspace: "61000000-0000-4000-8000-000000000003",
  campaignA: "61000000-0000-4000-8000-000000000004",
  campaignB: "61000000-0000-4000-8000-000000000005",
  actor: "61000000-0000-4000-8000-000000000006",
  alicia: "61000000-0000-4000-8000-000000000007",
  master: "61000000-0000-4000-8000-000000000008",
  product: "61000000-0000-4000-8000-000000000009",
  location: "61000000-0000-4000-8000-00000000000a",
  anchorB: "61000000-0000-4000-8000-00000000000b",
  anchorC: "61000000-0000-4000-8000-00000000000c",
  extra: "61000000-0000-4000-8000-00000000000d",
  storyA: "61000000-0000-4000-8000-00000000000e",
  storyB: "61000000-0000-4000-8000-00000000000f",
  unitA: "61000000-0000-4000-8000-000000000010",
  unitB: "61000000-0000-4000-8000-000000000011",
};

const HASH = (n: string) => `sha256:${n.repeat(64).slice(0, 64)}`;

function alicia(version = 1, workspaceId = IDS.workspace) {
  return buildAiStoryReusableCharacterVersion({
    reusableCharacterId: IDS.alicia,
    orgId: IDS.org,
    workspaceId,
    name: "Alicia",
    identityCore: {
      identityDescription: "Alicia is a synthetic restaurant spokesperson.",
      faceIdentityDescription: "Oval face, dark brown eyes, defined brows, medium nose, closed-lip smile.",
      bodyIdentityDescription: "Average adult height with balanced shoulders.",
      distinctiveVisualFacts: ["small beauty mark near the left eye"],
      mustPreserve: ["face identity", "body proportions", "beauty mark"],
      mustNeverChange: ["canonical face identity"],
    },
    defaultLook: { wardrobe: "white outfit", makeup: "natural", accessories: null, hairstyle: "shoulder length", hairColor: "dark brown" },
    mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false },
    canonicalAssets: [{ assetId: IDS.master, contentHash: HASH("a"), role: "IDENTITY_MASTER", source: "USER_APPROVED" }],
    status: "ACTIVE",
    version,
    supersedesReusableCharacterVersionId: null,
    createdBy: IDS.actor,
    createdAt: `2026-09-22T00:0${version}:00.000Z`,
  });
}

describe("AI Story reusable Character cross-Episode identity", () => {
  it("freezes library vs Campaign projection authority and voice boundary", () => {
    expect(WORKSPACE_CHARACTER_LIBRARY).toBe("REUSABLE_IDENTITY_ROOT");
    expect(CAMPAIGN_CHARACTER_AUTHORITY).toBe("EXECUTION_PROJECTION");
    expect(CANONICAL_IDENTITY_ROOT).toBe("USER_APPROVED_OR_CANONICAL_SOURCE");
    expect(CHARACTER_VOICE_CONTINUITY).toBe("NOT_YET_CERTIFIED");
    expect(VOICE_CONTINUITY_STATUS).toBe("NOT_CERTIFIED");
    expect(AI_STORY_REUSABLE_CHARACTER_LIBRARY).toBe("CERTIFIED");
    expect(SEEDANCE_CERTIFIED_MAX_REFERENCE_IMAGES).toBe(SEEDANCE_MAX_REFERENCE_IMAGES);
  });

  it("AN two Episodes same Campaign keep identity and vary Episode Look", () => {
    const v1 = alicia();
    const projection = buildCampaignProjectionFromReusableCharacter({
      reusable: v1, campaignId: IDS.campaignA, campaignCharacterId: "61000000-0000-4000-8000-000000000021",
      createdBy: IDS.actor, createdAt: "2026-09-22T00:01:00.000Z",
    });
    const episodeA = buildEpisodeCharacterBinding({
      storyId: IDS.storyA, reusable: v1, projection: projection.projection,
      episodeLook: { wardrobe: "white outfit", makeup: null, accessories: null, hairstyle: null, hairColor: null, expression: null, pose: null, location: "restaurant", action: null, product: null, dialogue: null },
      createdBy: IDS.actor, createdAt: "2026-09-22T00:02:00.000Z",
    });
    const episodeB = buildEpisodeCharacterBinding({
      storyId: IDS.storyB, reusable: v1, projection: projection.projection,
      episodeLook: { wardrobe: "blue outfit", makeup: null, accessories: null, hairstyle: null, hairColor: null, expression: null, pose: null, location: "restaurant", action: null, product: null, dialogue: null },
      createdBy: IDS.actor, createdAt: "2026-09-22T00:03:00.000Z",
    });
    expect(episodeA.reusableCharacterId).toBe(episodeB.reusableCharacterId);
    expect(episodeA.reusableCharacterVersionId).toBe(episodeB.reusableCharacterVersionId);
    expect(episodeA.identityFingerprint).toBe(episodeB.identityFingerprint);
    expect(episodeA.episodeLook.wardrobe).not.toBe(episodeB.episodeLook.wardrobe);
    expect(episodeA.canonicalAssetIds).toEqual(episodeB.canonicalAssetIds);
    const lineage = compileReusableCharacterLineage({
      reusable: v1, projection: projection.projection, binding: episodeA,
      groundingPath: "PROVIDER_REFERENCE_IMAGE", grounding: "PASS",
    });
    expect(lineage.primaryIdentityAssetId).toBe(IDS.master);
    expect(evaluateCrossEpisodeTechnicalIdentity({ left: episodeA, right: episodeB }).technicalIdentityLineage).toBe("PASS");
    const grounding = evaluateReusableCharacterGenerationAuthority({
      workspaceId: IDS.workspace,
      visibleRecurringCharacter: true,
      identityLockRequired: true,
      generationMode: "REFERENCE_TO_VIDEO",
      hasIdentityGroundedKeyframe: false,
      hasExactIdentityReferenceImage: true,
      reusable: v1,
      binding: episodeA,
      resolvedVersionId: episodeA.reusableCharacterVersionId,
      currentLibraryVersionId: v1.reusableCharacterVersionId,
      plannedAssetIds: [IDS.master],
      continuityAnchors: [],
      referenceNeeds: [{ kind: "CHARACTER_IDENTITY_MASTER", assetId: IDS.master, contentHash: HASH("a"), mandatory: true }],
    });
    expect(grounding.grounding).toBe("PASS");
  });

  it("AO two Campaigns share reusable root and keep CHARACTER_CAMPAIGN_SCOPE_GATE", () => {
    const v1 = alicia();
    const a = buildCampaignProjectionFromReusableCharacter({
      reusable: v1, campaignId: IDS.campaignA, campaignCharacterId: "61000000-0000-4000-8000-000000000021",
      createdBy: IDS.actor, createdAt: "2026-09-22T00:01:00.000Z",
    });
    const b = buildCampaignProjectionFromReusableCharacter({
      reusable: v1, campaignId: IDS.campaignB, campaignCharacterId: "61000000-0000-4000-8000-000000000022",
      createdBy: IDS.actor, createdAt: "2026-09-22T00:01:00.000Z",
    });
    expect(a.projection.reusableCharacterId).toBe(b.projection.reusableCharacterId);
    expect(a.campaignCharacter.characterId).not.toBe(b.campaignCharacter.characterId);
    expect(validateCharacterAuthorityBindings({
      campaignId: IDS.campaignB,
      bindings: [characterAuthorityBinding(a.campaignCharacter)],
      versions: [a.campaignCharacter],
    }).map((issue) => issue.gate)).toContain("CHARACTER_CAMPAIGN_SCOPE_GATE");
  });

  it("AP blocks cross-Workspace selection", () => {
    const foreign = alicia(1, IDS.otherWorkspace);
    expect(validateReusableCharacterWorkspaceScope({
      workspaceId: IDS.workspace,
      versions: [foreign],
    }).map((issue) => issue.gate)).toEqual(["REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE"]);
  });

  it("AQ pins historical Episode versions", () => {
    const v1 = alicia(1);
    const v2 = buildAiStoryReusableCharacterVersion({
      ...v1,
      version: 2,
      identityCore: { ...v1.identityCore, identityDescription: "Alicia v2 identity still synthetic." },
      supersedesReusableCharacterVersionId: v1.reusableCharacterVersionId,
      createdAt: "2026-09-22T00:02:00.000Z",
    });
    const projection = buildCampaignProjectionFromReusableCharacter({
      reusable: v1, campaignId: IDS.campaignA, campaignCharacterId: "61000000-0000-4000-8000-000000000021",
      createdBy: IDS.actor, createdAt: "2026-09-22T00:01:00.000Z",
    });
    const episode1 = buildEpisodeCharacterBinding({
      storyId: IDS.storyA, reusable: v1, projection: projection.projection,
      createdBy: IDS.actor, createdAt: "2026-09-22T00:01:30.000Z",
    });
    expect(validateCharacterVersionPinning({
      binding: episode1,
      currentLibraryVersionId: v2.reusableCharacterVersionId,
      resolvedVersionId: episode1.reusableCharacterVersionId,
    })).toEqual([]);
    expect(v2.reusableCharacterVersionId).not.toBe(episode1.reusableCharacterVersionId);
  });

  it("AR allows wardrobe look and blocks locked hair color / face rewrite", () => {
    const v1 = alicia();
    expect(applyEpisodeLookPolicy({
      policy: v1.mutableLookPolicy,
      look: { wardrobe: "blue jacket", makeup: null, accessories: null, hairstyle: null, hairColor: null, expression: null, pose: null, location: null, action: null, product: null, dialogue: null },
      identityCore: v1.identityCore,
    })).toEqual([]);
    expect(applyEpisodeLookPolicy({
      policy: v1.mutableLookPolicy,
      look: { wardrobe: null, makeup: null, accessories: null, hairstyle: null, hairColor: "blonde", expression: null, pose: null, location: null, action: null, product: null, dialogue: null },
      identityCore: v1.identityCore,
    }).map((issue) => issue.gate)).toContain("CHARACTER_LOCKED_TRAIT_GATE");
  });

  it("AS keeps canonical root ahead of generated continuity anchors", () => {
    const v1 = alicia();
    const anchors = [
      { assetId: IDS.anchorB, status: "APPROVED" as const },
      { assetId: IDS.anchorC, status: "APPROVED" as const },
    ];
    expect(validateCanonicalIdentityRoot({ canonicalAssets: v1.canonicalAssets, plannedAssetIds: [IDS.master, IDS.anchorB] })).toEqual([]);
    expect(validateCharacterAnchorDrift({
      canonicalAssets: v1.canonicalAssets,
      continuityAnchors: anchors,
      plannedAssetIds: [IDS.anchorB, IDS.anchorC],
    }).map((issue) => issue.gate)).toContain("CHARACTER_ANCHOR_DRIFT_GATE");
  });

  it("AT plans reference budget and blocks dropping Character identity", () => {
    const ok = planReusableCharacterReferenceBudget({
      needs: [
        { kind: "CHARACTER_IDENTITY_MASTER", assetId: IDS.master, contentHash: HASH("a"), mandatory: true },
        { kind: "PRODUCT", assetId: IDS.product, contentHash: HASH("p"), mandatory: true },
        { kind: "LOCATION", assetId: IDS.location, contentHash: HASH("l"), mandatory: true },
        { kind: "CONTINUITY_ANCHOR", assetId: IDS.anchorB, contentHash: HASH("b"), mandatory: false },
      ],
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.selected).toHaveLength(4);
      expect(ok.selected[0]?.kind).toBe("CHARACTER_IDENTITY_MASTER");
    }
    const blocked = planReusableCharacterReferenceBudget({
      needs: [
        { kind: "CHARACTER_IDENTITY_MASTER", assetId: IDS.master, contentHash: HASH("a"), mandatory: true },
        { kind: "PRODUCT", assetId: IDS.product, contentHash: HASH("p"), mandatory: true },
        { kind: "LOCATION", assetId: IDS.location, contentHash: HASH("l"), mandatory: true },
        { kind: "SECONDARY_CHARACTER", assetId: IDS.extra, contentHash: HASH("e"), mandatory: true },
        { kind: "CONTINUITY_ANCHOR", assetId: IDS.anchorB, contentHash: HASH("b"), mandatory: true },
      ],
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.issues[0]?.gate).toBe("REFERENCE_BUDGET_GATE");
  });

  it("AU blocks reference-free recurring Character generation", () => {
    expect(validateReusableCharacterReference({
      visibleRecurringCharacter: true,
      identityLockRequired: true,
      generationMode: "REFERENCE_FREE_T2V",
      hasIdentityGroundedKeyframe: false,
      hasExactIdentityReferenceImage: false,
    }).map((issue) => issue.gate)).toEqual(["REUSABLE_CHARACTER_REFERENCE_GATE"]);
    expect(validateReusableCharacterReference({
      visibleRecurringCharacter: true,
      identityLockRequired: true,
      generationMode: "FIRST_FRAME_IMAGE_TO_VIDEO",
      hasIdentityGroundedKeyframe: true,
      hasExactIdentityReferenceImage: false,
    })).toEqual([]);
  });

  it("AV human review starts pending and rejects only the drifted Unit", () => {
    const pending = reviewVisualIdentity({
      generationUnitId: IDS.unitA,
      reusableCharacterId: IDS.alicia,
      technicalIdentityLineage: "PASS",
      canonicalAssetId: IDS.master,
      generatedAssetId: IDS.anchorB,
    });
    expect(pending.visualIdentityMatch).toBe("PENDING_HUMAN_REVIEW");
    expect(reviewVisualIdentity({ ...pending, decision: "PASS" }).visualIdentityMatch).toBe("PASS");
    const drift = rejectIdentityDriftUnit({ generationUnitId: IDS.unitB, siblingGenerationUnitIds: [IDS.unitA, IDS.unitB] });
    expect(drift).toMatchObject({
      notAcceptedUnitId: IDS.unitB,
      reason: "CHARACTER_IDENTITY_DRIFT",
      retryScope: "GENERATION_UNIT",
      preservedSiblingUnitIds: [IDS.unitA],
    });
  });

  it("AW public cards hide projection fingerprints", () => {
    const card = publicReusableCharacterCard(alicia(), 3);
    expect(card).toMatchObject({ name: "Alicia", episodeCount: 3 });
    expect(JSON.stringify(card)).not.toMatch(/fingerprint|projection/i);
    expect(AI_STORY_REUSABLE_CHARACTER_COPY.useInEpisode).toBe("Use in Episode");
    expect(AI_STORY_REUSABLE_CHARACTER_COPY.identityLocked).toBe("Identity locked");
    const createForm = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/EpisodeCreateForm.tsx"), "utf8");
    const library = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/ReusableCharacterLibraryPanel.tsx"), "utf8");
    const debug = readFileSync(resolve(process.cwd(), "apps/web/src/components/ai-story/EpisodeDebugPanel.tsx"), "utf8");
    expect(createForm).toContain("episode-character-selector");
    expect(createForm).toContain("AI_STORY_REUSABLE_CHARACTER_COPY.identityLocked");
    expect(createForm.toLowerCase()).not.toContain("fingerprint");
    expect(createForm.toLowerCase()).not.toContain("projection");
    expect(library).toContain("AI_STORY_REUSABLE_CHARACTER_COPY.useInEpisode");
    expect(debug).toContain("VOICE_CONTINUITY_STATUS");
  });
});
