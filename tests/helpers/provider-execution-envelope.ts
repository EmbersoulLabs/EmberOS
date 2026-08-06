import type { CreateExecutionEnvelopeInput } from "@ceo-agent/shared";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

export function createEnvelopeInput(
  overrides: Partial<CreateExecutionEnvelopeInput> = {}
): CreateExecutionEnvelopeInput {
  const tenantId = "6f914e10-f197-49c7-b6b6-63c507c545cc";
  const workspaceId = "ad8c623e-c917-46f6-a5db-5730b255caf8";
  const executionId = "execution-envelope-1";
  const pipelineRunId = "pipeline-run-1";
  const correlationId = "correlation-1";
  const queueJobId = "queue-job-1";
  const idempotencyKey = "envelope-idempotency-1";
  return {
    version: "1",
    envelopeId: "envelope-1",
    payloadReference: "provider-envelope://envelope-1",
    tenantId,
    workspaceId,
    executionContext: {
      executionId,
      correlationId,
      pipelineRunId,
      queueJobId,
      idempotencyKey,
      timeoutDeadline: "2026-01-01T00:01:00.000Z",
      dataHandling: {
        sensitiveData: false,
        retentionAllowed: false,
      },
      trace: { traceId: "trace-1" },
    },
    capabilityId: "json-generation",
    capabilityVersion: "1.0.0",
    providerPolicySnapshot: {
      policyVersion: "1.0.0",
      allowedProviders: ["openai"],
    },
    canonicalRequest: {
      contractVersion: "1",
      executionIdentity: {
        executionId,
        tenantId,
        workspaceId,
        pipelineRunId,
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey,
        deterministicFingerprint: hash("a"),
      },
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      normalizedPayloadReference: {
        uri: "provider-payload://payload-1",
        contentHash: hash("b"),
        mediaType: "application/json",
      },
      outputSchema: {
        schemaId: "JsonGenerationResult",
        schemaVersion: "1.0.0",
      },
      contextVersions: { CampaignAIContext: "1.0.0" },
      correlation: { correlationId, pipelineRunId, queueJobId },
      timeoutPolicy: { timeoutMs: 60_000, reconciliationDelayMs: 5_000 },
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maximumDelayMs: 1_000,
        backoffMultiplier: 2,
      },
      providerConstraints: {},
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
