import {
  LOCAL_GPU_RECONCILE_ATTEMPT_LIMIT,
  LocalGpuContractError,
  localGpuJobIdFromGate,
  type LocalGpuJobState,
} from "@ceo-agent/shared/server";

export type LocalGpuReleaseRuntime = {
  gate: string | null;
  notFoundCount: number;
  uncertainCount: number;
};

export type LocalGpuCycleAction =
  | "submit"
  | "track"
  | "poll"
  | "recognize_completion"
  | "terminal"
  | "reconciliation_blocker"
  | "stop";

export type LocalGpuObservation =
  | { type: "submit_accepted" }
  | { type: "submit_rejected" }
  | { type: "submit_ambiguous" }
  | { type: "status"; state: LocalGpuJobState }
  | { type: "status_not_found" }
  | { type: "status_uncertain" };

function jobGate(runtime: LocalGpuReleaseRuntime): string {
  const jobId = localGpuJobIdFromGate(runtime.gate);
  if (!jobId) throw new LocalGpuContractError("LOCAL_GPU_JOB_IDENTITY_REQUIRED");
  return jobId;
}

function stopped(gate: string | null): boolean {
  return Boolean(gate && (/^failed:/i.test(gate) || /^blocked:/i.test(gate) || /^result:/i.test(gate)));
}

/** One transition. Never selects another provider and never authorizes a second POST. */
export function advanceLocalGpuRelease(
  runtime: LocalGpuReleaseRuntime,
  observation: LocalGpuObservation,
): LocalGpuReleaseRuntime & { action: LocalGpuCycleAction; submit: false; jobId: string } {
  const jobId = jobGate(runtime);
  if (stopped(runtime.gate)) return { ...runtime, action: "stop", submit: false, jobId };
  if (observation.type === "submit_accepted") {
    return { gate: jobId, notFoundCount: 0, uncertainCount: 0, action: "track", submit: false, jobId };
  }
  if (observation.type === "submit_rejected") {
    return { gate: `failed:${jobId}`, notFoundCount: runtime.notFoundCount, uncertainCount: runtime.uncertainCount, action: "terminal", submit: false, jobId };
  }
  if (observation.type === "submit_ambiguous") {
    return { gate: `reconcile:0:${jobId}`, notFoundCount: 0, uncertainCount: 0, action: "poll", submit: false, jobId };
  }
  if (observation.type === "status" && (observation.state === "FAILED" || observation.state === "CANCELLED")) {
    return { gate: `failed:${jobId}`, notFoundCount: 0, uncertainCount: 0, action: "terminal", submit: false, jobId };
  }
  if (observation.type === "status" && observation.state === "COMPLETED") {
    return { gate: `result:${jobId}`, notFoundCount: 0, uncertainCount: 0, action: "recognize_completion", submit: false, jobId };
  }
  if (observation.type === "status") {
    return { gate: jobId, notFoundCount: 0, uncertainCount: 0, action: "track", submit: false, jobId };
  }
  const count = observation.type === "status_not_found" ? runtime.notFoundCount + 1 : runtime.uncertainCount + 1;
  if (count >= LOCAL_GPU_RECONCILE_ATTEMPT_LIMIT) {
    return {
      gate: `blocked:${jobId}`,
      notFoundCount: observation.type === "status_not_found" ? count : runtime.notFoundCount,
      uncertainCount: observation.type === "status_uncertain" ? count : runtime.uncertainCount,
      action: "reconciliation_blocker",
      submit: false,
      jobId,
    };
  }
  return {
    gate: `reconcile:${count}:${jobId}`,
    notFoundCount: observation.type === "status_not_found" ? count : runtime.notFoundCount,
    uncertainCount: observation.type === "status_uncertain" ? count : runtime.uncertainCount,
    action: "poll",
    submit: false,
    jobId,
  };
}
