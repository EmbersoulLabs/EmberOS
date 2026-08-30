import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExecutionPlanReviewProjectionTimingRecorder } from "@ceo-agent/db";

describe("R3 execution-plan review compact ownership proof", () => {
  it("uses the canonical one-statement ownership proof", () => {
    const review = readFileSync(
      "packages/db/src/queries/ai-story-execution-plan-review.ts",
      "utf8"
    );
    expect(review).toContain(
      "assertExecutionPlanOwnershipChainInSingleQuery(plan, db)"
    );
    expect(review).not.toContain(
      '"execution_plan_review.ownership_chain_read": 6'
    );
  });

  it("retains every server-authoritative ownership predicate", () => {
    const ownership = readFileSync(
      "packages/db/src/queries/ai-story-ownership.ts",
      "utf8"
    );
    const compactProof = ownership.slice(
      ownership.indexOf("export async function assertExecutionPlanOwnershipChainInSingleQuery"),
      ownership.indexOf("export function planOwnershipFromRow")
    );
    for (const predicate of [
      "o.id = ${plan.orgId}",
      "w.id = ${plan.workspaceId}",
      "w.org_id = ${plan.orgId}",
      "c.id = ${plan.campaignId}",
      "c.workspace_id = ${plan.workspaceId}",
      "c.org_id = ${plan.orgId}",
      "s.id = ${plan.storyId}",
      "s.campaign_id = ${plan.campaignId}",
      "s.workspace_id = ${plan.workspaceId}",
      "s.org_id = ${plan.orgId}",
      "v.id = ${plan.storyVersionId}",
      "v.story_id = ${plan.storyId}",
      "p.id = ${plan.animationPackageId}",
      "p.story_id = ${plan.storyId}",
      "p.story_version_id = ${plan.storyVersionId}",
      "p.campaign_id = ${plan.campaignId}",
      "p.workspace_id = ${plan.workspaceId}",
      "p.org_id = ${plan.orgId}",
    ]) {
      expect(compactProof).toContain(predicate);
    }
    expect(compactProof).toContain("if (!row?.valid)");
  });

  it("reports one query and one round trip", async () => {
    const recorder = new ExecutionPlanReviewProjectionTimingRecorder();
    await recorder.run(
      "execution_plan_review.ownership_chain_read",
      async () => undefined,
      () => 1
    );
    const timing = recorder.snapshot().find(
      (row) => row.stage === "execution_plan_review.ownership_chain_read"
    );
    expect(timing).toMatchObject({
      status: "COMPLETED",
      queryCount: 1,
      roundTripCount: 1,
      rowCount: 1,
    });
  });
});
