import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pendingAiExecutionProjection } from "../apps/web/src/lib/ai-execution-truth";

describe("VS-RC-FIX-03 web pending projection", () => {
  it("does not claim Director invocation at queue acceptance", () => {
    expect(pendingAiExecutionProjection()).toEqual({
      aiInvoked: null,
      aiExecutionStatus: "PENDING_RUNTIME_EVIDENCE",
    });
  });

  it("is attached to production generate/run routes without Director transplant", () => {
    const generate = readFileSync("apps/web/src/app/api/campaigns/[id]/generate/route.ts", "utf8");
    const run = readFileSync("apps/web/src/app/api/campaigns/[id]/run/route.ts", "utf8");
    expect(generate).toContain("pendingAiExecutionProjection()");
    expect(run).toContain("pendingAiExecutionProjection()");
    expect(generate).toContain('requireWorkspaceRole(campaign.workspaceId, user.id, "operator")');
    expect(generate).not.toContain("authorizeVideoStudioGeneration");
    expect(generate).not.toContain("editing-director-v1");
    expect(run).not.toContain("editing-director-v1");
  });
});
