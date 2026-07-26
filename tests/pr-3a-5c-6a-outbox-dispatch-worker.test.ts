import { describe, expect, it, vi } from "vitest";
import {
  type ProviderAdapter,
  type ProviderCapabilityDeclaration,
} from "../packages/agents/src/provider-adapters/contracts";
import { ProviderAdapterError } from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  NoEligibleProviderError,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";
import {
  createProviderError,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
  type ProviderExecution,
  type ProviderOutboxJob,
} from "../packages/shared/src";
import {
  OutboxDispatchWorker,
  type ProviderDispatchEnvelope,
  type ProviderDispatchLogEntry,
} from "./helpers/legacy-outbox-dispatch-worker";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-26T08:00:00.000Z");

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
    regions: ["SG"],
    modelFamilies: ["model-a"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: true,
    zeroRetention: true,
    enterpriseControls: true,
  },
};

function execution(): ProviderExecution {
  return {
    contractVersion: "1",
    identity: {
      executionId: "execution-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      pipelineRunId: "pipeline-run-1",
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      idempotencyKey: "idempotency-1",
      deterministicFingerprint: hash("a"),
    },
    metadata: {
      skillId: "AI-005",
      skillVersion: "1.0.0",
      contextVersions: { CampaignAIContext: "1.0.0" },
      outputSchemaId: "MarketingResult",
      outputSchemaVersion: "1.0.0",
      correlationId: "correlation-1",
      createdAt: now.toISOString(),
    },
    status: "PENDING",
    createdAt: now.toISOString(),
  };
}

function request(): CanonicalProviderRequest {
  return {
    contractVersion: "1",
    executionIdentity: execution().identity,
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    normalizedPayloadReference: {
      uri: "provider-payload://payload-1",
      contentHash: hash("b"),
      mediaType: "application/json",
    },
    outputSchema: { schemaId: "MarketingResult", schemaVersion: "1.0.0" },
    contextVersions: { CampaignAIContext: "1.0.0" },
    correlation: {
      correlationId: "correlation-1",
      pipelineRunId: "pipeline-run-1",
      queueJobId: "job-1",
    },
    timeoutPolicy: { timeoutMs: 30_000, reconciliationDelayMs: 5_000 },
    retryPolicy: {
      maxAttempts: 3,
      initialDelayMs: 100,
      maximumDelayMs: 1_000,
      backoffMultiplier: 2,
    },
    providerConstraints: {},
  };
}

function routingRequest(): ProviderRoutingRequest {
  return {
    routingRequestId: "routing-1",
    capabilityId: "json-generation",
    capabilityVersion: "1.0.0",
    requestSchemaVersion: "1.0.0",
    resultSchemaVersion: "1.0.0",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
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
      requiredRegions: ["SG"],
      enterpriseControlsRequired: false,
      zeroRetentionRequired: false,
    },
  };
}

const policy: ProviderRoutingPolicy = {
  policyVersion: "1.0.0",
  preferredProviders: [],
  requireTrainingOptOut: true,
};

function envelope(): ProviderDispatchEnvelope {
  return {
    request: request(),
    routingRequest: routingRequest(),
    routingPolicy: policy,
    dataHandling: {
      allowedRegions: ["SG"],
      sensitiveData: false,
      retentionAllowed: false,
    },
    trace: { traceId: "trace-1" },
  };
}

