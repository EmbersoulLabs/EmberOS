import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callJsonModel: vi.fn(),
  callStructuredJsonModel,
}));

import { assertExplicitAiStorySceneGenerationMode } from "../packages/shared/src/ai-story-generation-authority";
import {
  bindShotPlanAuthorityLineage,
  generateScenePlan,
  resolveInheritedProductSceneFirstFrame,
  resolveScenePlanGenerationAuthority,
} from "../packages/agents/src/ai-story/story-planning-service";
import type {
  AiStorySceneGenerationAuthority,
  AiStorySceneGroundingLineage,
  AiStoryScenePlanningGroundingContext,
} from "../packages/shared/src";

const orgId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "20000000-0000-4000-8000-000000000002";
const otherWorkspaceId = "20000000-0000-4000-8000-000000000099";
const storyId = "30000000-0000-4000-8000-000000000003";
const storyVersionId = "40000000-0000-4000-8000-000000000004";
const matchingResultId = "50000000-0000-4000-8000-000000000005";
const productAssetId = "60000000-0000-4000-8000-000000000006";
const secondProductAssetId = "60000000-0000-4000-8000-000000000016";
const supportingAssetId = "60000000-0000-4000-8000-000000000007";
const outsideAssetId = "60000000-0000-4000-8000-000000000066";
const productSnapshotId = "70000000-0000-4000-8000-000000000008";
const secondSnapshotId = "70000000-0000-4000-8000-000000000018";
const supportingSnapshotId = "70000000-0000-4000-8000-000000000028";
const productBindingId = "80000000-0000-4000-8000-000000000009";
const secondProductBindingId = "80000000-0000-4000-8000-000000000019";
const supportingBindingId = "80000000-0000-4000-8000-000000000010";
const planningPackageId = "90000000-0000-4000-8000-000000000011";

const scope = { orgId, workspaceId, storyId, storyVersionId };

function binding(input: {
  bindingId: string;
  assetId: string;
  role: "PRODUCT_AUTHORITY" | "SUPPORTING_REFERENCE";
  analysisSnapshotId: string;
  fact: string;
  relationship?: "PRIMARY_PRODUCT" | "CATALOG_CHOICE";
}) {
  return {
    bindingId: input.bindingId,
    assetId: input.assetId,
    role: input.role,
    analysisSnapshotId: input.analysisSnapshotId,
    observedFacts: [input.fact],
    namedItems: [input.fact],
    productCandidates: [{
      name: input.fact,
      relationship: input.relationship ?? "PRIMARY_PRODUCT",
      evidence: [input.fact],
    }],
  };
}

function context(bindings: ReturnType<typeof binding>[]): AiStoryScenePlanningGroundingContext {
  return {
    contractVersion: "ai-story-scene-grounding-context.v1",
    orgId,
    workspaceId,
    storyId,
    storyVersionId,
    matchingResultId,
    bindings,
  };
}

function lineage(evidence: AiStorySceneGroundingLineage["evidence"], visualClaims: AiStorySceneGroundingLineage["visualClaims"] = []): AiStorySceneGroundingLineage {
  return {
    contractVersion: "ai-story-scene-grounding-lineage.v1",
    storyId,
    storyVersionId,
    matchingResultId,
    narrativeIntent: "Show the accepted product.",
    visualIntent: "Hold on the accepted product.",
    evidence,
    visualClaims,
  };
}

const inherited: AiStorySceneGenerationAuthority = {
  strategy: "PRODUCT_GROUNDED_VIDEO",
  referenceSource: "STORY_INHERITED",
  productVisualIdentityRequirement: "REQUIRED",
};

const productEvidence = {
  bindingId: productBindingId,
  assetId: productAssetId,
  role: "PRODUCT_AUTHORITY" as const,
  semanticSnapshotId: productSnapshotId,
  groundedFacts: ["Nasi Lemak"],
};

const acceptedContext = context([
  binding({
    bindingId: productBindingId,
    assetId: productAssetId,
    role: "PRODUCT_AUTHORITY",
    analysisSnapshotId: productSnapshotId,
    fact: "Nasi Lemak",
  }),
  binding({
    bindingId: supportingBindingId,
    assetId: supportingAssetId,
    role: "SUPPORTING_REFERENCE",
    analysisSnapshotId: supportingSnapshotId,
    fact: "Ayam Rendang",
    relationship: "CATALOG_CHOICE",
  }),
]);

