import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const fixturePath = "apps/web/src/lib/ai-story-production-verification-fixture.ts";
const routePath = "apps/web/src/app/api/admin/ai-story/campaigns/[id]/production-verification-fixture/route.ts";

describe("PROD-VERIFY-FIXTURE-01 deterministic server fixture", () => {
  it("is Platform Admin-only and accepts no arbitrary payload", () => {
    const route = read(routePath);
    expect(route).toContain("requirePlatformAdmin()");
    expect(route).toContain('raw.trim() !== "{}"');
    expect(route).not.toMatch(/prompt|provider|model|accessMode|settlementMode/);
  });

  it("uses an explicit versioned three-scene fixture with zero declared AI usage", () => {
    const source = read(fixturePath);
    expect(source).toContain('"ai-story-prod-verify-fixture.v1"');
    expect(source).toContain("verificationFixture: true");
    expect(source).toContain("PRODUCTION_CONTROL_PATH_VERIFICATION");
    expect(source).toContain("externalAiCalls: 0");
    expect(source).toContain("generated.sceneExecutionIds.length !== 3");
  });

  it("uses production domain persistence, approval, assembly and canonical Execute", () => {
    const source = read(fixturePath);
    for (const authority of [
      "createAiStoryVersion",
      "freezeAiStoryVersion",
      "saveAnimationPackage",
      "approveAnimationPackage",
      "createGenerateReview",
      "appendSceneIntentDecision",
      "appendStoryDecision",
      "createOrReturnAssembly",
      "authorizeAiStoryExecution",
      "authorizeAndExecuteExecutionPlan",
    ]) expect(source).toContain(authority);
    expect(source).toContain('authorizedBy !== "ACTIVE_PLATFORM_ADMIN"');
    expect(source).toContain("productionVerification:");
  });

  it("preserves failed evidence without exposing a partially ready fixture", () => {
    const source = read(fixturePath);
    expect(source).toContain('status: "failed"');
    expect(source).toContain("archivedAt: new Date()");
  });
});
