import { describe, expect, it } from "vitest";
import {
  AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION,
  AI_STORY_V2V_DURATION_RELATIONSHIP,
  AiStoryRecommendedDurationError,
  localGenerationDurationSecFromPlannedDurationMs,
  plannedDurationMatchesRecommendedDuration,
  projectRecommendedStoryRuntimeSec,
  type RecommendedDurationResolveInput,
} from "@ceo-agent/shared";
import { buildAiStoryRecommendedDurationAuthority } from "@ceo-agent/shared/server";

const ORG = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const STORY = "44444444-4444-4444-8444-444444444444";
const STORY_VERSION = "55555555-5555-4555-8555-555555555555";
const PACKAGE_ID = "66666666-6666-4666-8666-666666666666";
const SCENE = "77777777-7777-4777-8777-777777777777";

function input(
  overrides: Partial<RecommendedDurationResolveInput> = {}
): RecommendedDurationResolveInput {
  return {
    organizationId: ORG,
    workspaceId: WORKSPACE,
    campaignId: CAMPAIGN,
    storyId: STORY,
    storyVersionId: STORY_VERSION,
    animationPackageId: PACKAGE_ID,
    sceneId: SCENE,
    planningSceneId: "scene-001",
    sceneOrder: 0,
    generationStrategy: "TEXT_TO_VIDEO",
    sceneProposedDurationSec: 6,
    shots: [
      { shotId: "shot-a", planningSceneId: "scene-001", durationSec: 3 },
      { shotId: "shot-b", planningSceneId: "scene-001", durationSec: 4 },
    ],
    ...overrides,
  };
}

const FORBIDDEN_CONTRACT_TERMS = [
  "minimax",
  "seedance",
  "runway",
  "comfyui",
  "modelid",
  "providerid",
];

