import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  persistFailedIncompleteClassification,
  ProductionVerificationFailureClassificationError,
  ProductionVerificationStepTimeoutError,
  runProductionVerificationStep,
} from "../apps/web/src/lib/ai-story-production-verification-fixture";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("PROD-VERIFY-REVIEW-OPEN-TIMEOUT-01", () => {
  it("reuses the active review transaction for every reviewer authorization query", () => {
    const source = read("packages/db/src/queries/ai-story-execution-plan-review.ts");
    expect(source).not.toContain("getWorkspaceMembership(");
    expect(source.match(/assertReviewerAuthorized\([^;]+, tx\)/g)).toHaveLength(3);
    expect(source).toContain("db: QueryDb");
    expect(source).toContain("schema.workspaceMembers");
  });

  it("keeps review-open idempotency and uniqueness authority unchanged", () => {
    const source = read("packages/db/src/queries/ai-story-execution-plan-review.ts");
    expect(source).toContain("aiStoryReviewOpenedFacts.executionPlanId");
    expect(source).toContain(".onConflictDoNothing()");
    expect(source).toContain("Review open fact identity conflict");
  });

  it("uses a fresh bounded database context for failure classification", () => {
    const client = read("packages/db/src/client.ts");
    const fixture = read("apps/web/src/lib/ai-story-production-verification-fixture.ts");
    expect(client).toContain("withFreshDbContext");
    expect(client).toContain("createPostgresClient(url, 1, 3)");
    expect(client).toContain("set statement_timeout = '3s'");
    expect(client).toContain("set lock_timeout = '2s'");
    expect(client).toContain("freshClient.end({ timeout: 1 })");
    expect(fixture).toContain("writeFailedIncompleteWithFreshDb");
    expect(fixture).toContain('runProductionVerificationStep("failure_classification"');
  });

  it("persists failure classification through the independent writer", async () => {
    const writer = vi.fn().mockResolvedValue(true);
    const failedAt = new Date("2026-08-21T00:00:00.000Z");
    await persistFailedIncompleteClassification("story-safe-id", { writer, failedAt });
    expect(writer).toHaveBeenCalledWith("story-safe-id", failedAt);
  });

  it("surfaces an explicit secondary error when failure classification is not durable", async () => {
    const writer = vi.fn().mockResolvedValue(false);
    await expect(
      persistFailedIncompleteClassification("story-safe-id", { writer })
    ).rejects.toBeInstanceOf(ProductionVerificationFailureClassificationError);
  });

  it("bounds a simulated locked primary step without creating provider work", async () => {
    const timings: Array<{
      step: string;
      status: "PASS" | "FAIL" | "TIMEOUT";
      durationMs: number;
    }> = [];
    await expect(
      runProductionVerificationStep(
        "review_open",
        () => new Promise<never>(() => undefined),
        { timeoutMs: 5, timings }
      )
    ).rejects.toBeInstanceOf(ProductionVerificationStepTimeoutError);
    expect(timings[0]).toMatchObject({ step: "review_open", status: "TIMEOUT" });
    const fixture = read("apps/web/src/lib/ai-story-production-verification-fixture.ts");
    expect(fixture).toContain("externalAiCalls: 0");
  });
});
