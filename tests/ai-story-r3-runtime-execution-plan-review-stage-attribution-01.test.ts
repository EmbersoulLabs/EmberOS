import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExecutionPlanReviewProjectionTimingRecorder } from "@ceo-agent/db";

const pending = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

describe("R3 execution-plan review stage attribution", () => {
  it("uses distinct parent stage labels", () => {
    const source = readFileSync("packages/agents/src/ai-story/derive-product-runtime-projection.ts", "utf8");
    expect(source).toContain('observe("execution_plan_review_projection_read"');
    expect(source).toContain('observe("generated_scene_review_read"');
  });

  it("retains a timeout during the first read", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    const blocked = pending();
    const operation = recorder.run("execution_plan_review.plan_read", async () => {
      await blocked.promise;
      return [];
    }, (rows) => rows.length);
    recorder.markTimedOut();
    expect(recorder.snapshot()[0]?.status).toBe("TIMED_OUT");
    expect(recorder.snapshot().slice(1).every((row) => row.status === "NOT_REACHED")).toBe(true);
    blocked.release();
    await operation;
  });

  it("retains completed reads before a later timeout", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    await recorder.run("execution_plan_review.plan_read", async () => [{}], (rows) => rows.length);
    await recorder.run("execution_plan_review.ownership_chain_read", async () => undefined, () => 6);
    const blocked = pending();
    const operation = recorder.run("execution_plan_review.opened_fact_read", async () => {
      await blocked.promise;
      return [];
    }, (rows) => rows.length);
    recorder.markTimedOut();
    expect(recorder.snapshot().slice(0, 3).map((row) => row.status)).toEqual([
      "COMPLETED", "COMPLETED", "TIMED_OUT",
    ]);
    expect(recorder.snapshot().slice(3).every((row) => row.status === "NOT_REACHED")).toBe(true);
    blocked.release();
    await operation;
  });

  it("publishes a complete success trace", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    for (const row of recorder.snapshot()) {
      await recorder.run(row.stage, async () => [], (rows) => rows.length);
    }
    expect(recorder.snapshot().every((row) => row.status === "COMPLETED")).toBe(true);
  });
});
