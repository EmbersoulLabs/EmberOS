import { describe, expect, it } from "vitest";
import {
  PROVIDER_RELIABILITY_CONTRACT_VERSION,
  areContextVersionsCompatible,
  createProviderError,
  deserializeCallbackEvent,
  deserializeCanonicalProviderRequest,
  deserializeCanonicalProviderResult,
  deserializeCapabilityContract,
  deserializeDeliveryAttempt,
  deserializeProviderAttempt,
  deserializeProviderError,
  deserializeProviderExecution,
  deterministicFingerprint,
  isCapabilityCompatible,
  isOutputCompatible,
  isVersionCompatible,
  normalizeDeterministicInput,
  providerErrorPolicy,
  requestHash,
  responseHash,
  serializeCallbackEvent,
  serializeCanonicalProviderRequest,
  serializeCanonicalProviderResult,
  serializeCapabilityContract,
  serializeDeliveryAttempt,
  serializeProviderAttempt,
  serializeProviderError,
  serializeProviderExecution,
  stableSerialize,
  validateCallbackEvent,
  validateCanonicalProviderRequest,
  validateCanonicalProviderResult,
  validateCapabilityContract,
  validateDeliveryAttempt,
  validateProviderAttempt,
  validateProviderError,
  validateProviderExecution,
  type CapabilityContract,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
} from "../packages/shared/src/provider-reliability-contracts";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const NOW = "2026-07-26T00:00:00.000Z";

function capability(): CapabilityContract {
  return {
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    capabilityId: "marketing-score",
    capabilityVersion: "1.2.0",
    requestSchemaVersion: "1.1.0",
    resultSchemaVersion: "1.3.0",
    compatibleContextVersions: [
      { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    ],
    deprecationStatus: "ACTIVE",
    validationRules: [
      {
        ruleId: "score-range",
        description: "Scores must use the approved range",
        severity: "ERROR",
      },
    ],
    providerRequirements: {
      capabilities: ["structured-output", "text-generation"],
      structuredOutput: true,
      nativeIdempotency: false,
      executionLookup: true,
    },
    metadata: {
      displayName: "Marketing Score",
      description: "Evaluates final marketing output",
      owner: "marketing-pipeline",
      tags: ["finalization"],
    },
  };
}

function executionIdentity() {
  return {
    executionId: "execution-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    campaignId: "campaign-1",
    pipelineRunId: "pipeline-run-1",
    capabilityId: "marketing-score",
    capabilityVersion: "1.2.0",
    idempotencyKey: "provider-execution:v1:marketing-score:input-a",
    deterministicFingerprint: HASH_A,
  };
}

function request(): CanonicalProviderRequest {
  return {
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    executionIdentity: executionIdentity(),
    requestSchemaVersion: "1.1.0",
    resultSchemaVersion: "1.3.0",
    normalizedPayloadReference: {
      uri: "object://provider-input/input-a.json",
      contentHash: HASH_A,
      mediaType: "application/json",
    },
    outputSchema: {
      schemaId: "marketing-score-result",
      schemaVersion: "1.3.0",
    },
    contextVersions: {
      CampaignAIContext: "1.0.0",
    },
    correlation: {
      correlationId: "correlation-1",
      pipelineRunId: "pipeline-run-1",
      queueJobId: "queue-job-1",
    },
    timeoutPolicy: {
      timeoutMs: 30_000,
      reconciliationDelayMs: 5_000,
    },
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 1_000,
      maximumDelayMs: 30_000,
      backoffMultiplier: 2,
    },
    providerConstraints: {
      allowedProviderIds: ["provider-a", "provider-b"],
      requiredRegions: ["sg"],
      maximumEstimatedCostUsd: 0.2,
      executionLookupRequired: true,
    },
  };
}

function result(): CanonicalProviderResult {
  return {
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    executionId: "execution-1",
    providerAttemptId: "provider-attempt-1",
    normalizedOutput: { overallScore: 88 },
    resultReference: "object://provider-results/result-a.json",
    warnings: [],
    providerMetadata: {
      providerId: "provider-a",
      providerVersion: "2026-07",
      providerRequestId: "provider-request-1",
    },
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      providerUsageId: "usage-1",
    },
    cost: {
      amount: 0.012,
      currency: "USD",
      estimated: false,
    },
    modelVersion: "model-2026-07",
    requestHash: HASH_A,
    responseHash: HASH_B,
    retryable: false,
    validationStatus: "VALID",
  };
}

