import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({ callStructuredJsonModel }));

import {
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AiStoryOutlineVersionSchema,
} from "@ceo-agent/shared";
import { composeAiStoryCanonicalCommercialOutlineV1 } from "@ceo-agent/shared/server";
import {
  generateAiStoryScriptSemanticProposalV1,
  resolveCommercialStateChangeAnchorSceneIndex,
} from "../packages/agents/src/ai-story/script-semantic-writer";

const id = (n: number) => `96000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5),
  actor: id(6), product: id(7), character: id(8), characterVersion: id(9),
};
const COMMERCIAL_PROFILE = {
  profileId: "COMMERCIAL_STORY" as const,
  profileVersion: 1 as const,
  policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
};
const STORY = {
  title: "Planting the Seed of Awareness",
  summary: "A person places a plant on a table, steps back, and turns the pot.",
  objective: "Associate the brand with a quiet moment of attention.",
  targetAudience: "People",
  tone: "Quiet",
  estimatedDuration: "15s",
  story: {
    opening: "A person places a small green plant on a wooden table.",
    development: "The person steps back and notices the quiet.",
    ending: "A hand turns the pot and the moment settles.",
  },
  keyMessages: ["Attention can be simple."],
  cta: "",
  assetReferences: [],
  warnings: [],
};
const CHARACTER = {
  characterId: I.character,
  characterVersionId: I.characterVersion,
  characterFingerprint: `sha256:${"a".repeat(64)}`,
  name: "Exact Character",
  canonicalFacts: {
    identity: "Exact identity",
    appearance: "Exact appearance",
    personality: "Exact personality",
    emotionalArc: "Exact arc",
    relationships: [],
  },
};
const CONTEXT = {
  storyContext: STORY,
  characterContext: { characters: [], relationships: [] },
  worldContext: { locations: [], worldRules: [] },
  narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] },
};
const DIRECTOR = {
  coreMessage: "Message",
  hero: "Hero",
  conflict: "Conflict",
  turningPoint: "Turn",
  climax: "Climax",
  takeaway: "Takeaway",
};
const USAGE = { input: 10, output: 5, costUsd: 0.01 };

function beats(count: number) {
  const names = ["Opening", "Development", "Climax", "Ending"];
  return Array.from({ length: count }, (_, order) => ({
    id: `beat-${String(order + 1).padStart(3, "0")}`,
    order,
    name: names[order] ?? `Beat ${order}`,
    purpose: `Advance story beat ${order}.`,
    summary: `Beat ${order} changes what the person understands.`,
  }));
}

function scenesFor(storyBeats: ReturnType<typeof beats>) {
  return storyBeats.map((beat) => ({
    id: `scene-${String(beat.order + 1).padStart(3, "0")}`,
    beatIds: [beat.id],
    purpose: beat.purpose,
    durationSec: 4,
    transition: "",
    continuityNotes: "",
    order: beat.order,
  }));
}

function freeze(draft: ReturnType<typeof composeAiStoryCanonicalCommercialOutlineV1>) {
  return AiStoryOutlineVersionSchema.parse({
    ...draft,
    status: "FROZEN",
    approvedBy: I.actor,
    approvedAt: "2026-10-11T00:01:00.000Z",
    frozenAt: "2026-10-11T00:02:00.000Z",
  });
}

function compose(input: { beatCount: number; productAuthorityIds: string[]; objective?: "awareness" | "sales" }) {
  return freeze(composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story,
    storyVersionId: I.storyVersion,
    orgId: I.org,
    workspaceId: I.workspace,
    campaignId: I.campaign,
    version: 1,
    profile: COMMERCIAL_PROFILE,
    storyDraft: STORY,
    proposedStoryBeats: beats(input.beatCount),
    campaignObjective: input.objective ?? "awareness",
    customObjective: null,
    productAuthorityIds: input.productAuthorityIds,
    characterAuthorities: [{
      characterId: I.character,
      characterVersionId: I.characterVersion,
      characterFingerprint: CHARACTER.characterFingerprint,
    }],
    originalIdea: "A person places a plant, steps back, and turns the pot.",
    supersedesOutlineVersionId: null,
    createdBy: I.actor,
    createdAt: "2026-10-11T00:00:00.000Z",
  }));
}

function brandOutline() {
  return compose({ beatCount: 4, productAuthorityIds: [] });
}

function productOutline() {
  return compose({ beatCount: 2, productAuthorityIds: [I.product], objective: "sales" });
}

function narrativeScene(index: number, delta?: {
  dimension: "KNOWLEDGE";
  fromValue: string;
  value: string;
}) {
  return {
    sceneFunction: index === 0 ? "INTRODUCE" : index === 3 ? "RESOLVE" : "ESCALATE",
    sceneFunctionRegistryVersion: 1,
    sceneStateDeltas: delta
      ? [{
          dimension: delta.dimension,
          subjectId: I.character,
          fromValue: delta.fromValue,
          value: delta.value,
          reason: "The person understands something new about the moment.",
        }]
      : [],
    newInformation: [`Scene ${index} adds a story fact.`],
    newActionOutcomes: [`Scene ${index} completes a visible action.`],
    visibleAction: {
      type: "ACTION",
      subjectId: I.character,
      action: "The person moves with the plant and changes the moment.",
      objectId: null,
      storyEffect: "The story advances without a product.",
      stateDelta: null,
    },
    followingEntries: [],
    narrativeFunction: index === 0 ? "SETUP" : "TURN",
    storyConsequence: "The quiet moment becomes easier to notice.",
  };
}

function brandTransport(deltas: Array<Parameters<typeof narrativeScene>[1]> = []) {
  const openingDelta = deltas[0] ?? {
    dimension: "KNOWLEDGE" as const,
    fromValue: "The quiet moment has not been noticed",
    value: "The quiet moment is consciously noticed",
  };
  const scenes = [0, 1, 2, 3].map((index) => narrativeScene(index, index === 0 ? openingDelta : deltas[index]));
  return {
    contractVersion: "ai-story-script-semantic-proposal.v1",
    scenesByOrder: Object.fromEntries(scenes.map((scene, index) => [`scene_${index}`, scene])),
  };
}

function productTransport(anchorIndex: number) {
  const scenes = [0, 1].map((index) => ({
    sceneFunction: index === 0 ? "INTRODUCE" : "DEMONSTRATE",
    sceneFunctionRegistryVersion: 1,
    sceneStateDeltas: index === anchorIndex
      ? [{
          dimension: "PRODUCT_STATE",
          subjectId: I.product,
          fromValue: "available but unused",
          value: "actively used in the story",
          reason: "The product is visibly used.",
        }]
      : [],
    newInformation: ["The story changes."],
    newActionOutcomes: ["A visible action occurs."],
    visibleAction: {
      type: "ACTION",
      subjectId: I.character,
      action: index === anchorIndex
        ? "The character visibly uses the exact authorized Product."
        : "The character walks toward the table.",
      objectId: index === anchorIndex ? I.product : null,
      storyEffect: "The action changes the story.",
      stateDelta: null,
    },
    followingEntries: [],
    narrativeFunction: index === 0 ? "SETUP" : "PRODUCT_INTERVENTION",
    storyConsequence: "The product participates in the causal story.",
  }));
  return {
    contractVersion: "ai-story-script-semantic-proposal.v1",
    scenesByOrder: Object.fromEntries(scenes.map((scene, index) => [`scene_${index}`, scene])),
  };
}

function planningInput(outline: ReturnType<typeof brandOutline>, storyBeats = beats(outline.beats.length)) {
  return {
    frozenOutline: outline,
    story: STORY,
    storyBeats,
    scenePlan: scenesFor(storyBeats),
    creativeContext: CONTEXT,
    directorThinking: DIRECTOR,
    characterAuthorities: [CHARACTER],
    productAuthorityIds: outline.commercialStoryProfile?.productOrServiceAuthorityRefs ?? [],
  };
}

describe("commercial brand anchor contract", () => {
  beforeEach(() => {
    callStructuredJsonModel.mockReset();
  });

  it("accepts a four-beat product-free brand story without a commercial entry point", async () => {
    const outline = brandOutline();
    const before = JSON.stringify(outline);
    expect(outline.profile.profileId).toBe("COMMERCIAL_STORY");
    expect(outline.commercialStoryProfile).toMatchObject({
      commercialRole: "NONE",
      integrationPolicy: "NOT_REQUIRED",
      productOrServiceAuthorityRefs: [],
    });
    expect(outline.commercialStoryProfile?.commercialIntegration).toBeUndefined();
    expect(outline.beats).toHaveLength(4);
    callStructuredJsonModel.mockResolvedValueOnce({ result: brandTransport(), usage: USAGE });

    const result = await generateAiStoryScriptSemanticProposalV1(planningInput(outline));

    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(outline)).toBe(before);
    expect(result.semanticProposal.scenes).toHaveLength(4);
    expect(result.semanticProposal.scenes.map((scene) => scene.scenePlanItemId)).toEqual([
      "scene-001", "scene-002", "scene-003", "scene-004",
    ]);
    expect(result.semanticProposal.scenes.every((scene) => scene.commercialContribution === undefined)).toBe(true);
    expect(JSON.stringify(result.semanticProposal)).not.toContain("PRODUCT_STATE");
    const system = String(callStructuredJsonModel.mock.calls[0]?.[0]?.system);
    expect(system).not.toContain("PRODUCT_STATE sceneStateDelta");
    const schema = callStructuredJsonModel.mock.calls[0]?.[0]?.schema;
    expect(schema.safeParse(brandTransport()).success).toBe(true);
  });

  it("keeps a valid PRODUCT entry point and server-owned product state", async () => {
    const outline = productOutline();
    const storyBeats = beats(2);
    const scenePlan = scenesFor(storyBeats);
    expect(outline.commercialStoryProfile).toMatchObject({
      commercialRole: "PRODUCT",
      integrationPolicy: "CAUSAL_REQUIRED",
    });
    expect(outline.commercialStoryProfile?.commercialIntegration?.entryPoint.kind).toBe("BEAT_ID");
    expect(resolveCommercialStateChangeAnchorSceneIndex({
      frozenOutline: outline,
      storyBeats,
      scenePlan,
    })).toBe(1);
    callStructuredJsonModel.mockResolvedValueOnce({ result: productTransport(1), usage: USAGE });

    const result = await generateAiStoryScriptSemanticProposalV1(planningInput(outline, storyBeats));

    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
    expect(result.semanticProposal.scenes[1]?.sceneStateDeltas).toEqual([
      expect.objectContaining({ dimension: "PRODUCT_STATE", subjectId: I.product }),
    ]);
    expect(result.semanticProposal.scenes[1]?.commercialContribution?.commercialRole).toBe("PRODUCT");
    const schema = callStructuredJsonModel.mock.calls[0]?.[0]?.schema;
    expect(schema.safeParse(productTransport(1)).success).toBe(true);
    const withoutProductDelta = productTransport(1);
    withoutProductDelta.scenesByOrder.scene_1!.sceneStateDeltas = [];
    expect(schema.safeParse(withoutProductDelta).success).toBe(false);
  });

  it("blocks PRODUCT and OFFER stories that omit the required anchor before any model call", async () => {
    const product = productOutline();
    const productMissing = AiStoryOutlineVersionSchema.parse({
      ...product,
      commercialStoryProfile: {
        ...product.commercialStoryProfile,
        commercialIntegration: undefined,
      },
    });
    const offerMissing = AiStoryOutlineVersionSchema.parse({
      ...product,
      commercialStoryProfile: {
        ...product.commercialStoryProfile,
        commercialRole: "OFFER",
        commercialIntegration: undefined,
      },
    });

    await expect(generateAiStoryScriptSemanticProposalV1(planningInput(productMissing, beats(2))))
      .rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    await expect(generateAiStoryScriptSemanticProposalV1(planningInput(offerMissing, beats(2))))
      .rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });

  it("blocks NOT_REQUIRED when a product authority is also present", async () => {
    const brand = brandOutline();
    const conflict = AiStoryOutlineVersionSchema.parse({
      ...brand,
      commercialStoryProfile: {
        ...brand.commercialStoryProfile,
        productOrServiceAuthorityRefs: [I.product],
      },
    });

    await expect(generateAiStoryScriptSemanticProposalV1({
      ...planningInput(conflict),
      productAuthorityIds: [I.product],
    })).rejects.toThrow("SCRIPT_COMMERCIAL_INTEGRATION_CONTRACT_INVALID");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });

  it("resolves SCENE_ORDER and rejects an ambiguous BEAT_ID anchor before the model", async () => {
    const outline = productOutline();
    const storyBeats = beats(2);
    const scenePlan = scenesFor(storyBeats);
    const sceneOrder = AiStoryOutlineVersionSchema.parse({
      ...outline,
      commercialStoryProfile: {
        ...outline.commercialStoryProfile,
        commercialIntegration: {
          ...outline.commercialStoryProfile!.commercialIntegration,
          entryPoint: { kind: "SCENE_ORDER", sceneOrder: 1 },
        },
      },
    });
    expect(resolveCommercialStateChangeAnchorSceneIndex({
      frozenOutline: sceneOrder,
      storyBeats,
      scenePlan,
    })).toBe(1);
    callStructuredJsonModel.mockResolvedValueOnce({ result: productTransport(1), usage: USAGE });
    await generateAiStoryScriptSemanticProposalV1({
      ...planningInput(sceneOrder, storyBeats),
      scenePlan,
    });

    const ambiguous = scenePlan.map((scene) => ({ ...scene, beatIds: [storyBeats[0]!.id] }));
    await expect(generateAiStoryScriptSemanticProposalV1({
      ...planningInput(outline, storyBeats),
      scenePlan: ambiguous,
    })).rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
  });

  it("carries narrative state forward and rejects an unexplained reset", async () => {
    const outline = brandOutline();
    const before = JSON.stringify(outline);
    callStructuredJsonModel.mockResolvedValueOnce({
      result: brandTransport([
        { dimension: "KNOWLEDGE", fromValue: "unaware", value: "notices the quiet" },
      ]),
      usage: USAGE,
    });
    const continued = await generateAiStoryScriptSemanticProposalV1(planningInput(outline));
    expect(continued.semanticProposal.scenes[0]?.sceneStateOut).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "KNOWLEDGE", subjectId: I.character, value: "notices the quiet" }),
    ]));
    expect(continued.semanticProposal.scenes[1]?.sceneStateIn).toEqual(continued.semanticProposal.scenes[0]?.sceneStateOut);
    expect(continued.semanticProposal.scenes[3]?.sceneStateIn).toEqual(continued.semanticProposal.scenes[0]?.sceneStateOut);
    expect(JSON.stringify(outline)).toBe(before);

    callStructuredJsonModel.mockResolvedValueOnce({
      result: brandTransport([
        { dimension: "KNOWLEDGE", fromValue: "unaware", value: "notices the quiet" },
        { dimension: "KNOWLEDGE", fromValue: "reset without a cause", value: "forgets the moment" },
      ]),
      usage: USAGE,
    });
    await expect(generateAiStoryScriptSemanticProposalV1(planningInput(outline)))
      .rejects.toThrow("CANONICAL_SCRIPT_STATE_CONTRADICTION");
  });
});
