export type PlanningApprovalResponse = {
  readonly status: string;
  readonly storyId?: string;
  readonly animationPackage?: unknown;
};

export type PlanningApprovalRequest = {
  readonly campaignId: string;
  readonly storyId: string;
};

export type PlanningApprovalFetch = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>;

export class PlanningApprovalClientError extends Error {
  readonly code: string;

  constructor(message: string, code = "PLANNING_APPROVAL_REQUEST_FAILED") {
    super(message);
    this.name = "PlanningApprovalClientError";
    this.code = code;
  }
}

function approvalEndpoint(input: PlanningApprovalRequest): string {
  return `/api/campaigns/${encodeURIComponent(input.campaignId)}/ai-stories/${encodeURIComponent(input.storyId)}/planning/approve`;
}

export async function dispatchPlanningApproval(
  input: PlanningApprovalRequest,
  fetchImpl: PlanningApprovalFetch = fetch
): Promise<PlanningApprovalResponse> {
  const response = await fetchImpl(approvalEndpoint(input), {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    if (!response.ok) {
      throw new PlanningApprovalClientError(
        "Planning approval failed",
        `HTTP_${response.status}`
      );
    }
  }

  if (!response.ok) {
    throw new PlanningApprovalClientError(
      typeof payload.error === "string" ? payload.error : "Planning approval failed",
      typeof payload.code === "string" ? payload.code : `HTTP_${response.status}`
    );
  }

  return {
    status: typeof payload.status === "string" ? payload.status : "ready_for_execution",
    storyId: typeof payload.storyId === "string" ? payload.storyId : undefined,
    animationPackage: payload.animationPackage,
  };
}

export function createPlanningApprovalRequestGate(
  dispatch: (
    input: PlanningApprovalRequest
  ) => Promise<PlanningApprovalResponse> = dispatchPlanningApproval
): {
  approve(input: PlanningApprovalRequest): Promise<PlanningApprovalResponse>;
} {
  let pending: Promise<PlanningApprovalResponse> | null = null;
  let accepted: PlanningApprovalResponse | null = null;

  return {
    approve(input) {
      if (accepted) return Promise.resolve(accepted);
      if (pending) return pending;

      pending = dispatch(input)
        .then((result) => {
          accepted = result;
          return result;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
  };
}
