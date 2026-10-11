import { LOCAL_GPU_REMOTE_PROVIDER_FALLBACK, LocalGpuContractError } from "@ceo-agent/shared/server";

export type LocalGpuAudioEvidence = {
  readonly hasAudio: true;
  readonly speechContent: "HUMAN_REVIEW_REQUIRED";
};

/** A later evaluation may not erase speech evidence that was already recorded for an audible result. */
export function carryLocalGpuAudioEvidence(input: {
  hasAudio: boolean;
  prior: LocalGpuAudioEvidence | null;
  successor: LocalGpuAudioEvidence | null;
}): LocalGpuAudioEvidence | null {
  if (!input.hasAudio) return null;
  if (!input.prior) throw new LocalGpuContractError("LOCAL_GPU_AUDIO_EVIDENCE_REQUIRED");
  if (
    !input.successor
    || input.successor.hasAudio !== true
    || input.successor.speechContent !== input.prior.speechContent
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_AUDIO_EVIDENCE_DROPPED");
  }
  return input.successor;
}

/**
 * Completion plan for one Desktop job. Reuses an existing result and never authorizes another POST.
 * Materializing the row stays on the Phase 1 accept path; this function does not write.
 */
export function planLocalGpuCompletion(input: {
  jobId: string;
  existingResultId: string | null;
  contentHash: string;
}): {
  action: "reuse" | "materialize_once";
  jobId: string;
  generationResultId: string | null;
  submit: false;
  remoteProviderFallback: 0;
} {
  if (!/^[0-9a-f-]{36}$/i.test(input.jobId)) throw new LocalGpuContractError("LOCAL_GPU_JOB_IDENTITY_REQUIRED");
  if (input.existingResultId) {
    return {
      action: "reuse",
      jobId: input.jobId,
      generationResultId: input.existingResultId,
      submit: false,
      remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
    };
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(input.contentHash)) {
    throw new LocalGpuContractError("LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED");
  }
  return {
    action: "materialize_once",
    jobId: input.jobId,
    generationResultId: null,
    submit: false,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  };
}
