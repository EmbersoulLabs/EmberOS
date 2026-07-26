import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestHash,
  type CanonicalProviderRequest,
} from "@ceo-agent/shared";
import type { ProviderExecutionContext } from "../packages/agents/src/provider-adapters/contracts";

const { callJsonModel } = vi.hoisted(() => ({ callJsonModel: vi.fn() }));
vi.mock("../packages/agents/src/llm", () => ({ callJsonModel }));

import {
  OpenAIJsonCompatibilityAdapter,
  ProviderAdapterError,
} from "../packages/agents/src/provider-adapters";

const hash = (character: string) => `sha256:${character.repeat(64)}`;

function request(): CanonicalProviderRequest {
  return {
    contractVersion: "1",
    executionIdentity: {
      executionId: "execution-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      pipelineRunId: "pipeline-run-1",
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      idempotencyKey: "idem-1",
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
      schemaId: "MarketingResult",
      schemaVersion: "1.0.0",
    },
    contextVersions: { CampaignAIContext: "1.0.0" },
    correlation: {
      correlationId: "correlation-1",
      pipelineRunId: "pipeline-run-1",
      queueJobId: "queue-job-1",
    },
    timeoutPolicy: { timeoutMs: 30_000, reconciliationDelayMs: 5_000 },
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maximumDelayMs: 1_000,
      backoffMultiplier: 2,
    },
    providerConstraints: {
      allowedProviderIds: ["openai"],
      requiredRegions: ["US"],
    },
  };
}

function context(): ProviderExecutionContext {
  return {
    executionId: "execution-1",
    providerAttemptId: "attempt-1",
    correlationId: "correlation-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    timeoutDeadline: new Date(Date.now() + 60_000).toISOString(),
    idempotencyKey: "idem-1",
    capability: {
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
    },
    dataHandling: {
      allowedRegions: ["US"],
      sensitiveData: false,
      retentionAllowed: false,
    },
    trace: { traceId: "trace-1" },
  };
}

function adapter(payload: unknown = {
  system: "System prompt",
  user: "User prompt",
  schemaHint: '{"summary":"string"}',
  preferredModel: "gpt-4o-mini",
}) {
  return new OpenAIJsonCompatibilityAdapter({
    resolve: vi.fn().mockResolvedValue(payload),
  });
}

function providerError(error: unknown) {
  expect(error).toBeInstanceOf(ProviderAdapterError);
  return (error as ProviderAdapterError).providerError;
}

