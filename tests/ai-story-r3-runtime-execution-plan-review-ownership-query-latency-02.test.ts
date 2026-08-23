import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExecutionPlanReviewProjectionTimingRecorder } from "@ceo-agent/db";

const pending = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
};

describe("R3 execution-plan review ownership query phase timing", () => {
  it("separates parent budget from completed query wall time", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder(() => 742);
    await recorder.run(
      "execution_plan_review.ownership_chain_read",
      async () => undefined,
      () => 1
    );
    const timing = recorder.snapshot()[1];
    expect(timing).toMatchObject({
      status: "COMPLETED",
      queryCount: 1,
      roundTripCount: 1,
      rowCount: 1,
      ownershipQueryPhaseTiming: {
        remainingRuntimeBudgetMsAtEntry: 742,
        connectionAcquireMs: null,
        poolWaitMs: null,
        dbExecutionMs: null,
        networkReturnMs: null,
      },
    });
    expect(timing?.ownershipQueryPhaseTiming?.totalWallMs).toBeGreaterThanOrEqual(0);
    expect(timing?.ownershipQueryPhaseTiming?.dbExecutionAndNetworkMs).toBeGreaterThanOrEqual(0);
  });

  it("retains entry budget and elapsed DB/network wait on parent timeout", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder(() => 692);
    const blocked = pending();
    const operation = recorder.run(
      "execution_plan_review.ownership_chain_read",
      async () => { await blocked.promise; },
      () => 1
    );
    recorder.markTimedOut();
    const timing = recorder.snapshot()[1];
    expect(timing).toMatchObject({
      status: "TIMED_OUT",
      ownershipQueryPhaseTiming: {
        remainingRuntimeBudgetMsAtEntry: 692,
        connectionAcquireMs: null,
        poolWaitMs: null,
        rowDecodeMs: null,
      },
    });
    blocked.release();
    await operation;
  });

  it("keeps the six server-authoritative predicates and one-statement caller", () => {
    const ownership = readFileSync(
      "packages/db/src/queries/ai-story-ownership.ts",
      "utf8"
    );
    const review = readFileSync(
      "packages/db/src/queries/ai-story-execution-plan-review.ts",
      "utf8"
    );
    expect(ownership.replace(/\r\n/g, "\n")).toContain("select (\n      exists (");
    expect(ownership.match(/and exists \(/g)).toHaveLength(5);
    expect(review).toContain("assertExecutionPlanOwnershipChainInSingleQuery(plan, db)");
  });

  it("binds the recorder budget to the server deadline at route entry", () => {
    const route = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/runtime/route.ts",
      "utf8"
    );
    expect(route).toContain(
      "() => SERVER_RUNTIME_DEADLINE_MS - recorder.elapsedMs()"
    );
  });
});