describe("PR-3A.5C.1 provider reliability contracts", () => {
  it("serializes, validates, and freezes Capability contracts", () => {
    const validated = validateCapabilityContract(capability());
    const roundTrip = deserializeCapabilityContract(
      serializeCapabilityContract(validated)
    );

    expect(roundTrip).toEqual(validated);
    expect(Object.isFrozen(roundTrip)).toBe(true);
    expect(Object.isFrozen(roundTrip.providerRequirements)).toBe(true);
    expect(Object.isFrozen(roundTrip.metadata.tags)).toBe(true);
  });

  it("rejects malformed versions, empty requirements, and unknown fields", () => {
    expect(() =>
      validateCapabilityContract({
        ...capability(),
        capabilityVersion: "v1",
      })
    ).toThrow();
    expect(() =>
      validateCapabilityContract({
        ...capability(),
        providerRequirements: {
          capabilities: [],
          structuredOutput: true,
        },
      })
    ).toThrow();
    expect(() =>
      validateCapabilityContract({ ...capability(), providerName: "openai" })
    ).toThrow();
  });

  it("applies explicit half-open version compatibility ranges", () => {
    const range = { minInclusive: "1.2.0", maxExclusive: "2.0.0" };
    expect(isVersionCompatible("1.2.0", range)).toBe(true);
    expect(isVersionCompatible("1.9.9", range)).toBe(true);
    expect(isVersionCompatible("1.1.9", range)).toBe(false);
    expect(isVersionCompatible("2.0.0", range)).toBe(false);
  });

  it("checks capability, schema, context, and output compatibility independently", () => {
    const ranges = [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }];
    const support = {
      capabilityId: "marketing-score",
      capabilityVersions: ranges,
      requestSchemaVersions: ranges,
      resultSchemaVersions: ranges,
      contextVersions: { CampaignAIContext: ranges },
    };

    expect(isCapabilityCompatible(capability(), support)).toBe(true);
    expect(
      areContextVersionsCompatible(
        { CampaignAIContext: "1.5.0" },
        support.contextVersions
      )
    ).toBe(true);
    expect(
      areContextVersionsCompatible(
        { CampaignAIContext: "2.0.0" },
        support.contextVersions
      )
    ).toBe(false);
    expect(isOutputCompatible("1.9.0", ranges)).toBe(true);
    expect(
      isCapabilityCompatible(
        { ...capability(), deprecationStatus: "RETIRED" },
        support
      )
    ).toBe(false);
  });

  it("keeps logical execution, provider attempt, delivery attempt, and callback separate", () => {
    const execution = validateProviderExecution({
      contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
      identity: executionIdentity(),
      metadata: {
        skillId: "AI-007",
        skillVersion: "1.0.0",
        contextVersions: { CampaignAIContext: "1.0.0" },
        outputSchemaId: "marketing-score-result",
        outputSchemaVersion: "1.3.0",
        correlationId: "correlation-1",
        queueJobId: "queue-job-1",
        createdAt: NOW,
      },
      status: "EXECUTING",
      createdAt: NOW,
    });
    const attempt = validateProviderAttempt({
      contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
      attemptId: "provider-attempt-1",
      executionId: execution.identity.executionId,
      attemptNumber: 0,
      providerId: "provider-a",
      providerVersion: "2026-07",
      modelVersion: "model-2026-07",
      requestHash: HASH_A,
      status: "EXECUTING",
      startedAt: NOW,
    });
    const delivery = validateDeliveryAttempt({
      contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
      deliveryAttemptId: "delivery-attempt-1",
      executionId: execution.identity.executionId,
      providerAttemptId: attempt.attemptId,
      deliveryNumber: 0,
      status: "CLAIMED",
      leaseOwner: "worker-1",
      leaseExpiresAt: "2026-07-26T00:01:00.000Z",
    });
    const callback = validateCallbackEvent({
      contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
      callbackEventId: "callback-1",
      executionId: execution.identity.executionId,
      providerAttemptId: attempt.attemptId,
      providerId: attempt.providerId,
      providerRequestId: "provider-request-1",
      eventType: "completed",
      payloadHash: HASH_B,
      status: "RECEIVED",
      receivedAt: NOW,
    });

    expect(execution.identity.executionId).toBe("execution-1");
    expect(attempt.attemptId).not.toBe(execution.identity.executionId);
    expect(delivery.deliveryAttemptId).not.toBe(attempt.attemptId);
    expect(callback.callbackEventId).not.toBe(delivery.deliveryAttemptId);

    expect(
      deserializeProviderExecution(serializeProviderExecution(execution))
    ).toEqual(execution);
    expect(
      deserializeProviderAttempt(serializeProviderAttempt(attempt))
    ).toEqual(attempt);
    expect(
      deserializeDeliveryAttempt(serializeDeliveryAttempt(delivery))
    ).toEqual(delivery);
    expect(deserializeCallbackEvent(serializeCallbackEvent(callback))).toEqual(
      callback
    );
  });

  it("validates and round-trips provider-independent canonical requests", () => {
    const validated = validateCanonicalProviderRequest(request());
    const roundTrip = deserializeCanonicalProviderRequest(
      serializeCanonicalProviderRequest(validated)
    );
    expect(roundTrip).toEqual(validated);
    expect(Object.isFrozen(roundTrip.executionIdentity)).toBe(true);
    expect(JSON.stringify(roundTrip)).not.toContain("openai");
  });

  it("rejects invalid retry policy and provider-specific request fields", () => {
    expect(() =>
      validateCanonicalProviderRequest({
        ...request(),
        retryPolicy: {
          ...request().retryPolicy,
          initialDelayMs: 5_000,
          maximumDelayMs: 1_000,
        },
      })
    ).toThrow("maximumDelayMs");
    expect(() =>
      validateCanonicalProviderRequest({
        ...request(),
        openaiMessages: [],
      })
    ).toThrow();
  });

  it("validates, serializes, and freezes canonical results", () => {
    const validated = validateCanonicalProviderResult(result());
    const roundTrip = deserializeCanonicalProviderResult(
      serializeCanonicalProviderResult(validated)
    );
    expect(roundTrip).toEqual(validated);
    expect(Object.isFrozen(roundTrip.normalizedOutput)).toBe(true);
    expect(roundTrip.providerMetadata.providerId).toBe("provider-a");
  });

  it("rejects malformed hashes, currency, and provider-specific result fields", () => {
    expect(() =>
      validateCanonicalProviderResult({ ...result(), responseHash: "bad" })
    ).toThrow();
    expect(() =>
      validateCanonicalProviderResult({
        ...result(),
        cost: { amount: 1, currency: "usd", estimated: false },
      })
    ).toThrow();
    expect(() =>
      validateCanonicalProviderResult({
        ...result(),
        openaiResponse: { id: "response-1" },
      })
    ).toThrow();
  });

  it("enforces the canonical error taxonomy flags", () => {
    expect(providerErrorPolicy("TIMEOUT_UNKNOWN")).toEqual({
      retryable: false,
      terminal: false,
      needsReconciliation: true,
    });
    const rateLimit = createProviderError("RATE_LIMITED", {
      code: "rate_limit",
      message: "Provider rate limit",
      retryAfterMs: 1_000,
    });
    expect(rateLimit).toMatchObject({
      retryable: true,
      terminal: false,
      needsReconciliation: false,
    });
    expect(
      deserializeProviderError(serializeProviderError(rateLimit))
    ).toEqual(rateLimit);
    expect(() =>
      validateProviderError({
        contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
        kind: "AUTHENTICATION_FAILURE",
        code: "bad_key",
        message: "Authentication failed",
        retryable: true,
        terminal: false,
        needsReconciliation: false,
      })
    ).toThrow("Error flags");
  });

  it("defines a policy for every required error kind", () => {
    const kinds = [
      "RETRYABLE",
      "TIMEOUT_UNKNOWN",
      "RATE_LIMITED",
      "VALIDATION_FAILURE",
      "AUTHENTICATION_FAILURE",
      "POLICY_REJECTION",
      "PROVIDER_UNAVAILABLE",
      "CONFLICT",
      "DUPLICATE",
      "CANCELLED",
      "TERMINAL_FAILURE",
    ] as const;
    for (const kind of kinds) {
      expect(providerErrorPolicy(kind)).toEqual({
        retryable: expect.any(Boolean),
        terminal: expect.any(Boolean),
        needsReconciliation: expect.any(Boolean),
      });
    }
  });

  it("normalizes object ordering and canonical numeric values", () => {
    expect(stableSerialize({ z: 1, a: { y: -0, x: 2 } })).toBe(
      '{"a":{"x":2,"y":0},"z":1}'
    );
    expect(normalizeDeterministicInput({ b: 2, a: 1 })).toEqual({
      a: 1,
      b: 2,
    });
    expect(() => stableSerialize({ value: Number.NaN })).toThrow(
      "Non-finite"
    );
  });

  it("rejects volatile fields, UUIDs, Dates, and unsupported values from deterministic input", () => {
    expect(() =>
      normalizeDeterministicInput({ workerId: "worker-1", value: "stable" })
    ).toThrow("Volatile field workerId");
    expect(() =>
      normalizeDeterministicInput({
        value: "123e4567-e89b-42d3-a456-426614174000",
      })
    ).toThrow("Random UUID");
    expect(() => normalizeDeterministicInput({ value: new Date() })).toThrow(
      "Unsupported canonical value"
    );
    expect(() => normalizeDeterministicInput({ value: BigInt(1) })).toThrow(
      "Unsupported canonical value"
    );
  });

  it("produces identical fingerprints for identical logical inputs regardless of key order", async () => {
    const first = await deterministicFingerprint({
      capability: "marketing-score",
      input: { objective: "launch", platforms: ["tiktok", "instagram"] },
    });
    const second = await deterministicFingerprint({
      input: { platforms: ["tiktok", "instagram"], objective: "launch" },
      capability: "marketing-score",
    });
    const changed = await deterministicFingerprint({
      capability: "marketing-score",
      input: { objective: "retention", platforms: ["tiktok", "instagram"] },
    });

    expect(first).toBe(second);
    expect(changed).not.toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("separates deterministic fingerprints, request hashes, and response hashes", async () => {
    const fingerprint = await deterministicFingerprint({
      capability: "marketing-score",
      payloadHash: HASH_A,
    });
    const requestDigest = await requestHash({
      model: "model-a",
      payloadHash: HASH_A,
    });
    const responseDigest = await responseHash({
      result: { overallScore: 88 },
    });

    expect(new Set([fingerprint, requestDigest, responseDigest]).size).toBe(3);
  });
});
