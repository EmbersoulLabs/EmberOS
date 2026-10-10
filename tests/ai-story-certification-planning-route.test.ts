import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyCertificationPlanningAuthorities, loadPlanningCertificationRoute } from "@/lib/ai-story-certification-planning-context";

const scope = {
  orgId: "c6db344e-a2fd-45ec-8192-5d693cb7cdc8",
  workspaceId: "b98d5b1f-a1cd-4e4a-b0aa-db72da2e5dc0",
  campaignId: "aa7811cf-17af-4f5f-9ef3-d17bc601d39d",
  storyId: "11111111-1111-4111-8111-111111111111",
};
const runId = "22222222-2222-4222-8222-222222222222";

function authority(overrides: Partial<{
  status: string;
  certificationRunId: string;
  environment: string;
  orgId: string;
  workspaceId: string;
  campaignId: string;
  storyId: string | null;
}> = {}) {
  return {
    status: "ACTIVE",
    certificationRunId: runId,
    environment: "PRODUCTION",
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    campaignId: scope.campaignId,
    storyId: null as string | null,
    ...overrides,
  };
}

describe("shared certification planning route", () => {
  it("leaves campaigns with no certification row on the existing path", () => {
    expect(classifyCertificationPlanningAuthorities([], scope)).toEqual({ kind: "legacy" });
    expect(classifyCertificationPlanningAuthorities([
      authority({ orgId: "52519c8c-4011-478f-bf09-34e087e4bbdd" }),
    ], scope)).toEqual({ kind: "legacy" });
  });

  it("selects one active run for the unbound or matching episode", () => {
    expect(classifyCertificationPlanningAuthorities([authority()], scope)).toEqual({
      kind: "certification",
      environment: "PRODUCTION",
      certificationRunId: runId,
    });
    expect(classifyCertificationPlanningAuthorities([
      authority({ storyId: scope.storyId }),
    ], scope).kind).toBe("certification");
  });

  it("fails closed for a different episode, a missing run, an inactive row, or two rows", () => {
    expect(() => classifyCertificationPlanningAuthorities([
      authority({ storyId: "33333333-3333-4333-8333-333333333333" }),
    ], scope)).toThrow("PLANNING_SCOPE_INVALID");
    expect(() => classifyCertificationPlanningAuthorities([
      authority({ certificationRunId: "not-a-run" }),
    ], scope)).toThrow("PLANNING_CERTIFICATION_RUN_ID_REQUIRED");
    expect(() => classifyCertificationPlanningAuthorities([
      authority({ status: "REVOKED" }),
    ], scope)).toThrow("PLANNING_AUTHORITY_MISSING");
    expect(() => classifyCertificationPlanningAuthorities([
      authority(),
      authority({ certificationRunId: "44444444-4444-4444-8444-444444444444" }),
    ], scope)).toThrow("PLANNING_AUTHORITY_CONFLICT");
  });

  it("does not fall through when the ledger cannot be read", async () => {
    await expect(loadPlanningCertificationRoute(scope, async () => {
      throw new Error("connection refused");
    })).rejects.toThrow("PLANNING_LEDGER_UNAVAILABLE");
  });

  it("uses the same resolver in Web polish and the Worker planning runner before self-use", () => {
    const generate = readFileSync(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/generate/route.ts",
      "utf8",
    );
    const runner = readFileSync("apps/web/src/lib/ai-story-planning-runner.ts", "utf8");
    const worker = readFileSync("apps/worker/src/processors/story-planning-stage.ts", "utf8");
    expect(worker).toContain("ai-story-planning-runner.ts");
    for (const source of [generate, runner]) {
      const routeAt = source.indexOf("loadPlanningCertificationRoute");
      const reserveAt = source.indexOf("maximumCostUsd: \"0.50\"");
      expect(routeAt).toBeGreaterThan(-1);
      expect(reserveAt).toBeGreaterThan(routeAt);
      expect(source).toContain("certificationRoute.kind === \"certification\"");
    }
    expect(generate).toContain("certificationRoute.kind === \"legacy\"");
    expect(runner).toContain("const runStage = () => withConfiguredCertificationPlanningContext");
  });
});
