const BLOCKED_WITHOUT_REWORK = new Set(["exported"]);

export function canSubmitCreativeForReview(
  creativeStatus: string,
  hasPendingReview: boolean
): { ok: true } | { ok: false; code: string; message: string } {
  if (hasPendingReview) {
    return {
      ok: false,
      code: "REVIEW_PENDING",
      message: "This creative already has a pending review",
    };
  }
  if (BLOCKED_WITHOUT_REWORK.has(creativeStatus)) {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: "Exported creatives cannot be resubmitted for review",
    };
  }
  return { ok: true };
}

export function latestRejectedReview(
  reviews: Array<{
    decision: string;
    comment?: string | null;
    decidedAt?: Date | string | null;
    reviewerType?: string;
  }>
) {
  return reviews
    .filter((r) => r.decision === "rejected")
    .sort((a, b) => {
      const ta = a.decidedAt ? new Date(a.decidedAt).getTime() : 0;
      const tb = b.decidedAt ? new Date(b.decidedAt).getTime() : 0;
      return tb - ta;
    })[0];
}
