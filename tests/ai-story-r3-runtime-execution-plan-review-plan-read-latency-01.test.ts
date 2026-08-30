import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ExecutionPlanReviewProjectionTimingRecorder,
} from "../packages/db/src/queries/ai-story-execution-plan-review";

const source = readFileSync(
  "packages/db/src/queries/ai-story-execution-plan-review.ts",
  "utf8"
).replace(/\r\n/g, "\n");

describe("R3 execution-plan review compact plan-read repair", () => {
  it("records the plan-read parent budget, wall time, row count, and response size", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder(() => 1135);
    await recorder.run(
      "execution_plan_review.plan_read",
      async () => [{ id: "plan", orgId: "org", status: "PLANNED" }],
      (rows) => rows.length
    );

    const timing = recorder.snapshot()[0]!;
    expect(timing.status).toBe("COMPLETED");
    expect(timing.rowCount).toBe(1);
    expect(timing.planReadPhaseTiming).toMatchObject({
      remainingRuntimeBudgetMsAtEntry: 1135,
      poolWaitMs: null,
      dbExecutionMs: null,
    });
    expect(timing.planReadPhaseTiming?.appWallMs).toBeGreaterThanOrEqual(0);
    expect(timing.planReadPhaseTiming?.responseBytesApprox).toBeGreaterThan(0);
  });

  it("preserves partial plan-read timing when the parent deadline fires", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder(() => 692);
    let release!: () => void;
    const pending = recorder.run(
      "execution_plan_review.plan_read",
      () => new Promise<void>((resolve) => { release = resolve; }),
      () => 0
    );
    recorder.markTimedOut();

    const timing = recorder.snapshot()[0]!;
    expect(timing.status).toBe("TIMED_OUT");
    expect(timing.planReadPhaseTiming).toMatchObject({
      remainingRuntimeBudgetMsAtEntry: 692,
      responseBytesApprox: null,
    });
    release();
    await pending;
  });

  it("selects only the eight scalar authority fields and excludes compiled plan JSON", () => {
    const helper = source.slice(
      source.indexOf("export async function getExecutionPlanReviewPlanAuthority"),
      source.indexOf("export class ExecutionPlanReviewRepository")
    );
    for (const field of [
      "id", "orgId", "workspaceId", "campaignId", "storyId",
      "storyVersionId", "animationPackageId", "status",
    ]) {
      expect(helper).toContain(`${field}: schema.aiStoryExecutionPlans.${field}`);
    }
    expect(helper).not.toContain("plan: schema.aiStoryExecutionPlans.plan");
    expect(helper).not.toContain("contractVersion:");
    expect(helper).not.toContain("compilationHash:");
    expect(helper).not.toContain("deterministicFingerprint:");
    expect(helper).not.toContain("compiledAt:");
    expect(helper).not.toContain("createdAt:");
  });

  it("keeps getLogicalProjection on the compact server-side plan authority", () => {
    expect(source).toContain("return getExecutionPlanReviewPlanAuthority(executionPlanId, db);");
    expect(source).toContain("plan: ExecutionPlanReviewPlanAuthority");
    expect(source).toContain("assertExecutionPlanOwnershipChainInSingleQuery(plan, db)");
  });
});
