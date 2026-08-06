import { describe, expect, it, vi } from "vitest";
import type { CanonicalProviderResult } from "@ceo-agent/shared";
import {
  ExecutionFinalizer,
  type CompletedProviderDispatch,
  type ExecutionFinalizationLogEntry,
} from "../apps/worker/src/provider-execution-finalizer";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const now = new Date("2026-07-26T09:00:00.000Z");

function result(): CanonicalProviderResult {
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
      providerRequestId: "request-1",
    },
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    cost: { amount: 0.01, currency: "USD", estimated: false },
    modelVersion: "model-a",
    requestHash: hash("a"),
    responseHash: hash("b"),
    retryable: false,
    validationStatus: "VALID",
  };
}

function dispatch(): CompletedProviderDispatch {
  return {
    status: "DISPATCHED",
    jobId: "job-1",
    executionId: "execution-1",
    attemptId: "attempt-1",
    providerId: "provider-a",
    adapterVersion: "1.0.0",
    result: result(),
    executionDurationMs: 125,
    workerId: "worker-1",
    dispatchTimestamp: now.toISOString(),
  };
}

describe("PR-3A.5C.6B Execution Finalizer", () => {
  it("validates and returns a canonical finalization outcome", async () => {
    const finalize = vi.fn().mockResolvedValue({
      executionId: "execution-1",
      attemptId: "attempt-1",
      jobId: "job-1",
      workerId: "worker-1",
      result: result(),
      completedAt: now.toISOString(),
      completionMetadata: {},
    });
    const finalizer = new ExecutionFinalizer({ finalize }, { now: () => now });

    await expect(finalizer.finalize(dispatch())).resolves.toEqual({
      status: "FINALIZED",
      executionId: "execution-1",
      attemptId: "attempt-1",
      jobId: "job-1",
      workerId: "worker-1",
      completedAt: now.toISOString(),
      resultReference: "provider-result://result-1",
    });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("rejects non-completed dispatch outcomes before persistence", async () => {
    const finalize = vi.fn();
    const finalizer = new ExecutionFinalizer({ finalize });
    await expect(
      finalizer.finalize({ ...dispatch(), status: "NO_JOB" } as never)
    ).rejects.toThrow("only completed dispatch outcomes");
    expect(finalize).not.toHaveBeenCalled();
  });

  it("emits structured commit lifecycle logs without provider payloads", async () => {
    const logs: ExecutionFinalizationLogEntry[] = [];
    const finalizer = new ExecutionFinalizer(
      {
        finalize: vi.fn().mockResolvedValue({
          executionId: "execution-1",
          attemptId: "attempt-1",
          jobId: "job-1",
          workerId: "worker-1",
          result: result(),
          completedAt: now.toISOString(),
          completionMetadata: {},
        }),
      },
      { logger: { log: (entry) => logs.push(entry) }, now: () => now }
    );
    await finalizer.finalize(dispatch());

    expect(logs.map((entry) => entry.event)).toEqual([
      "provider_finalization.started",
      "provider_finalization.validation_passed",
      "provider_finalization.ledger_accepted",
      "provider_finalization.outbox_completed",
      "provider_finalization.transaction_committed",
    ]);
    expect(JSON.stringify(logs)).not.toContain("canonical");
    expect(JSON.stringify(logs)).not.toContain("provider-result");
  });

  it("logs rollback and rethrows persistence failures", async () => {
    const logs: ExecutionFinalizationLogEntry[] = [];
    const finalizer = new ExecutionFinalizer(
      { finalize: vi.fn().mockRejectedValue(new Error("Atomic commit failed")) },
      { logger: { log: (entry) => logs.push(entry) }, now: () => now }
    );
    await expect(finalizer.finalize(dispatch())).rejects.toThrow("Atomic commit failed");
    expect(logs.at(-1)?.event).toBe(
      "provider_finalization.transaction_rolled_back"
    );
  });

  it("has no provider execution, routing, retry, callback, reconciliation, or Pipeline boundary", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("apps/worker/src/provider-execution-finalizer.ts", "utf8")
    );
    expect(source).not.toMatch(/adapter\.execute|router\.route|scheduleRetry/i);
    expect(source).not.toMatch(/from [\"'][^\"']*pipeline/i);
    expect(source).not.toMatch(/resume|reconcile|processCallback/i);
  });
});