function claimedJob(overrides: Partial<ProviderOutboxJob> = {}): ProviderOutboxJob {
  return {
    contractVersion: "1",
    jobId: "job-1",
    executionId: "execution-1",
    payloadReference: "provider-dispatch://payload-1",
    correlationId: "correlation-1",
    status: "CLAIMED",
    priority: 0,
    attemptCount: 1,
    nextVisibleAt: now.toISOString(),
    leaseOwner: "worker-1",
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function result(): CanonicalProviderResult {
  return {
    contractVersion: "1",
    executionId: "execution-1",
    providerAttemptId: "execution-1:attempt:1",
    normalizedOutput: { ok: true },
    resultReference: "provider-result://result-1",
    warnings: [],
    providerMetadata: {
      providerId: "provider-a",
      providerVersion: "provider-a-v1",
      providerRequestId: "request-1",
    },
    provenance: [
      {
        providerId: "provider-a",
        adapterVersion: "1.0.0",
        modelVersion: "model-a",
        providerRequestId: "request-1",
      },
    ],
    usage: {},
    cost: { amount: 0, currency: "USD", estimated: false },
    modelVersion: "model-a",
    requestHash: hash("c"),
    responseHash: hash("d"),
    retryable: false,
    validationStatus: "VALID",
  };
}

function fixture(options: {
  job?: ProviderOutboxJob | null;
  activeJob?: ProviderOutboxJob | null;
  adapterError?: unknown;
  router?: { route: ReturnType<typeof vi.fn> };
} = {}) {
  const job = options.job === undefined ? claimedJob() : options.job;
  const activeJob = options.activeJob === undefined ? job : options.activeJob;
  const execute = options.adapterError
    ? vi.fn().mockRejectedValue(options.adapterError)
    : vi.fn().mockResolvedValue(result());
  const adapter: ProviderAdapter = {
    providerId: "provider-a",
    adapterVersion: "1.0.0",
    capabilities: () => new Set([declaration]),
    execute,
  };
  const adapters = new ProviderAdapterRegistry();
  adapters.register(adapter);
  const router =
    options.router ??
    new CanonicalProviderRouter(adapters, () => now);
  const logs: ProviderDispatchLogEntry[] = [];
  const worker = new OutboxDispatchWorker({
    workerId: "worker-1",
    leaseDurationMs: 60_000,
    outbox: {
      claimNextJob: vi.fn().mockResolvedValue(job),
      findJob: vi.fn().mockResolvedValue(activeJob),
    },
    ledger: {
      findExecution: vi.fn().mockResolvedValue({
        execution: execution(),
        requestHash: hash("c"),
      }),
    },
    envelopeLoader: { load: vi.fn().mockResolvedValue(envelope()) },
    router,
    adapters,
    logger: { log: (entry) => logs.push(entry) },
    now: () => now,
  });
  return { worker, execute, logs, router };
}

describe("PR-3A.5C.6A Outbox Dispatch Worker", () => {
  it("claims, routes, and executes exactly one Adapter", async () => {
    const { worker, execute } = fixture();
    const outcome = await worker.dispatchOne();

    expect(outcome).toMatchObject({
      status: "DISPATCHED",
      executionId: "execution-1",
      attemptId: "execution-1:attempt:1",
      providerId: "provider-a",
      adapterVersion: "1.0.0",
      workerId: "worker-1",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns NO_JOB without routing or Adapter execution", async () => {
    const route = vi.fn();
    const { worker, execute } = fixture({ job: null, router: { route } });
    await expect(worker.dispatchOne()).resolves.toMatchObject({ status: "NO_JOB" });
    expect(route).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["another owner", claimedJob({ leaseOwner: "worker-2" })],
    ["expired", claimedJob({ leaseExpiresAt: now.toISOString() })],
    ["not claimed", claimedJob({ status: "PENDING", leaseOwner: undefined, leaseExpiresAt: undefined })],
  ])("rejects a lease that is %s", async (_label, activeJob) => {
    const { worker, execute } = fixture({ activeJob });
    await expect(worker.dispatchOne()).resolves.toMatchObject({ status: "LEASE_LOST" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns the canonical no-provider outcome", async () => {
    const route = vi.fn().mockRejectedValue(
      new NoEligibleProviderError({
        routingRequestId: "routing-1",
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        requestSchemaVersion: "1.0.0",
        resultSchemaVersion: "1.0.0",
        policyVersion: "1.0.0",
        exclusions: [],
      })
    );
    const { worker, execute } = fixture({ router: { route } });
    await expect(worker.dispatchOne()).resolves.toMatchObject({
      status: "NO_ELIGIBLE_PROVIDER",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("normalizes Adapter failure without retry or fallback", async () => {
    const adapterError = new ProviderAdapterError(
      createProviderError("TERMINAL_FAILURE", {
        code: "PROVIDER_FAILED",
        message: "Provider failed",
      })
    );
    const { worker, execute } = fixture({ adapterError });
    await expect(worker.dispatchOne()).resolves.toMatchObject({
      status: "ADAPTER_FAILURE",
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves timeout ambiguity as TIMEOUT_UNKNOWN", async () => {
    const adapterError = new ProviderAdapterError(
      createProviderError("TIMEOUT_UNKNOWN", {
        code: "PROVIDER_TIMEOUT",
        message: "Provider state is unknown",
      })
    );
    const { worker } = fixture({ adapterError });
    await expect(worker.dispatchOne()).resolves.toMatchObject({
      status: "TIMEOUT_UNKNOWN",
    });
  });

  it("emits structured lifecycle logs without payloads or secrets", async () => {
    const { worker, logs } = fixture();
    await worker.dispatchOne();
    expect(logs.map((entry) => entry.event)).toEqual([
      "provider_dispatch.worker_started",
      "provider_dispatch.job_claimed",
      "provider_dispatch.router_decision",
      "provider_dispatch.adapter_invoked",
      "provider_dispatch.finished",
    ]);
    expect(JSON.stringify(logs)).not.toContain("provider-payload");
    expect(JSON.stringify(logs)).not.toContain("idempotency-1");
  });

  it("does not mutate the canonical request or execution", async () => {
    const dispatchEnvelope = envelope();
    const providerExecution = execution();
    const envelopeSnapshot = structuredClone(dispatchEnvelope);
    const executionSnapshot = structuredClone(providerExecution);
    const { worker } = fixture();
    Object.assign(
      (worker as unknown as { options: Record<string, unknown> }).options,
      {
        envelopeLoader: { load: vi.fn().mockResolvedValue(dispatchEnvelope) },
        ledger: {
          findExecution: vi.fn().mockResolvedValue({
            execution: providerExecution,
            requestHash: hash("c"),
          }),
        },
      }
    );
    await worker.dispatchOne();
    expect(dispatchEnvelope).toEqual(envelopeSnapshot);
    expect(providerExecution).toEqual(executionSnapshot);
  });

  it("contains no Pipeline, retry scheduler, reconciliation, or callback boundary", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("apps/worker/src/provider-dispatch-worker.ts", "utf8")
    );
    expect(source).not.toMatch(/from [\"'][^\"']*pipeline/i);
    expect(source).not.toMatch(/scheduleRetry|reconcile|processCallback/i);
    expect(source).not.toContain("completeJob(");
    expect(source).not.toContain("acceptResult(");
  });
});
