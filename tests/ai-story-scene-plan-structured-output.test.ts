import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callJsonModel: vi.fn(),
  callStructuredJsonModel,
}));

import {
  bindSceneGroundingProposalIdsByPlanOrder,
  generateScenePlan,
  normalizeExistenceOnlySceneGrounding,
} from "../packages/agents/src/ai-story/story-planning-service";

const input = {
  story: {
    title: "Fresh Lily Bouquet",
    summary: "A florist arranges fresh lilies.",
    objective: "Awareness",
    targetAudience: "Local customers",
    tone: "Friendly",
    estimatedDuration: "15s",
    story: { opening: "Open", development: "Arrange", ending: "Present" },
    keyMessages: [],
    cta: "Order today",
    assetReferences: [],
    warnings: [],
  },
  creativeContext: {
    storyContext: { title: "Fresh Lily Bouquet", summary: "A florist arranges fresh lilies.", objective: "Awareness", targetAudience: "Local customers", tone: "Friendly", estimatedDuration: "15s", keyMessages: [], cta: "Order today" },
    characterContext: { characters: [], relationships: [] },
    productAuthorities: [],
    worldContext: { locations: ["Flower shop"], visualStyle: "Natural", lighting: "Warm", environment: "Shop", objects: ["Lilies"], timeline: "Present", worldRules: ["Flowers stay fresh"] },
    narrativeContext: { arc: "Arrange and present", pacing: "Quick", emotionalJourney: "Satisfied", themes: ["Craft"], dialogue: [] },
    directorContext: {},
  },
  directorThinking: { coreMessage: "Fresh craft", hero: "Florist", conflict: "Time", turningPoint: "Bouquet completes", climax: "Presentation", takeaway: "Order today" },
  storyBeats: [{ id: "beat-001", name: "Opening", purpose: "Introduce", order: 0, summary: "The florist begins." }],
  assetGrounding: {
    contractVersion: "ai-story-scene-grounding-context.v1" as const,
    orgId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    storyId: "30000000-0000-4000-8000-000000000003",
    storyVersionId: "40000000-0000-4000-8000-000000000004",
    matchingResultId: "50000000-0000-4000-8000-000000000005",
    bindings: [],
  },
};

const validProviderResult = {
  scenePlan: [{
    id: "scene-001",
    beatIds: ["beat-001"],
    purpose: "Introduce the florist and lilies.",
    durationSec: 8,
    transition: "cut",
    continuityNotes: "The same florist remains in the flower shop.",
    order: 0,
    generationAuthority: {
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    },
  }],
  groundingSelections: [{
    sceneId: "scene-001",
    narrativeIntent: "Introduce the florist.",
    visualIntent: "Show the florist in the flower shop.",
    evidence: [],
    visualClaims: [],
  }],
};

describe("AI Story Scene Plan strict structured output", () => {
  beforeEach(() => callStructuredJsonModel.mockReset());

  it("uses the strict provider schema and accepts a canonical scene plan", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: validProviderResult, usage: { input: 20, output: 10, costUsd: 0.01 } });

    const result = await generateScenePlan(input);

    expect(result.scenePlan).toMatchObject(validProviderResult.scenePlan);
    expect(result.scenePlan[0]?.groundingLineage).toMatchObject({
      storyVersionId: input.assetGrounding.storyVersionId,
      matchingResultId: input.assetGrounding.matchingResultId,
      evidence: [],
    });
    expect(callStructuredJsonModel).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: "ai_story_scene_plan_v1",
      certificationStage: "scene_plan",
    }));
    const structuredSchema = callStructuredJsonModel.mock.calls[0]?.[0]?.schema;
    expect(structuredSchema.safeParse({
      ...validProviderResult,
      scenePlan: [{
        ...validProviderResult.scenePlan[0],
        generationAuthority: {
          strategy: "FIRST_FRAME_IMAGE_TO_VIDEO",
          referenceSource: "SCENE_EXPLICIT",
          referenceAssetIds: [input.assetGrounding.bindings[0]?.assetId ?? "60000000-0000-4000-8000-000000000006"],
          firstFrameAssetId: input.assetGrounding.bindings[0]?.assetId ?? "60000000-0000-4000-8000-000000000006",
          productVisualIdentityRequirement: "NONE",
        },
      }],
    }).success).toBe(false);
  });

  it("fails closed on a provider decode issue", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: null, decodeIssue: "INVALID_JSON", usage: { input: 20, output: 10, costUsd: 0.01 } });

    await expect(generateScenePlan(input)).rejects.toThrow("SCENE_PLAN_INVALID_JSON");
  });

  it("removes unsupported appearance detail from existence-only model claims", () => {
    expect(normalizeExistenceOnlySceneGrounding([{
      sceneId: "scene-001",
      narrativeIntent: "Show the accepted restaurant name.",
      visualIntent: "Reference the visible restaurant name only.",
      evidence: [],
      visualClaims: [{
        subject: "Tapao Jom!",
        detail: "a neon storefront sign",
        evidenceLevel: "EXISTENCE_ONLY",
      }],
    }])[0]?.visualClaims[0]).toEqual({
      subject: "Tapao Jom!",
      detail: "Tapao Jom!",
      evidenceLevel: "EXISTENCE_ONLY",
    });
  });

  it("binds equal-length grounding selections to canonical Scene ids by plan order", () => {
    expect(bindSceneGroundingProposalIdsByPlanOrder({
      sceneIds: ["scene-001", "scene-002"],
      proposals: [
        { ...validProviderResult.groundingSelections[0]!, sceneId: "scene-1" },
        { ...validProviderResult.groundingSelections[0]!, sceneId: "scene-2" },
      ],
    }).map((proposal) => proposal.sceneId)).toEqual(["scene-001", "scene-002"]);
  });

  it("does not fabricate missing Scene grounding selections", () => {
    expect(bindSceneGroundingProposalIdsByPlanOrder({
      sceneIds: ["scene-001", "scene-002"],
      proposals: [validProviderResult.groundingSelections[0]!],
    })).toHaveLength(1);
  });

  it("fails closed when structured fields conflict with canonical generation authority", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: {
        scenePlan: [{
          ...validProviderResult.scenePlan[0],
          generationAuthority: {
            ...validProviderResult.scenePlan[0]!.generationAuthority,
            referenceSource: "SCENE_EXPLICIT",
          },
        }],
        groundingSelections: validProviderResult.groundingSelections,
      },
      usage: { input: 20, output: 10, costUsd: 0.01 },
    });

    await expect(generateScenePlan(input)).rejects.toThrow();
  });
});
