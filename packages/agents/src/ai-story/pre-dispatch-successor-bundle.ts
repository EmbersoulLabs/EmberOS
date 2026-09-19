import {
  ProviderExecutionSchema,
  SceneProviderSchedulingCorrelationSchema,
  createExecutionDispatch,
  createExecutionEnvelope,
  type AiStoryCompiledProviderRequest,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  type ScheduleAcceptedBundleInput,
} from "@ceo-agent/db";

/** Builds, but does not persist, a deterministic successor for the same Scene/release authority. */
export async function buildAiStoryPreDispatchSuccessorBundle(input: {
  readonly source: ScheduleAcceptedBundleInput;
  readonly sourceDispatch: ExecutionDispatch;
  readonly compiledProviderRequest: AiStoryCompiledProviderRequest;
  readonly targetContractVersion: string;
  readonly createdAt: string;
}): Promise<{ successor: ScheduleAcceptedBundleInput; dispatch: ExecutionDispatch }> {
  const seed = {
    sourceDispatchId: input.sourceDispatch.dispatchId,
    successorFingerprint: input.compiledProviderRequest.requestFingerprint,
    targetContractVersion: input.targetContractVersion,
  };
  const correlationId = deterministicPersistenceUuid("ai-story-supersession-correlation", seed);
  const executionId = `execution:${deterministicPersistenceUuid("ai-story-supersession-execution", seed)}`;
  const outboxJobId = `outbox:${deterministicPersistenceUuid("ai-story-supersession-outbox", seed)}`;
  const envelopeId = `envelope:${deterministicPersistenceUuid("ai-story-supersession-envelope", seed)}`;
  const payloadReference = `db://ai-story-compiled-provider-requests/${input.compiledProviderRequest.compiledRequestId}`;
  const idempotencyKey = `supersession:${deterministicPersistenceUuid("ai-story-supersession-idempotency", seed)}`;
  const canonicalRequest = {
    ...input.source.envelope.canonicalRequest,
    executionIdentity: {
      ...input.source.envelope.canonicalRequest.executionIdentity,
      executionId,
      idempotencyKey,
      deterministicFingerprint: canonicalPersistenceHash({ kind: "ai-story-supersession-execution.v1", seed }),
    },
    normalizedPayloadReference: {
      ...input.source.envelope.canonicalRequest.normalizedPayloadReference,
      uri: payloadReference,
      contentHash: input.compiledProviderRequest.requestFingerprint,
    },
    correlation: {
      correlationId,
      pipelineRunId: input.source.envelope.canonicalRequest.correlation.pipelineRunId,
      queueJobId: outboxJobId,
    },
  };
  const envelope = await createExecutionEnvelope({
    ...input.source.envelope,
    envelopeId,
    payloadReference,
    executionContext: {
      ...input.source.envelope.executionContext,
      executionId,
      correlationId,
      queueJobId: outboxJobId,
      idempotencyKey,
      trace: {
        ...input.source.envelope.executionContext.trace,
        compiledRequestId: input.compiledProviderRequest.compiledRequestId,
        compiledRequestFingerprint: input.compiledProviderRequest.requestFingerprint,
      },
    },
    canonicalRequest,
    createdAt: input.createdAt,
  });
  const providerExecution = ProviderExecutionSchema.parse({
    ...input.source.providerExecution,
    identity: canonicalRequest.executionIdentity,
    metadata: {
      ...input.source.providerExecution.metadata,
      correlationId,
      queueJobId: outboxJobId,
      createdAt: input.createdAt,
    },
    createdAt: input.createdAt,
  });
  const correlation = SceneProviderSchedulingCorrelationSchema.parse({
    ...input.source.correlation,
    correlationId,
    providerExecutionId: executionId,
    envelopeId,
    outboxJobId,
    requestHash: envelope.requestHash,
    envelopeHash: envelope.envelopeHash,
    schedulingIdentityHash: canonicalPersistenceHash({ kind: "ai-story-supersession-scheduling.v1", seed }),
    scheduledAt: input.createdAt,
  });
  const successor: ScheduleAcceptedBundleInput = {
    ...input.source,
    providerExecution,
    compiledProviderRequest: input.compiledProviderRequest,
    requestHash: envelope.requestHash,
    envelope,
    outboxJob: {
      jobId: outboxJobId,
      executionId,
      payloadReference,
      correlationId,
      nextVisibleAt: new Date(input.createdAt),
    },
    correlation,
  };
  const dispatch = await createExecutionDispatch({
    version: "1",
    jobId: outboxJobId,
    executionId,
    envelopeId,
    payloadReference,
    correlationId,
    tenantId: correlation.ownership.orgId,
    workspaceId: correlation.ownership.workspaceId,
    capabilityId: input.source.routingDecision.capabilityId,
    capabilityVersion: input.source.routingDecision.capabilityVersion,
    requestHash: envelope.requestHash,
    envelopeHash: envelope.envelopeHash,
    workerHandoff: { envelopeId, payloadReference, dispatchContractVersion: "1" },
    createdAt: input.createdAt,
  });
  return { successor, dispatch };
}
