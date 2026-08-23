import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { GeneratedSceneReviewService } from "@ceo-agent/agents";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

const persistencePath =
  "packages/db/src/queries/ai-story-scene-execution-persistence.ts";

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe("R3 generated Scene review projection latency repair", () => {
  it("uses one compact indexed Scene-intent projection", async () => {
    const source = await readFile(persistencePath, "utf8");
    expect(source).toContain("async listIntentsByExecutionPlanId(");
    expect(source).toContain("select({ intent: schema.aiStorySceneExecutions.intent })");
    expect(source).toContain("aiStorySceneExecutions.executionPlanId, executionPlanId");
    expect(source).toContain("orderBy(asc(schema.aiStorySceneExecutions.sceneOrder))");
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
