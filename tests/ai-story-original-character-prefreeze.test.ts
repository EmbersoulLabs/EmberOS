import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryOutlineVersionSchema,
  AiStoryScriptVersionSchema,
} from "@ceo-agent/shared";
import {
  buildAiStoryCharacterVersion,
  buildAiStoryScriptVersion,
  composeAiStoryCanonicalCommercialOutlineV1,
  composeAiStoryCanonicalSceneSetV1,
  computeAiStoryScriptSemanticInputFingerprint,
  promoteAiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared/server";
import {
  bindProposalToAcceptedCharacter,
  projectAcceptedCharactersToPlanning,
} from "../packages/agents/src/ai-story/character-authority-planning";
import { generateAiStoryScriptSemanticProposalV1 } from "../packages/agents/src/ai-story/script-semantic-writer";
import { generateCharacterContinuity, generateShotPlan, generateWorldContinuity } from "../packages/agents/src/ai-story/story-planning-service";
import { acceptOriginalCharacterBeforeOutlineFreeze } from "../apps/web/src/lib/ai-story-character-proposal-acceptance";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
const callJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({ callStructuredJsonModel, callJsonModel }));

const id = (n: number) => `98000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), otherWorkspace: id(4),
  story: id(5), storyVersion: id(6), actor: id(7), product: id(8),
  character: id(9), asset: id(11),
};
const PROFILE = { profileId: "COMMERCIAL_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = {
  title: "Quiet brand moment", summary: "A brand moment unfolds without a product.", objective: "Leave the audience with a clear feeling.",
  targetAudience: "People", tone: "Quiet", estimatedDuration: "15s",
  story: { opening: "The moment starts.", development: "The moment develops.", ending: "The moment settles." },
  keyMessages: ["Attention can be simple."], cta: "", assetReferences: [], warnings: [],
};
const DIRECTOR = { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" };
const T2V = { strategy: "TEXT_TO_VIDEO" as const, referenceSource: "REFERENCE_FREE_T2V" as const, referenceAssetIds: [] as string[], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" as const };
const USAGE = { input: 11, output: 4, costUsd: 0 };

function beats(count = 4) {
  return ["Opening", "Development", "Climax", "Ending"].slice(0, count).map((name, order) => ({
    id: `beat-${String(order + 1).padStart(3, "0")}`, order, name, purpose: `Advance beat ${order}.`, summary: `Beat ${order} changes the moment.`,
  }));
}
function scenes(count = 4) {
  return beats(count).map((beat) => ({
    id: `scene-${String(beat.order + 1).padStart(3, "0")}`, beatIds: [beat.id], purpose: beat.purpose, durationSec: 4,
    transition: "", continuityNotes: "", order: beat.order, generationAuthority: T2V,
  }));
}
function outlineFor(characterAuthorities: { characterId: string; characterVersionId: string; characterFingerprint: string }[], options?: { productAuthorityIds?: string[]; objective?: "awareness" | "sales" }) {
  const storyBeats = beats(options?.productAuthorityIds?.length ? 2 : 4);
  const draft = composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign,
    version: 1, profile: PROFILE, storyDraft: STORY, proposedStoryBeats: storyBeats,
    campaignObjective: options?.objective ?? "awareness", customObjective: null,
    productAuthorityIds: options?.productAuthorityIds ?? [], characterAuthorities,
    originalIdea: "A quiet brand moment with no product.", supersedesOutlineVersionId: null,
    createdBy: I.actor, createdAt: "2026-10-11T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({
    ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-11T00:01:00.000Z", frozenAt: "2026-10-11T00:02:00.000Z",
    ...(options?.productAuthorityIds?.length ? { commercialStoryProfile: { ...draft.commercialStoryProfile, commercialIntegration: undefined } } : {}),
  });
}
function characterVersion(visualAssetReferences: { assetId: string; contentHash: string; purpose: string }[] = []) {
  return buildAiStoryCharacterVersion({
    characterId: I.character, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, version: 1, status: "ACTIVE",
    facts: {
      name: "Origin", identity: "An original person with no reference image.", appearance: "No uploaded reference.",
      personality: "Quiet and attentive.", emotionalArc: "Notices the moment and lets it settle.", relationships: [],
      visualAssetIds: visualAssetReferences.map((asset) => asset.assetId),
    },
    visualAssetReferences, supersedesCharacterVersionId: null, createdBy: I.actor, createdAt: "2026-10-11T00:00:00.000Z",
  });
}
function context(characters: Record<string, unknown>[]) {
  return { storyContext: STORY, characterContext: { characters, relationships: [] }, worldContext: {}, narrativeContext: {}, directorContext: {} };
}
function proposalCharacter() {
  return { id: "proposed_character_1", name: "Origin", role: "Protagonist", description: "An original person with no reference image.", motivation: "Notice the quiet moment.", visualNotes: "No uploaded reference.", proposalOnly: true as const };
}
function writerTransport(characterId: string, count = 4) {
  return {
    contractVersion: "ai-story-script-semantic-proposal.v1",
    scenesByOrder: Object.fromEntries(Array.from({ length: count }, (_, index) => [`scene_${index}`, {
      sceneFunction: index === 0 ? "INTRODUCE" : index === count - 1 ? "RESOLVE" : "ESCALATE",
      sceneFunctionRegistryVersion: 1, sceneStateDeltas: [],
      newInformation: [`Scene ${index} adds one fact.`], newActionOutcomes: [`Scene ${index} completes one action.`],
      visibleAction: { type: "ACTION", subjectId: characterId, action: "The person moves through the quiet moment.", objectId: null, storyEffect: "The story advances without a product.", stateDelta: null },
      followingEntries: [], narrativeFunction: index === 0 ? "SETUP" : "TURN", storyConsequence: "The feeling remains.",
    }])),
  };
}
function shot(index: number) {
  return { cameraFamily: "STATIC", composition: "The person holds the center.", framing: "Medium", lensSuggestion: "35mm", durationSec: 4, focus: "The person", emotion: "Quiet", information: `Scene ${index} is visible.` };
}

describe("original character acceptance before outline freeze", () => {
  beforeEach(() => { callStructuredJsonModel.mockReset(); callJsonModel.mockReset(); });

  it("completes Character Continuity deterministically when the Story has no Characters", async () => {
    const result = await generateCharacterContinuity({
      creativeContext: context([]) as never,
      directorThinking: DIRECTOR,
      storyBeats: beats(2),
      scenePlan: scenes(2),
      shotPlan: [shot(0), shot(1)] as never,
    });
    expect(result).toEqual({ characterContinuity: [], usage: { input: 0, output: 0, costUsd: 0 } });
    expect(callJsonModel).not.toHaveBeenCalled();
  });

  it("reproduces the old failure when a proposal reaches the writer before acceptance", async () => {
    const outline = outlineFor([]);
    await expect(generateAiStoryScriptSemanticProposalV1({
      frozenOutline: outline, story: STORY, storyBeats: beats(), scenePlan: scenes(),
      creativeContext: context([proposalCharacter()]) as never, directorThinking: DIRECTOR,
      characterAuthorities: [], productAuthorityIds: [],
    })).rejects.toThrow("CHARACTER_PROPOSAL_ACCEPTANCE_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
    expect(outline.authorityReferences.filter((reference) => reference.authorityType === "CHARACTER")).toEqual([]);
  });

  it("keeps a character-free narrative unsupported", async () => {
    await expect(generateAiStoryScriptSemanticProposalV1({
      frozenOutline: outlineFor([]), story: STORY, storyBeats: beats(), scenePlan: scenes(),
      creativeContext: context([]) as never, directorThinking: DIRECTOR, characterAuthorities: [], productAuthorityIds: [],
    })).rejects.toThrow("SCRIPT_SEMANTIC_WRITER_ENTITY_AUTHORITY_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });

  it("authorizes a reference-free or reference-backed original character and carries that id through scene materialization", async () => {
    for (const visuals of [[], [{ assetId: I.asset, contentHash: `sha256:${"b".repeat(64)}`, purpose: "CHARACTER_VISUAL_REFERENCE" }]] as const) {
      const version = characterVersion([...visuals]);
      const [authority] = projectAcceptedCharactersToPlanning({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, characters: [version] });
      const bound = bindProposalToAcceptedCharacter({ creativeContext: context([proposalCharacter()]) as never, proposalKey: "proposed_character_1", characterAuthority: authority! });
      expect(bound.characterContext.characters[0]?.id).toBe(I.character);
      expect(bound.characterContext.characters[0]?.proposalOnly).toBeUndefined();
      expect(bound.characterContext.characters[0]?.canonicalAuthority?.characterId).toBe(I.character);
      expect(JSON.stringify(bound)).not.toContain("proposed_character_1");
      const unbound = outlineFor([]);
      const outline = outlineFor([{ characterId: authority!.characterId, characterVersionId: authority!.characterVersionId, characterFingerprint: authority!.characterFingerprint }]);
      expect(outline.sourceHash).not.toBe(unbound.sourceHash);
      expect(outline.authorityReferences.filter((reference) => reference.authorityType === "PRODUCT")).toEqual([]);
      callStructuredJsonModel.mockResolvedValueOnce({ result: writerTransport(I.character), usage: USAGE });
      const authored = await generateAiStoryScriptSemanticProposalV1({
        frozenOutline: outline, story: STORY, storyBeats: beats(), scenePlan: scenes(), creativeContext: bound as never,
        directorThinking: DIRECTOR, characterAuthorities: [authority!], productAuthorityIds: [],
      });
      const material = promoteAiStoryScriptSemanticProposalV1({
        storyId: I.story, storyVersionId: I.storyVersion, frozenOutline: outline, storyBeatProposals: beats(), scenePlan: scenes(),
        characterAuthorities: [authority!], semanticProposal: authored.semanticProposal,
      });
      const fingerprint = computeAiStoryScriptSemanticInputFingerprint({
        storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: outline.outlineVersionId, outlineSourceHash: outline.sourceHash,
        story: STORY, storyBeats: beats(), scenePlan: scenes(), creativeContext: bound as never, directorThinking: DIRECTOR,
        characterAuthorities: [authority!], productAuthorityIds: [],
      });
      const script = AiStoryScriptVersionSchema.parse({
        ...buildAiStoryScriptVersion({
          storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: outline.outlineVersionId, orgId: I.org, workspaceId: I.workspace,
          version: 1, profileId: "COMMERCIAL_STORY", profileVersion: 1, outlineSourceHash: outline.sourceHash, semanticInputFingerprint: fingerprint,
          scenes: material.scenes, authorityReferences: material.authorityReferences, supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-10-11T01:00:00.000Z",
        }),
        status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-10-11T01:01:00.000Z", frozenAt: "2026-10-11T01:02:00.000Z",
      });
      callStructuredJsonModel.mockResolvedValueOnce({ result: { shotsByScene: Object.fromEntries([0, 1, 2, 3].map((index) => [`scene_${index}`, [shot(index)]])) }, usage: USAGE });
      const shots = await generateShotPlan({ story: STORY, creativeContext: bound as never, directorThinking: DIRECTOR, storyBeats: beats(), scenePlan: scenes(), canonicalScript: script });
      callJsonModel.mockResolvedValueOnce({ result: { characterContinuity: [{ characterId: I.character, name: "Origin", appearance: authority!.canonicalFacts.appearance, emotion: "Quiet", identity: authority!.canonicalFacts.identity }] }, usage: USAGE });
      const continuity = await generateCharacterContinuity({ creativeContext: bound as never, directorThinking: DIRECTOR, storyBeats: beats(), scenePlan: scenes(), shotPlan: shots.shotPlan });
      callJsonModel.mockResolvedValueOnce({ result: { worldContinuity: { location: "A quiet room", lighting: "Soft", environment: "No product is present.", objects: ["Table"], timeline: "One moment", worldRules: ["Nothing is added."] } }, usage: USAGE });
      const world = await generateWorldContinuity({ creativeContext: bound as never, directorThinking: DIRECTOR, storyBeats: beats(), scenePlan: scenes(), shotPlan: shots.shotPlan });
      const canonicalScenes = composeAiStoryCanonicalSceneSetV1({
        orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, storyVersionId: I.storyVersion, actorUserId: I.actor,
        frozenOutline: outline, frozenScript: script, scenePlan: scenes(), worldContinuity: world.worldContinuity,
        characterAuthorities: [authority!], productSources: [], createdAt: "2026-10-11T02:00:00.000Z",
      });
      expect(script.scenes).toHaveLength(4);
      expect(shots.shotPlan).toHaveLength(4);
      expect(continuity.characterContinuity.map((entry) => entry.characterId)).toEqual([I.character]);
      expect(canonicalScenes).toHaveLength(4);
      expect(canonicalScenes.every((scene) => scene.productBindings.length === 0)).toBe(true);
      expect(JSON.stringify(canonicalScenes)).not.toContain("proposed_character_1");
      expect(JSON.stringify(canonicalScenes)).not.toContain("PRODUCT_STATE");
    }
    expect(callStructuredJsonModel).toHaveBeenCalledTimes(4);
    expect(callJsonModel).toHaveBeenCalledTimes(4);
  });

  it("rejects name matching, another workspace, and use of the proposal key as the Character ID", () => {
    const version = characterVersion();
    const [authority] = projectAcceptedCharactersToPlanning({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, characters: [version] });
    expect(() => bindProposalToAcceptedCharacter({
      creativeContext: context([{ ...proposalCharacter(), id: "different_proposal" }]) as never,
      proposalKey: authority!.name, characterAuthority: authority!,
    })).toThrow(/no unresolved Character proposal/i);
    expect(() => projectAcceptedCharactersToPlanning({ orgId: I.org, workspaceId: I.otherWorkspace, campaignId: I.campaign, characters: [version] })).toThrow(/outside the Planning scope/);
  });

  it("persists acceptance only before outline freeze and discards the proposal key", async () => {
    const version = characterVersion();
    const saved: { draft?: unknown } = {};
    const base = {
      db: {} as never, orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, storyId: I.story, actorUserId: I.actor,
      proposalKey: "proposed_character_1",
      character: { name: "Origin", identity: "An original person with no reference image.", appearance: "No uploaded reference.", personality: "Quiet and attentive.", emotionalArc: "Notices the moment and lets it settle.", relationships: [], visualAssetIds: [] as string[] },
    };
    const deps = {
      loadStory: async () => ({ currentVersion: { id: I.storyVersion, frozenAt: new Date("2026-10-11T00:00:00.000Z"), structuredContent: STORY } }) as never,
      resolveOutline: async () => null,
      loadPackage: async () => ({ storyVersionId: I.storyVersion, status: "generating", payload: { kind: "planning_draft", completedStages: ["creative_context"], story: STORY, creativeContext: context([proposalCharacter()]) } }),
      loadContext: async () => null,
      createCharacter: async () => version,
      readCharacter: async () => version,
      saveContext: async () => ({}) as never,
      saveDraft: async (_db: never, input: { payload: unknown }) => { saved.draft = input.payload; return {} as never; },
    };
    const accepted = await acceptOriginalCharacterBeforeOutlineFreeze(base, deps as never);
    expect(accepted.characterId).toBe(I.character);
    expect(JSON.stringify(saved.draft)).not.toContain("proposed_character_1");
    expect(accepted.creativeContext.characterContext.characters[0]?.id).toBe(I.character);
    await expect(acceptOriginalCharacterBeforeOutlineFreeze(base, { ...deps, resolveOutline: async () => ({ outlineVersionId: id(20) }) } as never)).rejects.toThrow(/already frozen/);
    await expect(acceptOriginalCharacterBeforeOutlineFreeze(base, {
      ...deps,
      createCharacter: async () => characterVersion().characterId && { ...version, characterId: "proposed_character_1" },
    } as never)).rejects.toThrow(/cannot become the Character ID/);
  });

  it("documents the separate two-scene product constraint and still requires a product anchor", async () => {
    const version = characterVersion();
    const [authority] = projectAcceptedCharactersToPlanning({ orgId: I.org, workspaceId: I.workspace, campaignId: I.campaign, characters: [version] });
    const outline = outlineFor([{ characterId: authority!.characterId, characterVersionId: authority!.characterVersionId, characterFingerprint: authority!.characterFingerprint }], { productAuthorityIds: [I.product], objective: "sales" });
    expect(outline.beats).toHaveLength(2);
    await expect(generateAiStoryScriptSemanticProposalV1({
      frozenOutline: outline, story: STORY, storyBeats: beats(2), scenePlan: scenes(2),
      creativeContext: context([{ id: I.character, name: "Origin", canonicalAuthority: authority }]) as never,
      directorThinking: DIRECTOR, characterAuthorities: [authority!], productAuthorityIds: [I.product],
    })).rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });
});
