import { describe, expect, it } from "vitest";
import {
  projectAiStoryStatusFromRuntimeAuthority,
  type AiStoryRuntimeAuthorityEvidence,
} from "@ceo-agent/shared";

function evidence(
  overrides: Partial<AiStoryRuntimeAuthorityEvidence> = {}
): AiStoryRuntimeAuthorityEvidence {
  return {
    currentStoryStatus: "planning_review",
    archived: false,
    hasActiveCanonicalExecutionPlan: false,
    hasSceneEnteredProviderOrRuntimeExecution: false,
    hasCurrentSceneResult: false,
    currentGeneratedSceneReviewDecision: null,
    hasCanonicalExecutionFailureBeforeHumanReview: false,
    ...overrides,
  };
}

const pendingReviewRuntime = {
  hasActiveCanonicalExecutionPlan: true,
  hasSceneEnteredProviderOrRuntimeExecution: true,
  hasCurrentSceneResult: true,
  currentGeneratedSceneReviewDecision: "PENDING_REVIEW" as const,
};

describe("AI Story status convergence from runtime authority", () => {
  it("keeps planning_review when no runtime evidence exists", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(evidence());
    expect(result).toMatchObject({
      from: "planning_review",
      to: "planning_review",
      changed: false,
      reason: "UNCHANGED",
    });
  });

  it("projects planning_review to executing once canonical execution has started without a Scene Result", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        hasActiveCanonicalExecutionPlan: true,
        hasSceneEnteredProviderOrRuntimeExecution: true,
      })
    );
    expect(result).toMatchObject({
      from: "planning_review",
      to: "executing",
      changed: true,
      reason: "EXECUTION_STARTED",
    });
  });

  it("projects planning_review to execution_review when a current Scene Result is PENDING_REVIEW", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({ currentStoryStatus: "planning_review", ...pendingReviewRuntime })
    );
    expect(result).toMatchObject({
      from: "planning_review",
      to: "execution_review",
      changed: true,
      reason: "EXECUTION_REVIEW_PENDING",
    });
  });

  it("projects ready_for_execution to execution_review when a current Scene Result is PENDING_REVIEW", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({ currentStoryStatus: "ready_for_execution", ...pendingReviewRuntime })
    );
    expect(result).toMatchObject({
      from: "ready_for_execution",
      to: "execution_review",
      changed: true,
    });
  });

  it("projects executing to execution_review when PENDING_REVIEW evidence exists", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({ currentStoryStatus: "executing", ...pendingReviewRuntime })
    );
    expect(result).toMatchObject({
      from: "executing",
      to: "execution_review",
      changed: true,
    });
  });

  it("replays execution_review idempotently", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({ currentStoryStatus: "execution_review", ...pendingReviewRuntime })
    );
    expect(result).toMatchObject({
      from: "execution_review",
      to: "execution_review",
      changed: false,
      reason: "ALREADY_AT_PROJECTED_PHASE",
    });
  });

  it("never reopens an archived Story", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "archived",
        archived: true,
        ...pendingReviewRuntime,
      })
    );
    expect(result).toMatchObject({
      from: "archived",
      to: "archived",
      changed: false,
      reason: "ARCHIVED_FROZEN",
    });
  });

  it("does not infer status from timestamps", () => {
    const withoutRuntime = evidence({ currentStoryStatus: "planning_review" });
    expect(projectAiStoryStatusFromRuntimeAuthority(withoutRuntime).to).toBe(
      "planning_review"
    );
    expect(JSON.stringify(withoutRuntime)).not.toMatch(/At"|timestamp|createdAt|updatedAt/i);
  });

  it("allows execution_review while Provider Attempt remaining PENDING is out of band", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "planning_review",
        ...pendingReviewRuntime,
      })
    );
    expect(result.to).toBe("execution_review");
    expect(Object.keys(evidence())).not.toContain("providerAttemptStatus");
  });

  it("can be execution_review while later Scenes remain held", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "planning_review",
        hasActiveCanonicalExecutionPlan: true,
        hasSceneEnteredProviderOrRuntimeExecution: true,
        hasCurrentSceneResult: true,
        currentGeneratedSceneReviewDecision: "PENDING_REVIEW",
      })
    );
    expect(result.to).toBe("execution_review");
  });

  it("does not move execution_review backward into planning or executing", () => {
    const started = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "execution_review",
        hasActiveCanonicalExecutionPlan: true,
        hasSceneEnteredProviderOrRuntimeExecution: true,
      })
    );
    expect(started.to).toBe("execution_review");
    expect(started.changed).toBe(false);
  });

  it("projects canonical failure before Human Review to execution_failed", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "executing",
        hasActiveCanonicalExecutionPlan: true,
        hasSceneEnteredProviderOrRuntimeExecution: true,
        hasCanonicalExecutionFailureBeforeHumanReview: true,
      })
    );
    expect(result).toMatchObject({
      from: "executing",
      to: "execution_failed",
      changed: true,
      reason: "EXECUTION_FAILED_BEFORE_HUMAN_REVIEW",
    });
  });

  it("does not treat a plan alone as execution", () => {
    const result = projectAiStoryStatusFromRuntimeAuthority(
      evidence({
        currentStoryStatus: "planning_review",
        hasActiveCanonicalExecutionPlan: true,
      })
    );
    expect(result.to).toBe("planning_review");
    expect(result.changed).toBe(false);
  });
});
