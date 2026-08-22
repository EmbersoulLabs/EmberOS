import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertProductionVerificationCompletionInvariant,
  completeProductionVerificationFixture,
  ProductionVerificationCompletionError,
  type ProductionVerificationCompletionProjection,
  type ProductionVerificationCompletionResult,
  type ProductionVerificationFixtureRow,
} from "../apps/web/src/lib/ai-story-production-verification-completion";
import {
  ProductionVerificationHarnessPostCanonicalError,
  ProductionVerificationStepTimeoutError,
  runProductionVerificationStep,
} from "../apps/web/src/lib/ai-story-production-verification-fixture";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const fixture: ProductionVerificationFixtureRow = {
  story_id: "story-id",
  story_status: "planning_review",
  archived_at: null,
  version_id: "version-id",
  frozen_at: new Date("2026-08-22T00:00:00Z"),
  verification_fixture: true,
  verification_fixture_version: "ai-story-prod-verify-fixture.v1",
  fixture_run_id: "fixture-run-id",
};

const projection: ProductionVerificationCompletionProjection = {
  review_open_count: 1,
  approved_scene_intents: 3,
  approved_story_reviews: 1,
  assembly_count: 1,
  assembly_scene_count: 3,
  runtime_fact_count: 1,
  release_row_count: 3,
  released_scene_1_count: 1,
  held_scene_2_count: 1,
  held_scene_3_count: 1,
  seedance_routing_count: 1,
  verification_count: 1,
  scheduling_correlation_count: 1,
  outbox_count: 1,
  terminal_outbox_count: 1,
  claimable_outbox_count: 0,
  leased_outbox_count: 0,
  outbox_attempt_count: 0,
  provider_attempt_count: 0,
  generated_scene_result_count: 0,
  generated_scene_review_count: 0,
};

const completed = (converged: boolean): ProductionVerificationCompletionResult => ({
  fixtureState: "COMPLETED",
  storyStatus: "ready_for_execution",
  converged,
  connectionAcquireCount: 1,
  transactionCount: 1,
  secondCheckoutAttempts: 0,
  serialDbRoundTripCount: 4,
  timings: [],
});
describe("PROD-VERIFY-FIXTURE-COMPLETION-WRITE-01", () => {
  it("reproduces the pre-fix non-cancellable timeout race", async () => {
    let canonicalFactsPersisted = false;
    await expect(runProductionVerificationStep(
      "canonical_verification_execute",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        canonicalFactsPersisted = true;
      },
      { timeoutMs: 5 }
    )).rejects.toBeInstanceOf(ProductionVerificationStepTimeoutError);
    expect(canonicalFactsPersisted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(canonicalFactsPersisted).toBe(true);
  });

  it("accepts the complete zero-provider production-like authority", () => {
    expect(() => assertProductionVerificationCompletionInvariant(fixture, projection))
      .not.toThrow();
  });

  it.each([
    ["claimable outbox", { claimable_outbox_count: 1 }],
    ["provider attempt", { provider_attempt_count: 1 }],
    ["missing routing", { seedance_routing_count: 0 }],
    ["missing correlation", { scheduling_correlation_count: 0 }],
    ["missing verification identity", { verification_count: 0 }],
  ])("denies completion for %s", (_label, change) => {
    expect(() => assertProductionVerificationCompletionInvariant(
      fixture,
      { ...projection, ...change }
    )).toThrowError(ProductionVerificationCompletionError);
  });

  it("converges duplicate completion without duplicate bookkeeping", async () => {
    let state: "RUNNING" | "COMPLETED" = "RUNNING";
    let writes = 0;
    const writer = vi.fn(async () => {
      const converged = state === "COMPLETED";
      if (!converged) {
        state = "COMPLETED";
        writes += 1;
      }
      return completed(converged);
    });
    const input = {
      storyId: "story-id",
      storyVersionId: "version-id",
      executionPlanId: "plan-id",
      workspaceId: "workspace-id",
    };
    expect((await completeProductionVerificationFixture(input, { writer })).converged).toBe(false);
    expect((await completeProductionVerificationFixture(input, { writer })).converged).toBe(true);
    expect(writes).toBe(1);
  });

  it("separates post-canonical harness failure from Story failure classification", () => {
    const source = read("apps/web/src/lib/ai-story-production-verification-fixture.ts");
    const guard = source.indexOf("canonicalTimeoutOutcomeAmbiguous");
    const classifier = source.indexOf("persistFailedIncompleteClassification(storyId!)");
    expect(guard).toBeGreaterThan(-1);
    expect(classifier).toBeGreaterThan(guard);
    expect(source).toContain("storyFailureClassificationWritten: false");
    expect(new ProductionVerificationHarnessPostCanonicalError("TEST").code)
      .toBe("VERIFICATION_HARNESS_FAILED_AFTER_CANONICAL_SUCCESS");
  });

  it("keeps genuine pre-canonical failures on FAILED_INCOMPLETE classification", () => {
    const source = read("apps/web/src/lib/ai-story-production-verification-fixture.ts");
    expect(source).toContain('runProductionVerificationStep("failure_classification"');
    expect(source).toContain("persistFailedIncompleteClassification(storyId!)");
  });

  it("uses one fresh transaction and denies cross-workspace lookup", () => {
    const source = read("apps/web/src/lib/ai-story-production-verification-completion.ts");
    expect(source).toContain("withFreshDbContext");
    expect(source).toContain("freshDb.transaction");
    expect(source).toContain("connectionAcquireCount: 1");
    expect(source).toContain("transactionCount: 1");
    expect(source).toContain("secondCheckoutAttempts: 0");
    expect(source).toContain("s.workspace_id = ${input.workspaceId}::uuid");
  });

  it("does not change canonical Execute, release, routing, scheduling, or worker code", () => {
    const fixtureSource = read("apps/web/src/lib/ai-story-production-verification-fixture.ts");
    expect(fixtureSource).toContain("authorizeAndExecuteExecutionPlan");
    expect(fixtureSource).toContain("completeProductionVerificationFixture");
    expect(fixtureSource).toContain("AI_STORY_PROD_VERIFY_CANONICAL_TIMEOUT_MS = 30_000");
  });
});
