export type WorkspaceDisplayState =
  | "NOT_STARTED"
  | "AVAILABLE"
  | "QUEUED"
  | "IN_PROGRESS"
  | "PENDING_REVIEW"
  | "RECOVERY_AVAILABLE"
  | "COMPLETED";

export type ContinueCampaignTarget = {
  href: string;
  label: string;
  state: WorkspaceDisplayState;
} | null;

const ACTIVE_TASK_STATES = new Set(["queued", "running", "retrying"]);

/** Resolve a main-owned continuation surface from durable API facts only. */
export function resolveContinueCampaign(input: {
  slug: string;
  campaignId: string;
  campaignStatus: string;
  taskId?: string;
  taskStatus?: string;
}): ContinueCampaignTarget {
  if (
    input.campaignStatus === "pending_internal_review" ||
    input.campaignStatus === "pending_client_review"
  ) {
    return {
      href: `/w/${input.slug}/reviews`,
      label: "Continue review",
      state: "PENDING_REVIEW",
    };
  }
  if (!input.taskId || !input.taskStatus) return null;
  const href = `/w/${input.slug}/campaigns/${input.campaignId}/task?taskId=${input.taskId}`;
  if (ACTIVE_TASK_STATES.has(input.taskStatus)) {
    return {
      href,
      label: "Continue workflow",
      state: input.taskStatus === "queued" ? "QUEUED" : "IN_PROGRESS",
    };
  }
  if (input.taskStatus === "failed") {
    return { href, label: "Review workflow issue", state: "RECOVERY_AVAILABLE" };
  }
  if (input.taskStatus === "completed") {
    return { href, label: "Open completed workflow", state: "COMPLETED" };
  }
  return null;
}

export function mapTaskDisplayState(taskStatus?: string): WorkspaceDisplayState {
  if (!taskStatus) return "NOT_STARTED";
  if (taskStatus === "queued") return "QUEUED";
  if (taskStatus === "running" || taskStatus === "retrying") return "IN_PROGRESS";
  if (taskStatus === "failed") return "RECOVERY_AVAILABLE";
  if (taskStatus === "completed") return "COMPLETED";
  return "AVAILABLE";
}

export function friendlyWorkspaceFailure(taskStatus?: string): string | null {
  return taskStatus === "failed"
    ? "This workflow needs attention. Open it to review the available recovery action."
    : null;
}