describe("PR-3A.5C.4 Provider Adapter", () => {
  beforeEach(() => {
    callJsonModel.mockReset();
    callJsonModel.mockResolvedValue({
      result: { summary: "canonical" },
      usage: { input: 20, output: 10, costUsd: 0.001 },
      providerRequestId: "chatcmpl-1",
      modelVersion: "gpt-4o-mini-2026-01-01",
    });
  });

  it("declares explicit provider and version compatibility", () => {
    const declaration = [...adapter().capabilities()][0]!;
    expect(declaration).toMatchObject({
      providerId: "openai",
      adapterVersion: "1.0.0",
      capabilityId: "json-generation",
      nativeIdempotency: false,
      lookup: false,
      cancellation: false,
      callbacks: false,
      streaming: false,
    });
    expect(declaration.capabilityVersions).toEqual([
      { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    ]);
    expect(declaration.requestSchemaVersions).toEqual([
      { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    ]);
    expect(declaration.resultSchemaVersions).toEqual([
      { minInclusive: "1.0.0", maxExclusive: "2.0.0" },
    ]);
  });

  it("maps a validated request without mutating canonical input", async () => {
    const canonical = request();
    const snapshot = structuredClone(canonical);
    await adapter().execute(canonical, context());

    expect(canonical).toEqual(snapshot);
    expect(callJsonModel).toHaveBeenCalledWith(
      "System prompt",
      "User prompt",
      '{"summary":"string"}',
      { model: "gpt-4o-mini" }
    );
  });

  it("normalizes result identity, usage, cost, hashes, and provenance", async () => {
    const canonical = request();
    const executionContext = context();
    const result = await adapter().execute(canonical, executionContext);
    const expectedRequestHash = await requestHash(canonical);

    expect(result).toMatchObject({
      executionId: "execution-1",
      providerAttemptId: "attempt-1",
      normalizedOutput: { summary: "canonical" },
      resultReference: "provider-result://openai/chatcmpl-1",
      providerMetadata: {
        providerId: "openai",
        providerVersion: "openai-api-v1",
        providerRequestId: "chatcmpl-1",
      },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      cost: { amount: 0.001, currency: "USD", estimated: true },
      modelVersion: "gpt-4o-mini-2026-01-01",
      requestHash: expectedRequestHash,
      validationStatus: "VALID",
    });
    expect(result.responseHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.provenance).toEqual([
      {
        providerId: "openai",
        adapterVersion: "1.0.0",
        modelVersion: "gpt-4o-mini-2026-01-01",
        providerRequestId: "chatcmpl-1",
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects mismatched infrastructure context before provider execution", async () => {
    await expect(
      adapter().execute(request(), { ...context(), executionId: "wrong" })
    ).rejects.toMatchObject({
      providerError: { kind: "TERMINAL_FAILURE" },
    });
    expect(callJsonModel).not.toHaveBeenCalled();
  });

  it("enforces explicit provider constraints", async () => {
    await expect(
      adapter().execute(
        {
          ...request(),
          providerConstraints: { allowedProviderIds: ["gemini"] },
        },
        context()
      )
    ).rejects.toMatchObject({
      providerError: { kind: "TERMINAL_FAILURE" },
    });
    await expect(
      adapter().execute(
        {
          ...request(),
          providerConstraints: { nativeIdempotencyRequired: true },
        },
        context()
      )
    ).rejects.toMatchObject({
      providerError: { kind: "TERMINAL_FAILURE" },
    });
    expect(callJsonModel).not.toHaveBeenCalled();
  });

  it("normalizes rate limits", async () => {
    callJsonModel.mockRejectedValue(
      Object.assign(new Error("Too many requests"), { status: 429, code: "rate_limit" })
    );
    const error = await adapter().execute(request(), context()).catch((value) => value);
    expect(providerError(error)).toMatchObject({
      kind: "RATE_LIMITED",
      retryable: true,
      terminal: false,
    });
  });

  it("normalizes timeout ambiguity for reconciliation", async () => {
    callJsonModel.mockRejectedValue(new Error("Request timed out after provider acceptance"));
    const error = await adapter().execute(request(), context()).catch((value) => value);
    expect(providerError(error)).toMatchObject({
      kind: "TIMEOUT_UNKNOWN",
      retryable: false,
      needsReconciliation: true,
    });
  });

  it("normalizes policy and authentication rejection", async () => {
    callJsonModel.mockRejectedValueOnce(
      Object.assign(new Error("Content policy rejected"), { status: 403 })
    );
    const policy = await adapter().execute(request(), context()).catch((value) => value);
    expect(providerError(policy).kind).toBe("POLICY_REJECTION");

    callJsonModel.mockRejectedValueOnce(
      Object.assign(new Error("Invalid API key"), { status: 401 })
    );
    const auth = await adapter().execute(request(), context()).catch((value) => value);
    expect(providerError(auth).kind).toBe("AUTHENTICATION_FAILURE");
  });

  it("rejects malformed payloads and provider output", async () => {
    const malformedPayload = await adapter({ system: "" })
      .execute(request(), context())
      .catch((value) => value);
    expect(providerError(malformedPayload).kind).toBe("VALIDATION_FAILURE");

    callJsonModel.mockResolvedValueOnce({
      result: null,
      usage: { input: 1, output: 1, costUsd: 0 },
      providerRequestId: "chatcmpl-bad",
      modelVersion: "gpt-4o-mini",
    });
    const malformedOutput = await adapter()
      .execute(request(), context())
      .catch((value) => value);
    expect(providerError(malformedOutput).kind).toBe("VALIDATION_FAILURE");
  });

  it("returns normalized unsupported lookup and cancellation contracts", async () => {
    const compatibility = adapter();
    expect(await compatibility.lookup("chatcmpl-1", context())).toEqual({
      status: "UNSUPPORTED",
    });
    expect(await compatibility.cancel("chatcmpl-1", context())).toEqual({
      status: "UNSUPPORTED",
    });
  });

  it("keeps provider-specific and business persistence dependencies inside boundaries", () => {
    const contracts = readFileSync(
      resolve("packages/agents/src/provider-adapters/contracts.ts"),
      "utf8"
    );
    const implementation = readFileSync(
      resolve("packages/agents/src/provider-adapters/openai-json-adapter.ts"),
      "utf8"
    );
    const canonical = readFileSync(
      resolve("packages/shared/src/provider-reliability-contracts.ts"),
      "utf8"
    );

    expect(contracts).not.toMatch(/openai|@ceo-agent\/db|pipeline|ledger|outbox/i);
    expect(implementation).not.toMatch(
      /@ceo-agent\/db|provider-ledger|provider-outbox|pipeline-|createReview|routeJsonCompletion/
    );
    expect(canonical).not.toMatch(/from\s+["']openai["']/);
    expect(implementation).not.toMatch(/fallback|selectProvider|ProviderRouter/);
  });
});