function resolve(authority: AiStorySceneGenerationAuthority, sceneLineage: AiStorySceneGroundingLineage, accepted = acceptedContext, expected = scope) {
  return resolveInheritedProductSceneFirstFrame({
    sceneId: "scene-002",
    generationAuthority: authority,
    lineage: sceneLineage,
    acceptedContext: accepted,
    expectedScope: expected,
  });
}

describe("inherited product scene first-frame resolution", () => {
  beforeEach(() => callStructuredJsonModel.mockReset());

  it("resolves exactly one accepted PRODUCT_AUTHORITY into a scene-explicit first frame", () => {
    const resolved = resolve(inherited, lineage([
      productEvidence,
      {
        bindingId: supportingBindingId,
        assetId: supportingAssetId,
        role: "SUPPORTING_REFERENCE",
        semanticSnapshotId: supportingSnapshotId,
        groundedFacts: ["Ayam Rendang"],
      },
    ], [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "OBSERVED_APPEARANCE" }]));

    expect(resolved).toEqual({
      strategy: "PRODUCT_GROUNDED_VIDEO",
      referenceSource: "SCENE_EXPLICIT",
      referenceAssetIds: [productAssetId],
      firstFrameAssetId: productAssetId,
      productVisualIdentityRequirement: "REQUIRED",
    });
    expect(resolved).not.toMatchObject({ firstFrameAssetId: supportingAssetId });
  });

  it("copies the resolved first frame into shot authority without reinterpretation", () => {
    const resolved = resolve(inherited, lineage([productEvidence]));
    const scene = {
      id: "scene-002",
      beatIds: ["beat-001"],
      purpose: "Reveal the product.",
      durationSec: 4,
      transition: "cut",
      continuityNotes: "",
      order: 1,
      generationAuthority: resolved,
      groundingLineage: lineage([productEvidence]),
    };
    const [shot] = bindShotPlanAuthorityLineage({
      planningPackageId,
      scenePlan: [scene],
      shotPlan: [{
        id: "shot-001",
        sceneId: "scene-002",
        cameraType: "close-up",
        cameraMovement: "slow push-in",
        composition: "centered product",
        framing: "tight",
        lensSuggestion: "50mm",
        durationSec: 4,
        focus: "product",
        emotion: "appetite",
        information: "the accepted product",
        order: 0,
      }],
    });

    expect(shot?.authorityLineage?.generationAuthority).toEqual(resolved);
    expect(shot?.authorityLineage?.generationAuthority.firstFrameAssetId).toBe(productAssetId);
  });

  it("fails closed when a product-grounded scene has no PRODUCT_AUTHORITY", () => {
    expect(() => resolve(inherited, lineage([], [
      { subject: "Ayam Rendang", detail: "Ayam Rendang", evidenceLevel: "EXISTENCE_ONLY" },
    ]))).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_REQUIRED:scene-002");
  });

  it("fails closed when two product assets are selected and nothing already names one", () => {
    const twoProducts = context([
      ...acceptedContext.bindings,
      binding({
        bindingId: secondProductBindingId,
        assetId: secondProductAssetId,
        role: "PRODUCT_AUTHORITY",
        analysisSnapshotId: secondSnapshotId,
        fact: "Sambal",
      }),
    ]);
    expect(() => resolve(inherited, lineage([
      productEvidence,
      {
        bindingId: secondProductBindingId,
        assetId: secondProductAssetId,
        role: "PRODUCT_AUTHORITY",
        semanticSnapshotId: secondSnapshotId,
        groundedFacts: ["Sambal"],
      },
    ]), twoProducts)).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_AMBIGUOUS:scene-002");

    const explicit = resolve({
      strategy: "PRODUCT_GROUNDED_VIDEO",
      referenceSource: "SCENE_EXPLICIT",
      referenceAssetIds: [productAssetId],
      firstFrameAssetId: productAssetId,
      productVisualIdentityRequirement: "REQUIRED",
    }, lineage([productEvidence]), twoProducts);
    expect(explicit.firstFrameAssetId).toBe(productAssetId);
  });

  it("does not promote a supporting reference or existence-only menu item to a product first frame", () => {
    const supportingOnly = lineage([{
      bindingId: supportingBindingId,
      assetId: supportingAssetId,
      role: "SUPPORTING_REFERENCE",
      semanticSnapshotId: supportingSnapshotId,
      groundedFacts: ["Ayam Rendang"],
    }], [{ subject: "Ayam Rendang", detail: "Ayam Rendang", evidenceLevel: "EXISTENCE_ONLY" }]);

    expect(() => resolve(inherited, supportingOnly)).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_REQUIRED:scene-002");

    const referenceFree = resolve({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    }, supportingOnly);
    expect(referenceFree).toEqual({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    });
  });

  it("rejects a cross-workspace scope and an asset outside the accepted matching result", () => {
    expect(() => resolve(
      inherited,
      lineage([productEvidence]),
      acceptedContext,
      { ...scope, workspaceId: otherWorkspaceId },
    )).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_SCOPE_MISMATCH:scene-002");

    expect(() => resolve(inherited, lineage([{
      ...productEvidence,
      assetId: outsideAssetId,
    }]))).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_UNACCEPTED:scene-002");

    expect(() => resolve(inherited, lineage([{
      ...productEvidence,
      bindingId: supportingBindingId,
      assetId: supportingAssetId,
      semanticSnapshotId: supportingSnapshotId,
    }]))).toThrow("SCENE_PRODUCT_FIRST_FRAME_AUTHORITY_UNACCEPTED:scene-002");
  });

  it("lets canonical scene consume the resolved authority and still reject unresolved inheritance", () => {
    const resolved = resolve(inherited, lineage([productEvidence]));
    expect(assertExplicitAiStorySceneGenerationMode({
      generationAuthority: resolved,
      productBindings: [{ sourceAssetId: productAssetId }],
    })).toMatchObject({
      referenceSource: "SCENE_EXPLICIT",
      firstFrameAssetId: productAssetId,
    });
    let unresolved: unknown;
    try {
      assertExplicitAiStorySceneGenerationMode({
        generationAuthority: inherited,
        productBindings: [{ sourceAssetId: productAssetId }],
      });
    } catch (error) {
      unresolved = error;
    }
    expect(unresolved).toMatchObject({
      code: "CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_UNRESOLVED",
      message: "Inherited Story references do not identify an exact Scene first-frame material",
    });
  });

  it("resolves inherited product scenes inside scene planning without another model call", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: {
        scenePlan: [{
          id: "scene-002",
          beatIds: ["beat-001"],
          purpose: "Reveal the accepted product.",
          durationSec: 4,
          transition: "cut",
          continuityNotes: "Product stays the accepted asset.",
          order: 0,
          generationAuthority: inherited,
        }],
        groundingSelections: [{
          sceneId: "scene-002",
          narrativeIntent: "Reveal the accepted product.",
          visualIntent: "Hold on the accepted product.",
          evidence: [{ bindingId: productBindingId, groundedFacts: ["Nasi Lemak"] }],
          visualClaims: [{ subject: "Nasi Lemak", detail: "Nasi Lemak", evidenceLevel: "EXISTENCE_ONLY" }],
        }],
      },
      usage: { input: 1, output: 1, costUsd: 0 },
    });

    const result = await generateScenePlan({
      story: {
        title: "Commercial",
        summary: "A product is revealed.",
        objective: "Awareness",
        targetAudience: "Customers",
        tone: "Warm",
        estimatedDuration: "15s",
        story: { opening: "Open", development: "Reveal", ending: "Close" },
        keyMessages: [],
        cta: "Order",
        assetReferences: [],
        warnings: [],
      },
      creativeContext: {
        storyContext: { title: "Commercial", summary: "A product is revealed.", objective: "Awareness", targetAudience: "Customers", tone: "Warm", estimatedDuration: "15s", keyMessages: [], cta: "Order" },
        characterContext: { characters: [], relationships: [] },
        productAuthorities: [],
        worldContext: { locations: ["Stall"], visualStyle: "Natural", lighting: "Day", environment: "Stall", objects: ["Plate"], timeline: "Present", worldRules: ["Food stays real"] },
        narrativeContext: { arc: "Reveal", pacing: "Quick", emotionalJourney: "Appetite", themes: ["Food"], dialogue: [] },
        directorContext: {},
      },
      directorThinking: { coreMessage: "Product", hero: "Dish", conflict: "Hunger", turningPoint: "Reveal", climax: "Serve", takeaway: "Order" },
      storyBeats: [{ id: "beat-001", name: "Reveal", purpose: "Show the product", order: 0, summary: "The product appears." }],
      assetGrounding: acceptedContext,
    });

    expect(callStructuredJsonModel).toHaveBeenCalledTimes(1);
    expect(result.scenePlan[0]?.generationAuthority).toEqual({
      strategy: "PRODUCT_GROUNDED_VIDEO",
      referenceSource: "SCENE_EXPLICIT",
      referenceAssetIds: [productAssetId],
      firstFrameAssetId: productAssetId,
      productVisualIdentityRequirement: "REQUIRED",
    });
  });

  it("keeps reference-free scenes empty when scene planning reconciles supporting-only evidence", () => {
    const scene = {
      id: "scene-001",
      beatIds: ["beat-001"],
      purpose: "Mention the menu.",
      durationSec: 3,
      transition: "",
      continuityNotes: "",
      order: 0,
      generationAuthority: {
        strategy: "TEXT_TO_VIDEO" as const,
        referenceSource: "REFERENCE_FREE_T2V" as const,
        referenceAssetIds: [] as string[],
        firstFrameAssetId: null,
        productVisualIdentityRequirement: "NONE" as const,
      },
    };
    const sceneLineage = lineage([{
      bindingId: supportingBindingId,
      assetId: supportingAssetId,
      role: "SUPPORTING_REFERENCE",
      semanticSnapshotId: supportingSnapshotId,
      groundedFacts: ["Ayam Rendang"],
    }], [{ subject: "Ayam Rendang", detail: "Ayam Rendang", evidenceLevel: "EXISTENCE_ONLY" }]);
    const authority = resolveScenePlanGenerationAuthority({
      sceneId: scene.id,
      scene,
      lineage: sceneLineage,
      acceptedContext: acceptedContext,
      expectedScope: scope,
    });
    expect(authority).toEqual(scene.generationAuthority);
  });

  it("does not move resolution into canonical scene or script authorization", () => {
    const planner = readFileSync("packages/agents/src/ai-story/story-planning-service.ts", "utf8");
    const lineageCall = planner.indexOf("const lineageByScene = bindSceneGroundingLineage(");
    const resolveCall = planner.indexOf("resolveScenePlanGenerationAuthority({", lineageCall);
    expect(lineageCall).toBeGreaterThan(0);
    expect(resolveCall).toBeGreaterThan(lineageCall);

    const resolver = planner.slice(
      planner.indexOf("export function resolveInheritedProductSceneFirstFrame"),
      planner.indexOf("export function resolveScenePlanGenerationAuthority"),
    );
    for (const forbidden of ["callJsonModel", "callStructuredJsonModel", "matchAssets", "analyzeAsset", "generateAiStoryScriptSemanticProposalV1"]) {
      expect(resolver).not.toContain(forbidden);
    }

    const canonical = readFileSync("packages/shared/src/ai-story-generation-authority.ts", "utf8");
    expect(canonical).toContain("CANONICAL_SCENE_GENERATION_MODE_AUTHORITY_UNRESOLVED");
    expect(canonical).not.toContain("resolveInheritedProductSceneFirstFrame");

    const composer = readFileSync("packages/shared/src/ai-story-canonical-scene-composer.server.ts", "utf8");
    expect(composer).toContain("assertExplicitAiStorySceneGenerationMode");
    expect(composer).not.toContain("resolveInheritedProductSceneFirstFrame");

    const script = readFileSync("apps/web/src/lib/ai-story-canonical-script-producer.ts", "utf8");
    expect(script).toContain("assertCommercialScriptCandidatePreAuthorization");
    expect(script).not.toContain("resolveInheritedProductSceneFirstFrame");
    const gate = script.indexOf("assertCommercialScriptCandidatePreAuthorization");
    const persist = script.indexOf("persistAuthorizedProposal", gate);
    expect(persist).toBeGreaterThan(gate);
  });
});
