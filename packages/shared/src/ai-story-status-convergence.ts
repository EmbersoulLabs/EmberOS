/**
 * Canonical AI Story status is a projection of persisted runtime authority.
 *
 * This helper is the single status-convergence policy. It is idempotent, never
 * infers from timestamps, and never inspects Provider Attempt.status.
 * Canonical Scene Result / Generated Scene Review / runtime execution facts
 * remain authoritative.
 */
import type { AiStoryStatus } from "./ai-story";
import type { GeneratedSceneReviewState } from "./ai-story-generated-scene-review";

export type AiStoryRuntimeAuthorityEvidence = {
  readonly currentStoryStatus: AiStoryStatus;
  readonly archived: boolean;
  readonly hasActiveCanonicalExecutionPlan: boolean;
  readonly hasSceneEnteredProviderOrRuntimeExecution: boolean;
  readonly hasCurrentSceneResult: boolean;
  readonly currentGeneratedSceneReviewDecision: GeneratedSceneReviewState | null;
  readonly hasCanonicalExecutionFailureBeforeHumanReview: boolean;
};

export const AI_STORY_STATUS_CONVERGENCE_REASONS = [
  "UNCHANGED",
  "ARCHIVED_FROZEN",
  "EXECUTION_REVIEW_PENDING",
  "EXECUTION_STARTED",
  "EXECUTION_FAILED_BEFORE_HUMAN_REVIEW",
  "ALREADY_AT_PROJECTED_PHASE",
] as const;

export type AiStoryStatusConvergenceReason =
  (typeof AI_STORY_STATUS_CONVERGENCE_REASONS)[number];

export type AiStoryStatusConvergenceProjection = {
  readonly from: AiStoryStatus;
  readonly to: AiStoryStatus;
  readonly changed: boolean;
  readonly reason: AiStoryStatusConvergenceReason;
};

const CONVERGEABLE_STATUSES = new Set<AiStoryStatus>([
  "planning_review",
  "ready_for_execution",
  "generate_review",
  "executing",
  "execution_review",
  "execution_failed",
]);

function unchanged(
  from: AiStoryStatus,
  reason: AiStoryStatusConvergenceReason
): AiStoryStatusConvergenceProjection {
  return { from, to: from, changed: false, reason };
}

function applyProjectedStatus(
  from: AiStoryStatus,
  projected: AiStoryStatus,
  reason: AiStoryStatusConvergenceReason
): AiStoryStatusConvergenceProjection {
  if (from === projected) {
    return unchanged(from, "ALREADY_AT_PROJECTED_PHASE");
  }
  if (from === "execution_review") {
    return unchanged(from, "ALREADY_AT_PROJECTED_PHASE");
  }
  if (from === "execution_failed" && projected === "executing") {
    return unchanged(from, "ALREADY_AT_PROJECTED_PHASE");
  }
  return { from, to: projected, changed: true, reason };
}

/**
 * Project Story status from canonical persisted runtime evidence.
 * Pure. Idempotent. Does not read timestamps or Provider Attempt.status.
 */
export function projectAiStoryStatusFromRuntimeAuthority(
  evidence: AiStoryRuntimeAuthorityEvidence
): AiStoryStatusConvergenceProjection {
  const from = evidence.currentStoryStatus;
  if (from === "archived" || evidence.archived) {
    return unchanged(from, "ARCHIVED_FROZEN");
  }
  if (!CONVERGEABLE_STATUSES.has(from)) {
    return unchanged(from, "UNCHANGED");
  }

  const pendingReview =
    evidence.hasCurrentSceneResult &&
    evidence.currentGeneratedSceneReviewDecision === "PENDING_REVIEW";
  if (pendingReview) {
    return applyProjectedStatus(from, "execution_review", "EXECUTION_REVIEW_PENDING");
  }

  if (
    evidence.hasCanonicalExecutionFailureBeforeHumanReview &&
    from !== "execution_review"
  ) {
    return applyProjectedStatus(
      from,
      "execution_failed",
      "EXECUTION_FAILED_BEFORE_HUMAN_REVIEW"
    );
  }

  if (
    evidence.hasActiveCanonicalExecutionPlan &&
    evidence.hasSceneEnteredProviderOrRuntimeExecution
  ) {
    return applyProjectedStatus(from, "executing", "EXECUTION_STARTED");
  }

  return unchanged(from, "UNCHANGED");
}
