/**
 * Map repository domain errors onto stable PR 2B.4 API error codes where useful.
 * Leaves unrecognized errors untouched for handleApiError.
 */
export function normalizeReviewAssemblyApiError(error: unknown): unknown {
  if (!(error instanceof Error) || !("code" in error)) return error;
  const code = String((error as Error & { code: unknown }).code);
  const message = error.message;

  let mapped: string | null = null;
  if (code === "EXECUTION_PLAN_REVIEW_IDENTITY_CONFLICT") {
    mapped = "REVIEW_IDENTITY_CONFLICT";
  } else if (code === "EXECUTION_PLAN_REVIEW_STATE_INVALID") {
    if (/AI QC is blocking|Snapshot is required|QC validation result is required/i.test(message)) {
      mapped = "SCENE_REVIEW_NOT_ELIGIBLE";
    } else if (
      /Story approval requires every required Scene|Story review requires|cannot be approved/i.test(
        message
      )
    ) {
      mapped = "STORY_REVIEW_NOT_ELIGIBLE";
    } else {
      mapped = "REVIEW_STATE_CONFLICT";
    }
  }

  if (!mapped) return error;
  return Object.assign(new Error(message), {
    name: error.name,
    code: mapped,
    status: 409,
  });
}
