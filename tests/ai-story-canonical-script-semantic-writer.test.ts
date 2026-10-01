import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({ callStructuredJsonModel }));

import {
  AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT,
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  AiStoryOutlineVersionSchema,
  AiStoryScriptSemanticProposalV1Schema,
  evaluateCommercialProductActionCausality,
  validateAiStoryScript,
  type AiStoryScriptSemanticProposalV1,
} from "@ceo-agent/shared";
import {
  AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1,
  AiStoryScriptSemanticPromotionError,
  buildAiStoryScriptVersion,
  composeAiStoryCanonicalCommercialOutlineV1,
  composeAiStoryCanonicalOutlineV1,
  promoteAiStoryScriptSemanticProposalV1,
  validateAiStoryCommercialStoryProfile,
  validateAiStoryProductStoryProfile,
} from "@ceo-agent/shared/server";
import { buildAiStoryScriptSemanticProviderOutputSchema, generateAiStoryScriptSemanticProposalV1, resolveCommercialIntegrationAnchorSceneIndex, resolveCommercialStateChangeAnchorSceneIndex } from "../packages/agents/src/ai-story/script-semantic-writer";

const id = (n: number) => `96000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5),
  actor: id(6), product: id(7), character: id(8), characterVersion: id(9),
};
const PROFILE = { profileId: "PRODUCT_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_PRODUCT_STORY_PROFILE_POLICY_FINGERPRINT };
const COMMERCIAL_PROFILE = { profileId: "COMMERCIAL_STORY" as const, profileVersion: 1 as const, policyFingerprint: AI_STORY_COMMERCIAL_STORY_PROFILE_POLICY_FINGERPRINT };
const STORY = { title: "Story", summary: "A precise story", objective: "Build awareness", targetAudience: "People", tone: "Clear", estimatedDuration: "8s", story: { opening: "Open", development: "Advance", ending: "End" }, keyMessages: [], cta: "Learn", assetReferences: [], warnings: [] };
const BEATS = [
  { id: "proposal-beat-a", order: 0, name: "Introduce", purpose: "Introduce the Product", summary: "The Product becomes part of the story." },
  { id: "proposal-beat-b", order: 1, name: "Detail", purpose: "Reveal Product detail", summary: "A further Product detail becomes visible." },
];
const SCENES = [
  { id: "scene-plan-a", beatIds: [BEATS[0]!.id], purpose: "Introduction", durationSec: 4, transition: "", continuityNotes: "", order: 0 },
  { id: "scene-plan-b", beatIds: [BEATS[1]!.id], purpose: "Detail", durationSec: 4, transition: "", continuityNotes: "", order: 1 },
];
const CHARACTER = {
  characterId: I.character, characterVersionId: I.characterVersion,
  characterFingerprint: `sha256:${"a".repeat(64)}`, name: "Exact Character",
  canonicalFacts: { identity: "Exact identity", appearance: "Exact appearance", personality: "Exact personality", emotionalArc: "Exact arc", relationships: [] },
};

function outline() {
  const draft = composeAiStoryCanonicalOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace,
    campaignId: I.campaign, version: 1, profile: PROFILE, storyDraft: STORY,
    proposedStoryBeats: BEATS, campaignObjective: "awareness", customObjective: null,
    productAuthorityIds: [I.product], characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
    originalIdea: "Exact intent", supersedesOutlineVersionId: null, createdBy: I.actor, createdAt: "2026-09-15T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-15T00:01:00.000Z", frozenAt: "2026-09-15T00:02:00.000Z" });
}

function commercialOutline() {
  const draft = composeAiStoryCanonicalCommercialOutlineV1({
    storyId: I.story, storyVersionId: I.storyVersion, orgId: I.org, workspaceId: I.workspace,
    campaignId: I.campaign, version: 1, profile: COMMERCIAL_PROFILE, storyDraft: STORY,
    proposedStoryBeats: BEATS, campaignObjective: "sales", customObjective: null,
    productAuthorityIds: [I.product], characterAuthorities: [{ characterId: I.character, characterVersionId: I.characterVersion, characterFingerprint: CHARACTER.characterFingerprint }],
    originalIdea: "The character physically uses the product and learns its benefit", supersedesOutlineVersionId: null,
    createdBy: I.actor, createdAt: "2026-09-15T00:00:00.000Z",
  });
  return AiStoryOutlineVersionSchema.parse({ ...draft, status: "FROZEN", approvedBy: I.actor, approvedAt: "2026-09-15T00:01:00.000Z", frozenAt: "2026-09-15T00:02:00.000Z" });
}

function providerSchema(input: Partial<Parameters<typeof buildAiStoryScriptSemanticProviderOutputSchema>[0]> = {}) {
  const commercial = input.commercial ?? false;
  return buildAiStoryScriptSemanticProviderOutputSchema({
    commercial,
    sceneCount: 2,
    stateChangeAnchorSceneIndex: null,
    characterIds: [I.character],
    productAuthorityIds: [I.product],
    ...(commercial ? {
      physicalCommercialParticipationRequired: true,
      commercialAuthorityIds: [I.product],
    } : {}),
    ...input,
  });
}

function proposal(): AiStoryScriptSemanticProposalV1 {
  return {
    contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
    scenes: [
      { scenePlanItemId: SCENES[0]!.id, sceneFunction: "PRODUCT_INTRODUCTION", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [
        { type: "ACTION", subjectId: I.character, objectId: I.product, action: "The character presents the Product.", storyEffect: "The Product enters the narrative." },
        { type: "DIALOGUE", speakerId: I.character, line: "Here it is.", language: "en" },
      ], newInformation: ["The Product is now part of the narrative."], newActionOutcomes: ["The Product is presented."] },
      { scenePlanItemId: SCENES[1]!.id, sceneFunction: "PRODUCT_DETAIL_REVEAL", sceneFunctionRegistryVersion: 1, sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [], entries: [
        { type: "ACTION", subjectId: I.product, action: "The Product remains visible as the story reveals more context.", storyEffect: "The narrative advances." },
      ], newInformation: ["Further narrative context becomes available."], newActionOutcomes: ["The story advances."] },
    ],
  };
}

function structuredProviderProposal() {
  const value = proposal();
  return {
    ...value,
    scenes: value.scenes.map((scene) => ({
      ...Object.fromEntries(Object.entries(scene).filter(([key]) => key !== "scenePlanItemId")),
      entries: scene.entries.map((entry) => entry.type === "ACTION"
        ? { ...entry, objectId: entry.objectId ?? null, stateDelta: entry.stateDelta ?? null }
        : entry.type === "DIALOGUE"
          ? { ...entry, deliveryOrSubtext: entry.deliveryOrSubtext ?? null }
          : entry),
    })),
  };
}

function commercialProviderProposal(anchorIndex = 1) {
  const source = structuredProviderProposal();
  return {
    ...source,
    scenes: source.scenes.map((scene, index) => ({
      ...scene,
      sceneFunction: index === 0 ? "INTRODUCE" : "DEMONSTRATE",
      sceneStateIn: [],
      sceneStateDeltas: index === anchorIndex
        ? [{ dimension: "PRODUCT_STATE", subjectId: I.product, fromValue: "available but unused", value: "actively used in the story", reason: "The Product is visibly used" }]
        : [],
      sceneStateOut: [],
      visibleAction: {
        type: "ACTION",
        subjectId: I.character,
        action: index === anchorIndex
          ? "The character visibly uses the exact authorized Product."
          : "The character walks toward the workbench.",
        objectId: index === anchorIndex ? I.product : null,
        storyEffect: index === anchorIndex
          ? "The Product changes the character's understanding."
          : "The character approaches the place where the story changes.",
        stateDelta: null,
      },
      followingEntries: [],
      narrativeFunction: index === 0 ? "SETUP" : "PRODUCT_INTERVENTION",
      storyConsequence: "The Product participates in the causal Story.",
      entries: undefined,
    })).map(({ entries: _entries, ...scene }) => scene),
  };
}

function providerTransport(value: ReturnType<typeof structuredProviderProposal> | ReturnType<typeof commercialProviderProposal>) {
  const { scenes, ...authority } = value;
  return {
    ...authority,
    scenesByOrder: Object.fromEntries(scenes.map((scene, index) => [`scene_${index}`, scene])),
  };
}

function promote(overrides: Partial<Parameters<typeof promoteAiStoryScriptSemanticProposalV1>[0]> = {}) {
  return promoteAiStoryScriptSemanticProposalV1({
    storyId: I.story, storyVersionId: I.storyVersion, frozenOutline: outline(),
    storyBeatProposals: BEATS, scenePlan: SCENES, characterAuthorities: [CHARACTER], semanticProposal: proposal(),
    ...overrides,
  });
}

function expectCode(run: () => unknown, code: string) {
  try { run(); throw new Error("EXPECTED_FAILURE"); }
  catch (error) { expect(error).toBeInstanceOf(AiStoryScriptSemanticPromotionError); expect((error as AiStoryScriptSemanticPromotionError).code).toBe(code); }
}

describe("AI Story Canonical Script Semantic Writer V1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the strict semantic proposal separate from canonical authority", () => {
    const value = AiStoryScriptSemanticProposalV1Schema.parse(proposal());
    expect(value.scenes[0]).not.toHaveProperty("scriptSceneId");
    expect(value.scenes[0]!.entries[0]).not.toHaveProperty("entryId");
    expect(() => AiStoryScriptSemanticProposalV1Schema.parse({ ...value, scriptVersionId: id(100) })).toThrow();
  });

  it("requires exactly one proposal Scene per Scene Plan item", () => {
    const missing = proposal(); missing.scenes = missing.scenes.slice(0, 1);
    expectCode(() => promote({ semanticProposal: missing }), "CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID");
    const extra = proposal(); extra.scenes.push({ ...extra.scenes[1]!, scenePlanItemId: "extra" });
    expectCode(() => promote({ semanticProposal: extra }), "CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID");
    const duplicate = proposal(); duplicate.scenes[1] = { ...duplicate.scenes[1]!, scenePlanItemId: SCENES[0]!.id };
    expectCode(() => promote({ semanticProposal: duplicate }), "CANONICAL_SCRIPT_PROPOSAL_SCENE_COVERAGE_INVALID");
  });

  it("rejects unknown Scene Functions and unknown entity IDs", () => {
    expect(() => AiStoryScriptSemanticProposalV1Schema.parse({ ...proposal(), scenes: [{ ...proposal().scenes[0], sceneFunction: "MODEL_CHOICE" }] })).toThrow();
    const unknown = proposal(); unknown.scenes[0]!.entries[0] = { ...unknown.scenes[0]!.entries[0], subjectId: id(999) } as never;
    expectCode(() => promote({ semanticProposal: unknown }), "CANONICAL_SCRIPT_UNKNOWN_ENTITY_ID");
  });

  it("requires exact Character IDs for DIALOGUE and VO without name matching", () => {
    for (const entry of [
      { type: "DIALOGUE", speakerId: I.product, line: "No", language: "en" },
      { type: "VO", voiceOwnerId: I.product, line: "No", narrativePurpose: "No", language: "en" },
    ] as const) {
      const value = proposal(); value.scenes[0]!.entries = [entry];
      expectCode(() => promote({ semanticProposal: value }), "CANONICAL_SCRIPT_CHARACTER_ID_REQUIRED");
    }
  });

  it("requires the exact frozen-Outline Character snapshot", () => {
    expectCode(() => promote({ characterAuthorities: [{ ...CHARACTER, characterFingerprint: `sha256:${"b".repeat(64)}` }] }), "CANONICAL_SCRIPT_CHARACTER_AUTHORITY_INVALID");
  });

  it("supports Product-only ACTION while deriving Character and Product authority", () => {
    const result = promote();
    expect(result.scenes[1]!.entries[0]).toMatchObject({ type: "ACTION", subjectId: I.product });
    expect(result.authorityReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({ authorityType: "CHARACTER", authorityId: I.character, authorityVersionId: I.characterVersion }),
      { authorityType: "PRODUCT", authorityId: I.product },
    ]));
  });

  it("derives deterministic Script Scene and Entry UUIDs instead of trusting Scene Plan identity", () => {
    const first = promote(); const second = promote();
    expect(first).toEqual(second);
    expect(first.scenes[0]!.scriptSceneId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.scenes[0]!.scriptSceneId).not.toBe(SCENES[0]!.id);
    expect(first.scenes[0]!.entries.map((entry) => entry.entryId)).toEqual(second.scenes[0]!.entries.map((entry) => entry.entryId));
  });

  it("derives exact exclusive Outline Beat claims server-side", () => {
    const result = promote(); const source = outline();
    expect(result.scenes.flatMap((scene) => scene.outlineBeatClaims.map((claim) => claim.outlineBeatId))).toEqual(source.beats.map((beat) => beat.id));
    expect(result.scenes[0]!.outlineBeatClaims[0]!.outlineBeatId).not.toBe(BEATS[0]!.id);
    const duplicateScenes = SCENES.map((scene) => ({ ...scene, beatIds: [BEATS[0]!.id] }));
    expectCode(() => promote({ scenePlan: duplicateScenes }), "CANONICAL_SCRIPT_EXCLUSIVE_BEAT_CLAIM_INVALID");
  });

  it("owns contiguous Entry order and exact deterministic duration allocation", () => {
    const scene = promote().scenes[0]!;
    expect(scene.entries.map((entry) => entry.order)).toEqual([0, 1]);
    expect(scene.entries.reduce((sum, entry) => sum + entry.durationRange.minSeconds, 0)).toBe(SCENES[0]!.durationSec);
    expect(scene.entries.every((entry) => entry.durationRange.minSeconds === entry.durationRange.maxSeconds)).toBe(true);
    expect(scene.targetDurationRange).toEqual({ minSeconds: 4, maxSeconds: 4 });
    expect(AI_STORY_SCRIPT_SEMANTIC_PROMOTION_POLICY_V1.durationPolicy).toContain("EXACT_SCENE_DURATION");
  });

  it("rejects unknown and contradictory state rather than repairing it", () => {
    const unknown = proposal(); unknown.scenes[0]!.sceneStateIn = [{ dimension: "KNOWLEDGE", subjectId: id(999), value: "unknown" }];
    expectCode(() => promote({ semanticProposal: unknown }), "CANONICAL_SCRIPT_UNKNOWN_ENTITY_ID");
    const contradiction = proposal();
    contradiction.scenes[0]!.sceneStateIn = [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "before" }];
    contradiction.scenes[0]!.sceneStateDeltas = [{ dimension: "KNOWLEDGE", subjectId: I.character, fromValue: "different", value: "after", reason: "Action" }];
    contradiction.scenes[0]!.sceneStateOut = [{ dimension: "KNOWLEDGE", subjectId: I.character, value: "after" }];
    expectCode(() => promote({ semanticProposal: contradiction }), "CANONICAL_SCRIPT_STATE_CONTRADICTION");
  });

  it("does not infer Location, Prop, Asset, Cast, constraints, or evidence authority", () => {
    const result = promote();
    for (const scene of result.scenes) expect(scene).toMatchObject({ locationIds: [], propIds: [], assetIds: [], mustKeep: [], mustAvoid: [], newEvidence: [], productEvidence: [] });
    expect(result.scenes.every((scene) => scene.castReferences === undefined && scene.castRelationships === undefined)).toBe(true);
  });

  it("derives Product progression contributions and never accepts claim authority from the model", () => {
    const result = promote();
    expect(result.scenes[0]!.productStoryContributions).toEqual([expect.objectContaining({ semanticFunction: "PRODUCT_INTRODUCTION", contributionTypes: ["NEW_PRODUCT_INFORMATION"], productAuthorityIds: [I.product], claimIds: [] })]);
    expect(result.scenes[1]!.productStoryContributions).toEqual([expect.objectContaining({ semanticFunction: "PRODUCT_DETAIL_REVEAL", contributionTypes: ["NEW_PRODUCT_INFORMATION"], productAuthorityIds: [I.product], claimIds: [] })]);
    expect(result.scenes.flatMap((scene) => scene.productStoryContributions ?? []).every((item) => item.claimIds.length === 0)).toBe(true);
  });

  it.each([
    ["PRODUCT_RELATIONSHIP", "NEW_PRODUCT_RELATIONSHIP"],
    ["PRODUCT_EVIDENCE", "NEW_PRODUCT_EVIDENCE"],
    ["PRODUCT_CONTEXT", "NEW_PRODUCT_CONTEXT"],
  ] as const)("maps %s contribution server-side to %s", (semanticFunction, contributionType) => {
    const source = outline();
    const changed = AiStoryOutlineVersionSchema.parse({ ...source, productStoryProfile: { ...source.productStoryProfile!, progressionGoals: source.productStoryProfile!.progressionGoals.map((goal, index) => index === 1 ? { ...goal, semanticFunction } : goal) } });
    const result = promote({ frozenOutline: changed });
    expect(result.scenes[1]!.productStoryContributions?.[0]).toMatchObject({ semanticFunction, contributionTypes: [contributionType] });
  });

  it("rejects unsupported Product proof without canonical claim evidence", () => {
    const value = proposal(); value.scenes[1]!.sceneFunction = "PRODUCT_BENEFIT_PROOF";
    expectCode(() => promote({ semanticProposal: value }), "CANONICAL_SCRIPT_UNSUPPORTED_PRODUCT_PROOF");
  });

  it("produces Script-schema, Script-validator, and Product-Story-validator compatible material", () => {
    const source = outline(); const material = promote({ frozenOutline: source });
    const script = buildAiStoryScriptVersion({
      storyId: I.story, storyVersionId: I.storyVersion, outlineVersionId: source.outlineVersionId,
      orgId: I.org, workspaceId: I.workspace, version: 1, profileId: "PRODUCT_STORY", profileVersion: 1,
      outlineSourceHash: source.sourceHash, scenes: material.scenes, authorityReferences: material.authorityReferences,
      supersedesScriptVersionId: null, createdBy: I.actor, createdAt: "2026-09-15T01:00:00.000Z",
    });
    const known = new Set([`CHARACTER:${I.character}`, `PRODUCT:${I.product}`]);
    expect(validateAiStoryScript(script, source, { knownAuthorityReferences: known }).filter((issue) => issue.severity === "BLOCK")).toEqual([]);
    expect(validateAiStoryProductStoryProfile(source, script).filter((issue) => issue.severity === "BLOCK")).toEqual([]);
  });

  it("requires a commercial visible action instead of dialogue alone", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 0 });
    expect(schema.safeParse(structuredProviderProposal()).success).toBe(false);
  });

  it("resolves the commercial state-change anchor from exact SCENE_ORDER authority", () => {
    const source = commercialOutline();
    const withSceneOrder = AiStoryOutlineVersionSchema.parse({
      ...source,
      commercialStoryProfile: {
        ...source.commercialStoryProfile!,
        commercialIntegration: {
          ...source.commercialStoryProfile!.commercialIntegration,
          entryPoint: { kind: "SCENE_ORDER", sceneOrder: 1 },
        },
      },
    });
    expect(resolveCommercialStateChangeAnchorSceneIndex({ frozenOutline: withSceneOrder, storyBeats: BEATS, scenePlan: SCENES })).toBe(1);
  });

  it("resolves BEAT_ID through the canonical Beat basis to the exact claiming Scene", () => {
    const source = commercialOutline();
    expect(source.commercialStoryProfile?.commercialIntegration.entryPoint.kind).toBe("BEAT_ID");
    expect(resolveCommercialStateChangeAnchorSceneIndex({ frozenOutline: source, storyBeats: BEATS, scenePlan: SCENES })).toBe(1);
    expect(() => resolveCommercialStateChangeAnchorSceneIndex({
      frozenOutline: source,
      storyBeats: BEATS,
      scenePlan: SCENES.map((scene) => ({ ...scene, beatIds: [BEATS[0]!.id] })),
    })).toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
  });

  it("fails before the model call when the frozen commercial anchor cannot be resolved", async () => {
    await expect(generateAiStoryScriptSemanticProposalV1({
      frozenOutline: commercialOutline(), story: STORY, storyBeats: BEATS,
      scenePlan: SCENES.map((scene) => ({ ...scene, beatIds: [BEATS[0]!.id] })),
      creativeContext: { storyContext: STORY, characterContext: { characters: [], relationships: [] }, productContext: { source: "NONE", products: [] }, worldContext: { locations: [], timePeriod: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] } },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
    })).rejects.toThrow("SCRIPT_STATE_CHANGE_ANCHOR_REQUIRED");
    expect(callStructuredJsonModel).not.toHaveBeenCalled();
  });

  it("requires a typed delta on only the exact commercial anchor Scene", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 1 });
    const valid = commercialProviderProposal(1);
    expect(schema.safeParse(providerTransport(valid)).success).toBe(true);
    const allZero = commercialProviderProposal(1);
    allZero.scenes = allZero.scenes.map((scene) => ({ ...scene, sceneStateDeltas: [] }));
    expect(schema.safeParse(providerTransport(allZero)).success).toBe(false);
    const nonAnchorZero = commercialProviderProposal(1);
    nonAnchorZero.scenes = nonAnchorZero.scenes.map((scene, index) => index === 0 ? { ...scene, sceneStateDeltas: [] } : scene);
    expect(schema.safeParse(providerTransport(nonAnchorZero)).success).toBe(true);
  });

  it("requires the physical commercial anchor to expose exactly one causal Product state transition", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 1 });
    const valid = providerTransport(commercialProviderProposal(1));
    expect(schema.safeParse(valid).success).toBe(true);

    const knowledgeOnly = providerTransport(commercialProviderProposal(1));
    knowledgeOnly.scenesByOrder.scene_1!.sceneStateDeltas = [{
      dimension: "KNOWLEDGE", subjectId: I.character, fromValue: "unaware",
      value: "understands", reason: "The character learns",
    }];
    expect(schema.safeParse(knowledgeOnly).success).toBe(false);

    const wrongProduct = providerTransport(commercialProviderProposal(1));
    wrongProduct.scenesByOrder.scene_1!.sceneStateDeltas = [{
      ...wrongProduct.scenesByOrder.scene_1!.sceneStateDeltas[0]!,
      subjectId: id(999),
    }];
    expect(schema.safeParse(wrongProduct).success).toBe(false);

    const duplicate = providerTransport(commercialProviderProposal(1));
    duplicate.scenesByOrder.scene_1!.sceneStateDeltas.push({
      ...duplicate.scenesByOrder.scene_1!.sceneStateDeltas[0]!,
      value: "used twice",
    });
    expect(schema.safeParse(duplicate).success).toBe(false);
  });

  it("constrains state subjects to exact Character and Product authority IDs", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 1 });
    const characterState = commercialProviderProposal(1);
    expect(schema.safeParse(providerTransport(characterState)).success).toBe(true);
    const productState = commercialProviderProposal(1);
    expect(schema.safeParse(providerTransport(productState)).success).toBe(true);
    const unknownState = commercialProviderProposal(1);
    unknownState.scenes[1]!.sceneStateDeltas[0] = { ...unknownState.scenes[1]!.sceneStateDeltas[0]!, subjectId: id(999) };
    expect(schema.safeParse(providerTransport(unknownState)).success).toBe(false);
  });

  it("requires the exact commercial object at the anchor and keeps commercial contribution out of provider authority", () => {
    const schema = providerSchema({ commercial: true, sceneCount: 1, stateChangeAnchorSceneIndex: 0 });
    const parsed = schema.parse({
      contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      scenesByOrder: { scene_0: {
        sceneFunction: "DEMONSTRATE",
        sceneFunctionRegistryVersion: 1,
        sceneStateIn: [],
        sceneStateDeltas: [{ dimension: "PRODUCT_STATE", subjectId: I.product, fromValue: "available but unused", value: "actively used in the story", reason: "The character uses the product" }],
        sceneStateOut: [],
        newInformation: ["The product is in use."],
        newActionOutcomes: ["The character uses the product."],
        visibleAction: {
          type: "ACTION",
          subjectId: I.character,
          action: "The character holds the authorized product and uses it.",
          objectId: I.product,
          storyEffect: "The product participates in the action.",
          stateDelta: null,
        },
        followingEntries: [],
        narrativeFunction: "PRODUCT_INTERVENTION",
        storyConsequence: "The product remains in the character's action.",
      } },
    });
    expect(parsed.scenesByOrder.scene_0?.visibleAction).toMatchObject({ objectId: I.product });
    expect(parsed.scenesByOrder.scene_0).not.toHaveProperty("commercialContribution");
    expect(schema.safeParse({
      ...parsed,
      scenesByOrder: {
        scene_0: {
          ...parsed.scenesByOrder.scene_0,
          commercialContribution: {
            commercialRole: "PRODUCT",
            narrativeFunction: "PRODUCT_INTERVENTION",
            participationKind: "ENABLE",
            commercialAuthorityIds: [I.product],
            preState: "before",
            postState: "after",
            storyConsequence: "changed",
          },
        },
      },
    }).success).toBe(false);
  });

  it("does not force the Product into ordinary commercial Scenes, including a seven-Scene contract", () => {
    const sceneCount = 7;
    const anchor = 3;
    const schema = providerSchema({ commercial: true, sceneCount, stateChangeAnchorSceneIndex: anchor });
    const base = commercialProviderProposal(anchor).scenes[0]!;
    const scenesByOrder = Object.fromEntries(Array.from({ length: sceneCount }, (_, index) => [
      `scene_${index}`,
      {
        ...base,
        sceneStateDeltas: index === anchor
          ? [{ dimension: "PRODUCT_STATE", subjectId: I.product, fromValue: "available but unused", value: "actively used", reason: "The Product participates" }]
          : [],
        visibleAction: {
          ...base.visibleAction,
          objectId: index === anchor ? I.product : null,
          action: index === anchor ? "The character physically uses the authorized Product." : "The character walks toward the workbench.",
        },
      },
    ]));
    expect(schema.safeParse({ contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION, scenesByOrder }).success).toBe(true);
    expect(Object.values(scenesByOrder).filter((scene) => scene.visibleAction.objectId === I.product)).toHaveLength(1);
  });

  it("structurally rejects Product ACTION authority outside the frozen integration anchor", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 1 });

    const productObject = providerTransport(commercialProviderProposal(1));
    productObject.scenesByOrder.scene_0!.visibleAction.objectId = I.product;
    expect(schema.safeParse(productObject).success).toBe(false);

    const productSubject = providerTransport(commercialProviderProposal(1));
    productSubject.scenesByOrder.scene_0!.visibleAction.subjectId = I.product;
    expect(schema.safeParse(productSubject).success).toBe(false);

    const productFollowingAction = providerTransport(commercialProviderProposal(1));
    productFollowingAction.scenesByOrder.scene_0!.followingEntries = [{
      type: "ACTION",
      subjectId: I.character,
      action: "The character visibly handles the commercial Product.",
      objectId: I.product,
      storyEffect: "The Product appears outside its integration authority.",
      stateDelta: null,
    }];
    expect(schema.safeParse(productFollowingAction).success).toBe(false);

    const productState = providerTransport(commercialProviderProposal(1));
    productState.scenesByOrder.scene_0!.sceneStateIn = [{
      dimension: "PRODUCT_STATE", subjectId: I.product, value: "mechanically inserted",
    }];
    expect(schema.safeParse(productState).success).toBe(false);
  });

  it("rejects a non-commercial object at the physical integration anchor", () => {
    const schema = providerSchema({ commercial: true, stateChangeAnchorSceneIndex: 1 });
    const value = providerTransport(commercialProviderProposal(1));
    value.scenesByOrder.scene_1!.visibleAction.objectId = I.character;
    expect(schema.safeParse(value).success).toBe(false);
  });

  it("projects the anchor contribution exclusively from frozen Outline authority", async () => {
    const source = commercialOutline();
    const transport = providerTransport(commercialProviderProposal(1));
    transport.scenesByOrder.scene_1!.sceneStateDeltas = [{
      dimension: "PRODUCT_STATE",
      subjectId: I.product,
      fromValue: "provider-owned wrong pre-state",
      value: "provider-owned wrong post-state",
      reason: "Provider semantic wording only",
    }];
    callStructuredJsonModel.mockResolvedValueOnce({ result: transport, usage: { input: 10, output: 5, costUsd: 0.01 } });
    const result = await generateAiStoryScriptSemanticProposalV1({
      frozenOutline: source, story: STORY, storyBeats: BEATS, scenePlan: SCENES,
      creativeContext: { storyContext: STORY, characterContext: { characters: [], relationships: [] }, productContext: { source: "NONE", products: [] }, worldContext: { locations: [], timePeriod: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] } },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
    });
    const integration = source.commercialStoryProfile!.commercialIntegration!;
    expect(result.semanticProposal.scenes[0]!.commercialContribution).toBeUndefined();
    expect(result.semanticProposal.scenes[0]!.sceneStateIn).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectId: I.product }),
    ]));
    expect(result.semanticProposal.scenes[1]!.commercialContribution).toEqual({
      commercialRole: source.commercialStoryProfile!.commercialRole,
      narrativeFunction: integration.narrativeFunction,
      participationKind: integration.commercialActionOrParticipation,
      commercialAuthorityIds: integration.commercialAuthorityRefs,
      preState: integration.preIntegrationState,
      postState: integration.postIntegrationState,
      storyConsequence: integration.storyConsequence,
    });
    expect(result.semanticProposal.scenes[1]!.sceneStateIn).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "PRODUCT_STATE", subjectId: I.product, value: integration.preIntegrationState }),
    ]));
    expect(result.semanticProposal.scenes[1]!.sceneStateOut).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: "PRODUCT_STATE", subjectId: I.product, value: integration.postIntegrationState }),
    ]));
    const material = promoteAiStoryScriptSemanticProposalV1({
      storyId: I.story,
      storyVersionId: I.storyVersion,
      frozenOutline: source,
      storyBeatProposals: BEATS,
      scenePlan: SCENES,
      characterAuthorities: [CHARACTER],
      semanticProposal: result.semanticProposal,
    });
    const script = buildAiStoryScriptVersion({
      storyId: I.story,
      storyVersionId: I.storyVersion,
      outlineVersionId: source.outlineVersionId,
      orgId: I.org,
      workspaceId: I.workspace,
      version: 1,
      profileId: "COMMERCIAL_STORY",
      profileVersion: 1,
      outlineSourceHash: source.sourceHash,
      scenes: material.scenes,
      authorityReferences: material.authorityReferences,
      supersedesScriptVersionId: null,
      createdBy: I.actor,
      createdAt: "2026-09-15T01:00:00.000Z",
    });
    expect(validateAiStoryCommercialStoryProfile(source, script)
      .filter((issue) => issue.gate === "COMMERCIAL_INTEGRATION_GATE" && issue.severity === "BLOCK"))
      .toEqual([]);
    expect(evaluateCommercialProductActionCausality(script)).toEqual([]);
    expect(script.scenes[1]!.entries[0]).toMatchObject({
      type: "ACTION",
      objectId: I.product,
      stateDelta: {
        dimension: "PRODUCT_STATE",
        subjectId: I.product,
        fromValue: integration.preIntegrationState,
        value: integration.postIntegrationState,
      },
    });
  });

  it("uses one frozen entry-point resolver for state change and commercial integration", () => {
    const source = commercialOutline();
    const input = { frozenOutline: source, storyBeats: BEATS, scenePlan: SCENES };
    expect(resolveCommercialIntegrationAnchorSceneIndex(input)).toBe(resolveCommercialStateChangeAnchorSceneIndex(input));
  });

  it("keeps Scene Plan identity out of provider output and requires the exact Scene count", () => {
    const schema = providerSchema({ sceneCount: 5 });
    const scene = structuredProviderProposal().scenes[0]!;
    expect(schema.safeParse({
      contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      scenesByOrder: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`scene_${index}`, scene])),
    }).success).toBe(true);
    expect(schema.safeParse({
      contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      scenesByOrder: Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`scene_${index}`, scene])),
    }).success).toBe(false);
    expect(schema.safeParse({
      contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      scenesByOrder: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`scene_${index}`, scene])),
    }).success).toBe(false);
    expect(schema.safeParse({
      contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
      scenesByOrder: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`scene_${index}`, { ...scene, scenePlanItemId: `model-scene-${index}` }])),
    }).success).toBe(false);
  });

  it("injects exact canonical Scene Plan IDs by server-owned array order", async () => {
    const fiveScenes = Array.from({ length: 5 }, (_, order) => ({
      ...SCENES[order % SCENES.length]!,
      id: `scene-plan-${order}`,
      order,
    }));
    const providerScene = structuredProviderProposal().scenes[0]!;
    callStructuredJsonModel.mockResolvedValueOnce({
      result: {
        contractVersion: AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
        scenesByOrder: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`scene_${index}`, providerScene])),
      },
      usage: { input: 10, output: 5, costUsd: 0.01 },
    });
    const result = await generateAiStoryScriptSemanticProposalV1({
      frozenOutline: outline(), story: STORY, storyBeats: BEATS, scenePlan: fiveScenes,
      creativeContext: { storyContext: STORY, characterContext: { characters: [], relationships: [] }, productContext: { source: "NONE", products: [] }, worldContext: { locations: [], timePeriod: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] } },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
    });
    expect(result.semanticProposal.scenes.map((scene) => scene.scenePlanItemId)).toEqual(fiveScenes.map((scene) => scene.id));
    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
  });

  it("uses one existing model call and returns only a validated proposal", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: providerTransport(structuredProviderProposal()), usage: { input: 10, output: 5, costUsd: 0.01 } });
    const source = outline();
    const result = await generateAiStoryScriptSemanticProposalV1({
      frozenOutline: source, story: STORY, storyBeats: BEATS, scenePlan: SCENES,
      creativeContext: { storyContext: STORY, characterContext: { characters: [], relationships: [] }, productContext: { source: "NONE", products: [] }, worldContext: { locations: [], timePeriod: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] } },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
    });
    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
    expect(callStructuredJsonModel).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: "ai_story_script_semantic_proposal_v1",
      certificationStage: "script_semantic_writer",
      system: expect.stringContaining("sceneStateIn must copy every fact from the previous Scene sceneStateOut"),
    }));
    expect(result.semanticProposal).toEqual(proposal());
  });

  it("fails closed when the structured provider refuses instead of repairing semantic authority", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: null,
      decodeIssue: "PROVIDER_REFUSAL",
      usage: { input: 10, output: 0, costUsd: 0.001 },
    });
    await expect(generateAiStoryScriptSemanticProposalV1({
      frozenOutline: outline(), story: STORY, storyBeats: BEATS, scenePlan: SCENES,
      creativeContext: { storyContext: STORY, characterContext: { characters: [], relationships: [] }, productContext: { source: "NONE", products: [] }, worldContext: { locations: [], timePeriod: "", worldRules: [] }, narrativeContext: { arc: "Arc", pacing: "Pace", emotionalJourney: "Journey", themes: [] } },
      directorThinking: { coreMessage: "Message", hero: "Hero", conflict: "Conflict", turningPoint: "Turn", climax: "Climax", takeaway: "Takeaway" },
      characterAuthorities: [CHARACTER], productAuthorityIds: [I.product],
    })).rejects.toThrow("SCRIPT_SEMANTIC_WRITER_PROVIDER_REFUSAL");
  });
});
