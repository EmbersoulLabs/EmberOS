import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RouteOwnershipValidationTimingRecorder } from "../apps/web/src/lib/ai-story-execution-plan-access";

describe("R3 Runtime route compact ownership validation", () => {
  it("uses the canonical one-statement server ownership proof", () => {
    const source = readFileSync("apps/web/src/lib/ai-story-execution-plan-access.ts", "utf8");
    expect(source).toContain("assertExecutionPlanOwnershipChainInSingleQuery(plan, db)");
    expect(source).not.toContain("assertExecutionPlanOwnershipChain(plan, db)");
    expect(source).toContain("ownership_validation.compact_server_chain_proof");
  });

  it("preserves every tenant and aggregate identity predicate", () => {
    const source = readFileSync("packages/db/src/queries/ai-story-ownership.ts", "utf8");
    const proof = source.slice(
      source.indexOf("export async function assertExecutionPlanOwnershipChainInSingleQuery"),
      source.indexOf("export function planOwnershipFromRow")
    );
    for (const identity of [
      "plan.orgId", "plan.workspaceId", "plan.campaignId", "plan.storyId",
      "plan.storyVersionId", "plan.animationPackageId",
    ]) expect(proof).toContain(identity);
    expect(proof).toContain("if (!row?.valid)");
  });

  it("publishes one completed query and round trip", async () => {
    const recorder = new RouteOwnershipValidationTimingRecorder();
    await recorder.run(async () => undefined);
    expect(recorder.snapshot()[0]).toMatchObject({
      status: "COMPLETED", queryCount: 1, roundTripCount: 1, rowCount: 1,
    });
  });

  it("retains partial timing when the parent deadline fires", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const recorder = new RouteOwnershipValidationTimingRecorder();
    const operation = recorder.run(() => blocked);
    recorder.markTimedOut();
    expect(recorder.snapshot()[0]?.status).toBe("TIMED_OUT");
    release();
    await operation;
  });
});
