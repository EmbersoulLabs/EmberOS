import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_STORY_RETRY_PROVIDER_MODES,
  AI_STORY_SCENE_EXECUTION_MODES,
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  AI_STORY_VIDEO_ANALYSIS_PROVIDER_CALLS,
  AI_STORY_VIDEO_ANALYSIS_PROVIDER_COST_USD,
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER,
  classifyAiStoryVideoAssetAnalysis,
  createVideoAssetAnalysisRecord,
  parseBoundedVideoUserIntent,
  resolveReusableVideoAssetAnalysis,
  routeAiStoryVideoPlanningStrategy,
  sourcePhotoSentToVideoProviderForDna,
  videoAssetAnalysisReuseKey,
  type AiStoryVideoAssetObservation,
} from "@ceo-agent/shared";

const id = (n: number) => `d4000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"ab".repeat(32)}`;
const otherHash = `sha256:${"cd".repeat(32)}`;

function observation(overrides?: Partial<AiStoryVideoAssetObservation>): AiStoryVideoAssetObservation {
  return {
    videoAssetId: id(1),
    contentHash: hash,
    durationMs: 4000,
    durationSec: 4,
    width: 720,
    height: 1280,
    fps: 24,
    orgId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    shotCountEstimate: 1,
    dominantShotType: "MEDIUM",
    cameraMotion: "STATIC",
    compositionStability: "STABLE",
    framingSummary: "Hands writing on a notebook.",
    oneContinuousShot: true,
    abruptCuts: false,
    primaryActionSummary: "A person writes an invoice by hand.",
    actionTags: ["WRITING"],
    actionReferenceStrength: true,
    handMotionImportant: true,
    bodyPostureImportant: true,
    interactionTimingImportant: false,
    environmentSummary: "A plain desk without a distinctive place.",
    environmentTags: ["OFFICE_DESK"],
    environmentReferenceStrength: false,
    layoutImportant: false,
    lightingMoodImportant: false,
    signageIdentityVisible: false,
    backgroundClutterImportant: false,
    visiblePeopleEstimate: 1,
    primaryPersonPresent: true,
    personCentric: true,
    humanIsReplaceableActionReference: true,
    identityFidelityImportant: false,
    strictMotionPreservationMatters: false,
    strictTimelinePreservationMatters: false,
    strictShotStructureMatters: false,
    subjectReplacementLikely: false,
    canUseAsExistingVideo: false,
    existingVideoSuitabilityReason: "The clip is source material for a new generation.",
    requiresGenerationToBeUseful: true,
    qualityRiskFlags: [],
    analyzedAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("video asset analysis and strategy router", () => {
  it("classifies a writing clip as an action reference", () => {
    const analysis = classifyAiStoryVideoAssetAnalysis(observation());
    expect(analysis.recommendedReferenceUse).toBe("ACTION_REFERENCE");
    expect(analysis.couldBeStrictV2vCandidateIfProviderExists).toBe(false);
  });

  it("classifies a street or storefront clip as an environment reference", () => {
    const analysis = classifyAiStoryVideoAssetAnalysis(observation({
      framingSummary: "A quiet shop front on a street.",
      primaryActionSummary: "No person performs an action.",
      actionTags: [],
      actionReferenceStrength: false,
      handMotionImportant: false,
      bodyPostureImportant: false,
      environmentSummary: "A storefront facing the street.",
      environmentTags: ["STREET", "SHOP_FRONT"],
      environmentReferenceStrength: true,
      layoutImportant: true,
      lightingMoodImportant: true,
      signageIdentityVisible: true,
      visiblePeopleEstimate: 0,
      primaryPersonPresent: false,
      personCentric: false,
      humanIsReplaceableActionReference: false,
      dominantShotType: "WIDE",
      cameraMotion: "SLOW_PAN",
    }));
    expect(analysis.recommendedReferenceUse).toBe("ENVIRONMENT_REFERENCE");
  });

  it("classifies writing at a distinctive counter as action and environment", () => {
    const analysis = classifyAiStoryVideoAssetAnalysis(observation({
      framingSummary: "A person writes at a florist counter.",
      environmentSummary: "A distinctive florist counter with visible shop identity.",
      environmentTags: ["FLORIST_COUNTER"],
      environmentReferenceStrength: true,
      layoutImportant: true,
      signageIdentityVisible: true,
    }));
    expect(analysis.recommendedReferenceUse).toBe("ACTION_AND_ENVIRONMENT_REFERENCE");
  });

  it("classifies a polished final clip as existing video", () => {
    const analysis = classifyAiStoryVideoAssetAnalysis(observation({
      primaryActionSummary: "A finished promo already shows the needed scene.",
      canUseAsExistingVideo: true,
      existingVideoSuitabilityReason: "Finished promo already matches the needed scene.",
      requiresGenerationToBeUseful: false,
    }));
    expect(analysis.recommendedReferenceUse).toBe("EXISTING_VIDEO");
  });

  it("reserves strict V2V for tight motion preservation and not for generic walking", () => {
    const tight = classifyAiStoryVideoAssetAnalysis(observation({
      primaryActionSummary: "A person completes a timed handoff on a fixed shot.",
      actionTags: ["HANDING_ITEM"],
      interactionTimingImportant: true,
      identityFidelityImportant: true,
      strictMotionPreservationMatters: true,
      strictTimelinePreservationMatters: true,
      strictShotStructureMatters: true,
      subjectReplacementLikely: true,
      cameraMotion: "SLOW_PUSH",
    }));
    const walking = classifyAiStoryVideoAssetAnalysis(observation({
      primaryActionSummary: "A person walks down a street.",
      actionTags: ["WALKING"],
      handMotionImportant: false,
      bodyPostureImportant: false,
      strictMotionPreservationMatters: false,
      subjectReplacementLikely: false,
    }));
    expect(tight.recommendedReferenceUse).toBe("STRICT_V2V_CANDIDATE");
    expect(tight.couldBeStrictV2vCandidateIfProviderExists).toBe(true);
    expect(walking.recommendedReferenceUse).toBe("ACTION_REFERENCE");
  });

  it("classifies a poor or meaningless clip as unsuitable", () => {
    const analysis = classifyAiStoryVideoAssetAnalysis(observation({
      primaryActionSummary: "The picture is too blurred to read.",
      actionTags: [],
      actionReferenceStrength: false,
      handMotionImportant: false,
      bodyPostureImportant: false,
      qualityRiskFlags: ["TOO_BLURRY", "TOO_CHAOTIC", "MEANINGLESS"],
    }));
    expect(analysis.recommendedReferenceUse).toBe("UNSUITABLE_VIDEO_REFERENCE");
  });

  it("routes each reference class to a provider-neutral planning strategy", () => {
    const cases = [
      [observation(), "GENERATE_WITH_ACTION_REFERENCE"],
      [observation({
        actionTags: [],
        actionReferenceStrength: false,
        handMotionImportant: false,
        bodyPostureImportant: false,
        primaryPersonPresent: false,
        personCentric: false,
        environmentReferenceStrength: true,
        environmentTags: ["STREET"],
        environmentSummary: "A street outside a shop.",
      }), "GENERATE_WITH_ENVIRONMENT_REFERENCE"],
      [observation({
        environmentReferenceStrength: true,
        environmentTags: ["FLORIST_COUNTER"],
        environmentSummary: "A florist counter.",
        layoutImportant: true,
      }), "GENERATE_WITH_ACTION_AND_ENVIRONMENT_REFERENCE"],
      [observation({
        canUseAsExistingVideo: true,
        requiresGenerationToBeUseful: false,
        existingVideoSuitabilityReason: "Finished promo already matches the needed scene.",
      }), "USE_AS_EXISTING_VIDEO"],
      [observation({
        strictMotionPreservationMatters: true,
        strictTimelinePreservationMatters: true,
        strictShotStructureMatters: true,
        subjectReplacementLikely: true,
        interactionTimingImportant: true,
      }), "REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE"],
      [observation({
        actionTags: [],
        actionReferenceStrength: false,
        handMotionImportant: false,
        qualityRiskFlags: ["TOO_BLURRY"],
      }), "IGNORE_AS_REFERENCE"],
    ] as const;
    for (const [facts, strategy] of cases) {
      const route = routeAiStoryVideoPlanningStrategy({
        analysis: classifyAiStoryVideoAssetAnalysis(facts),
        executionContext: { strictV2vProviderAvailable: false, episodeId: id(8) },
      });
      expect(route.strategy).toBe(strategy);
      expect(route.dispatched).toBe(false);
      expect(route.providerCalls).toBe(0);
    }
  });

  it("lets a bounded environment or action intent bias a combined clip", () => {
    const combined = classifyAiStoryVideoAssetAnalysis(observation({
      environmentReferenceStrength: true,
      environmentTags: ["FLORIST_COUNTER", "SHOP_FRONT"],
      environmentSummary: "A florist counter on a shop street.",
      layoutImportant: true,
      signageIdentityVisible: true,
    }));
    expect(parseBoundedVideoUserIntent("keep the environment")).toBe("KEEP_ENVIRONMENT");
    expect(parseBoundedVideoUserIntent("use this street")).toBe("KEEP_ENVIRONMENT");
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: combined,
      userIntent: "use this street",
    }).strategy).toBe("GENERATE_WITH_ENVIRONMENT_REFERENCE");
    expect(parseBoundedVideoUserIntent("follow this hand action")).toBe("FOLLOW_HAND_ACTION");
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: combined,
      userIntent: "follow this hand action",
    }).strategy).toBe("GENERATE_WITH_ACTION_REFERENCE");
    expect(parseBoundedVideoUserIntent("make it cinematic and change everything")).toBeNull();
  });

  it("uses a direct-use intent only when the clip is valid final media", () => {
    const writing = classifyAiStoryVideoAssetAnalysis(observation());
    const directlyUsable = {
      ...writing,
      canUseAsExistingVideo: true,
    };
    expect(parseBoundedVideoUserIntent("just use this video directly")).toBe("USE_VIDEO_DIRECTLY");
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: directlyUsable,
      userIntent: "just use this video directly",
    }).strategy).toBe("USE_AS_EXISTING_VIDEO");
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: writing,
      userIntent: "just use this video directly",
    }).strategy).toBe("GENERATE_WITH_ACTION_REFERENCE");
    const poor = classifyAiStoryVideoAssetAnalysis(observation({
      qualityRiskFlags: ["CORRUPTED"],
      actionReferenceStrength: false,
      actionTags: [],
    }));
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: poor,
      userIntent: "just use this video directly",
    }).strategy).toBe("IGNORE_AS_REFERENCE");
  });

  it("routes a same-motion person replacement intent to strict V2V handling without a Provider", () => {
    const writing = classifyAiStoryVideoAssetAnalysis(observation());
    const route = routeAiStoryVideoPlanningStrategy({
      analysis: writing,
      userIntent: "same motion, just replace person",
      executionContext: { strictV2vProviderAvailable: false, sceneId: id(9), episodeId: id(10) },
    });
    expect(route.strategy).toBe("REQUEST_STRICT_V2V_IF_PROVIDER_AVAILABLE");
    expect(route.strictV2vProviderAvailable).toBe(false);
    expect(route.providerCalls).toBe(0);
    expect(route.providerCostUsd).toBe(0);
    const street = classifyAiStoryVideoAssetAnalysis(observation({
      actionTags: [],
      actionReferenceStrength: false,
      handMotionImportant: false,
      bodyPostureImportant: false,
      primaryPersonPresent: false,
      personCentric: false,
      visiblePeopleEstimate: 0,
      environmentReferenceStrength: true,
      environmentTags: ["STREET"],
      environmentSummary: "An empty street.",
    }));
    expect(routeAiStoryVideoPlanningStrategy({
      analysis: street,
      userIntent: "same video, just replace person",
    }).strategy).toBe("GENERATE_WITH_ENVIRONMENT_REFERENCE");
  });

  it("reuses one stored analysis across episodes and recomputes only when identity or version changes", () => {
    let calls = 0;
    const facts = observation();
    const first = resolveReusableVideoAssetAnalysis({
      stored: null,
      observation: facts,
      analyze: (value) => {
        calls += 1;
        return classifyAiStoryVideoAssetAnalysis(value);
      },
    });
    const second = resolveReusableVideoAssetAnalysis({
      stored: first.analysis,
      observation: facts,
      analyze: () => {
        calls += 1;
        throw new Error("stored analysis must not be recomputed");
      },
    });
    const episodeA = routeAiStoryVideoPlanningStrategy({
      analysis: second.analysis,
      executionContext: { episodeId: id(11) },
    });
    const episodeB = routeAiStoryVideoPlanningStrategy({
      analysis: second.analysis,
      executionContext: { episodeId: id(12) },
    });
    expect(first.reused).toBe(false);
    expect(first.invalidationReason).toBe("NOT_STORED");
    expect(second.reused).toBe(true);
    expect(second.invalidationReason).toBeNull();
    expect(calls).toBe(1);
    expect(episodeA.reuseKey).toBe(episodeB.reuseKey);
    expect(episodeA.reusedAnalysis).toBe(true);
    expect(episodeA.strategy).toBe("GENERATE_WITH_ACTION_REFERENCE");

    const hashChanged = resolveReusableVideoAssetAnalysis({
      stored: first.analysis,
      observation: observation({ contentHash: otherHash }),
      analyze: (value) => {
        calls += 1;
        return classifyAiStoryVideoAssetAnalysis(value);
      },
    });
    expect(hashChanged.reused).toBe(false);
    expect(hashChanged.invalidationReason).toBe("CONTENT_HASH_CHANGED");

    const versionChanged = resolveReusableVideoAssetAnalysis({
      stored: {
        videoAssetId: facts.videoAssetId,
        workspaceId: facts.workspaceId,
        contentHash: facts.contentHash,
        analysisVersion: "ai-story-video-asset-analysis.v0",
      },
      observation: facts,
      analyze: (value) => {
        calls += 1;
        return classifyAiStoryVideoAssetAnalysis(value);
      },
    });
    expect(versionChanged.reused).toBe(false);
    expect(versionChanged.invalidationReason).toBe("ANALYSIS_VERSION_CHANGED");
    expect(calls).toBe(3);

    const record = createVideoAssetAnalysisRecord(first.analysis, "2026-09-24T00:01:00.000Z");
    expect(record.reuseKey).toBe(videoAssetAnalysisReuseKey(first.analysis));
    expect(record.analysisVersion).toBe(AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION);
    expect(record.analysis).toEqual(first.analysis);
  });

  it("leaves T2V, I2V, and Character DNA contracts unchanged and makes no Provider call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const analysis = classifyAiStoryVideoAssetAnalysis(observation());
    routeAiStoryVideoPlanningStrategy({ analysis });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(AI_STORY_VIDEO_ANALYSIS_PROVIDER_CALLS).toBe(0);
    expect(AI_STORY_VIDEO_ANALYSIS_PROVIDER_COST_USD).toBe(0);
    expect(AI_STORY_SCENE_EXECUTION_MODES).toEqual(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]);
    expect(AI_STORY_SCENE_GENERATION_STRATEGIES).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(AI_STORY_RETRY_PROVIDER_MODES).toEqual(["REFERENCE_FREE_T2V", "FIRST_FRAME_I2V"]);
    expect(SOURCE_PHOTO_EXCLUDED_FROM_VIDEO_PROVIDER).toBe("CERTIFIED");
    expect(sourcePhotoSentToVideoProviderForDna()).toBe(false);
    const seedance = readFileSync("packages/agents/src/ai-story/seedance-request-mapping.ts", "utf8");
    const dna = readFileSync("packages/shared/src/ai-story-character-dna.ts", "utf8");
    const analysisSource = readFileSync("packages/shared/src/ai-story-video-asset-analysis.ts", "utf8");
    const routerSource = readFileSync("packages/shared/src/ai-story-video-strategy-router.ts", "utf8");
    expect(seedance).toContain(
      'enum(["PRODUCT_GROUNDED_VIDEO", "CREATIVE_T2V", "TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"])',
    );
    expect(dna).not.toContain("GENERATE_WITH_ACTION_REFERENCE");
    for (const source of [analysisSource, routerSource]) {
      expect(source).not.toContain("fetch(");
      expect(source.toLowerCase()).not.toContain("seedance");
      expect(source.toLowerCase()).not.toContain("runway");
      expect(source.toLowerCase()).not.toContain("settle");
    }
  });
});
