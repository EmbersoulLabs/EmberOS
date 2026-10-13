import { LOCAL_GPU_REMOTE_PROVIDER_FALLBACK } from "@ceo-agent/shared/server";
import { type LocalGpuAudioEvidence } from "./local-gpu-result-finalization";

export type LocalGpuReviewSnapshot = {
  readonly decision: "APPROVED" | "REJECTED" | null;
  readonly aggregateStatus: "POST_QC_PASS" | "POST_QC_REQUIRES_HUMAN_CONFIRMATION" | "POST_QC_REJECT" | null;
  readonly audio: LocalGpuAudioEvidence | null;
};

/** Review projection. Pending speech review is not a request to generate again. */
export function resolveLocalGpuReviewState(input: LocalGpuReviewSnapshot): {
  runtime: "PENDING_REVIEW" | "APPROVED" | "NOT_READY";
  regenerate: false;
  dispatch: false;
  remoteProviderFallback: 0;
} {
  const closed = {
    regenerate: false as const,
    dispatch: false as const,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  };
  if (input.decision === "APPROVED") return { runtime: "APPROVED", ...closed };
  if (
    input.aggregateStatus === "POST_QC_REQUIRES_HUMAN_CONFIRMATION"
    || input.audio?.speechContent === "HUMAN_REVIEW_REQUIRED"
  ) {
    return { runtime: "PENDING_REVIEW", ...closed };
  }
  return { runtime: "NOT_READY", ...closed };
}

export function localGpuAssemblyHandoff(input: LocalGpuReviewSnapshot): {
  assemblyEligible: boolean;
  dispatch: false;
  remoteProviderFallback: 0;
} {
  const review = resolveLocalGpuReviewState(input);
  return {
    assemblyEligible: review.runtime === "APPROVED",
    dispatch: false,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  };
}

export type LocalGpuReviewCandidate = {
  readonly sourceKind: string;
  readonly workspaceId: string;
  readonly localPackageId: string | null;
  readonly generationResultId: string;
};

/** Selects the single worker result for a package. Does not create one. */
export function selectLocalGpuReviewResult<T extends LocalGpuReviewCandidate>(
  rows: readonly T[],
  scope: { workspaceId: string; packageId: string },
): T | null {
  const matches = rows.filter((row) =>
    row.sourceKind === "LOCAL_GPU_WORKER"
    && row.workspaceId === scope.workspaceId
    && row.localPackageId === scope.packageId
  );
  if (matches.length > 1) throw new Error("LOCAL_GPU_DUPLICATE_RESULT");
  return matches[0] ?? null;
}
