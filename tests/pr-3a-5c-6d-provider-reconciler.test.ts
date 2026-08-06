import { describe, expect, it, vi } from "vitest";
import {
  createProviderError,
  type CanonicalProviderResult,
  type ProviderAttempt,
  type ProviderExecution,
  type ProviderOutboxJob,
} from "@ceo-agent/shared";
import type { ProviderReconciliationSnapshot } from "@ceo-agent/db";
import type {
  ProviderAdapter,
  ProviderCapabilityDeclaration,
  ProviderLookupResult,
} from "../packages/agents/src/provider-adapters/contracts";
import { ProviderAdapterRegistry } from "../packages/agents/src/provider-router";
import {
  ProviderReconciler,
  type ProviderReconciliationLogEntry,
  type ProviderReconciliationRequest,
} from "../apps/worker/src/provider-reconciler";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const baseTime = new Date("2026-07-26T12:00:00.000Z");

function execution(
  status: ProviderExecution["status"] = "RECONCILING",
  acceptedAttemptId?: string
): ProviderExecution {
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
      createdAt: baseTime.toISOString(),
    },
    status,
    acceptedAttemptId,
    resultReference: acceptedAttemptId ? "provider-result://result-1" : undefined,
    createdAt: baseTime.toISOString(),
    completedAt: acceptedAttemptId ? baseTime.toISOString() : undefined,
  };
}

function attempt(
  overrides: Partial<ProviderAttempt> = {}
): ProviderAttempt {
  return {
    contractVersion: "1",
    attemptId: "attempt-1",
    executionId: "execution-1",
    attemptNumber: 1,
    providerId: "provider-a",
    providerVersion: "provider-a-v1",
    modelVersion: "model-a",
    providerRequestId: "provider-request-1",
    requestHash: hash("b"),
    status: "TIMEOUT_UNKNOWN",
    startedAt: baseTime.toISOString(),
    ...overrides,
  };
}

function result(
  overrides: Partial<CanonicalProviderResult> = {}
): CanonicalProviderResult {
  return {
    contractVersion: "1",
    executionId: "execution-1",
    providerAttemptId: "attempt-1",
    normalizedOutput: { summary: "canonical" },
    resultReference: "provider-result://result-1",
    warnings: [],
    providerMetadata: {
      providerId: "provider-a",
      providerVersion: "provider-a-v1",
      providerRequestId: "provider-request-1",
    },
    usage: {},
    cost: { amount: 0, currency: "USD", estimated: false },
    modelVersion: "model-a",
    requestHash: hash("b"),
    responseHash: hash("c"),
    retryable: false,
    validationStatus: "VALID",
    ...overrides,
  };
}

function outbox(status: ProviderOutboxJob["status"] = "CLAIMED"): ProviderOutboxJob {
  return {
    contractVersion: "1",
    jobId: "job-1",
    executionId: "execution-1",
    payloadReference: "provider-dispatch://payload-1",
    correlationId: "correlation-1",
    status,
    priority: 0,
    attemptCount: 1,
    nextVisibleAt: baseTime.toISOString(),
    leaseOwner: status === "CLAIMED" ? "worker-1" : undefined,
    leaseExpiresAt:
      status === "CLAIMED"
        ? new Date(baseTime.getTime() + 60_000).toISOString()
        : undefined,
    completedAt: status === "COMPLETED" ? baseTime.toISOString() : undefined,
    completionWorkerId: status === "COMPLETED" ? "worker-1" : undefined,
    completionMetadata: status === "COMPLETED" ? { providerId: "provider-a" } : undefined,
    createdAt: baseTime.toISOString(),
    updatedAt: baseTime.toISOString(),
  };
}

function snapshot(options: {
  execution?: ProviderExecution;
  providerAttempt?: ProviderAttempt;
  acceptedResult?: CanonicalProviderResult;
  outboxJob?: ProviderOutboxJob | null;
} = {}): ProviderReconciliationSnapshot {
  const providerExecution = options.execution ?? execution();
  const providerAttempt = options.providerAttempt ?? attempt();
  return {
    ledger: {
      execution: providerExecution,
      requestHash: hash("b"),
      attempts: [
        {
          attempt: providerAttempt,
          warnings: [],
          providerMetadata: {},
        },
      ],
      acceptedResult: options.acceptedResult,
    },
    outboxJob: options.outboxJob === undefined ? outbox() : options.outboxJob,
  };
}

