import {
  AiStoryProviderRuntimeJobSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryModeResolutionSnapshot,
} from "@ceo-agent/shared";
import type {
  AiStoryProviderCapabilityDeclaration,
  AiStoryProviderCompileIntent,
  AiStoryProviderResolution,
} from "./provider-capability-resolution";
import {
  AiStoryAnalysisAuthorityPinSchema,
  buildAiStoryCanonicalExecutionAuthority,
  type AiStoryCanonicalExecutionAuthority,
  type AiStoryCanonicalExecutionAuthorityRepository,
  InMemoryAiStoryCanonicalExecutionAuthorityRepository,
} from "./asset-aware-execution-authority";
import {
  createAiStoryProviderAttempt,
  type AiStoryProviderRuntimeRepository,
  type AiStoryRuntimeFreshness,
  InMemoryAiStoryProviderRuntimeRepository,
} from "./provider-runtime-dispatch-integration";
import type { z } from "zod";

export async function scheduleAssetAwareCanonicalProviderExecution(input: {
  readonly plannerSnapshot: AiStoryModeResolutionSnapshot;
  readonly analysisAuthorities: readonly z.input<
    typeof AiStoryAnalysisAuthorityPinSchema
  >[];
  readonly providerResolution: AiStoryProviderResolution;
  readonly providerCapability: AiStoryProviderCapabilityDeclaration;
  readonly providerCompileIntent: AiStoryProviderCompileIntent;
  readonly compiledRequest: AiStoryCompiledProviderRequest;
  readonly freshness: AiStoryRuntimeFreshness;
  readonly idempotencyKey: string;
  readonly providerExecutionId?: string;
  readonly attemptNumber?: number;
  readonly scheduledAt: string;
  readonly runtimeRepository: AiStoryProviderRuntimeRepository;
  readonly authorityRepository: AiStoryCanonicalExecutionAuthorityRepository;
}): Promise<{
  readonly authority: AiStoryCanonicalExecutionAuthority;
  readonly attempt: Awaited<
    ReturnType<typeof createAiStoryProviderAttempt>
  >["attempt"];
  readonly job: ReturnType<typeof AiStoryProviderRuntimeJobSchema.parse>;
  readonly replayed: boolean;
}> {
  const scheduled = await createAiStoryProviderAttempt({
    repository: input.runtimeRepository,
    request: input.compiledRequest,
    freshness: input.freshness,
    idempotencyKey: input.idempotencyKey,
    providerExecutionId: input.providerExecutionId,
    attemptNumber: input.attemptNumber,
    now: input.scheduledAt,
  });
  const authority = buildAiStoryCanonicalExecutionAuthority({
    plannerSnapshot: input.plannerSnapshot,
    analysisAuthorities: input.analysisAuthorities,
    providerResolution: input.providerResolution,
    providerCapability: input.providerCapability,
    providerCompileIntent: input.providerCompileIntent,
    compiledRequest: input.compiledRequest,
    providerAttempt: scheduled.attempt,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.scheduledAt,
  });
  const job = AiStoryProviderRuntimeJobSchema.parse({
    ...scheduled.job,
    executionAuthorityId: authority.executionAuthorityId,
    executionAuthorityFingerprint:
      authority.authorityFingerprint,
    plannerSnapshotId:
      authority.plannerSnapshot.plannerSnapshotId,
    providerResolutionId:
      authority.providerResolution.providerResolutionId,
    compileIntentId:
      authority.providerCompileIntent.compileIntentId,
    compiledRequestId: authority.compiledRequestId,
    requestFingerprint: authority.requestFingerprint,
  });
  const acceptedAuthority =
    await input.authorityRepository.acceptAuthority(authority, job);
  return {
    authority: acceptedAuthority,
    attempt: scheduled.attempt,
    job,
    replayed: scheduled.replayed,
  };
}

export async function prepareAssetAwareCanonicalProviderExecution(
  input: Omit<
    Parameters<typeof scheduleAssetAwareCanonicalProviderExecution>[0],
    "runtimeRepository" | "authorityRepository"
  >
) {
  return scheduleAssetAwareCanonicalProviderExecution({
    ...input,
    runtimeRepository: new InMemoryAiStoryProviderRuntimeRepository(),
    authorityRepository:
      new InMemoryAiStoryCanonicalExecutionAuthorityRepository(),
  });
}
