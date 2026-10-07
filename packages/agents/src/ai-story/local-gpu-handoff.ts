import {
  LOCAL_GPU_AUTO_APPROVED,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  type AiStoryAudioQcExpectation,
  type AiStoryGenerationResult,
  type AiStoryLocalGenerationPackage,
} from "@ceo-agent/shared";
import { buildGenerationResultPostQcInput } from "./generation-result-service";

/**
 * LOCAL_GPU uses the existing Generation Result, Audio QC, and Post-QC
 * contracts. This handoff does not approve, retry, or evaluate a second lifecycle.
 */
export function handoffLocalGpuToExistingReview(input: {
  result: AiStoryGenerationResult;
  package: AiStoryLocalGenerationPackage;
  audioQcExpectationKind: AiStoryAudioQcExpectation["expectationKind"] | null;
}) {
  if (input.result.source.sourceKind !== "LOCAL_GPU_WORKER") {
    throw new Error("LOCAL_GPU_GENERATION_RESULT_REQUIRED");
  }
  return {
    generationResult: input.result,
    postQcInput: buildGenerationResultPostQcInput(input.result, input.package),
    audioQcExpectationKind: input.audioQcExpectationKind,
    autoApproved: LOCAL_GPU_AUTO_APPROVED,
    automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  };
}
