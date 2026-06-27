import { describe, it, expect } from "vitest";
import {
  canSubmitCreativeForReview,
  latestRejectedReview,
} from "../apps/web/src/lib/review-resubmit";

describe("canSubmitCreativeForReview", () => {
  it("blocks when a review is already pending", () => {
    const result = canSubmitCreativeForReview("compliance_failed", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("REVIEW_PENDING");
  });

  it("allows resubmit from compliance_failed when no pending review", () => {
    expect(canSubmitCreativeForReview("compliance_failed", false)).toEqual({ ok: true });
  });

  it("blocks exported creatives", () => {
    const result = canSubmitCreativeForReview("exported", false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_STATE");
  });
});

describe("latestRejectedReview", () => {
  it("returns the most recent rejection", () => {
    const latest = latestRejectedReview([
      { decision: "rejected", comment: "old", decidedAt: "2026-01-01T00:00:00Z" },
      { decision: "approved", decidedAt: "2026-02-01T00:00:00Z" },
      { decision: "rejected", comment: "new", decidedAt: "2026-03-01T00:00:00Z" },
    ]);
    expect(latest?.comment).toBe("new");
  });
});
