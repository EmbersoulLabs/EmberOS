import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  ProviderAdapter,
  ProviderCapabilityDeclaration,
} from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";
import {
  createExecutionDispatch,
  createExecutionEnvelope,
  type CanonicalProviderResult,
} from "../packages/shared/src";
import {
  ProviderExecutionWorker,
  type ProviderWorkerLogEntry,
} from "../apps/worker/src/provider-dispatch-worker";
import { createEnvelopeInput } from "./helpers/provider-execution-envelope";

const now = new Date("2026-07-26T08:00:00.000Z");

async function fixture(options: { adapterError?: Error } = {}) {
  const routingRequest: ProviderRoutingRequest = {
    routingRequestId: "routing-worker-1",
    capabilityId: "json-generation",
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: "6f914e10-f197-49c7-b6b6-63c507c545cc",
    workspaceId: "ad8c623e-c917-46f6-a5db-5730b255caf8",
    correlationId: "correlation-1",
    policyVersion: "1.0.0",
    requiredFeatures: ["STRUCTURED_OUTPUT"],
    requireLookup: false,
    requireCancellation: false,
    requireCallbacks: false,
    requireStreaming: false,
    dataHandling: {
      sensitiveData: false,
      externalProcessingAllowed: true,
      providerTrainingAllowed: false,
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
  const routingPolicy: ProviderRoutingPolicy = {
    policyVersion: "1.0.0",
    preferredProviders: [],
    requireTrainingOptOut: true,
  };
  const envelope = await createExecutionEnvelope(
    createEnvelopeInput({
      providerPolicySnapshot: { routingRequest, routingPolicy },
    })
  );
  const dispatch = await createExecutionDispatch({
    version: "1",
    jobId: envelope.executionContext.queueJobId!,
    executionId: envelope.executionContext.executionId,
    envelopeId: envelope.envelopeId,
    payloadReference: envelope.payloadReference,
    correlationId: envelope.executionContext.correlationId,
    tenantId: envelope.tenantId,
    workspaceId: envelope.workspaceId,
    capabilityId: envelope.capabilityId,
    capabilityVersion: envelope.capabilityVersion,
    requestHash: envelope.requestHash,
    envelopeHash: envelope.envelopeHash,
    workerHandoff: {
      envelopeId: envelope.envelopeId,
      payloadReference: envelope.payloadReference,
      dispatchContractVersion: "1",
    },
    createdAt: now.toISOString(),
  });
  const declaration: ProviderCapabilityDeclaration = {
    providerId: "provider-a",
    adapterVersion: "1.0.0",
    capabilityId: "json-generation",
    capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
    requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
    nativeIdempotency: true,
    lookup: false,
    cancellation: false,
    callbacks: false,
    streaming: false,
    routing: {
      costClass: "LOW",
      latencyClass: "FAST",
      qualityClass: "HIGH",
      reliabilityClass: "HIGH",
      regions: [],
      modelFamilies: ["model-a"],
      sensitiveDataAllowed: false,
      externalProcessing: true,
      trainingOptOut: true,
      zeroRetention: true,
      enterpriseControls: true,
    },
  };
  const execute = options.adapterError
    ? vi.fn().mockRejectedValue(options.adapterError)
    : vi.fn(async (_request, context): Promise<CanonicalProviderResult> => ({
        contractVersion: "1",
        executionId: dispatch.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput: { ok: true },
        resultReference: "provider-result://worker-1",
        warnings: [],
        providerMetadata: {
          providerId: "provider-a",
          providerVersion: "provider-a-v1",
        },
        usage: {},
        cost: { amount: 0, currency: "USD", estimated: false },
        modelVersion: "model-a",
        requestHash: `sha256:${"c".repeat(64)}`,
        responseHash: `sha256:${"d".repeat(64)}`,
        retryable: false,
        validationStatus: "VALID",
      }));
  const adapter: ProviderAdapter = {
    providerId: "provider-a",
    adapterVersion: "1.0.0",
    capabilities: () => new Set([declaration]),
    execute,
  };
  const adapters = new ProviderAdapterRegistry();
  adapters.register(adapter);
  const logs: ProviderWorkerLogEntry[] = [];
  const worker = new ProviderExecutionWorker({
    workerId: "worker-1",
    dispatches: { getDispatch: vi.fn(async () => dispatch) },
    envelopes: { getEnvelope: vi.fn(async () => envelope) },
    router: new CanonicalProviderRouter(adapters, () => now),
    adapters,
    logger: { log: (entry) => logs.push(entry) },
    now: () => now,
  });
  return { worker, dispatch, envelope, execute, logs };
}

describe("PR-3A.5C.6E.3 Production Worker", () => {
  it("consumes Dispatch, loads Envelope, resolves Registry, and executes Adapter", async () => {
    const { worker, dispatch, envelope, execute } = await fixture();
    const outcome = await worker.execute(dispatch.dispatchId);
    expect(outcome).toMatchObject({
      status: "DISPATCHED",
      dispatchId: dispatch.dispatchId,
      envelopeId: envelope.envelopeId,
      providerId: "provider-a",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(envelope.canonicalRequest);
  });

  it("preserves immutable Dispatch, Envelope, and canonical Request", async () => {
    const { worker, dispatch, envelope } = await fixture();
    const dispatchSnapshot = structuredClone(dispatch);
    const envelopeSnapshot = structuredClone(envelope);
    await worker.execute(dispatch.dispatchId);
    expect(dispatch).toEqual(dispatchSnapshot);
    expect(envelope).toEqual(envelopeSnapshot);
    expect(Object.isFrozen(dispatch)).toBe(true);
    expect(Object.isFrozen(envelope)).toBe(true);
  });

  it("rejects missing or conflicting handoff before provider execution", async () => {
    const missing = await fixture();
    Object.assign(
      (missing.worker as unknown as { options: Record<string, unknown> }).options,
      { dispatches: { getDispatch: vi.fn(async () => null) } }
    );
    await expect(missing.worker.execute("missing")).resolves.toMatchObject({
      status: "DISPATCH_NOT_FOUND",
    });
    expect(missing.execute).not.toHaveBeenCalled();

    const conflicting = await fixture();
    Object.assign(
      (conflicting.worker as unknown as { options: Record<string, unknown> }).options,
      {
        envelopes: {
          getEnvelope: vi.fn(async () => ({
            ...conflicting.envelope,
            envelopeHash: `sha256:${"e".repeat(64)}`,
          })),
        },
      }
    );
    await expect(
      conflicting.worker.execute(conflicting.dispatch.dispatchId)
    ).resolves.toMatchObject({ status: "UNEXPECTED_INFRASTRUCTURE_FAILURE" });
    expect(conflicting.execute).not.toHaveBeenCalled();
  });

  it("emits sanitized structured logs", async () => {
    const { worker, dispatch, envelope, logs } = await fixture();
    await worker.execute(dispatch.dispatchId);
    expect(logs.map((entry) => entry.event)).toEqual([
      "provider_worker.started",
      "provider_worker.dispatch_loaded",
      "provider_worker.envelope_loaded",
      "provider_worker.provider_resolved",
      "provider_worker.adapter_invoked",
      "provider_worker.finished",
    ]);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(
      envelope.canonicalRequest.normalizedPayloadReference.uri
    );
    expect(serialized).not.toContain(envelope.executionContext.idempotencyKey);
  });

  it("contains no Outbox, Ledger, Finalizer, business, prompt, or retry boundary", () => {
    const source = readFileSync(
      resolve(__dirname, "../apps/worker/src/provider-dispatch-worker.ts"),
      "utf8"
    );
    expect(source).not.toMatch(
      /claimNextJob|ProviderOutbox|ProviderLedger|ExecutionFinalizer/
    );
    expect(source).not.toMatch(
      /Campaign|Story|Asset|Marketing|generatePrompt|scheduleRetry/
    );
    expect(source).not.toMatch(/SeedanceProvider|OpenAIProvider|VeoProvider|KlingProvider/);
    expect(source).not.toMatch(/completeJob|acceptResult|finalize\(/);
  });
});
