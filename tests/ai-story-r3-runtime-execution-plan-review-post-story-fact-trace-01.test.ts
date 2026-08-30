import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES,
  EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION,
  ExecutionPlanReviewProjectionTimingRecorder,
} from "@ceo-agent/db";
import { parseRuntimeTimeoutTrace } from "../apps/web/src/lib/ai-story-runtime-client";

const pending = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

async function completeThrough(
  recorder: ExecutionPlanReviewProjectionTimingRecorder,
  lastStage: string
) {
  for (const row of recorder.snapshot()) {
    if (row.stage === lastStage) break;
    await recorder.run(row.stage, async () => [{}], (rows) => rows.length);
  }
}

describe("R3 execution-plan review post-story-fact trace", () => {
  it("registers every stable review substage and the deployed trace marker", () => {
    expect(EXECUTION_PLAN_REVIEW_PROJECTION_SUBSTAGES).toEqual([
      "execution_plan_review.plan_read",
      "execution_plan_review.ownership_chain_read",
      "execution_plan_review.opened_fact_read",
      "execution_plan_review.scene_review_fact_read",
      "execution_plan_review.story_review_fact_read",
      "execution_plan_review.required_scene_read",
      "execution_plan_review.projection_assembly",
    ]);
    expect(EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION).toBe(
      "execution-plan-review-post-story-fact-trace.v1"
    );
  });

  it("publishes completed story fact timing when required-scene read times out", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    await completeThrough(recorder, "execution_plan_review.required_scene_read");
    const blocked = pending();
    const operation = recorder.run(
      "execution_plan_review.required_scene_read",
      async () => { await blocked.promise; return []; },
      (rows) => rows.length
    );
    recorder.markTimedOut();
    expect(recorder.snapshot().map((row) => row.status)).toEqual([
      "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED",
      "TIMED_OUT", "NOT_REACHED",
    ]);
    blocked.release();
    await operation;
  });

  it("publishes a projection-assembly timeout after every DB read completes", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    await completeThrough(recorder, "execution_plan_review.projection_assembly");
    const blocked = pending();
    const operation = recorder.run(
      "execution_plan_review.projection_assembly",
      async () => { await blocked.promise; return {}; },
      () => 1
    );
    recorder.markTimedOut();
    expect(recorder.snapshot().slice(0, 6).every((row) => row.status === "COMPLETED")).toBe(true);
    expect(recorder.snapshot()[6]?.status).toBe("TIMED_OUT");
    blocked.release();
    await operation;
  });

  it("preserves the complete review snapshot through the browser-safe parser", () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    const body = {
      errorCode: "AI_STORY_RUNTIME_READ_TIMEOUT",
      elapsedMs: 15_000,
      lastCompletedStage: "runtime_authorization_read",
      timedOutStage: "execution_plan_review_projection_read",
      stageTimings: [],
      executionPlanReviewTraceVersion: EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION,
      executionPlanReviewStageTimings: recorder.snapshot(),
    };
    const parsed = parseRuntimeTimeoutTrace(body, "test-correlation");
    expect(parsed?.executionPlanReviewTraceVersion).toBe(
      EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION
    );
    expect(parsed?.executionPlanReviewStageTimings).toHaveLength(7);
  });

  it("emits the same review snapshot in the correlated server timing event", () => {
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts",
      "utf8"
    );
    expect(route.match(/executionPlanReviewStageTimings: executionPlanReviewRecorder\.snapshot\(\)/g)).toHaveLength(3);
    expect(route).toContain("executionPlanReviewTraceVersion: EXECUTION_PLAN_REVIEW_PROJECTION_TRACE_VERSION");
  });
});
