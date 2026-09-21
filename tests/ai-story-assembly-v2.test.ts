import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_FINAL_ASSEMBLY_V2,
  ASSEMBLY_V1_BACKWARD_COMPATIBILITY,
  ASSEMBLY_V2_CHANGES_COMMERCIAL_AUTHORITY,
  ASSEMBLY_V2_DISPATCHES_PROVIDER,
  ASSEMBLY_GENERATES_NATIVE_AUDIO,
  ASSEMBLY_V2_GENERATES_AUDIO,
  ASSEMBLY_V2_MUXES_NATIVE_AUDIO_IN_FINAL_OUTPUT,
  ASSEMBLY_V2_ORDERS_NATIVE_AUDIO_WITH_EDITORIAL_TIMELINE,
  ASSEMBLY_V2_PRESERVES_NATIVE_AUDIO,
  ASSEMBLY_V2_PRESERVES_NATIVE_SOURCE_AUDIO,
  ASSEMBLY_V2_TRIMS_NATIVE_AUDIO_IN_SYNC_WITH_VIDEO,
  NATIVE_DIALOGUE_AUDIO_PRESERVATION,
  AUDIO_PLAN,
  AUTHORIZED_VISUAL_TRANSITION_EXECUTION,
  COMMERCIAL_PAYOFF_MEDIA_EXECUTION,
  EDITORIAL_OMISSION_EXECUTION,
  EDITORIAL_ORDER_EXECUTION,
  EDITORIAL_PLAN_MEDIA_EXECUTION,
  EDITORIAL_TRIM_EXECUTION,
  FINAL_STORY_ASSEMBLY_V2,
  FINAL_STORY_ASSEMBLY_V2_EXECUTION,
  FINAL_STORY_ASSEMBLY_V2_VIDEO_ONLY,
  HARD_CUT_EXECUTION,
  MULTI_SHOT_FINAL_ASSEMBLY,
  READY_FOR_ASSEMBLY_V2_REVIEW,
  READY_FOR_PRODUCTION_MERGE_ASSEMBLY_V2,
  SCENE_BRIDGE_MEDIA_EXECUTION,
  AiStoryAssemblyV2PlanSchema,
  selectAiStoryAssemblyRoute,
} from "@ceo-agent/shared";
import {
  AiStoryAssemblyV2PlanError,
  compileAiStoryAssemblyV2Plan,
  computeAiStoryAssemblyV2Fingerprint,
  computeAiStoryNarrativeEditorialPlanFingerprint,
} from "@ceo-agent/shared/server";
import { buildAssemblyV2Fixture } from "./helpers/ai-story-assembly-v2-fixture";

const source = (index: number) => ({
  path: `unused-${index}.mp4`,
  hash: `sha256:${index.toString(16).padStart(64, "0")}`,
  durationMs: 6000,
  width: 320,
  height: 180,
  frameRate: 30,
});

function criticalFixture() {
  return buildAssemblyV2Fixture({
    sources: [source(1), source(2), source(3)],
    entries: [
      { sourceIndex: 0, role: "ACTION", durationSeconds: 2 },
      { sourceIndex: 2, role: "PAYOFF", durationSeconds: 2.5 },
    ],
    omittedSourceIndexes: [1],
    profileId: "PRODUCT_STORY",
    base: 1_000,
  });
}

