import { describe, expect, it, vi } from "vitest";
import type {
  CanonicalProviderResult,
  ProviderAttempt,
  ProviderExecution,
  ProviderOutboxJob,
} from "@ceo-agent/shared";
import type { ProviderResumeSnapshot } from "@ceo-agent/db";
import type { ExecutionFinalizationOutcome } from "../apps/worker/src/provider-execution-finalizer";
import {
  ResumeCoordinator,
  type ResumeCoordinatorLogEntry,
} from "../apps/worker/src/provider-resume-coordinator";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const completedAt = "2026-07-26T10:00:00.000Z";

function finalization(
  overrides: Partial<ExecutionFinalizationOutcome> = {}
): ExecutionFinalizationOutcome {
  return {
    status: "FINALIZED",
    executionId: "execution-1",
    attemptId: "attempt-1",
    jobId: "job-1",
    workerId: "worker-1",
    completedAt,
    resultReference: "provider-result://result-1",
    ...overrides,
  };
}

function result(): CanonicalProviderResult {
  return {
    contractVersion: "1",
    executionId: "execution-1",
    providerAttemptId: "attempt-1",
    normalizedOutput: { private: "not-for-signal" },
    resultReference: "provider-result://result-1",
    warnings: [],
    providerMetadata: {
      providerId: "provider-a",
      providerVersion: "provider-a-v1",
    },
    usage: {},
    cost: { amount: 0, currency: "USD", estimated: false },
    modelVersion: "model-a",
    requestHash: hash("a"),
    responseHash: hash("b"),
    retryable: false,
    validationStatus: "VALID",
  };
}

function execution(
  status: ProviderExecution["status"] = "SUCCEEDED"
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
      deterministicFingerprint: hash("c"),
    },
    metadata: {
      skillId: "AI-005",
      skillVersion: "1.0.0",
      contextVersions: { CampaignAIContext: "1.0.0" },
      outputSchemaId: "MarketingResult",
      outputSchemaVersion: "1.0.0",
      correlationId: "correlation-1",
      createdAt: completedAt,
    },
    status,
    acceptedAttemptId: "attempt-1",
    resultReference: "provider-result://result-1",
    createdAt: completedAt,
    completedAt,
  };
}

function attempt(): ProviderAttempt {
  return {
    contractVersion: "1",
    attemptId: "attempt-1",
    executionId: "execution-1",
    attemptNumber: 1,
    providerId: "provider-a",
    providerVersion: "provider-a-v1",
    modelVersion: "model-a",
    requestHash: hash("a"),
    responseHash: hash("b"),
    status: "SUCCEEDED",
    completedAt,
  };
}

function outbox(): ProviderOutboxJob {
  return {
    contractVersion: "1",
    jobId: "job-1",
    executionId: "execution-1",
    payloadReference: "provider-dispatch://payload-1",
    correlationId: "correlation-1",
    status: "COMPLETED",
    priority: 0,
    attemptCount: 1,
    nextVisibleAt: completedAt,
    completedAt,
    completionWorkerId: "worker-1",
    completionMetadata: { providerId: "provider-a" },
    createdAt: completedAt,
    updatedAt: completedAt,
  };
}

function snapshot(
  overrides: Partial<ProviderResumeSnapshot> = {}
): ProviderResumeSnapshot {
  return {
    execution: execution(),
    acceptedResult: result(),
    acceptedAttempt: attempt(),
    outboxJob: outbox(),
    ...overrides,
  };
}

function coordinator(options: {
  snapshot?: ProviderResumeSnapshot | null;
  resumed?: boolean;
  logs?: ResumeCoordinatorLogEntry[];
  times?: Date[];
} = {}) {
  const times = options.times ?? [
    new Date(completedAt),
    new Date(completedAt),
    new Date(completedAt),
  ];
  let index = 0;
  return new ResumeCoordinator(
    {
      load: vi.fn().mockResolvedValue(
        options.snapshot === undefined ? snapshot() : options.snapshot
      ),
    },
    {
      hasResumeMarker: vi.fn().mockResolvedValue(options.resumed ?? false),
    },
    {
      logger: { log: (entry) => options.logs?.push(entry) },
      now: () => times[Math.min(index++, times.length - 1)]!,
    }
  );
}

const input = {
  finalization: finalization(),
  policyVersion: "1.0.0",
  trace: { traceId: "trace-1" },
};

