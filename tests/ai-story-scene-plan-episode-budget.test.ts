import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindSceneGroundingLineage } from "@ceo-agent/shared";

const callStructuredJsonModel = vi.hoisted(() => vi.fn());
vi.mock("../packages/agents/src/llm", () => ({
  callJsonModel: vi.fn(),
  callStructuredJsonModel,
}));

import {
  assertScenePlanEpisodeBudget,
  generateScenePlan,
  ScenePlanEpisodeBudgetError,
} from "../packages/agents/src/ai-story/story-planning-service";

const beats = (ids: string[]) => ids.map((id, order) => ({
  id,
  name: id,
  purpose: id,
  order,
  summary: id,
}));

const scene = (
  id: string,
  order: number,
  durationSec: number,
  beatIds: string[],
) => ({
  id,
  order,
  durationSec,
  beatIds,
});

const authority = {
  strategy: "TEXT_TO_VIDEO" as const,
  referenceSource: "REFERENCE_FREE_T2V" as const,
  referenceAssetIds: [] as string[],
  firstFrameAssetId: null,
  productVisualIdentityRequirement: "NONE" as const,
};

function providerScene(item: ReturnType<typeof scene>) {
  return {
    ...item,
    purpose: "Pack the meal",
    transition: "",
    continuityNotes: "",
    generationAuthority: authority,
  };
}

