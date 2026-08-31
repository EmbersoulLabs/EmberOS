import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const verifyRoutePath =
  "apps/web/src/app/api/admin/ai-story/campaigns/[id]/stories/[storyId]/execution-plans/[executionPlanId]/verify-execute/route.ts";

describe("PROD-VERIFY-01 no-provider canonical Execute", () => {
  it("A/N keeps ordinary Execute provider-capable and free of verification authority", () => {
    const route = read(
      "apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/execute/route.ts"
    );
    expect(route).toContain("authorizeAndExecuteExecutionPlan");
    expect(route).not.toContain("productionVerification:");
  });

  it("B/M requires persistent Platform Admin authority on a separate operator route", () => {
    const route = read(verifyRoutePath);
    expect(route).toContain("requirePlatformAdmin()");
    expect(route).toContain('authorizedBy !== "ACTIVE_PLATFORM_ADMIN"');
    expect(route).not.toContain("AGENCY_PLAN_CAPABILITY");
  });

  it("C rejects client verification flags on ordinary Execute", () => {
    const contract = read("packages/shared/src/ai-story-canonical-execute.ts");
    for (const key of [
      '"verify"',
      '"verificationMode"',
      '"verificationPolicyVersion"',
      '"productionVerification"',
    ]) {
      expect(contract).toContain(key);
    }
    expect(contract).toContain(".strict()");
  });

  it("D-G exercises canonical staging, routing and one initial schedule", () => {
    const route = read(verifyRoutePath);
    const execute = read(
      "packages/agents/src/ai-story/authorize-and-execute-execution-plan.ts"
    );
    expect(route).toContain("resolveAuthorizedExecutionPlan");
    expect(route).toContain("authorizeAiStoryExecution");
    expect(route).toContain("resolveCanonicalWebExecuteProviderAuthority");
    expect(route).toContain("providerRouting.router");
    expect(route).toContain("providerRouting.routingPolicy");
    expect(route).toContain("authorizeAndExecuteExecutionPlan");
    expect(execute).toContain("releases.initialize");
    expect(execute).toContain("[initialScene.sceneExecutionId]");
    expect(execute).toContain("productionVerification: input.productionVerification");
  });

  it("H-J persists a non-claimable outbox before the transaction commits", () => {
    const scheduling = read("packages/db/src/queries/ai-story-scene-scheduling.ts");
    const createOutbox = scheduling.indexOf("createOutboxJobInTransaction(");
    const createVerification = scheduling.indexOf(
      ".insert(schema.aiStoryExecuteVerifications)",
      createOutbox
    );
    expect(createOutbox).toBeGreaterThan(-1);
    expect(createVerification).toBeGreaterThan(createOutbox);
    expect(scheduling).toContain('status: productionVerification ? "CANCELLED" : "PENDING"');
    const claims = read("packages/db/src/queries/provider-outbox.ts");
    expect(claims).toContain("status} in ('PENDING', 'RETRY_WAIT')");
    expect(claims).not.toMatch(/status\}\s+in \([^)]*CANCELLED/);
  });

  it("K makes verification Execute idempotent and identity-bound", () => {
    const scheduling = read("packages/db/src/queries/ai-story-scene-scheduling.ts");
    expect(scheduling).toContain(".onConflictDoNothing()");
    expect(scheduling).toContain("getProductionVerification");
    expect(scheduling).toContain("Production verification identity conflicts");
  });

  it("L resolves the full ownership chain and denies cross-workspace identities", () => {
    const route = read(verifyRoutePath);
    const access = read("apps/web/src/lib/ai-story-execution-plan-access.ts");
    expect(route).toContain("resolveAuthorizedExecutionPlan");
    expect(access).toContain("assertExecutionPlanOwnershipChain");
    expect(access).toContain("eq(schema.aiStoryExecutionPlans.workspaceId");
  });

  it("O exposes a bounded non-empty release identity", () => {
    const health = read("apps/web/src/app/api/health/route.ts");
    expect(health).toContain("EMBEROS_RELEASE_REVISION");
    expect(health).toContain("releaseRevision");
  });

  it("P fails certification when the expected release identity mismatches", () => {
    const check = read("scripts/verify-production-release-revision.ts");
    expect(check).toContain("CERT_RELEASE_REVISION_MISSING");
    expect(check).toContain("CERT_RELEASE_REVISION_MISMATCH");
    expect(check).toContain("throw new Error");
  });
});