describe("PR-3A.5C.6C Resume Coordinator", () => {
  it("returns an immutable READY_TO_RESUME signal for verified finalization", async () => {
    const decision = await coordinator().evaluate(input);
    expect(decision).toMatchObject({
      decision: "READY_TO_RESUME",
      reasons: ["FINALIZATION_VERIFIED"],
      signal: {
        executionId: "execution-1",
        attemptId: "attempt-1",
        providerId: "provider-a",
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        correlationId: "correlation-1",
        decision: "READY_TO_RESUME",
      },
      audit: {
        coordinatorVersion: "1.0.0",
        policyVersion: "1.0.0",
        trace: { traceId: "trace-1" },
      },
    });
    expect(Object.isFrozen(decision)).toBe(true);
    expect(decision.signal.signalHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects an already resumed finalization", async () => {
    await expect(coordinator({ resumed: true }).evaluate(input)).resolves.toMatchObject({
      decision: "DO_NOT_RESUME",
      reasons: ["RESUME_MARKER_EXISTS"],
    });
  });

  it.each([
    ["CANCELLED", "EXECUTION_CANCELLED"],
    ["SUPERSEDED", "EXECUTION_SUPERSEDED"],
  ] as const)("rejects %s execution", async (status, reason) => {
    const decision = await coordinator({
      snapshot: snapshot({ execution: execution(status) }),
    }).evaluate(input);
    expect(decision).toMatchObject({ decision: "DO_NOT_RESUME", reasons: [reason] });
  });

  it("waits when reconciliation is pending", async () => {
    await expect(
      coordinator({
        snapshot: snapshot({ execution: execution("RECONCILING") }),
      }).evaluate(input)
    ).resolves.toMatchObject({
      decision: "WAIT_FOR_RECONCILIATION",
      reasons: ["RECONCILIATION_PENDING"],
    });
  });

  it("returns UNKNOWN for missing finalization state", async () => {
    await expect(coordinator({ snapshot: null }).evaluate(input)).resolves.toMatchObject({
      decision: "UNKNOWN",
      reasons: ["EXECUTION_NOT_FOUND"],
    });
  });

  it("rejects missing accepted result and incomplete Outbox completion", async () => {
    const missingResult = await coordinator({
      snapshot: snapshot({ acceptedResult: undefined }),
    }).evaluate(input);
    expect(missingResult).toMatchObject({
      decision: "DO_NOT_RESUME",
      reasons: ["ACCEPTED_RESULT_MISSING"],
    });

    const incompleteOutbox = await coordinator({
      snapshot: snapshot({
        outboxJob: { ...outbox(), status: "PENDING", completedAt: undefined, completionWorkerId: undefined, completionMetadata: undefined },
      }),
    }).evaluate(input);
    expect(incompleteOutbox).toMatchObject({
      decision: "DO_NOT_RESUME",
      reasons: ["OUTBOX_NOT_COMPLETED"],
    });
  });

  it("keeps signal and decision hashes stable across timestamps", async () => {
    const first = await coordinator({
      times: [
        new Date("2026-07-26T10:00:01.000Z"),
        new Date("2026-07-26T10:00:02.000Z"),
        new Date("2026-07-26T10:00:03.000Z"),
      ],
    }).evaluate(input);
    const second = await coordinator({
      times: [
        new Date("2026-07-26T11:00:01.000Z"),
        new Date("2026-07-26T11:00:02.000Z"),
        new Date("2026-07-26T11:00:03.000Z"),
      ],
    }).evaluate(input);
    expect(first.signal.decisionTimestamp).not.toBe(second.signal.decisionTimestamp);
    expect(first.signal.signalHash).toBe(second.signal.signalHash);
    expect(first.audit.decisionHash).toBe(second.audit.decisionHash);
  });

  it("records evaluation duration and structured lifecycle logs", async () => {
    const logs: ResumeCoordinatorLogEntry[] = [];
    const decision = await coordinator({
      logs,
      times: [
        new Date("2026-07-26T10:00:00.000Z"),
        new Date("2026-07-26T10:00:01.000Z"),
        new Date("2026-07-26T10:00:02.000Z"),
      ],
    }).evaluate(input);
    expect(decision.audit.evaluationDurationMs).toBe(2_000);
    expect(logs.map((entry) => entry.event)).toEqual([
      "provider_resume.evaluation_started",
      "provider_resume.eligibility_passed",
      "provider_resume.decision_produced",
      "provider_resume.evaluation_finished",
    ]);
    expect(JSON.stringify(logs)).not.toContain("not-for-signal");
  });

  it("has no Pipeline, provider execution, routing, retry, reconciliation execution, or writes", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("apps/worker/src/provider-resume-coordinator.ts", "utf8")
    );
    expect(source).not.toMatch(/adapter\.execute|router\.route|scheduleRetry/i);
    expect(source).not.toMatch(/from [\"'][^\"']*pipeline/i);
    expect(source).not.toMatch(/\.(insert|update|delete)\(/);
    expect(source).not.toMatch(/resumePipeline|runReconciliation|processCallback/i);
  });
});
