import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isReviewRetryDispatchExecutable } from "@ceo-agent/db";

const base = {
  historicalSceneResultExists: true,
  latestHumanReview: "REJECTED" as const,
  validLaterReviewRetryLineage: true,
  currentProviderAttemptExists: false,
  currentWorkerResultExists: false,
  currentSceneResultExists: false,
  currentDispatchAlreadyTerminal: false,
  anotherExecutableSuccessorExists: false,
};

describe("AI Story review-retry result terminality selector", () => {
  it("blocks a Provider-successful result with APPROVED Human Review", () => {
    expect(isReviewRetryDispatchExecutable({
      ...base,
      latestHumanReview: "APPROVED",
      validLaterReviewRetryLineage: false,
    })).toBe(false);
  });

  it("blocks NEEDS_CHANGES/REJECTED without a valid later retry", () => {
    expect(isReviewRetryDispatchExecutable({
      ...base,
      validLaterReviewRetryLineage: false,
    })).toBe(false);
  });

  it("allows a fresh generation after NEEDS_CHANGES and a valid later retry", () => {
    expect(isReviewRetryDispatchExecutable(base)).toBe(true);
  });

  it.each([
    "currentProviderAttemptExists",
    "currentWorkerResultExists",
    "currentSceneResultExists",
    "currentDispatchAlreadyTerminal",
    "anotherExecutableSuccessorExists",
  ] as const)("blocks duplicate ownership through %s", (key) => {
    expect(isReviewRetryDispatchExecutable({ ...base, [key]: true })).toBe(false);
  });

  it("allows a first generation when no historical Scene Result exists", () => {
    expect(isReviewRetryDispatchExecutable({
      ...base,
      historicalSceneResultExists: false,
      latestHumanReview: null,
      validLaterReviewRetryLineage: false,
    })).toBe(true);
  });

  it("wires both preview and claim through the same lineage-aware SQL gate", () => {
    const source = readFileSync(
      "packages/db/src/queries/provider-execution-dispatch.ts",
      "utf8"
    );
    expect(source.match(/\$\{postTerminalReviewRetrySceneResultGate\}/g)).toHaveLength(2);
    expect(source).toContain("retry_source_attempt.attempt_id = authority.prior_provider_attempt_id");
    expect(source).toContain("rejected_review.decision = 'REJECTED'");
    expect(source).toContain("later_approved_review.decision = 'APPROVED'");
    expect(source).toContain("current_result.provider_execution_id = execution.execution_id");
    expect(source).toContain("not exists (select 1 from provider_attempts a where a.execution_id=execution.execution_id)");
    expect(source).toContain("not exists (select 1 from ai_story_worker_execution_results r where r.dispatch_id=dispatch.dispatch_id)");
  });
});