describe("AI Story Final Assembly V2 authority", () => {
  it("certifies native source-audio preservation without generating audio or changing commercial authority", () => {
    expect(AI_STORY_FINAL_ASSEMBLY_V2).toBe("CERTIFIED");
    expect(EDITORIAL_PLAN_MEDIA_EXECUTION).toBe("CERTIFIED");
    expect(EDITORIAL_TRIM_EXECUTION).toBe("CERTIFIED");
    expect(EDITORIAL_ORDER_EXECUTION).toBe("CERTIFIED");
    expect(EDITORIAL_OMISSION_EXECUTION).toBe("CERTIFIED");
    expect(HARD_CUT_EXECUTION).toBe("CERTIFIED");
    expect(AUTHORIZED_VISUAL_TRANSITION_EXECUTION).toBe("CERTIFIED");
    expect(SCENE_BRIDGE_MEDIA_EXECUTION).toBe("CERTIFIED");
    expect(COMMERCIAL_PAYOFF_MEDIA_EXECUTION).toBe("CERTIFIED");
    expect(MULTI_SHOT_FINAL_ASSEMBLY).toBe("CERTIFIED");
    expect(ASSEMBLY_V1_BACKWARD_COMPATIBILITY).toBe("CERTIFIED");
    expect(FINAL_STORY_ASSEMBLY_V2).toBe("CERTIFIED");
    expect(FINAL_STORY_ASSEMBLY_V2_EXECUTION).toBe("CERTIFIED");
    expect(FINAL_STORY_ASSEMBLY_V2_VIDEO_ONLY).toBe(true);
    expect(ASSEMBLY_GENERATES_NATIVE_AUDIO).toBe(false);
    expect(ASSEMBLY_V2_GENERATES_AUDIO).toBe(false);
    expect(ASSEMBLY_V2_PRESERVES_NATIVE_AUDIO).toBe(true);
    expect(ASSEMBLY_V2_PRESERVES_NATIVE_SOURCE_AUDIO).toBe(true);
    expect(ASSEMBLY_V2_TRIMS_NATIVE_AUDIO_IN_SYNC_WITH_VIDEO).toBe(true);
    expect(ASSEMBLY_V2_ORDERS_NATIVE_AUDIO_WITH_EDITORIAL_TIMELINE).toBe(true);
    expect(ASSEMBLY_V2_MUXES_NATIVE_AUDIO_IN_FINAL_OUTPUT).toBe(true);
    expect(NATIVE_DIALOGUE_AUDIO_PRESERVATION).not.toMatch(/GENERATION/);
    expect(ASSEMBLY_V2_DISPATCHES_PROVIDER).toBe(false);
    expect(ASSEMBLY_V2_CHANGES_COMMERCIAL_AUTHORITY).toBe(false);
    expect(AUDIO_PLAN).toBe("CERTIFIED");
    expect(READY_FOR_ASSEMBLY_V2_REVIEW).toBe("PASS");
    expect(READY_FOR_PRODUCTION_MERGE_ASSEMBLY_V2).toBe(
      "PENDING_PR140_PR141_PR142_PR143_AND_HUMAN_AUTHORIZATION"
    );
  });

  it("ASSEMBLY_V2_PLAN_SCHEMA PASS", () => {
    const plan = criticalFixture().compile();
    expect(AiStoryAssemblyV2PlanSchema.parse(plan)).toEqual(plan);
    expect(plan.assemblyRoute).toBe("ASSEMBLY_V2_EDITORIAL");
    expect(plan.videoOnly).toBe(true);
  });

  it("ASSEMBLY_V2_FINGERPRINT DETERMINISM PASS", () => {
    const fixture = criticalFixture();
    const first = fixture.compile();
    const second = fixture.compile();
    expect(second.assemblyFingerprint).toBe(first.assemblyFingerprint);
    expect(second.assemblyV2PlanId).toBe(first.assemblyV2PlanId);
    expect(computeAiStoryAssemblyV2Fingerprint(first)).toBe(
      first.assemblyFingerprint
    );
  });

  it("EDITORIAL_PLAN_EXACT_BINDING and SOURCE_HASH_BINDING PASS", () => {
    const fixture = criticalFixture();
    const plan = fixture.compile();
    for (const entry of plan.resolvedTimeline) {
      const sourceMedia = fixture.acceptedSourceMedia.find(
        (sourceMedia) => sourceMedia.sourceResultId === entry.sourceResultId
      )!;
      const unit = fixture.units.find(
        (candidate) => candidate.generationUnitId === entry.generationUnitId
      )!;
      expect(entry.generationUnitId).toBe(sourceMedia.generationUnitId);
      expect(entry.directorShotId).toBe(unit.directorShotId);
      expect(entry.sourceContentHash).toBe(sourceMedia.contentHash);
    }
  });

  it("USE_DISPOSITION, OMIT_DISPOSITION, TRIM_RANGE, and SOURCE_DURATION_NOT_FINAL_DURATION PASS", () => {
    const fixture = criticalFixture();
    const plan = fixture.compile();
    expect(plan.resolvedTimeline).toHaveLength(2);
    expect(plan.omittedGenerationUnitIds).toEqual([
      fixture.units[1]!.generationUnitId,
    ]);
    expect(plan.resolvedTimeline.map((entry) => entry.generationUnitId)).toEqual([
      fixture.units[0]!.generationUnitId,
      fixture.units[2]!.generationUnitId,
    ]);
    expect(plan.resolvedTimeline.map((entry) => entry.trimWindow.durationMs)).toEqual([
      2000,
      2500,
    ]);
    expect(plan.expectedOutputDurationMs).toBe(4500);
    expect(plan.expectedOutputDurationMs).not.toBe(18_000);
    expect(
      plan.resolvedTimeline.every(
        (entry) =>
          entry.trimWindow.resolutionMethod === "DETERMINISTIC_FALLBACK"
      )
    ).toBe(true);
  });

  it("EDITORIAL_ORDER EXECUTED from timeline authority, not source order", () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [source(4), source(5), source(6)],
      entries: [
        { sourceIndex: 1, role: "ACTION", durationSeconds: 1 },
        { sourceIndex: 0, role: "REACTION", durationSeconds: 1 },
        { sourceIndex: 2, role: "PAYOFF", durationSeconds: 1 },
      ],
      profileId: "COMMERCIAL_STORY",
      base: 2_000,
    });
    expect(fixture.compile().resolvedTimeline.map((entry) => entry.generationUnitId)).toEqual([
      fixture.units[1]!.generationUnitId,
      fixture.units[0]!.generationUnitId,
      fixture.units[2]!.generationUnitId,
    ]);
  });

  it("HARD_CUT has no overlap and authorized DISSOLVE is bounded", () => {
    const hard = criticalFixture().compile();
    expect(hard.resolvedTimeline[1]!.transitionFromPrevious).toMatchObject({
      executionKind: "HARD_CUT",
      durationMs: 0,
    });
    const dissolveFixture = criticalFixture();
    dissolveFixture.compileInput.editorialPlan.timeline[1]!.transitionIntent =
      "DISSOLVE";
    dissolveFixture.compileInput.editorialPlan.timeline[1]!.transitionRationale =
      "Authorized Story-time compression";
    dissolveFixture.compileInput.editorialPlan.editorialFingerprint =
      computeAiStoryNarrativeEditorialPlanFingerprint(
        dissolveFixture.compileInput.editorialPlan
      );
    const dissolve = compileAiStoryAssemblyV2Plan(dissolveFixture.compileInput);
    expect(dissolve.resolvedTimeline[1]!.transitionFromPrevious).toMatchObject({
      executionKind: "DISSOLVE",
      durationMs: 250,
    });
    expect(dissolve.expectedOutputDurationMs).toBe(4250);
  });

  it("UNAUTHORIZED_TRANSITION BLOCKED", () => {
    const fixture = criticalFixture();
    fixture.compileInput.editorialPlan.timeline[1]!.transitionIntent = "FADE";
    fixture.compileInput.editorialPlan.editorialFingerprint =
      computeAiStoryNarrativeEditorialPlanFingerprint(
        fixture.compileInput.editorialPlan
      );
    expect(() => compileAiStoryAssemblyV2Plan(fixture.compileInput)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_TRANSITION" })
    );
  });

  it("exact semantic timing requires both certified boundaries", () => {
    const fixture = criticalFixture();
    fixture.acceptedSourceMedia[0]!.semanticTimingEvidence = [
      {
        semantic: "ACTION_ONSET",
        timestampMs: 1000,
        evidenceId: "b2000000-0000-4000-8000-000000009001",
      },
      {
        semantic: "ACTION_COMPLETE",
        timestampMs: 3000,
        evidenceId: "b2000000-0000-4000-8000-000000009002",
      },
    ];
    const exact = compileAiStoryAssemblyV2Plan(fixture.compileInput);
    expect(exact.resolvedTimeline[0]!.trimWindow).toMatchObject({
      sourceStartMs: 1000,
      sourceEndMs: 3000,
      resolutionMethod: "CERTIFIED_EVENT_METADATA",
    });
    expect(exact.resolvedTimeline[1]!.trimWindow.resolutionMethod).toBe(
      "DETERMINISTIC_FALLBACK"
    );
  });

  it("CUT_ON_ACTION is approximate without exact timing evidence", () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [source(7), source(8)],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 1.5 },
        {
          sourceIndex: 1,
          role: "ACTION",
          durationSeconds: 1.5,
          transition: "CONTINUOUS_ACTION",
        },
      ],
      base: 3_000,
    });
    expect(fixture.compile().resolvedTimeline[1]!.cutOnActionExecution).toBe(
      "CUT_ON_ACTION_APPROXIMATE"
    );
  });

  it("REACTION_ORDER and COMMERCIAL_PAYOFF_ORDER validation fail closed", () => {
    const reactionFirst = buildAssemblyV2Fixture({
      sources: [source(9), source(10)],
      entries: [
        { sourceIndex: 0, role: "REACTION", durationSeconds: 1 },
        { sourceIndex: 1, role: "ACTION", durationSeconds: 1 },
      ],
      base: 4_000,
    });
    expect(() => reactionFirst.compile()).toThrowError(
      expect.objectContaining({ code: "EDITORIAL_CAUSAL_ORDER_INVALID" })
    );

    const payoffEarly = buildAssemblyV2Fixture({
      sources: [source(11), source(12), source(13)],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 1 },
        { sourceIndex: 1, role: "PAYOFF", durationSeconds: 1 },
        { sourceIndex: 2, role: "REACTION", durationSeconds: 1 },
      ],
      profileId: "COMMERCIAL_STORY",
      base: 5_000,
    });
    expect(() => payoffEarly.compile()).toThrowError(
      expect.objectContaining({ code: "EDITORIAL_CAUSAL_ORDER_INVALID" })
    );
  });

  it("SCENE_BRIDGE_EXECUTION PASS", () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [source(14), source(15)],
      entries: [
        { sourceIndex: 0, role: "ACTION", durationSeconds: 1, sceneIndex: 0 },
        { sourceIndex: 1, role: "REACTION", durationSeconds: 1, sceneIndex: 1 },
      ],
      base: 6_000,
    });
    expect(fixture.compile().resolvedTimeline[1]!.sceneBridgeExecution).toMatchObject({
      bridgeType: "MATCH_STATE",
      executionKind: "ORDER_AND_CUT_PRESERVED",
    });
  });

  it("fails closed on non-frozen plans, source mismatch, short source, and incompatible aspect ratio", () => {
    const notFrozen = criticalFixture();
    notFrozen.compileInput.editorialPlan.status = "APPROVED";
    notFrozen.compileInput.editorialPlan.frozenAt = null;
    expect(() => notFrozen.compile()).toThrowError(
      expect.objectContaining({ code: "EDITORIAL_PLAN_NOT_FROZEN" })
    );

    const wrongShot = criticalFixture();
    wrongShot.acceptedSourceMedia[0]!.directorShotId =
      "b2000000-0000-4000-8000-000000009999";
    expect(() => wrongShot.compile()).toThrowError(
      expect.objectContaining({ code: "EDITORIAL_ENTRY_BINDING_MISMATCH" })
    );

    const short = criticalFixture();
    short.acceptedSourceMedia[0]!.durationMs = 1000;
    expect(() => short.compile()).toThrowError(
      expect.objectContaining({ code: "SOURCE_SHORTER_THAN_REQUIRED" })
    );

    const incompatible = criticalFixture();
    incompatible.acceptedSourceMedia[0]!.width = 320;
    incompatible.acceptedSourceMedia[0]!.height = 240;
    expect(() => incompatible.compile()).toThrowError(
      expect.objectContaining({ code: "OUTPUT_PROFILE_INCOMPATIBLE" })
    );
  });

  it("OPTIONAL is excluded by the explicit deterministic policy", () => {
    const fixture = buildAssemblyV2Fixture({
      sources: [source(16), source(17)],
      entries: [{ sourceIndex: 0, role: "ACTION", durationSeconds: 1 }],
      optionalSourceIndexes: [1],
      base: 7_000,
    });
    const plan = fixture.compile();
    expect(plan.optionalExcludedGenerationUnitIds).toEqual([
      fixture.units[1]!.generationUnitId,
    ]);
    expect(plan.resolvedTimeline).toHaveLength(1);
  });

  it("ASSEMBLY_V1 LEGACY routing remains explicit", () => {
    expect(
      selectAiStoryAssemblyRoute({
        editorialPlan: null,
        assemblyV2AuthorityValid: true,
      })
    ).toBe("ASSEMBLY_V1_LEGACY");
    expect(
      selectAiStoryAssemblyRoute({
        editorialPlan: { status: "FROZEN" },
        assemblyV2AuthorityValid: true,
      })
    ).toBe("ASSEMBLY_V2_EDITORIAL");
    expect(() =>
      selectAiStoryAssemblyRoute({
        editorialPlan: { status: "APPROVED" },
        assemblyV2AuthorityValid: true,
      })
    ).toThrow("EDITORIAL_PLAN_NOT_FROZEN");
  });

  it("uses repository-conventional typed Assembly V2 failures", () => {
    const error = new AiStoryAssemblyV2PlanError(
      "SOURCE_MEDIA_MISSING",
      "source missing"
    );
    expect(error).toMatchObject({
      name: "AiStoryAssemblyV2PlanError",
      code: "SOURCE_MEDIA_MISSING",
    });
  });

  it("does not import Provider dispatch, pricing, settlement, quota, ceiling, billing, BGM, or VO paths", () => {
    const implementation = [
      "packages/shared/src/ai-story-assembly-v2.ts",
      "packages/shared/src/ai-story-assembly-v2.server.ts",
      "packages/agents/src/ai-story/assembly-v2-engine.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(implementation).not.toMatch(
      /seedance|provider-attempt|provider-dispatch|commercial-pricing|\breservation\b|\bsettlement\b|\bquota\b|\bceiling\b|billing-account|text-to-speech|\bbgm\b|voice-over/i
    );
  });
});
