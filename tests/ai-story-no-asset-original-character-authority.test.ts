import { beforeEach, describe, expect, it, vi } from "vitest";
import { AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT, AiStoryOutlineVersionSchema } from "@ceo-agent/shared";
import { buildAiStoryCharacterVersion, composeAiStoryCanonicalCommercialOutlineV1 } from "@ceo-agent/shared/server";
import {
  bindCreativeContextToCharacterAuthority,
  projectAcceptedCharactersToPlanning,
} from "../packages/agents/src/ai-story/character-authority-planning";
import { generateAiStoryScriptSemanticProposalV1 } from "../packages/agents/src/ai-story/script-semantic-writer";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({ callStructuredJsonModel }));

const id = (n: number) => `97000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), otherWorkspace: id(4),
  story: id(5), storyVersion: id(6), actor: id(7), product: id(8),
  character: id(9), otherCharacter: id(10), asset: id(11),
};
const PROFILE = {
  profileId: "COMMERCIAL_STORY" as const,
  profileVersion: 1 as const,
  policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
};
const STORY = {
  title: "Quiet brand moment",
  summary: "A brand moment unfolds without a product.",
  objective: "Leave the audience with a clear feeling.",
  targetAudience: "People",
  tone: "Quiet",
  estimatedDuration: "15s",
  story: { opening: "The moment starts.", development: "The moment develops.", ending: "The moment settles." },
  keyMessages: ["Attention can be simple."],
  cta: "",
  assetReferences: [],
  warnings: [],
};
const DIRECTOR = {
  coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway",
};
const USAGE = { input: 11, output: 4, costUsd: 0.01 };

function beats() {
  return ["Opening", "Development", "Climax", "Ending"].map((name, order) => ({
    id: `beat-${String(order + 1).padStart(3, "0")}`,
    order,
    name,
    purpose: `Advance beat ${order}.`,
    summary: `Beat ${order} changes the moment.`,
  }));
}

function scenes() {
  return beats().map((beat) => ({
    id: `scene-${String(beat.order + 1).padStart(3, "0")}`,
    beatIds: [beat.id],
    purpose: beat.purpose,
    durationSec: 4,
    transition: "",
    continuityNotes: "",
    order: beat.order,
  }));
}

function outlineFor(characterAuthorities: { characterId: string; characterVersionId: string; characterFingerprint: string }[]) {
  const draft = composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story,
    storyVersionId: I.storyVersion,
    orgId: I.org,
    workspaceId: I.workspace,
    campaignId: I.campaign,
    version: 1,
    profile: PROFILE,
    storyDraft: STORY,
    proposedStoryBeats: beats(),
    campaignObjective: "awareness",
    customObjective: null,
    productAuthorityIds: [],
    characterAuthorities,
    originalIdea: "A quiet brand moment with no product.",
    supersedesOutlineVersionId: null,
    createdBy: I.actor,
    createdAt: "2026-10-11T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: I.actor,
    approvedAt: "2026-10-11T00:01:00.000Z",
    frozenAt: "2026-10-11T00:02:00.000Z",
  });
}

function context(characters: Record<string, unknown>[]) {
  return {
    storyContext: STORY,
    characterContext: { characters, relationships: [] },
    worldContext: {},
    narrativeContext: {},
    directorContext: {},
  };
}

function proposalCharacter() {
  return {
    id: "proposed_character_1",
    name: "Origin",
    role: "Protagonist",
    description: "An original person with no reference image.",
    motivation: "Notice the quiet moment.",
    visualNotes: "No uploaded reference.",
    proposalOnly: true as const,
  };
}

function characterVersion(visualAssetReferences: { assetId: string; contentHash: string; purpose: string }[] = []) {
  return buildAiStoryCharacterVersion({
    characterId: I.character,
    orgId: I.org,
    workspaceId: I.workspace,
    campaignId: I.campaign,
    version: 1,
    status: "ACTIVE",
    facts: {
      name: "Origin",
      identity: "An original person with no reference image.",
      appearance: "No uploaded reference.",
      personality: "Quiet and attentive.",
      emotionalArc: "Notices the moment and lets it settle.",
      relationships: [],
      visualAssetIds: visualAssetReferences.map((asset) => asset.assetId),
    },
    visualAssetReferences,
    supersedesCharacterVersionId: null,
    createdBy: I.actor,
    createdAt: "2026-10-11T00:00:00.000Z",
  });
}

function writerInput(input: {
  outline: ReturnType<typeof outlineFor>;
  characters: Record<string, unknown>[];
  characterAuthorities: ReturnType<typeof projectAcceptedCharactersToPlanning>;
}) {
  return {
    frozenOutline: input.outline,
    story: STORY,
    storyBeats: beats(),
    scenePlan: scenes(),
    creativeContext: context(input.characters),
    directorThinking: DIRECTOR,
    characterAuthorities: input.characterAuthorities,
    productAuthorityIds: [] as string[],
  };
}

describe("no-asset original character authority", () => {
  beforeEach(() => callStructuredJsonModel.mockReset());

  it("requires explicit acceptance before a proposed original character can reach the model", async () => {
    const outline = outlineFor([]);
    const before = JSON.stringify(outline);
    await expect(generateAiStoryScriptSemanticProposalV1(writerInput({
      outline,
      characters: [proposalCharacter()],
      characterAuthorities: [],
    }))).rejects.toThrow("CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
    expect(JSON.stringify(outline)).toBe(before);
    expect(JSON.stringify(outline)).not.toContain("proposed_character_1");
    expect(outline.authorityReferences.filter((reference) => reference.authorityType === "CHARACTER")).toEqual([]);
    expect(outline.authorityReferences.filter((reference) => reference.authorityType === "PRODUCT")).toEqual([]);
  });

  it("fails closed for a character-free narrative instead of inventing an entity", async () => {
    const outline = outlineFor([]);
    const before = JSON.stringify(outline);
    await expect(generateAiStoryScriptSemanticProposalV1(writerInput({
      outline,
      characters: [],
      characterAuthorities: [],
    }))).rejects.toThrow("SCRIPT_SEMANTIC_WRITER_ENTITY_AUTHORITY_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
    expect(JSON.stringify(outline)).toBe(before);
  });

  it("accepts an authorized reference-free character and a reference-backed character without adding product authority", async () => {
    const bare = characterVersion();
    const backed = characterVersion([{
      assetId: I.asset,
      contentHash: `sha256:${"b".repeat(64)}`,
      purpose: "CHARACTER_VISUAL_REFERENCE",
    }]);
    for (const version of [bare, backed]) {
      const [authority] = projectAcceptedCharactersToPlanning({
        orgId: I.org,
        workspaceId: I.workspace,
        campaignId: I.campaign,
        characters: [version],
      });
      const outline = outlineFor([{
        characterId: authority!.characterId,
        characterVersionId: authority!.characterVersionId,
        characterFingerprint: authority!.characterFingerprint,
      }]);
      const before = JSON.stringify(outline);
      callStructuredJsonModel.mockResolvedValueOnce({
        result: {
          contractVersion: "ai-story-script-semantic-proposal.v1",
          scenesByOrder: Object.fromEntries([0, 1, 2, 3].map((index) => [`scene_${index}`, {
            sceneFunction: index === 0 ? "INTRODUCE" : index === 3 ? "RESOLVE" : "ESCALATE",
            sceneFunctionRegistryVersion: 1,
            sceneStateDeltas: index === 0 ? [{
              dimension: "PHYSICAL_CONDITION",
              subjectId: authority!.characterId,
              fromValue: "Standing still before the quiet moment",
              value: "Moving through the quiet moment",
              reason: "The authorized Character's visible action begins the story progression.",
            }] : [],
            newInformation: [`Scene ${index} adds one fact.`],
            newActionOutcomes: [`Scene ${index} completes one action.`],
            visibleAction: {
              type: "ACTION",
              subjectId: authority!.characterId,
              action: "The person moves through the quiet moment.",
              objectId: null,
              storyEffect: "The story advances without a product.",
              stateDelta: null,
            },
            followingEntries: [],
            narrativeFunction: index === 0 ? "SETUP" : "TURN",
            storyConsequence: "The feeling remains.",
          }])),
        },
        usage: USAGE,
      });
      const result = await generateAiStoryScriptSemanticProposalV1(writerInput({
        outline,
        characters: [{
          id: authority!.characterId,
          name: authority!.name,
          role: "Protagonist",
          description: authority!.canonicalFacts.identity,
          motivation: authority!.canonicalFacts.personality,
          visualNotes: authority!.canonicalFacts.appearance,
          canonicalAuthority: authority,
        }],
        characterAuthorities: [authority!],
      }));
      expect(result.semanticProposal.scenes).toHaveLength(4);
      expect(result.semanticProposal.scenes.every((scene) =>
        scene.sceneStateIn.length === scene.sceneStateOut.length
      )).toBe(true);
      expect(result.semanticProposal.scenes.flatMap((scene) => scene.sceneStateDeltas)).toHaveLength(1);
      expect(JSON.stringify(result.semanticProposal)).not.toContain("PRODUCT_STATE");
      expect(JSON.stringify(outline)).toBe(before);
    }
    expect(bare.visualAssetReferences).toEqual([]);
    expect(backed.visualAssetReferences).toHaveLength(1);
    expect(callStructuredJsonModel).toHaveBeenCalledTimes(2);
  });

  it("rejects a cross-workspace character and an invalid proposal mapping before authority is invented", () => {
    const version = characterVersion();
    expect(() => projectAcceptedCharactersToPlanning({
      orgId: I.org,
      workspaceId: I.otherWorkspace,
      campaignId: I.campaign,
      characters: [version],
    })).toThrow(/outside the Planning scope/);
    const [authority] = projectAcceptedCharactersToPlanning({
      orgId: I.org,
      workspaceId: I.workspace,
      campaignId: I.campaign,
      characters: [version],
    });
    expect(() => bindCreativeContextToCharacterAuthority({
      creativeContext: context([{
        id: "proposed_character_1",
        name: authority!.name,
        role: "Protagonist",
        description: "Different identity",
        motivation: "Different",
        visualNotes: "Different",
      }]) as never,
      characterAuthorities: [authority!],
    })).toThrow(/exact ID/);
  });

  it("still requires a product anchor for a physical commercial role", async () => {
    const version = characterVersion();
    const [authority] = projectAcceptedCharactersToPlanning({
      orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, characters: [version],
    });
    const draft = composeAiStoryCanonicalCommercialOutlineV1({
      storyId: I.story,
      storyVersionId: I.storyVersion,
      orgId: I.org,
      workspaceId: I.workspace,
      campaignId: I.campaign,
      version: 1,
      profile: PROFILE,
      storyDraft: STORY,
      proposedStoryBeats: beats(),
      campaignObjective: "sales",
      customObjective: null,
      productAuthorityIds: [I.product],
      characterAuthorities: [{
        characterId: authority!.characterId,
        characterVersionId: authority!.characterVersionId,
        characterFingerprint: authority!.characterFingerprint,
      }],
      originalIdea: "A product is used in the story.",
      supersedesOutlineVersionId: null,
      createdBy: I.actor,
      createdAt: "2026-10-11T00:00:00.000Z",
    });
    const outline = AiStoryOutlineVersionSchema.parse({
      ...draft,
      status: "FROZEN",
      approvedBy: I.actor,
      approvedAt: "2026-10-11T00:01:00.000Z",
      frozenAt: "2026-10-11T00:02:00.000Z",
      commercialStoryProfile: {
        ...draft.commercialStoryProfile,
        commercialIntegration: undefined,
      },
    });
    await expect(generateAiStoryScriptSemanticProposalV1({
      ...writerInput({
        outline,
        characters: [{
          id: authority!.characterId,
          name: authority!.name,
          canonicalAuthority: authority,
        }],
        characterAuthorities: [authority!],
      }),
      productAuthorityIds: [I.product],
    })).rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });
});
