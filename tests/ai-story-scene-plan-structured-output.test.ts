import { beforeEach, describe, expect, it, vi } from "vitest";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callJsonModel: vi.fn(),
  callStructuredJsonModel,
}));

import { generateScenePlan } from "../packages/agents/src/ai-story/story-planning-service";

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
};

describe("AI Story Scene Plan strict structured output", () => {
  beforeEach(() => callStructuredJsonModel.mockReset());

  it("uses the strict provider schema and accepts a canonical scene plan", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: validProviderResult, usage: { input: 20, output: 10, costUsd: 0.01 } });

    const result = await generateScenePlan(input);

    expect(result.scenePlan).toEqual(validProviderResult.scenePlan);
    expect(callStructuredJsonModel).toHaveBeenCalledWith(expect.objectContaining({
      schemaName: "ai_story_scene_plan_v1",
      certificationStage: "scene_plan",
    }));
  });

  it("fails closed on a provider decode issue", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({ result: null, decodeIssue: "INVALID_JSON", usage: { input: 20, output: 10, costUsd: 0.01 } });

    await expect(generateScenePlan(input)).rejects.toThrow("SCENE_PLAN_INVALID_JSON");
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
      },
      usage: { input: 20, output: 10, costUsd: 0.01 },
    });

    await expect(generateScenePlan(input)).rejects.toThrow();
  });
});