const id = (n: number) => `81000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

describe("assertScenePlanEpisodeBudget", () => {
  it("accepts a 25-second plan partitioned as 10, 10, and 5", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["opening", "packing", "finish"]),
      scenes: [
        scene("scene-001", 0, 10, ["opening"]),
        scene("scene-002", 1, 10, ["packing"]),
        scene("scene-003", 2, 5, ["finish"]),
      ],
    })).not.toThrow();
  });

  it("blocks a 40-second plan against a 25-second episode", () => {
    const scenes = [5, 10, 10, 5, 5, 5].map((durationSec, index) =>
      scene(`scene-00${index + 1}`, index, durationSec, [`beat-${index}`]),
    );
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(scenes.map((item) => item.beatIds[0]!)),
      scenes,
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_DURATION_BUDGET_INVALID" }));
    expect(scenes.map((item) => item.durationSec)).toEqual([5, 10, 10, 5, 5, 5]);
  });

  it("blocks one CTA beat copied onto three scenes", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["cta"]),
      scenes: [
        scene("scene-004", 0, 10, ["cta"]),
        scene("scene-005", 1, 10, ["cta"]),
        scene("scene-006", 2, 5, ["cta"]),
      ],
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_BEAT_DUPLICATED" }));
  });

  it("accepts every distinct beat owned exactly once", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["a", "b", "c", "d"]),
      scenes: [
        scene("scene-001", 0, 5, ["a"]),
        scene("scene-002", 1, 5, ["b"]),
        scene("scene-003", 2, 5, ["c"]),
        scene("scene-004", 3, 10, ["d"]),
      ],
    })).not.toThrow();
  });

  it("accepts one scene merging two different beats", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["prep", "fold", "finish"]),
      scenes: [
        scene("scene-001", 0, 10, ["prep", "fold"]),
        scene("scene-002", 1, 15, ["finish"]),
      ],
    })).not.toThrow();
  });

  it("blocks an unknown beat id", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["opening"]),
      scenes: [scene("scene-001", 0, 25, ["not-a-beat"])],
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_UNKNOWN_BEAT" }));
  });

  it("blocks a duplicate scene id", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["a", "b"]),
      scenes: [
        scene("scene-001", 0, 10, ["a"]),
        scene("scene-001", 1, 15, ["b"]),
      ],
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_DUPLICATE_ID" }));
  });

  it("blocks a non-sequential scene order", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["a", "b"]),
      scenes: [
        scene("scene-001", 0, 10, ["a"]),
        scene("scene-002", 2, 15, ["b"]),
      ],
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_ORDER_INVALID" }));
  });

  it("blocks a beat that the plan does not own", () => {
    expect(() => assertScenePlanEpisodeBudget({
      targetDurationSec: 25,
      beats: beats(["opening", "cta"]),
      scenes: [scene("scene-001", 0, 25, ["opening"])],
    })).toThrowError(expect.objectContaining({ code: "SCENE_PLAN_BEAT_COVERAGE_INVALID" }));
  });
});

describe("generateScenePlan episode duration authority", () => {
  const storyBeats = beats(["opening"]);
  const planInput = {
    story: {
      title: "Nasi Lemak packing",
      summary: "Yuki packs nasi lemak.",
      objective: "Show the pack",
      targetAudience: "Takeaway customers",
      tone: "Working",
      estimatedDuration: "about a minute",
      story: { opening: "Portions", development: "Fold", ending: "Ready" },
      keyMessages: [],
      cta: "Tapao",
      assetReferences: [],
      warnings: [],
    },
    creativeContext: {
      storyContext: {
        title: "Nasi Lemak packing",
        summary: "Yuki packs nasi lemak.",
        objective: "Show the pack",
        targetAudience: "Takeaway customers",
        tone: "Working",
        estimatedDuration: "about a minute",
        keyMessages: [],
        cta: "Tapao",
      },
      characterContext: { characters: [], relationships: [] },
      productAuthorities: [],
      worldContext: {
        locations: [],
        visualStyle: "",
        lighting: "",
        environment: "",
        objects: [],
        timeline: "",
        worldRules: [],
      },
      narrativeContext: { arc: "", pacing: "", emotionalJourney: "", themes: [], dialogue: [] },
      directorContext: {},
    },
    directorThinking: {
      coreMessage: "Pack",
      hero: "Yuki",
      conflict: "Time",
      turningPoint: "Fold",
      climax: "Close",
      takeaway: "Ready",
    },
    storyBeats,
  };

  beforeEach(() => {
    callStructuredJsonModel.mockReset();
  });

  it("keeps the historical path compatible when no episode duration is supplied", async () => {
    callStructuredJsonModel.mockResolvedValueOnce({
      result: { scenePlan: [providerScene(scene("scene-001", 0, 40, ["opening"]))] },
      usage: { input: 1, output: 1, costUsd: 0 },
    });
    const result = await generateScenePlan(planInput);
    expect(result.scenePlan.map((item) => item.durationSec)).toEqual([40]);
    const system = String(callStructuredJsonModel.mock.calls[0]?.[0]?.system);
    expect(system).not.toContain("Target Episode duration");
    expect(system.toLowerCase()).not.toContain("seedance");
  });

  it("rejects a provider plan that misses the episode duration without rewriting it", async () => {
    const returned = [providerScene(scene("scene-001", 0, 40, ["opening"]))];
    callStructuredJsonModel.mockResolvedValueOnce({
      result: { scenePlan: returned },
      usage: { input: 1, output: 1, costUsd: 0 },
    });
    await expect(generateScenePlan({
      ...planInput,
      targetDurationSec: 25,
      storyBrief: "Prefer 10 seconds, 10 seconds, and 5 seconds.",
    })).rejects.toBeInstanceOf(ScenePlanEpisodeBudgetError);
    expect(returned[0]?.durationSec).toBe(40);
    const request = callStructuredJsonModel.mock.calls[0]?.[0];
    const system = String(request.system);
    expect(system).toContain("Target Episode duration is exactly 25 seconds");
    expect(system).toContain("not a template for every story");
    expect(system).not.toContain("10s + 10s + 5s");
    expect(system.toLowerCase()).not.toContain("seedance");
    expect(String(request.user)).toContain("Prefer 10 seconds, 10 seconds, and 5 seconds.");
  });
});

describe("scene grounding authority", () => {
  const context = {
    contractVersion: "ai-story-scene-grounding-context.v1" as const,
    orgId: id(1),
    workspaceId: id(2),
    storyId: id(3),
    storyVersionId: id(4),
    matchingResultId: id(5),
    bindings: [{
      bindingId: id(6),
      assetId: id(7),
      role: "PRODUCT_AUTHORITY" as const,
      analysisSnapshotId: id(8),
      observedFacts: ["rice", "egg", "sambal", "peanuts", "paper"],
      namedItems: ["nasi lemak"],
      productCandidates: [{
        name: "nasi lemak",
        relationship: "PRIMARY_PRODUCT" as const,
        evidence: ["rice"],
      }],
    }],
  };

  it("keeps an observed product claim", () => {
    const lineage = bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-001"],
      proposals: [{
        sceneId: "scene-001",
        narrativeIntent: "Show the prepared portions",
        visualIntent: "Rice, egg, sambal, and peanuts on paper",
        evidence: [{ bindingId: id(6), groundedFacts: ["rice", "egg"] }],
        visualClaims: [{ subject: "nasi lemak", detail: "nasi lemak", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    });
    expect(lineage.get("scene-001")?.visualClaims[0]).toEqual({
      subject: "nasi lemak",
      detail: "nasi lemak",
      evidenceLevel: "EXISTENCE_ONLY",
    });
  });

  it("rejects a character name that the product binding does not observe", () => {
    expect(() => bindSceneGroundingLineage({
      context,
      sceneIds: ["scene-001"],
      proposals: [{
        sceneId: "scene-001",
        narrativeIntent: "Yuki starts packing",
        visualIntent: "Hands fold the paper",
        evidence: [{ bindingId: id(6), groundedFacts: ["paper"] }],
        visualClaims: [{ subject: "Yuki", detail: "Yuki", evidenceLevel: "EXISTENCE_ONLY" }],
      }],
    })).toThrow(/unsupported visual subject Yuki/);
  });
});

describe("episode scene-plan wiring", () => {
  it("passes episode requested duration into scene planning", () => {
    const runner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    expect(runner).toContain("targetDurationSec: episodeIntent.data.requestedDurationSec");
    expect(runner).not.toContain("10, 10, 5");
    expect(runner).not.toContain("[10, 10, 5]");
  });
});