const declaration: ProviderCapabilityDeclaration = {
  providerId: "provider-a",
  adapterVersion: "1.0.0",
  capabilityId: "json-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: true,
  lookup: true,
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

const request: ProviderReconciliationRequest = {
  reconciliationRequestId: "reconciliation-1",
  executionId: "execution-1",
  attemptId: "attempt-1",
  jobId: "job-1",
  providerId: "provider-a",
  adapterVersion: "1.0.0",
  providerRequestId: "provider-request-1",
  requestSchemaVersion: "1.0.0",
  resultSchemaVersion: "1.0.0",
  trigger: "TIMEOUT_UNKNOWN",
  policyVersion: "1.0.0",
  dataHandling: {
    sensitiveData: false,
    retentionAllowed: false,
  },
  trace: { traceId: "trace-1" },
};

function fixture(options: {
  lookup?: ProviderLookupResult;
  lookupError?: Error;
  lookupSupported?: boolean;
  snapshot?: ProviderReconciliationSnapshot | null;
  logs?: ProviderReconciliationLogEntry[];
  times?: Date[];
} = {}) {
  const lookup = options.lookupError
    ? vi.fn().mockRejectedValue(options.lookupError)
    : vi.fn().mockResolvedValue(
        options.lookup ?? {
          status: "SUCCEEDED",
          providerRequestId: "provider-request-1",
          result: result(),
        }
      );
  const execute = vi.fn();
  const adapter: ProviderAdapter = {
    providerId: "provider-a",
    adapterVersion: "1.0.0",
    capabilities: () =>
      new Set([
        {
          ...declaration,
          lookup: options.lookupSupported ?? true,
        },
      ]),
    execute,
    lookup: options.lookupSupported === false ? undefined : lookup,
  };
  const adapters = new ProviderAdapterRegistry();
  adapters.register(adapter);
  const times = options.times ?? [baseTime, baseTime, baseTime, baseTime, baseTime];
  let index = 0;
  const reconciler = new ProviderReconciler(
    {
      load: vi.fn().mockResolvedValue(
        options.snapshot === undefined ? snapshot() : options.snapshot
      ),
    },
    adapters,
    {
      logger: { log: (entry) => options.logs?.push(entry) },
      now: () => times[Math.min(index++, times.length - 1)]!,
    }
  );
  return { reconciler, lookup, execute };
}

describe("PR-3A.5C.6D Provider Reconciler", () => {
  it("verifies TimeoutUnknown provider completion and requires finalization", async () => {
    const { reconciler, lookup, execute } = fixture();
    const decision = await reconciler.reconcile(request);
    expect(decision).toMatchObject({
      state: "RECOVERABLE",
      decision: "FINALIZE_REQUIRED",
      reasons: ["PROVIDER_RESULT_VERIFIED"],
      providerState: "SUCCEEDED",
      audit: { lookupPerformed: true },
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not look up an already consistent successful execution", async () => {
    const accepted = result();
    const { reconciler, lookup } = fixture({
      snapshot: snapshot({
        execution: execution("SUCCEEDED", "attempt-1"),
        providerAttempt: attempt({
          status: "SUCCEEDED",
          responseHash: accepted.responseHash,
          completedAt: baseTime.toISOString(),
        }),
        acceptedResult: accepted,
        outboxJob: outbox("COMPLETED"),
      }),
    });
    await expect(reconciler.reconcile(request)).resolves.toMatchObject({
      state: "CONSISTENT",
      decision: "CONSISTENT",
      reasons: ["FINALIZED_STATE_CONSISTENT"],
      audit: { lookupPerformed: false },
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns UNSUPPORTED when Adapter lookup is unavailable", async () => {
    const { reconciler } = fixture({ lookupSupported: false });
    await expect(reconciler.reconcile(request)).resolves.toMatchObject({
      decision: "UNSUPPORTED",
      reasons: ["RECONCILIATION_UNSUPPORTED"],
    });
  });

  it.each([
    [{ status: "RUNNING", providerRequestId: "provider-request-1" }, "WAIT", "PROVIDER_RUNNING"],
    [{ status: "NOT_FOUND" }, "RESUME_ALLOWED", "PROVIDER_REQUEST_NOT_FOUND"],
    [{ status: "UNKNOWN" }, "UNKNOWN", "PROVIDER_STATE_UNKNOWN"],
  ] as const)("maps provider state to canonical decision", async (lookup, decision, reason) => {
    const value = await fixture({ lookup }).reconciler.reconcile(request);
    expect(value).toMatchObject({ decision, reasons: [reason] });
  });

  it("allows resume after a confirmed retryable provider failure", async () => {
    const lookup: ProviderLookupResult = {
      status: "FAILED",
      providerRequestId: "provider-request-1",
      error: createProviderError("PROVIDER_UNAVAILABLE", {
        code: "PROVIDER_DOWN",
        message: "Provider unavailable",
      }),
    };
    await expect(fixture({ lookup }).reconciler.reconcile(request)).resolves.toMatchObject({
      state: "RECOVERABLE",
      decision: "RESUME_ALLOWED",
      reasons: ["PROVIDER_RETRYABLE_FAILURE"],
    });
  });

  it("requires manual intervention for Ledger/provider disagreement", async () => {
    const lookup: ProviderLookupResult = {
      status: "SUCCEEDED",
      providerRequestId: "provider-request-1",
      result: result({ requestHash: hash("e") }),
    };
    await expect(fixture({ lookup }).reconciler.reconcile(request)).resolves.toMatchObject({
      state: "INCONSISTENT",
      decision: "MANUAL_INTERVENTION_REQUIRED",
      reasons: ["LEDGER_PROVIDER_STATE_MISMATCH"],
    });
  });

  it("returns UNKNOWN when execution state is missing", async () => {
    await expect(fixture({ snapshot: null }).reconciler.reconcile(request)).resolves.toMatchObject({
      state: "UNKNOWN",
      decision: "UNKNOWN",
      reasons: ["EXECUTION_NOT_FOUND"],
    });
  });

  it("normalizes lookup transport ambiguity into UNKNOWN", async () => {
    await expect(
      fixture({ lookupError: new Error("network payload omitted") }).reconciler.reconcile(
        request
      )
    ).resolves.toMatchObject({
      state: "UNKNOWN",
      decision: "UNKNOWN",
      reasons: ["PROVIDER_STATE_UNKNOWN"],
      providerState: "UNKNOWN",
    });
  });

  it("produces stable decision hashes independent of timestamps and lookup latency", async () => {
    const first = await fixture({
      times: [
        new Date("2026-07-26T12:00:00.000Z"),
        new Date("2026-07-26T12:00:01.000Z"),
        new Date("2026-07-26T12:00:02.000Z"),
        new Date("2026-07-26T12:00:03.000Z"),
      ],
    }).reconciler.reconcile(request);
    const second = await fixture({
      times: [
        new Date("2026-07-26T13:00:00.000Z"),
        new Date("2026-07-26T13:00:05.000Z"),
        new Date("2026-07-26T13:00:10.000Z"),
        new Date("2026-07-26T13:00:15.000Z"),
      ],
    }).reconciler.reconcile(request);
    expect(first.audit.lookupLatencyMs).not.toBe(second.audit.lookupLatencyMs);
    expect(first.audit.decisionTimestamp).not.toBe(second.audit.decisionTimestamp);
    expect(first.audit.decisionHash).toBe(second.audit.decisionHash);
  });

  it("emits structured logs without provider result bodies", async () => {
    const logs: ProviderReconciliationLogEntry[] = [];
    await fixture({ logs }).reconciler.reconcile(request);
    expect(logs.map((entry) => entry.event)).toEqual([
      "provider_reconciliation.started",
      "provider_reconciliation.lookup_started",
      "provider_reconciliation.lookup_completed",
      "provider_reconciliation.decision_produced",
      "provider_reconciliation.completed",
    ]);
    expect(JSON.stringify(logs)).not.toContain("canonical");
  });

  it("contains no provider execution, routing, retry, resume, callback, reconciliation writes, or business mutation", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("apps/worker/src/provider-reconciler.ts", "utf8")
    );
    expect(source).not.toMatch(/adapter\.execute|router\.route|scheduleRetry/i);
    expect(source).not.toMatch(/resumePipeline|processCallback/i);
    expect(source).not.toMatch(/\.(insert|update|delete)\(/);
    expect(source).not.toMatch(/from [\"'][^\"']*pipeline/i);
  });
});