describe("Recommended Duration V1", () => {
  it("repeats the same recommendation, fingerprint, and authority id", () => {
    const first = buildAiStoryRecommendedDurationAuthority(input());
    const second = buildAiStoryRecommendedDurationAuthority(input());
    expect(first.contractVersion).toBe(AI_STORY_RECOMMENDED_DURATION_AUTHORITY_VERSION);
    expect(first.decision).toEqual(second.decision);
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
    expect(first.authorityId).toBe(second.authorityId);
  });

  it("uses ordered shot timing instead of the scene proposal", () => {
    const authority = buildAiStoryRecommendedDurationAuthority(input());
    expect(authority.decision).toMatchObject({
      resolution: "SHOT_TIMING",
      recommendedDurationSec: 7,
      plannedDurationMs: 7000,
      reasonCodes: ["SHOT_DURATION_TOTAL"],
    });
    expect(authority.inputs.sceneProposedDurationSec).toBe(6);
  });

  it("falls back to the scene proposal when no shot timing exists", () => {
    const authority = buildAiStoryRecommendedDurationAuthority(
      input({ sceneProposedDurationSec: 10, shots: [] })
    );
    expect(authority.decision).toMatchObject({
      resolution: "SCENE_PLAN_FALLBACK",
      recommendedDurationSec: 10,
      plannedDurationMs: 10000,
      reasonCodes: ["SCENE_PLAN_DURATION"],
    });
  });

  it("fails closed for non-positive and non-finite timing", () => {
    for (const durationSec of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buildAiStoryRecommendedDurationAuthority(
          input({
            shots: [
              { shotId: "shot-a", planningSceneId: "scene-001", durationSec },
            ],
          })
        )
      ).toThrow(AiStoryRecommendedDurationError);
    }
    expect(() =>
      buildAiStoryRecommendedDurationAuthority(
        input({ sceneProposedDurationSec: 0, shots: [] })
      )
    ).toThrow(AiStoryRecommendedDurationError);
  });

  it("keeps source-owned duration ahead of planner proposals", () => {
    const authority = buildAiStoryRecommendedDurationAuthority(
      input({
        generationStrategy: "VIDEO_TO_VIDEO",
        sourceDurationLocked: true,
        sourceDurationSec: 10,
        sourceDurationMs: 10000,
      })
    );
    expect(AI_STORY_V2V_DURATION_RELATIONSHIP).toBe("OUTPUT_DURATION_FOLLOWS_SOURCE");
    expect(authority.decision).toMatchObject({
      resolution: "SOURCE_LOCKED",
      recommendedDurationSec: 10,
      plannedDurationMs: 10000,
      reasonCodes: ["OUTPUT_DURATION_FOLLOWS_SOURCE"],
    });
    expect(() =>
      buildAiStoryRecommendedDurationAuthority(
        input({ generationStrategy: "VIDEO_TO_VIDEO", shots: [] })
      )
    ).toThrow(AiStoryRecommendedDurationError);
  });

  it("rejects an execution plan whose planned duration disagrees with the authority", () => {
    const authority = buildAiStoryRecommendedDurationAuthority(
      input({ sceneProposedDurationSec: 8, shots: [] })
    );
    expect(authority.decision.plannedDurationMs).toBe(8000);
    expect(plannedDurationMatchesRecommendedDuration(authority, 8000)).toBe(true);
    expect(plannedDurationMatchesRecommendedDuration(authority, 10000)).toBe(false);
  });

  it("projects local package duration from the canonical planned duration", () => {
    const shotAuthority = buildAiStoryRecommendedDurationAuthority(
      input({
        sceneProposedDurationSec: 6,
        shots: [
          { shotId: "shot-a", planningSceneId: "scene-001", durationSec: 3 },
          { shotId: "shot-b", planningSceneId: "scene-001", durationSec: 5 },
        ],
      })
    );
    expect(shotAuthority.decision.recommendedDurationSec).toBe(8);
    expect(shotAuthority.decision.plannedDurationMs).toBe(8000);
    expect(
      localGenerationDurationSecFromPlannedDurationMs(shotAuthority.decision.plannedDurationMs)
    ).toBe(8);
    expect(
      localGenerationDurationSecFromPlannedDurationMs(shotAuthority.decision.plannedDurationMs)
    ).toBe(shotAuthority.decision.recommendedDurationSec);
    expect(
      localGenerationDurationSecFromPlannedDurationMs(shotAuthority.decision.plannedDurationMs)
    ).not.toBe(shotAuthority.inputs.sceneProposedDurationSec);
  });

  it("sums scene recommendations into a story runtime projection", () => {
    const scenes = [8, 10, 6].map((durationSec, index) =>
      buildAiStoryRecommendedDurationAuthority(
        input({
          sceneOrder: index,
          sceneId: `77777777-7777-4777-8777-77777777777${index}`,
          sceneProposedDurationSec: durationSec,
          shots: [],
        })
      )
    );
    expect(
      projectRecommendedStoryRuntimeSec(
        scenes.map((scene) => scene.decision.recommendedDurationSec)
      )
    ).toBe(24);
    const again = projectRecommendedStoryRuntimeSec(
      scenes.map((scene) => scene.decision.recommendedDurationSec)
    );
    expect(again).toBe(24);
  });

  it("does not treat the story estimate hint as execution authority", () => {
    const estimatedDuration = "about one minute";
    const revisedEstimate = "about two minutes";
    const first = buildAiStoryRecommendedDurationAuthority(input());
    const second = buildAiStoryRecommendedDurationAuthority(input());
    expect(estimatedDuration).not.toBe(revisedEstimate);
    expect(first.semanticFingerprint).toBe(second.semanticFingerprint);
    expect(JSON.stringify(first)).not.toContain(estimatedDuration);
    expect(JSON.stringify(second)).not.toContain(revisedEstimate);
  });

  it("changes the fingerprint when duration evidence or identity changes", () => {
    const base = buildAiStoryRecommendedDurationAuthority(input());
    const shotChanged = buildAiStoryRecommendedDurationAuthority(
      input({
        shots: [
          { shotId: "shot-a", planningSceneId: "scene-001", durationSec: 3 },
          { shotId: "shot-b", planningSceneId: "scene-001", durationSec: 5 },
        ],
      })
    );
    const sceneFallbackChanged = buildAiStoryRecommendedDurationAuthority(
      input({ sceneProposedDurationSec: 9, shots: [] })
    );
    const sceneFallbackBase = buildAiStoryRecommendedDurationAuthority(
      input({ shots: [] })
    );
    const storyVersionChanged = buildAiStoryRecommendedDurationAuthority(
      input({ storyVersionId: "55555555-5555-4555-8555-555555555556" })
    );
    const sceneChanged = buildAiStoryRecommendedDurationAuthority(
      input({ sceneId: "77777777-7777-4777-8777-777777777778" })
    );
    expect(shotChanged.semanticFingerprint).not.toBe(base.semanticFingerprint);
    expect(shotChanged.authorityId).not.toBe(base.authorityId);
    expect(sceneFallbackChanged.semanticFingerprint).not.toBe(
      sceneFallbackBase.semanticFingerprint
    );
    expect(storyVersionChanged.semanticFingerprint).not.toBe(base.semanticFingerprint);
    expect(sceneChanged.semanticFingerprint).not.toBe(base.semanticFingerprint);
  });

  it("rejects shot evidence from another story version or scene", () => {
    expect(() =>
      buildAiStoryRecommendedDurationAuthority(
        input({
          shots: [
            {
              shotId: "shot-a",
              planningSceneId: "scene-001",
              durationSec: 3,
              storyVersionId: "55555555-5555-4555-8555-555555555556",
            },
          ],
        })
      )
    ).toThrow(AiStoryRecommendedDurationError);
    expect(() =>
      buildAiStoryRecommendedDurationAuthority(
        input({
          shots: [
            { shotId: "shot-a", planningSceneId: "scene-other", durationSec: 3 },
          ],
        })
      )
    ).toThrow(AiStoryRecommendedDurationError);
  });

  it("keeps provider and model identity out of the authority", () => {
    const authority = buildAiStoryRecommendedDurationAuthority(input());
    const serialized = JSON.stringify(authority).toLowerCase();
    for (const term of FORBIDDEN_CONTRACT_TERMS) {
      expect(serialized).not.toContain(term);
    }
  });
});
