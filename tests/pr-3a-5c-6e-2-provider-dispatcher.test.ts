import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createExecutionEnvelope,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import {
  ProviderExecutionDispatcher,
  type DispatcherEnvelopeStore,
  type DispatcherJob,
  type DispatcherRepository,
} from "../apps/worker/src/provider-execution-dispatcher";
import { createEnvelopeInput } from "./helpers/provider-execution-envelope";

async function fixture() {
  const envelope = await createExecutionEnvelope(createEnvelopeInput());
  const job: DispatcherJob = {
    jobId: envelope.executionContext.queueJobId!,
    executionId: envelope.executionContext.executionId,
    payloadReference: envelope.payloadReference,
    correlationId: envelope.executionContext.correlationId,
    status: "PENDING",
  };
  let persisted: ExecutionDispatch | null = null;
  const repository: DispatcherRepository = {
    selectEligibleJob: vi.fn(async () => (persisted ? null : job)),
    createDispatch: vi.fn(async (dispatch) => {
      if (persisted) throw new Error("duplicate");
      persisted = dispatch;
      return dispatch;
    }),
    getDispatchByJobId: vi.fn(async () => persisted),
  };
  const envelopes: DispatcherEnvelopeStore = {
    getEnvelopeByPayloadReference: vi.fn(async () => envelope),
  };
  return { envelope, job, repository, envelopes };
}

describe("PR-3A.5C.6E.2 Production Dispatcher", () => {
  it("creates one deterministic immutable dispatch from the persisted envelope", async () => {
    const { envelope, repository, envelopes } = await fixture();
    const dispatcher = new ProviderExecutionDispatcher(repository, envelopes, {
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const result = await dispatcher.dispatchNext();

    expect(result.status).toBe("DISPATCHED");
    if (result.status !== "DISPATCHED") throw new Error("expected dispatch");
    expect(result.dispatch).toMatchObject({
      jobId: envelope.executionContext.queueJobId,
      envelopeId: envelope.envelopeId,
      correlationId: envelope.executionContext.correlationId,
      requestHash: envelope.requestHash,
      envelopeHash: envelope.envelopeHash,
      workerHandoff: {
        envelopeId: envelope.envelopeId,
        payloadReference: envelope.payloadReference,
        dispatchContractVersion: "1",
      },
      status: "DISPATCHED",
    });
    expect(Object.isFrozen(result.dispatch)).toBe(true);
    expect(repository.createDispatch).toHaveBeenCalledOnce();
  });

  it("validates the envelope and returns an existing equivalent Dispatch", async () => {
    const { job, repository, envelopes } = await fixture();
    const dispatcher = new ProviderExecutionDispatcher(repository, envelopes, {
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const first = await dispatcher.dispatchNext();
    if (first.status !== "DISPATCHED") throw new Error("expected dispatch");
    repository.selectEligibleJob = vi.fn(async () => job);

    const second = await dispatcher.dispatchNext();
    expect(second).toEqual(first);
    expect(envelopes.getEnvelopeByPayloadReference).toHaveBeenCalledTimes(2);
    expect(repository.createDispatch).toHaveBeenCalledOnce();
    expect(Object.isFrozen(first.dispatch.workerHandoff)).toBe(true);
  });

  it("is idempotent and does not dispatch the same eligible job twice", async () => {
    const { repository, envelopes } = await fixture();
    const dispatcher = new ProviderExecutionDispatcher(repository, envelopes);
    const first = await dispatcher.dispatchNext();
    const second = await dispatcher.dispatchNext();
    expect(first.status).toBe("DISPATCHED");
    expect(second.status).toBe("NO_JOB");
    expect(repository.createDispatch).toHaveBeenCalledOnce();
  });

  it("rejects missing, invalid, or identity-conflicting envelopes", async () => {
    const missing = await fixture();
    missing.envelopes.getEnvelopeByPayloadReference = vi.fn(async () => null);
    await expect(
      new ProviderExecutionDispatcher(
        missing.repository,
        missing.envelopes
      ).dispatchNext()
    ).rejects.toThrow(/does not exist/);

    const tampered = await fixture();
    tampered.envelopes.getEnvelopeByPayloadReference = vi.fn(async () => ({
      ...tampered.envelope,
      requestHash: `sha256:${"f".repeat(64)}`,
    }));
    await expect(
      new ProviderExecutionDispatcher(
        tampered.repository,
        tampered.envelopes
      ).dispatchNext()
    ).rejects.toThrow(/request hash/);

    const conflicting = await fixture();
    conflicting.envelopes.getEnvelopeByPayloadReference = vi.fn(async () => ({
      ...conflicting.envelope,
      executionContext: {
        ...conflicting.envelope.executionContext,
        executionId: "different-execution",
      },
    }));
    await expect(
      new ProviderExecutionDispatcher(
        conflicting.repository,
        conflicting.envelopes
      ).dispatchNext()
    ).rejects.toThrow();
  });

  it("rejects a non-queued job before resolving its envelope", async () => {
    const { job, repository, envelopes } = await fixture();
    repository.selectEligibleJob = vi.fn(
      async () => ({ ...job, status: "CLAIMED" }) as unknown as DispatcherJob
    );
    await expect(
      new ProviderExecutionDispatcher(repository, envelopes).dispatchNext()
    ).rejects.toThrow(/not queued/);
    expect(envelopes.getEnvelopeByPayloadReference).not.toHaveBeenCalled();
  });

  it("logs only sanitized dispatch metadata", async () => {
    const { repository, envelopes, envelope } = await fixture();
    const entries: unknown[] = [];
    await new ProviderExecutionDispatcher(repository, envelopes, {
      logger: { log: (entry) => entries.push(entry) },
    }).dispatchNext();
    const serialized = JSON.stringify(entries);
    expect(serialized).toContain(envelope.envelopeId);
    expect(serialized).toContain(envelope.workspaceId);
    expect(serialized).not.toContain(
      envelope.canonicalRequest.normalizedPayloadReference.uri
    );
    expect(serialized).not.toContain("providerPolicySnapshot");
  });

  it("keeps dispatcher and repository boundaries isolated", () => {
    const service = readFileSync(
      resolve(
        __dirname,
        "../apps/worker/src/provider-execution-dispatcher.ts"
      ),
      "utf8"
    );
    const repository = readFileSync(
      resolve(
        __dirname,
        "../packages/db/src/queries/provider-execution-dispatch.ts"
      ),
      "utf8"
    );
    expect(service).not.toMatch(
      /ProviderAdapter|ProviderRouter|OutboxDispatchWorker|ExecutionFinalizer/
    );
    expect(service).not.toMatch(/prompt|generatePrompt|executeProvider/i);
    expect(repository).not.toMatch(/\.update\(|\.delete\(/);
    expect(repository).not.toMatch(
      /providerAttempts|acceptedResult|completeJob|claimNextJob/
    );
    const entrypoint = readFileSync(
      resolve(
        __dirname,
        "../apps/worker/src/provider-execution-dispatch-entrypoint.ts"
      ),
      "utf8"
    );
    expect(entrypoint).toContain("dispatchNextProviderExecution");
    expect(entrypoint).not.toMatch(/OutboxDispatchWorker|ProviderAdapter|Finalizer/);
  });
});
