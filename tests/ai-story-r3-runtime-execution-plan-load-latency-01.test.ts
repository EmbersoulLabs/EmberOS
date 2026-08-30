import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExecutionPlanLoadTimingRecorder } from "../apps/web/src/lib/ai-story-execution-plan-access";

describe("R3 Runtime execution-plan load latency", () => {
  it("uses one compact authority-row projection without the compiled plan JSON", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-execution-plan-access.ts", "utf8");
    const load = source.slice(source.indexOf('const [plan] = await observe("execution_plan_load"'));
    expect(load).toContain("id: schema.aiStoryExecutionPlans.id");
    expect(load).toContain("animationPackageId: schema.aiStoryExecutionPlans.animationPackageId");
    expect(load).not.toContain("plan: schema.aiStoryExecutionPlans.plan");
  });

  it("publishes a completed single-query timing", async () => {
    const recorder = new ExecutionPlanLoadTimingRecorder();
    await recorder.run(async () => [{}], (rows) => rows.length);
    expect(recorder.snapshot()).toEqual([
      expect.objectContaining({ status: "COMPLETED", queryCount: 1, roundTripCount: 1, rowCount: 1 }),
    ]);
  });

  it("retains the active query when the parent deadline fires", async () => {
    const recorder = new ExecutionPlanLoadTimingRecorder();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const operation = recorder.run(async () => { await blocked; return []; }, (rows) => rows.length);
    recorder.markTimedOut();
    expect(recorder.snapshot()[0]?.status).toBe("TIMED_OUT");
    release();
    await operation;
  });
});
