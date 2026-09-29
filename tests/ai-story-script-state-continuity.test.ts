import { describe, expect, it } from "vitest";
import {
  AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION,
  CreativeContextSchema,
  carryForwardUnchangedScriptSceneState,
  dropUnchangedPhysicalScriptChanges,
  validateAiStoryScript,
  type AiStoryOutlineVersion,
  type AiStoryScriptSemanticProposalV1,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import { buildAiStoryOutlineVersion, buildAiStoryScriptVersion } from "@ceo-agent/shared/server";
import { selectStoryBoundCharacterAuthorities } from "../packages/agents/src/ai-story/character-authority-planning";

const id = (n: number) => `71000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const IDS = {
  org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5),
  actor: id(6), beat: id(7), character: id(8), product: id(9), sceneA: id(10), sceneB: id(11),
  otherCharacter: id(12), version: id(13),
};
const fingerprint = `sha256:${"a".repeat(64)}`;

function scene(input: {
  scenePlanItemId: string;
  sceneStateIn: AiStoryScriptSemanticProposalV1["scenes"][number]["sceneStateIn"];
  sceneStateOut: AiStoryScriptSemanticProposalV1["scenes"][number]["sceneStateOut"];
  sceneStateDeltas?: AiStoryScriptSemanticProposalV1["scenes"][number]["sceneStateDeltas"];
  action?: string;
}): AiStoryScriptSemanticProposalV1["scenes"][number] {
  return {
    scenePlanItemId: input.scenePlanItemId,
    sceneFunction: "DEMONSTRATE",
    sceneFunctionRegistryVersion: 1,
    sceneStateIn: input.sceneStateIn,
    sceneStateDeltas: input.sceneStateDeltas ?? [],
    sceneStateOut: input.sceneStateOut,
    entries: [{
      type: "ACTION",
      subjectId: IDS.character,
      objectId: IDS.product,
      action: input.action ?? "The character keeps using the product.",
      storyEffect: "The product stays in the story.",
    }],
    newInformation: ["The story continues."],
    newActionOutcomes: ["The action remains visible."],
  };
}

function held(value: string) {
  return { dimension: "POSSESSION" as const, subjectId: IDS.character, value };
}

describe("commercial script state continuity", () => {
  it("carries an unchanged held product across adjacent scenes", () => {
    const product = held("holding the same product");
    const [first, second] = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [product], sceneStateOut: [product] }),
      scene({
        scenePlanItemId: "scene-002",
        sceneStateIn: [],
        sceneStateOut: [],
        action: "The camera moves closer while the character keeps talking.",
      }),
    ]);
    expect(second!.sceneStateIn).toEqual([product]);
    expect(second!.sceneStateOut).toEqual([product]);
    expect(first!.sceneStateOut).toEqual([product]);
    expect(JSON.stringify(second)).not.toContain("CAMERA");
  });

  it("still fails a real unexplained product or location reset", () => {
    const before = { dimension: "LOCATION" as const, subjectId: IDS.character, value: "florist workbench" };
    const reset = { ...before, value: "different shop" };
    const aligned = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [before], sceneStateOut: [before] }),
      scene({ scenePlanItemId: "scene-002", sceneStateIn: [reset], sceneStateOut: [reset] }),
    ]);
    expect(aligned[1]!.sceneStateIn).toEqual([reset]);
    const outline = frozenOutline();
    const script = continuityScript(outline, before.value, reset.value);
    expect(validateAiStoryScript(script, outline, {
      knownAuthorityReferences: new Set([`CHARACTER:${IDS.character}`, `PRODUCT:${IDS.product}`]),
    }).some((issue) => issue.gate === "STATE_CONTINUITY_GATE" && issue.message.includes("Unexplained state reset"))).toBe(true);
  });

  it("does not treat a camera change as story-world state", () => {
    const place = { dimension: "LOCATION" as const, subjectId: IDS.character, value: "florist workbench" };
    const aligned = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [place], sceneStateOut: [place] }),
      scene({
        scenePlanItemId: "scene-002",
        sceneStateIn: [place],
        sceneStateOut: [place],
        action: "The camera pushes in. The character and product stay at the workbench.",
      }),
    ]);
    expect(aligned[1]!.sceneStateIn).toEqual([place]);
    expect(aligned[1]!.sceneStateOut).toEqual([place]);
    expect(aligned[1]!.sceneStateDeltas).toEqual([]);
  });

  it("requires a visible action rather than dialogue alone", () => {
    const outline = frozenOutline();
    const spoken = continuityScript(outline, "holding the product", "holding the product");
    spoken.scenes[0]!.entries = [{
      entryId: id(20),
      order: 0,
      type: "DIALOGUE",
      speakerId: IDS.character,
      line: "This product is useful.",
      language: "en",
      durationRange: { minSeconds: 1, maxSeconds: 2 },
    }];
    const issues = validateAiStoryScript(spoken, outline, {
      knownAuthorityReferences: new Set([`CHARACTER:${IDS.character}`, `PRODUCT:${IDS.product}`]),
    });
    expect(issues.some((issue) => issue.gate === "ACTION_BEAT_PRESENCE_GATE")).toBe(true);
  });

  it("does not invent physical state for off-screen dialogue", () => {
    const product = held("holding the same product");
    const aligned = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [product], sceneStateOut: [product] }),
      {
        ...scene({ scenePlanItemId: "scene-002", sceneStateIn: [], sceneStateOut: [] }),
        entries: [{
          type: "DIALOGUE",
          speakerId: IDS.character,
          line: "An off-screen voice interrupts.",
          language: "en",
        }],
      },
    ]);
    expect(aligned[1]!.sceneStateIn.map((fact) => fact.subjectId)).toEqual([IDS.character]);
    expect(aligned[1]!.sceneStateIn).toEqual([product]);
    expect(aligned[1]!.sceneStateDeltas).toEqual([]);
  });

  it("keeps the story-bound character when another campaign character exists", () => {
    const facts = {
      identity: "Yuki",
      appearance: "Florist",
      personality: "Warm",
      emotionalArc: "Surprise",
      relationships: [],
    };
    const canonical = {
      characterId: IDS.character,
      characterVersionId: IDS.version,
      characterFingerprint: fingerprint,
      name: "Yuki",
      canonicalFacts: facts,
    };
    const projection = {
      ...canonical,
      characterId: IDS.otherCharacter,
      characterFingerprint: `sha256:${"b".repeat(64)}`,
    };
    const creativeContext = CreativeContextSchema.parse({
      storyContext: {},
      characterContext: { characters: [{ name: "Yuki", canonicalAuthority: canonical }] },
      worldContext: {},
      narrativeContext: {},
    });
    const selected = selectStoryBoundCharacterAuthorities({
      characterAuthorities: [projection, canonical],
      creativeContext,
    });
    expect(selected.map((authority) => authority.characterId)).toEqual([IDS.character]);
  });

  it("rebases a restated knowledge incoming value onto the previous outgoing value", () => {
    const contract = AI_STORY_SCRIPT_SEMANTIC_PROPOSAL_CONTRACT_VERSION;
    expect(contract).toBe("ai-story-script-semantic-proposal.v1");
    const prior = { dimension: "KNOWLEDGE" as const, subjectId: IDS.character, value: "delighted by the product" };
    const restated = { ...prior, value: "about to mention the price" };
    const aligned = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [prior], sceneStateOut: [prior] }),
      scene({
        scenePlanItemId: "scene-002",
        sceneStateIn: [restated],
        sceneStateDeltas: [{
          ...restated,
          fromValue: restated.value,
          value: "mentions the price",
          reason: "The next beat starts",
        }],
        sceneStateOut: [{ ...prior, value: "mentions the price" }],
      }),
    ]);
    expect(aligned[1]!.sceneStateIn[0]!.value).toBe(prior.value);
    expect(aligned[1]!.sceneStateDeltas[0]!.fromValue).toBe(prior.value);
  });

  it("drops an unchanged physical delta and keeps a real location change", () => {
    const place = { dimension: "LOCATION" as const, subjectId: IDS.character, value: "florist workbench" };
    const moved = { ...place, value: "different shop" };
    const product = held("holding the same product");
    const [unchanged, changed] = dropUnchangedPhysicalScriptChanges([
      scene({
        scenePlanItemId: "scene-001",
        sceneStateIn: [product, place],
        sceneStateOut: [product, place],
        sceneStateDeltas: [{ ...product, fromValue: product.value, value: product.value, reason: "Still holding" }],
      }),
      scene({
        scenePlanItemId: "scene-002",
        sceneStateIn: [place],
        sceneStateOut: [moved],
        sceneStateDeltas: [{ ...place, fromValue: place.value, value: moved.value, reason: "Unexplained move" }],
      }),
    ]);
    expect(unchanged!.sceneStateDeltas).toEqual([]);
    expect(changed!.sceneStateDeltas).toEqual([
      { ...place, fromValue: place.value, value: moved.value, reason: "Unexplained move" },
    ]);
  });

  it("drops a commercial contribution that does not change state", () => {
    const [sceneWithContribution] = dropUnchangedPhysicalScriptChanges([{
      ...scene({ scenePlanItemId: "scene-001", sceneStateIn: [], sceneStateOut: [] }),
      commercialContribution: {
        commercialRole: "PRODUCT",
        narrativeFunction: "ACTION",
        participationKind: "ENABLE",
        commercialAuthorityIds: [IDS.product],
        preState: "same",
        postState: "same",
        storyConsequence: "No change",
      },
    }]);
    expect(sceneWithContribution!.commercialContribution).toBeUndefined();
  });

  it("rebases an ACTION stateDelta together with the scene delta", () => {
    const prior = { dimension: "KNOWLEDGE" as const, subjectId: IDS.character, value: "delighted by the product" };
    const restated = { ...prior, value: "about to mention the price" };
    const delta = {
      ...restated,
      fromValue: restated.value,
      value: "mentions the price",
      reason: "The next beat starts",
    };
    const aligned = carryForwardUnchangedScriptSceneState([
      scene({ scenePlanItemId: "scene-001", sceneStateIn: [prior], sceneStateOut: [prior] }),
      {
        ...scene({
          scenePlanItemId: "scene-002",
          sceneStateIn: [restated],
          sceneStateDeltas: [delta],
          sceneStateOut: [{ ...prior, value: "mentions the price" }],
        }),
        entries: [{
          type: "ACTION",
          subjectId: IDS.character,
          objectId: IDS.product,
          action: "The character keeps using the product.",
          storyEffect: "The product stays in the story.",
          stateDelta: delta,
        }],
      },
    ]);
    expect(aligned[1]!.entries[0]).toMatchObject({
      type: "ACTION",
      stateDelta: { fromValue: prior.value, value: "mentions the price", reason: "The next beat starts" },
    });
    expect(aligned[1]!.sceneStateDeltas[0]).toEqual(
      aligned[1]!.entries[0] && aligned[1]!.entries[0].type === "ACTION"
        ? aligned[1]!.entries[0].stateDelta
        : null,
    );
  });
});

function frozenOutline(): AiStoryOutlineVersion {
  return {
    ...buildAiStoryOutlineVersion({
      storyId: IDS.story,
      storyVersionId: IDS.storyVersion,
      orgId: IDS.org,
      workspaceId: IDS.workspace,
      version: 1,
      profile: { profileId: "CORE", profileVersion: 1 },
      premise: "A continuous moment",
      coreClaim: "The product stays in hand",
      storyUnits: [{ storyUnitId: id(30), order: 0, purpose: "Continue", summary: "One moment", requiredBeatIds: [IDS.beat] }],
      beats: [{
        id: IDS.beat,
        storyUnitId: id(30),
        order: 0,
        classification: "MAJOR",
        name: "Use",
        purpose: "Keep the product in use",
        summary: "The product remains held",
        required: true,
        ownershipPolicy: "EXCLUSIVE",
        authorityReferences: [],
      }],
      hooks: [],
      setupPayoffs: [],
      requiredSceneOutcomes: [],
      authorityReferences: [{ authorityType: "PRODUCT", authorityId: IDS.product }],
      upstreamAuthorityId: IDS.storyVersion,
      supersedesOutlineVersionId: null,
      createdBy: IDS.actor,
      createdAt: "2026-09-29T00:00:00.000Z",
    }),
    status: "FROZEN",
    approvedBy: IDS.actor,
    approvedAt: "2026-09-29T00:01:00.000Z",
    frozenAt: "2026-09-29T00:02:00.000Z",
  };
}

function continuityScript(outline: AiStoryOutlineVersion, previous: string, next: string): AiStoryScriptVersion {
  return buildAiStoryScriptVersion({
    storyId: IDS.story,
    storyVersionId: IDS.storyVersion,
    outlineVersionId: outline.outlineVersionId,
    orgId: IDS.org,
    workspaceId: IDS.workspace,
    version: 1,
    profileId: "CORE",
    profileVersion: 1,
    outlineSourceHash: outline.sourceHash,
    scenes: [
      {
        scriptSceneId: IDS.sceneA,
        order: 0,
        outlineBeatClaims: [{ outlineBeatId: IDS.beat, claim: "Keep the product in use" }],
        sceneFunction: "DEMONSTRATE",
        sceneFunctionRegistryVersion: 1,
        sceneStateIn: [{ dimension: "LOCATION", subjectId: IDS.character, value: previous }],
        sceneStateDeltas: [],
        sceneStateOut: [{ dimension: "LOCATION", subjectId: IDS.character, value: previous }],
        entries: [{
          entryId: id(21),
          order: 0,
          type: "ACTION",
          subjectId: IDS.character,
          objectId: IDS.product,
          action: "The character uses the product.",
          storyEffect: "The product participates.",
          durationRange: { minSeconds: 1, maxSeconds: 2 },
        }],
        characterIds: [IDS.character],
        locationIds: [],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [IDS.product],
        targetDurationRange: { minSeconds: 1, maxSeconds: 2 },
        mustKeep: [],
        mustAvoid: [],
        newInformation: ["The product is in use."],
        newEvidence: [],
        newActionOutcomes: ["The product is visible."],
        productEvidence: [],
      },
      {
        scriptSceneId: IDS.sceneB,
        order: 1,
        outlineBeatClaims: [{ outlineBeatId: IDS.beat, claim: "Keep the product in use" }],
        sceneFunction: "DEMONSTRATE",
        sceneFunctionRegistryVersion: 1,
        sceneStateIn: [{ dimension: "LOCATION", subjectId: IDS.character, value: next }],
        sceneStateDeltas: [],
        sceneStateOut: [{ dimension: "LOCATION", subjectId: IDS.character, value: next }],
        entries: [{
          entryId: id(22),
          order: 0,
          type: "ACTION",
          subjectId: IDS.character,
          objectId: IDS.product,
          action: "The character is still using the product.",
          storyEffect: "The product remains present.",
          durationRange: { minSeconds: 1, maxSeconds: 2 },
        }],
        characterIds: [IDS.character],
        locationIds: [],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [IDS.product],
        targetDurationRange: { minSeconds: 1, maxSeconds: 2 },
        mustKeep: [],
        mustAvoid: [],
        newInformation: ["The moment continues."],
        newEvidence: [],
        newActionOutcomes: ["The product is still visible."],
        productEvidence: [],
      },
    ],
    authorityReferences: [
      { authorityType: "CHARACTER", authorityId: IDS.character },
      { authorityType: "PRODUCT", authorityId: IDS.product },
    ],
    supersedesScriptVersionId: null,
    createdBy: IDS.actor,
    createdAt: "2026-09-29T00:03:00.000Z",
  });
}
