import { describe, expect, it } from "vitest";
import {
  AI_STORY_CHARACTER_LEGACY_FIELD_CLASSIFICATION,
  AiStoryCharacterAuthorityVersionSchema,
  characterAuthorityBinding,
  projectLegacyCharacterCompatibility,
  validateCharacterAuthorityBindings,
} from "@ceo-agent/shared";
import { buildAiStoryCharacterVersion, computeAiStoryCharacterFingerprint } from "@ceo-agent/shared/server";
import { projectGeneratedCharactersToProposals } from "@ceo-agent/agents";

const IDS = {
  org: "51000000-0000-4000-8000-000000000001",
  workspace: "51000000-0000-4000-8000-000000000002",
  campaign: "51000000-0000-4000-8000-000000000003",
  otherCampaign: "51000000-0000-4000-8000-000000000004",
  actor: "51000000-0000-4000-8000-000000000005",
  ada: "51000000-0000-4000-8000-000000000006",
  ben: "51000000-0000-4000-8000-000000000007",
  relationship: "51000000-0000-4000-8000-000000000008",
  asset: "51000000-0000-4000-8000-000000000009",
};

const facts = (name = "Ada") => ({
  name,
  identity: `${name} is the campaign's returning founder.`,
  appearance: `${name} has a blue field jacket and a silver pin.`,
  personality: "Patient, precise, and candid.",
  emotionalArc: "Begins guarded and may become trusting through Story-authorized events.",
  relationships: [],
  visualAssetIds: [],
});

function version(characterId = IDS.ada, versionNumber = 1, name = "Ada", campaignId = IDS.campaign) {
  return buildAiStoryCharacterVersion({
    characterId, orgId: IDS.org, workspaceId: IDS.workspace, campaignId,
    version: versionNumber, status: "ACTIVE", facts: facts(name), visualAssetReferences: [],
    supersedesCharacterVersionId: null, createdBy: IDS.actor, createdAt: `2026-08-29T00:0${versionNumber}:00.000Z`,
  });
}

describe("AI Story Campaign Character authority", () => {
  it("builds stable, deterministic provider-neutral Character versions", () => {
    const first = version(); const second = version();
    expect(first.characterVersionId).toBe(second.characterVersionId);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprint).toBe(computeAiStoryCharacterFingerprint(first));
    expect(AiStoryCharacterAuthorityVersionSchema.parse(first)).toEqual(first);
    const serialized = JSON.stringify(first).toLowerCase();
    for (const forbidden of ["seedance", "providerrole", "image_to_video", "lora", "lip_sync"]) expect(serialized).not.toContain(forbidden);
  });

  it("preserves immutable historical snapshots when mutable Campaign authority advances", () => {
    const v1 = version();
    const v2 = buildAiStoryCharacterVersion({
      characterId: IDS.ada, orgId: IDS.org, workspaceId: IDS.workspace, campaignId: IDS.campaign,
      version: 2, status: "ACTIVE", facts: facts("Ada Ren"), visualAssetReferences: [],
      supersedesCharacterVersionId: v1.characterVersionId, createdBy: IDS.actor, createdAt: "2026-08-29T00:02:00.000Z",
    });
    expect(v2.supersedesCharacterVersionId).toBe(v1.characterVersionId);
    expect(v2.characterVersionId).not.toBe(v1.characterVersionId);
    expect(v2.fingerprint).not.toBe(v1.fingerprint);
    expect(v1.name).toBe("Ada");
  });

  it("validates Campaign scope, exact version/fingerprint, dialogue, Action, relationships, and optional Assets", () => {
    const ben = version(IDS.ben, 1, "Ben");
    const ada = buildAiStoryCharacterVersion({
      characterId: IDS.ada, orgId: IDS.org, workspaceId: IDS.workspace, campaignId: IDS.campaign,
      version: 1, status: "ACTIVE", facts: { ...facts(), relationships: [{ relationshipId: IDS.relationship, relatedCharacterId: IDS.ben, relationshipType: "COLLEAGUE", baseline: "They trust one another's craft." }] },
      visualAssetReferences: [{ assetId: IDS.asset, contentHash: `sha256:${"a".repeat(64)}`, purpose: "CHARACTER_VISUAL_REFERENCE" }],
      supersedesCharacterVersionId: null, createdBy: IDS.actor, createdAt: "2026-08-29T00:01:00.000Z",
    });
    expect(validateCharacterAuthorityBindings({ campaignId: IDS.campaign, bindings: [characterAuthorityBinding(ada), characterAuthorityBinding(ben)], versions: [ada, ben], referencedCharacterIds: [IDS.ada, IDS.ben], dialogueSpeakerIds: [IDS.ada], actionCharacterIds: [IDS.ada, IDS.ben], availableAssetIds: new Set([IDS.asset]) })).toEqual([]);
    const cross = version(IDS.ben, 1, "Ben", IDS.otherCampaign);
    const tampered = { ...characterAuthorityBinding(ada), characterFingerprint: `sha256:${"f".repeat(64)}` };
    const gates = new Set(validateCharacterAuthorityBindings({ campaignId: IDS.campaign, bindings: [tampered], versions: [ada, cross], referencedCharacterIds: [IDS.ada, IDS.ben], dialogueSpeakerIds: [IDS.ben], actionCharacterIds: [IDS.ben], availableAssetIds: new Set() }).map((issue) => issue.gate));
    expect(gates).toEqual(new Set(["CHARACTER_FINGERPRINT_GATE", "CHARACTER_CONTINUITY_GATE", "RELATIONSHIP_CHARACTER_GATE", "CHARACTER_ASSET_REFERENCE_GATE", "CHARACTER_EXISTS_GATE", "DIALOGUE_SPEAKER_CHARACTER_GATE", "ACTION_CHARACTER_GATE"]));
    const wrongVersion = { ...characterAuthorityBinding(ada), characterVersionId: "51000000-0000-4000-8000-000000000099" };
    expect(validateCharacterAuthorityBindings({ campaignId: IDS.campaign, bindings: [wrongVersion], versions: [ada] }).map((issue) => issue.gate)).toContain("CHARACTER_VERSION_GATE");
    expect(validateCharacterAuthorityBindings({ campaignId: IDS.campaign, bindings: [characterAuthorityBinding(cross)], versions: [cross] }).map((issue) => issue.gate)).toContain("CHARACTER_CAMPAIGN_SCOPE_GATE");
  });

  it("keeps Character and Product domains typed and legacy payloads compatibility-only", () => {
    expect(AI_STORY_CHARACTER_LEGACY_FIELD_CLASSIFICATION).toMatchObject({ visualNotes: "CANONICAL_PROJECTION_APPEARANCE", costume: "STORY_STATE", age: "NON_AUTHORITATIVE_LEGACY_DATA" });
    expect(projectLegacyCharacterCompatibility({ id: "legacy-character", role: "protagonist" })).toMatchObject({ kind: "LEGACY_CHARACTER_COMPATIBILITY", canonicalCharacter: null });
    expect(characterAuthorityBinding(version())).toEqual(expect.objectContaining({ characterId: IDS.ada }));
  });

  it("keeps AI-generated Characters proposal-only until explicit user acceptance", () => {
    const proposals = projectGeneratedCharactersToProposals([{ id: "legacy-ada", name: "Ada", role: "lead", description: "A patient founder", motivation: "Earn trust", visualNotes: "Cobalt jacket" }]);
    expect(proposals).toEqual([expect.objectContaining({ proposalOnly: true, name: "Ada", identity: "A patient founder", appearance: "Cobalt jacket" })]);
    expect(proposals[0]).not.toHaveProperty("characterId");
  });
});
