/**
 * Sprint 3 PR 3.3 — Worker/Adapter contract unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  PHASE1_EXECUTION_LOCKED,
  SCENE_ROUTER_VERSION,
  WORKER_ATTEMPT_CONTRACT_VERSION,
  WORKER_EXECUTION_STATES,
  WORKER_RUNTIME_CONTRACT_VERSION,
  WorkerExecutionResultSchema,
  workerAcceptanceAllowsProviderSwitch,
} from "@ceo-agent/shared";
import {
  createPr33TestAdapterRegistry,
  DeterministicCanonicalTestAdapter,
} from "../packages/agents/src/ai-story/canonical-provider-test-adapters";
import {
  computeWorkerAttemptId,
  computeWorkerExecutionResultHash,
  SceneProviderWorkerRuntime,
  WorkerRuntimeError,
} from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import {
  buildPr33ValidatedBundle,
  InMemoryWorkerRuntimeRepository,
  pr33RoutingDecision,
} from "./helpers/ai-story-pr33-worker";

describe("Sprint 3 PR 3.3 worker contracts", () => {
  it("freezes routerVersion=1 on Routing Decision", () => {
    expect(SCENE_ROUTER_VERSION).toBe(1);
    expect(pr33RoutingDecision().routerVersion).toBe(1);
  });

  it("keeps Worker states distinct from Scene/Outbox/Ledger vocabularies", () => {
    expect(WORKER_EXECUTION_STATES).toEqual([
      "RECEIVED",
      "VALIDATED",
      "SUBMISSION_PENDING",
      "ACCEPTED",
      "NOT_ACCEPTED",
      "ACCEPTANCE_UNKNOWN",
      "PROCESSING",
      "TERMINAL_SUCCESS",
      "TERMINAL_FAILURE",
    ]);
    expect(WORKER_EXECUTION_STATES).not.toContain("PENDING");
    expect(WORKER_EXECUTION_STATES).not.toContain("CLAIMED");
    expect(WORKER_EXECUTION_STATES).not.toContain("READY_FOR_EXECUTION");
  });

  it("never allows Provider switch from acceptance classification", () => {
    for (const classification of [
      "NOT_SUBMITTED",
      "NOT_ACCEPTED",
      "ACCEPTANCE_UNKNOWN",
      "ACCEPTED",
    ] as const) {
      expect(workerAcceptanceAllowsProviderSwitch(classification)).toBe(false);
    }
  });

  it("computes deterministic Worker attempt identity without wall-clock or random UUID", () => {
    const input = {
      providerExecutionId: "execution-pr33-scene-a",
      dispatchId: "dispatch-pr33-scene-a",
      routingDecisionId: "10000000-0000-5000-8000-000000000501",
      selectedProviderId: "seedance",
      adapterVersion: "1.0.0",
      attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
    };
    const a = computeWorkerAttemptId(input);
    const b = computeWorkerAttemptId(input);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(
      computeWorkerAttemptId({ ...input, dispatchId: "dispatch-other" })
    ).not.toBe(a);
    expect(
      computeWorkerAttemptId({ ...input, selectedProviderId: "minimax" })
    ).not.toBe(a);
  });

  it("Canonical Adapter exposes submit/lookup/normalizeCallback/classifyError/describeCapabilities", () => {
    const adapter = new DeterministicCanonicalTestAdapter("accepted_async");
    expect(typeof adapter.submit).toBe("function");
    expect(typeof adapter.lookup).toBe("function");
    expect(typeof adapter.normalizeCallback).toBe("function");
    expect(typeof adapter.classifyError).toBe("function");
    expect(typeof adapter.describeCapabilities).toBe("function");
    expect(adapter.describeCapabilities()[0]?.lookup).toBe(true);
  });

  it("processes accepted Dispatch through bound Adapter without fallback or Finalizer", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const adapters = createPr33TestAdapterRegistry("accepted_async");
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters,
      now: () => new Date("2026-08-04T12:10:00.000Z"),
    });

    const first = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(first.adapterInvoked).toBe(true);
    expect(first.finalizerInvoked).toBe(false);
    expect(first.usageWritten).toBe(false);
    expect(first.costWritten).toBe(false);
    expect(first.sceneResultWritten).toBe(false);
    expect(first.automaticFallbackEnabled).toBe(false);
    expect(first.executionAllowed).toBe(false);
    expect(first.result.providerId).toBe("seedance");
    expect(first.result.adapterVersion).toBe("1.0.0");
    expect(first.result.routerVersion).toBe(1);
    expect(first.result.acceptanceClassification).toBe("ACCEPTED");
    expect(first.result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(first.result.workerContractVersion).toBe(WORKER_RUNTIME_CONTRACT_VERSION);

    const second = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(second.replayed).toBe(true);
    expect(second.adapterInvoked).toBe(false);
    expect(second.result.workerExecutionResultId).toBe(
      first.result.workerExecutionResultId
    );
    expect(second.result.providerAttemptId).toBe(first.result.providerAttemptId);
  });

  it("fails closed before Adapter submit when production commercial reservation authority is absent", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const adapter = new DeterministicCanonicalTestAdapter("accepted_async", {
      providerId: "seedance",
      adapterVersion: "1.0.0",
    });
    const adapters = createPr33TestAdapterRegistry("accepted_async");
    adapters.register("seedance", "1.0.0", () => adapter);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters,
      requireCommercialReservation: true,
    });
    await expect(worker.processDispatch({ dispatchId: bundle.dispatch.dispatchId }))
      .rejects.toThrow("Commercial reservation authority is required");
    expect(adapter.submitCount).toBe(0);
  });

  it("reserves commercial budget/quota before the bound Adapter is invoked", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const sequence: string[] = [];
    const adapter = new DeterministicCanonicalTestAdapter("accepted_async", {
      providerId: "seedance",
      adapterVersion: "1.0.0",
    });
    const originalSubmit = adapter.submit.bind(adapter);
    adapter.submit = async (input) => {
      sequence.push("provider-submit");
      return originalSubmit(input);
    };
    const adapters = createPr33TestAdapterRegistry("accepted_async");
    adapters.register("seedance", "1.0.0", () => adapter);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters,
      requireCommercialReservation: true,
      commercialReservation: {
        reserveBeforeSubmit: async () => {
          sequence.push("commercial-reservation");
          return { reservationId: "reservation-1" };
        },
        loadForOutcome: async () => null,
        recordProviderOutcome: async () => {
          sequence.push("commercial-outcome");
        },
      },
    });
    await worker.processDispatch({ dispatchId: bundle.dispatch.dispatchId });
    expect(sequence).toEqual([
      "commercial-reservation",
      "provider-submit",
      "commercial-outcome",
    ]);
  });

  it("resolves Adapter only from persisted Routing Decision binding", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const adapters = createPr33TestAdapterRegistry("accepted_async");
    adapters.register("minimax", "1.0.0", () => {
      throw new Error("must not resolve minimax");
    });
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const outcome = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(outcome.result.providerId).toBe("seedance");
  });

  it("fails closed when Adapter is not registered for persisted binding", async () => {
    const bundle = await buildPr33ValidatedBundle({
      routingDecision: pr33RoutingDecision({
        selectedProviderId: "unknown-provider",
        selectedAdapterVersion: "9.9.9",
      }),
    });
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters: createPr33TestAdapterRegistry(),
    });
    await expect(
      worker.processDispatch({ dispatchId: bundle.dispatch.dispatchId })
    ).rejects.toMatchObject({ code: "ADAPTER_NOT_REGISTERED" });
  });

  it("marks acceptance unknown as reconciliation without fallback", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters: createPr33TestAdapterRegistry("acceptance_unknown"),
    });
    const outcome = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(outcome.result.acceptanceClassification).toBe("ACCEPTANCE_UNKNOWN");
    expect(outcome.result.reconciliationRequired).toBe(true);
    expect(outcome.result.automaticFallbackEnabled).toBe(false);
  });

  it("treats definitive not accepted as terminal for V1 without Provider switch", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters: createPr33TestAdapterRegistry("not_accepted"),
    });
    const outcome = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(outcome.result.acceptanceClassification).toBe("NOT_ACCEPTED");
    expect(outcome.result.workerState).toBe("NOT_ACCEPTED");
    expect(outcome.result.providerId).toBe("seedance");
  });

  it("resumes accepted request via lookup without resubmit", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const adapter = new DeterministicCanonicalTestAdapter("terminal_success", {
      providerId: "seedance",
      adapterVersion: "1.0.0",
    });
    const adapters = createPr33TestAdapterRegistry("terminal_success");
    adapters.register("seedance", "1.0.0", () => adapter);
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });

    const submitted = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(submitted.result.providerRequestId).toBeTruthy();
    repository.results.clear();
    repository.observations.clear();
    const resumed = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: submitted.result.providerRequestId,
    });
    expect(resumed.result.providerAttemptId).toBe(submitted.result.providerAttemptId);
    expect(resumed.result.canonicalProviderState).toBe("SUCCEEDED");
    expect(adapter.submitCount).toBe(1);
    expect(adapter.lookupCount).toBe(1);
  });

  it("rejects conflicting Worker result replay", async () => {
    const bundle = await buildPr33ValidatedBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const withoutHash = {
      workerExecutionResultId: "10000000-0000-5000-8000-000000000901",
      providerExecutionId: bundle.providerExecutionId,
      providerAttemptId: "10000000-0000-5000-8000-000000000902",
      dispatchId: bundle.dispatch.dispatchId,
      outboxJobId: bundle.outboxJobId,
      routingDecisionId: bundle.routingDecision.routingDecisionId,
      providerId: bundle.routingDecision.selectedProviderId,
      adapterVersion: bundle.routingDecision.selectedAdapterVersion,
      routerVersion: SCENE_ROUTER_VERSION,
      providerRequestId: "req-terminal",
      workerState: "TERMINAL_SUCCESS" as const,
      acceptanceClassification: "ACCEPTED" as const,
      canonicalProviderState: "SUCCEEDED" as const,
      reconciliationRequired: false,
      workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
      attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
      producedAt: "2026-08-04T12:10:00.000Z",
      executionAllowed: false as const,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      automaticFallbackEnabled: false as const,
    };
    const terminal = WorkerExecutionResultSchema.parse({
      ...withoutHash,
      deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
    });
    await repository.acceptOrReturnWorkerExecutionResult(terminal);
    const conflicting = WorkerExecutionResultSchema.parse({
      ...terminal,
      canonicalProviderState: "FAILED",
      workerState: "TERMINAL_FAILURE",
      deterministicIntegrityHash: computeWorkerExecutionResultHash({
        ...terminal,
        canonicalProviderState: "FAILED",
        workerState: "TERMINAL_FAILURE",
      }),
    });
    await expect(
      repository.acceptOrReturnWorkerExecutionResult(conflicting)
    ).rejects.toBeInstanceOf(WorkerRuntimeError);
  });

  it("blocks Adapter when validated bundle is missing", async () => {
    const repository = new InMemoryWorkerRuntimeRepository(null);
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters: createPr33TestAdapterRegistry(),
    });
    await expect(
      worker.processDispatch({ dispatchId: "missing-dispatch" })
    ).rejects.toMatchObject({ code: "WORKER_DISPATCH_INVALID" });
  });
});
