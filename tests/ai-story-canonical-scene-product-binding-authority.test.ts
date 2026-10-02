import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertExplicitAiStorySceneGenerationMode,
  AiStorySceneGenerationModeAuthorityError,
  type AiStoryCanonicalScene,
  type AiStorySceneGenerationAuthority,
  type AiStoryScriptVersion,
} from "@ceo-agent/shared";
import {
  buildAiStoryScriptVersion,
  deriveExpectedCanonicalSceneProductAuthorities,
  finalizeAiStoryCanonicalScene,
  validateAiStoryCanonicalScenes,
} from "@ceo-agent/shared/server";

const id = (n: number) => `8d000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const I = {
  org: id(1), workspace: id(2), campaign: id(3), story: id(4), storyVersion: id(5), outline: id(6), actor: id(7),
  scriptScene: id(8), entry: id(9), scene: id(10), character: id(11), productA: id(12), productB: id(13), productC: id(14),
  beat: id(15), scriptSceneB: id(16), entryB: id(17), sceneB: id(18), beatB: id(19),
};
const hash = `sha256:${"ab".repeat(32)}`;

function binding(productId: string, requirement: "REQUIRED" | "PREFERRED" = "REQUIRED") {
  return {
    productAuthorityId: productId,
    sourceAssetId: productId,
    sourceAssetContentHash: hash,
    visualIdentityRequirement: requirement,
  };
}

function explicitAuthority(productId: string, strategy: "FIRST_FRAME_IMAGE_TO_VIDEO" | "PRODUCT_GROUNDED_VIDEO" = "FIRST_FRAME_IMAGE_TO_VIDEO"): AiStorySceneGenerationAuthority {
  return {
    strategy,
    referenceSource: "SCENE_EXPLICIT",
    referenceAssetIds: [productId],
    firstFrameAssetId: productId,
    productVisualIdentityRequirement: "REQUIRED",
  };
}

const referenceFree: AiStorySceneGenerationAuthority = {
  strategy: "TEXT_TO_VIDEO",
  referenceSource: "REFERENCE_FREE_T2V",
  referenceAssetIds: [],
  firstFrameAssetId: null,
  productVisualIdentityRequirement: "NONE",
};

function scriptScene(input: {
  scriptSceneId: string;
  order: number;
  beatId: string;
  entryId: string;
  productAuthorityRefs: string[];
  sceneFunction?: string;
}) {
  return {
    scriptSceneId: input.scriptSceneId,
    order: input.order,
    outlineBeatClaims: [{ outlineBeatId: input.beatId, claim: "The scene advances the watch" }],
    sceneFunction: input.sceneFunction ?? "TRANSITION",
    sceneFunctionRegistryVersion: 1,
    sceneStateIn: [{ dimension: "LOCATION" as const, subjectId: I.character, value: "counter" }],
    sceneStateDeltas: [],
    sceneStateOut: [{ dimension: "LOCATION" as const, subjectId: I.character, value: "counter" }],
    entries: [{
      entryId: input.entryId,
      order: 0,
      type: "ACTION" as const,
      subjectId: I.character,
      action: "The keeper looks across the counter.",
      storyEffect: "Attention moves to the work surface.",
      durationRange: { minSeconds: 2, maxSeconds: 5 },
    }],
    characterIds: [I.character],
    locationIds: [],
    propIds: [],
    assetIds: [],
    productAuthorityRefs: input.productAuthorityRefs,
    targetDurationRange: { minSeconds: 2, maxSeconds: 7 },
    mustKeep: ["Character identity"],
    mustAvoid: ["Teleportation"],
    newInformation: ["The counter is in view."],
    newEvidence: [],
    newActionOutcomes: ["The look is completed."],
    productEvidence: [],
  };
}

function script(scenes: ReturnType<typeof scriptScene>[]): AiStoryScriptVersion {
  return buildAiStoryScriptVersion({
    storyId: I.story,
    storyVersionId: I.storyVersion,
    outlineVersionId: I.outline,
    orgId: I.org,
    workspaceId: I.workspace,
    version: 1,
    profileId: "CORE",
    profileVersion: 1,
    outlineSourceHash: `sha256:${"cd".repeat(32)}`,
    scenes,
    authorityReferences: [{ authorityType: "CHARACTER", authorityId: I.character }],
    supersedesScriptVersionId: null,
    createdBy: I.actor,
    createdAt: "2026-10-02T08:00:00.000Z",
  });
}

function canonical(input: {
  source: AiStoryScriptVersion;
  sourceScene: AiStoryScriptVersion["scenes"][number];
  sceneId: string;
  order: number;
  generationAuthority?: AiStorySceneGenerationAuthority;
  productBindings: AiStoryCanonicalScene["productBindings"];
}) {
  return finalizeAiStoryCanonicalScene({
    sceneId: input.sceneId,
    orgId: I.org,
    workspaceId: I.workspace,
    campaignId: I.campaign,
    storyId: I.story,
    storyVersionId: I.storyVersion,
    scriptVersionId: input.source.scriptVersionId,
    version: 1,
    order: input.order,
    sourceScriptSceneIds: [input.sourceScene.scriptSceneId],
    sourceScriptEntryIds: input.sourceScene.entries.map((entry) => entry.entryId),
    sceneFunction: input.sourceScene.sceneFunction,
    sceneRole: "REVEAL",
    importance: "MAJOR",
    locationBinding: {
      scope: "EPHEMERAL_ENVIRONMENT",
      id: id(40 + input.order),
      storyId: I.story,
      sceneId: input.sceneId,
      displayName: "Counter",
      environmentDescription: "A small work counter",
      visualIdentityRequirement: "NONE",
    },
    locationState: { temporaryFacts: ["The counter stays in frame"] },
    castBindings: [],
    productBindings: input.productBindings as AiStoryCanonicalScene["productBindings"] & { visualIdentityRequirement: "REQUIRED" | "PREFERRED" }[],
    generationAuthority: input.generationAuthority,
    entryState: input.sourceScene.sceneStateIn,
    events: input.sourceScene.entries,
    exitState: input.sourceScene.sceneStateOut,
    continuityFacts: input.sourceScene.newInformation,
    timeRelation: "UNSPECIFIED",
    discontinuity: null,
    mustKeep: input.sourceScene.mustKeep,
    mustAvoid: input.sourceScene.mustAvoid,
    lineageOperation: "CREATE",
    parentSceneVersionIds: [],
    createdBy: I.actor,
    createdAt: "2026-10-02T08:10:00.000Z",
  });
}

function productGate(scenes: AiStoryCanonicalScene[], source: AiStoryScriptVersion) {
  return validateAiStoryCanonicalScenes(scenes, source).filter((issue) => issue.gate === "PRODUCT_BINDING_GATE");
}

describe("canonical scene product binding authority separation", () => {
  it("accepts a visual-only opening hook binding when the script has no product participation", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA)],
    });
    expect(source.scenes[0]!.productAuthorityRefs).toEqual([]);
    expect(source.scenes[0]!.commercialContribution).toBeUndefined();
    expect(scene).not.toHaveProperty("commercialContribution");
    expect(scene.events[0]).not.toHaveProperty("commercialContribution");
    expect(scene.productBindings).toEqual([expect.objectContaining({
      productAuthorityId: I.productA,
      sourceAssetId: I.productA,
      visualIdentityRequirement: "REQUIRED",
    })]);
    expect(productGate([scene], source)).toEqual([]);
    const preferred = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA, "PREFERRED")],
    });
    expect(productGate([preferred], source).length).toBeGreaterThan(0);
  });

  it("deduplicates the same script product and visual product to one binding", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [I.productA] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA, "PRODUCT_GROUNDED_VIDEO"),
      productBindings: [binding(I.productA)],
    });
    expect(deriveExpectedCanonicalSceneProductAuthorities({
      scriptProductAuthorityRefs: source.scenes[0]!.productAuthorityRefs,
      generationAuthority: scene.generationAuthority,
      productBindings: scene.productBindings,
    })).toEqual({ ok: true, productAuthorityIds: [I.productA] });
    expect(productGate([scene], source)).toEqual([]);
  });

  it("fails closed when script narrative product differs from the first-frame product", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [I.productB] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA), binding(I.productB)],
    });
    expect(productGate([scene], source)).toContainEqual(expect.objectContaining({
      gate: "PRODUCT_BINDING_GATE",
      message: "Scene generation visual Product conflicts with Script narrative Product authority",
    }));
  });

  it("fails when the explicit first-frame product binding is missing", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [],
    });
    expect(productGate([scene], source).length).toBeGreaterThan(0);
  });

  it("fails when an explicit scene adds a product outside script and generation authority", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA), binding(I.productC)],
    });
    expect(productGate([scene], source).length).toBeGreaterThan(0);
  });

  it("keeps an empty reference-free scene free of product bindings", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: referenceFree,
      productBindings: [],
    });
    expect(productGate([scene], source)).toEqual([]);
  });

  it("rejects a reference-free product binding that the script does not authorize", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: referenceFree,
      productBindings: [binding(I.productA)],
    });
    expect(productGate([scene], source)).toContainEqual(expect.objectContaining({ gate: "PRODUCT_BINDING_GATE" }));
  });

  it("keeps duplicate product authority detection fail closed", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA), binding(I.productA)],
    });
    expect(productGate([scene], source)).toContainEqual(expect.objectContaining({
      message: "Scene contains duplicate Product authority bindings",
    }));
  });

  it("rejects a visual product binding without an explicit visual identity requirement", () => {
    const sceneSource = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [binding(I.productA)],
    });
    const incomplete = structuredClone(scene);
    delete (incomplete.productBindings[0] as { visualIdentityRequirement?: string }).visualIdentityRequirement;
    expect(productGate([incomplete], source)).toContainEqual(expect.objectContaining({
      message: "Scene Product visual identity requirement must be explicitly resolved",
    }));
  });

  it("keeps the explicit material mismatch gate fail closed", () => {
    expect(() => assertExplicitAiStorySceneGenerationMode({
      generationAuthority: explicitAuthority(I.productA),
      productBindings: [],
    })).toThrow(AiStorySceneGenerationModeAuthorityError);
    try {
      assertExplicitAiStorySceneGenerationMode({
        generationAuthority: explicitAuthority(I.productA),
        productBindings: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AiStorySceneGenerationModeAuthorityError);
      expect((error as AiStorySceneGenerationModeAuthorityError).code).toBe("CANONICAL_SCENE_GENERATION_MODE_MATERIAL_MISMATCH");
    }
  });

  it("does not force a product binding into a reference-free scene beside a visual hook", () => {
    const hook = scriptScene({ scriptSceneId: I.scriptScene, order: 0, beatId: I.beat, entryId: I.entry, productAuthorityRefs: [] });
    const later = scriptScene({ scriptSceneId: I.scriptSceneB, order: 1, beatId: I.beatB, entryId: I.entryB, productAuthorityRefs: [] });
    const source = script([hook, later]);
    const scenes = [
      canonical({
        source,
        sourceScene: source.scenes[0]!,
        sceneId: I.scene,
        order: 0,
        generationAuthority: explicitAuthority(I.productA),
        productBindings: [binding(I.productA)],
      }),
      canonical({
        source,
        sourceScene: source.scenes[1]!,
        sceneId: I.sceneB,
        order: 1,
        generationAuthority: referenceFree,
        productBindings: [],
      }),
    ];
    expect(productGate(scenes, source)).toEqual([]);
    expect(scenes.filter((scene) => scene.productBindings.length > 0)).toHaveLength(1);
    expect(scenes[1]!.productBindings).toEqual([]);
  });

  it("keeps script-only narrative product bindings on their existing requirement", () => {
    const sceneSource = scriptScene({
      scriptSceneId: I.scriptScene,
      order: 0,
      beatId: I.beat,
      entryId: I.entry,
      productAuthorityRefs: [I.productA],
      sceneFunction: "PRODUCT_DETAIL_REVEAL",
    });
    const source = script([sceneSource]);
    const scene = canonical({
      source,
      sourceScene: source.scenes[0]!,
      sceneId: I.scene,
      order: 0,
      generationAuthority: referenceFree,
      productBindings: [binding(I.productA, "PREFERRED")],
    });
    expect(scene.productBindings[0]!.visualIdentityRequirement).toBe("PREFERRED");
    expect(productGate([scene], source)).toEqual([]);
  });

  it("does not encode a story-specific character, product, or asset", () => {
    const source = readFileSync(new URL("../packages/shared/src/ai-story-scene.server.ts", import.meta.url), "utf8");
    const tokens = ["Yu" + "ki", "Mini" + " Fan", "Nasi" + " Lemak", "70235a91-" + "8f48-4f2d-a7fe-65cd2cc973f8"];
    for (const token of tokens) expect(source).not.toContain(token);
  });
});
