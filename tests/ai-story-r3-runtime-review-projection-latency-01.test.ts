import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  GeneratedSceneReviewReadSubstageRecorder,
  GeneratedSceneReviewService,
} from "@ceo-agent/agents";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const persistencePath =
  "packages/db/src/queries/ai-story-scene-execution-persistence.ts";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe("R3 generated Scene review projection latency repair", () => {
  it("mutates the exact request recorder passed directly to the helper", async () => {
    const intents = makePhase2aCompilation().intents;
    const requestRecorder = new GeneratedSceneReviewReadSubstageRecorder();
    const isolatedDependencyRecorder = new GeneratedSceneReviewReadSubstageRecorder();
    const service = new GeneratedSceneReviewService({
      persistenceRepository: { listIntentsByExecutionPlanId: async () => intents } as never,
      providerAttemptCostRecordLoader: async () => [],
      reviewRepository: { listByExecutionPlanId: async () => [] } as never,
      readSubstageRecorder: isolatedDependencyRecorder,
    });

    await service.loadPlanReadModel(
      makePhase2aCompilation().plan.storyExecutionId,
      requestRecorder
    );

    expect(requestRecorder.snapshot().every((row) => row.status === "COMPLETED")).toBe(true);
    expect(
      isolatedDependencyRecorder.snapshot().every((row) => row.status === "NOT_REACHED")
    ).toBe(true);
  });

  it("emits service entry before the first repository-call marker", async () => {
    const intents = makePhase2aCompilation().intents;
    const markers: string[] = [];
    const service = new GeneratedSceneReviewService({
      persistenceRepository: { listIntentsByExecutionPlanId: async () => intents } as never,
      providerAttemptCostRecordLoader: async () => [],
      reviewRepository: { listByExecutionPlanId: async () => [] } as never,
    });

    await service.loadPlanReadModel(
      makePhase2aCompilation().plan.storyExecutionId,
      new GeneratedSceneReviewReadSubstageRecorder(),
      (event) => markers.push(event.marker)
    );

    expect(markers).toEqual([
      "review_load_plan_read_model_entry.v1",
      "review_first_repository_call.v1",
    ]);
  });

  it("uses one compact indexed Scene-intent projection", async () => {
    const source = await readFile(persistencePath, "utf8");
    expect(source).toContain("async listIntentsByExecutionPlanId(");
    expect(source).toContain("select({ intent: schema.aiStorySceneExecutions.intent })");
    expect(source).toContain("aiStorySceneExecutions.executionPlanId, executionPlanId");
    expect(source).toContain("orderBy(asc(schema.aiStorySceneExecutions.sceneOrder))");
  });

  it("retains completed timing when the cost read is marked timed out", async () => {
    const intents = makePhase2aCompilation().intents;
    const recorder = new GeneratedSceneReviewReadSubstageRecorder();
    let releaseCost!: () => void;
    const costBlocked = new Promise<void>((resolve) => { releaseCost = resolve; });
    const service = new GeneratedSceneReviewService({
      persistenceRepository: { listIntentsByExecutionPlanId: async () => intents } as never,
      providerAttemptCostRecordLoader: async () => { await costBlocked; return []; },
      reviewRepository: { listByExecutionPlanId: async () => [] } as never,
      readSubstageRecorder: recorder,
    });
    const pending = service.loadPlanReadModel(makePhase2aCompilation().plan.storyExecutionId);
    await delay(10);
    recorder.markTimedOut();
    expect(recorder.snapshot().map(({ stage, status }) => ({ stage, status }))).toEqual([
      { stage: "generated_scene_review.scene_execution_list", status: "COMPLETED" },
      { stage: "generated_scene_review.provider_attempt_cost_records", status: "TIMED_OUT" },
      { stage: "generated_scene_review.review_list", status: "NOT_REACHED" },
      { stage: "generated_scene_review.read_model_assembly", status: "NOT_REACHED" },
    ]);
    releaseCost();
    await pending;
  });

  it("retains the first two timings when the review read is marked timed out", async () => {
    const intents = makePhase2aCompilation().intents;
    const recorder = new GeneratedSceneReviewReadSubstageRecorder();
    let releaseReviews!: () => void;
    const reviewsBlocked = new Promise<void>((resolve) => { releaseReviews = resolve; });
    const service = new GeneratedSceneReviewService({
      persistenceRepository: { listIntentsByExecutionPlanId: async () => intents } as never,
      providerAttemptCostRecordLoader: async () => [],
      reviewRepository: { listByExecutionPlanId: async () => { await reviewsBlocked; return []; } } as never,
      readSubstageRecorder: recorder,
    });
    const pending = service.loadPlanReadModel(makePhase2aCompilation().plan.storyExecutionId);
    await delay(10);
    recorder.markTimedOut();
    expect(recorder.snapshot().map(({ stage, status }) => ({ stage, status }))).toEqual([
      { stage: "generated_scene_review.scene_execution_list", status: "COMPLETED" },
      { stage: "generated_scene_review.provider_attempt_cost_records", status: "COMPLETED" },
      { stage: "generated_scene_review.review_list", status: "TIMED_OUT" },
      { stage: "generated_scene_review.read_model_assembly", status: "NOT_REACHED" },
    ]);
    releaseReviews();
    await pending;
  });

  it("publishes a complete exclusive success trace", async () => {
    const intents = makePhase2aCompilation().intents;
    const recorder = new GeneratedSceneReviewReadSubstageRecorder();
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const service = new GeneratedSceneReviewService({
      persistenceRepository: { listIntentsByExecutionPlanId: async () => intents } as never,
      providerAttemptCostRecordLoader: async () => [],
      reviewRepository: { listByExecutionPlanId: async () => [] } as never,
      readSubstageRecorder: recorder,
    });
    await service.loadPlanReadModel(makePhase2aCompilation().plan.storyExecutionId);
    expect(recorder.snapshot().every((row) => row.status === "COMPLETED")).toBe(true);
    expect(recorder.snapshot().every((row) => row.durationMs !== null)).toBe(true);
    vi.restoreAllMocks();
  });

  it("preserves the read model while reporting each serial boundary", async () => {
    const intents = makePhase2aCompilation().intents;
    const callOrder: string[] = [];
    const timings: Array<{
      sceneExecutionListMs: number;
      providerAttemptCostRecordsMs: number;
      generatedSceneReviewListMs: number;
      readModelAssemblyMs: number;
      totalLoadPlanReadModelMs: number;
      sceneExecutionRowCount: number;
      providerAttemptCostRecordCount: number;
      generatedSceneReviewRowCount: number;
      sceneExecutionQueryCount: number;
      sceneExecutionRoundTripCount: number;
      providerAttemptCostQueryCount: number;
      providerAttemptCostRoundTripCount: number;
      generatedSceneReviewQueryCount: number;
      generatedSceneReviewRoundTripCount: number;
      connectionAcquireCount: number;
      secondCheckoutAttempts: number;
    }> = [];
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const service = new GeneratedSceneReviewService({
      persistenceRepository: {
        listIntentsByExecutionPlanId: async () => {
          callOrder.push("scene_execution_list");
          await delay(20);
          return intents;
        },
      } as never,
      providerAttemptCostRecordLoader: async () => {
        callOrder.push("provider_attempt_cost_records");
        await delay(5);
        return [];
      },
      reviewRepository: {
        listByExecutionPlanId: async () => {
          callOrder.push("generated_scene_review_list");
          await delay(5);
          return [];
        },
      } as never,
      onLoadPlanReadModelTiming: (timing) => timings.push(timing),
    });

    const model = await service.loadPlanReadModel(
      makePhase2aCompilation().plan.storyExecutionId
    );

    expect(callOrder).toEqual([
      "scene_execution_list",
      "provider_attempt_cost_records",
      "generated_scene_review_list",
    ]);
    expect(model).toHaveLength(intents.length);
    expect(model.map((scene) => scene.sceneExecutionId)).toEqual(
      intents.map((intent) => intent.identity.sceneExecutionId)
    );
    expect(model.every((scene) => scene.reviewState === "PENDING_REVIEW")).toBe(true);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({
      sceneExecutionRowCount: intents.length,
      providerAttemptCostRecordCount: 0,
      generatedSceneReviewRowCount: 0,
      sceneExecutionQueryCount: 1,
      sceneExecutionRoundTripCount: 1,
      providerAttemptCostQueryCount: 1,
      providerAttemptCostRoundTripCount: 1,
      generatedSceneReviewQueryCount: 1,
      generatedSceneReviewRoundTripCount: 1,
      connectionAcquireCount: 1,
      secondCheckoutAttempts: 0,
    });
    expect(timings[0]!.sceneExecutionListMs).toBeGreaterThanOrEqual(15);
    expect(timings[0]!.providerAttemptCostRecordsMs).toBeGreaterThanOrEqual(3);
    expect(timings[0]!.generatedSceneReviewListMs).toBeGreaterThanOrEqual(3);
    expect(timings[0]!.totalLoadPlanReadModelMs).toBeGreaterThanOrEqual(
      timings[0]!.sceneExecutionListMs
    );
    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"ai_story_generated_scene_review_read_timing"')
    );
    info.mockRestore();
  });
});
