/**
 * Production commercial settlement recovery: same Attempt, same Dispatch,
 * same reservation, zero Provider submit.
 */
import { describe, expect, it } from "vitest";
import {
  DeterministicCanonicalTestAdapter,
} from "../packages/agents/src/ai-story/canonical-provider-test-adapters";
import { CanonicalAdapterRegistry } from "../packages/agents/src/ai-story/canonical-provider-adapter";
import {
  computeWorkerAttemptId,
  SceneProviderWorkerRuntime,
  WorkerRuntimeError,
} from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import { AiStoryRuntimeContinuationCoordinator } from "../packages/agents/src/ai-story/ai-story-runtime-continuation-coordinator";
import {
  buildPr33ValidatedBundle,
  InMemoryWorkerRuntimeRepository,
} from "./helpers/ai-story-pr33-worker";
import {
  buildTerminalSuccessWorkerResult,
  InMemoryProjectionRepository,
} from "./helpers/ai-story-pr35-finalizer";

const COMPILED_REQUEST_ID = "830a199d-5d04-5639-8929-8b16350a7b27";
const REQUEST_FINGERPRINT =
  "sha256:b98b9e4edd741ada6da9ab24e842b0ac95eefbe29cd6e5529cbee763e2a55362";
const PROVIDER_TASK_ID = "cgt-20260919161416-njtbr";
const RESERVATION_ID = "5ae05aeb-05bb-5a66-96dc-e885fd7f841d";

async function recoveryBundle() {
  const base = await buildPr33ValidatedBundle();
  return {
    ...base,
    envelope: {
      ...base.envelope,
      executionContext: {
        ...base.envelope.executionContext,
        trace: {
          ...base.envelope.executionContext.trace,
          compiledRequestId: COMPILED_REQUEST_ID,
          compiledRequestFingerprint: REQUEST_FINGERPRINT,
        },
      },
    },
  };
}

function seedanceAdapter(scenario: ConstructorParameters<typeof DeterministicCanonicalTestAdapter>[0] = "terminal_success") {
  const adapter = new DeterministicCanonicalTestAdapter(scenario, {
    providerId: "seedance",
    adapterVersion: "1.0.0",
  });
  const adapters = new CanonicalAdapterRegistry();
  adapters.register("seedance", "1.0.0", () => adapter);
  return { adapter, adapters };
}

function attemptIdFor(bundle: Awaited<ReturnType<typeof recoveryBundle>>) {
  return computeWorkerAttemptId({
    providerExecutionId: bundle.providerExecutionId,
    dispatchId: bundle.dispatch.dispatchId,
    routingDecisionId: bundle.routingDecision.routingDecisionId,
    selectedProviderId: bundle.routingDecision.selectedProviderId,
    adapterVersion: bundle.routingDecision.selectedAdapterVersion,
  });
}

function countingCommercial(reservationId = RESERVATION_ID) {
  return {
    reservationId,
    reserveCalls: 0,
    claimCalls: 0,
    outcomeCalls: 0,
    loadCalls: 0,
    async reserveBeforeSubmit() {
      this.reserveCalls += 1;
      return { reservationId: this.reservationId };
    },
    async claimSubmissionBeforeAdapter() {
      this.claimCalls += 1;
    },
    async loadForOutcome() {
      this.loadCalls += 1;
      return { reservationId: this.reservationId };
    },
    async recordProviderOutcome() {
      this.outcomeCalls += 1;
    },
  };
}

describe("same-Attempt Production settlement recovery", () => {
  it("looks up an already-submitted PENDING Attempt and never calls submit", async () => {
    const bundle = await recoveryBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const providerAttemptId = attemptIdFor(bundle);
    repository.adapterStates.set(providerAttemptId, {
      status: "PENDING",
      providerTaskId: PROVIDER_TASK_ID,
    });
    const { adapter, adapters } = seedanceAdapter("terminal_success");
    const commercial = countingCommercial();
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters,
      commercialReservation: commercial,
      now: () => new Date("2026-09-19T16:30:00.000Z"),
    });

    const first = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: PROVIDER_TASK_ID,
      forbidSubmit: true,
    });
    const second = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: PROVIDER_TASK_ID,
      forbidSubmit: true,
    });

    expect(adapter.submitCount).toBe(0);
    expect(adapter.lookupCount).toBe(1);
    expect(first.adapterInvoked).toBe(true);
    expect(first.result.providerAttemptId).toBe(providerAttemptId);
    expect(first.result.dispatchId).toBe(bundle.dispatch.dispatchId);
    expect(first.result.providerRequestId).toBe(PROVIDER_TASK_ID);
    expect(first.result.canonicalProviderState).toBe("SUCCEEDED");
    expect(second.replayed).toBe(true);
    expect(second.adapterInvoked).toBe(false);
    expect(second.result.providerAttemptId).toBe(first.result.providerAttemptId);
    expect(second.result.dispatchId).toBe(first.result.dispatchId);
    expect(repository.prepareAttemptCalls).toBe(0);
    expect(repository.claimAttemptCalls).toBe(0);
    expect(commercial.reserveCalls).toBe(0);
    expect(commercial.claimCalls).toBe(0);
    expect(commercial.loadCalls).toBe(1);
    expect(commercial.outcomeCalls).toBe(1);
    expect(repository.adapterStates.size).toBe(1);
  });

  it("ordinary continueFromDispatch also refuses submit once a Provider task exists", async () => {
    const bundle = await recoveryBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    repository.adapterStates.set(attemptIdFor(bundle), {
      status: "PENDING",
      providerTaskId: PROVIDER_TASK_ID,
    });
    const { adapter, adapters } = seedanceAdapter("terminal_success");
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    const outcome = await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
    });
    expect(adapter.submitCount).toBe(0);
    expect(adapter.lookupCount).toBe(1);
    expect(outcome.result.providerRequestId).toBe(PROVIDER_TASK_ID);
  });

  it("same-Attempt recovery with forbidSubmit fails closed when no Provider task exists", async () => {
    const bundle = await recoveryBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const { adapter, adapters } = seedanceAdapter("terminal_success");
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    await expect(
      worker.processDispatch({
        dispatchId: bundle.dispatch.dispatchId,
        forbidSubmit: true,
      })
    ).rejects.toMatchObject({
      name: "WorkerRuntimeError",
      code: "RECONCILIATION_REQUIRED",
    });
    expect(adapter.submitCount).toBe(0);
  });

  it("keeps Scene 2/3 held because recovery never releases later scenes", async () => {
    const held = {
      scene2: "AUTHORIZED_NOT_RELEASED" as const,
      scene3: "AUTHORIZED_NOT_RELEASED" as const,
    };
    const bundle = await recoveryBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    repository.adapterStates.set(attemptIdFor(bundle), {
      status: "SUBMITTED",
      providerTaskId: PROVIDER_TASK_ID,
    });
    const { adapter, adapters } = seedanceAdapter("terminal_success");
    const worker = new SceneProviderWorkerRuntime({ repository, adapters });
    await worker.processDispatch({
      dispatchId: bundle.dispatch.dispatchId,
      mode: "lookup",
      providerRequestId: PROVIDER_TASK_ID,
      forbidSubmit: true,
    });
    expect(adapter.submitCount).toBe(0);
    expect(held).toEqual({
      scene2: "AUTHORIZED_NOT_RELEASED",
      scene3: "AUTHORIZED_NOT_RELEASED",
    });
  });

  it("resumeAcceptedProviderAttemptFromDispatch proves the same Attempt identities", async () => {
    const bundle = await recoveryBundle();
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const providerAttemptId = attemptIdFor(bundle);
    repository.adapterStates.set(providerAttemptId, {
      status: "SUBMITTED",
      providerTaskId: PROVIDER_TASK_ID,
    });
    const { adapters } = seedanceAdapter("terminal_success");
    const coordinator = new AiStoryRuntimeContinuationCoordinator({
      worker: { repository, adapters },
      finalization: {
        chain: {} as never,
        bridge: { workerId: "settlement-recovery-test" },
        productionFinalizer: {} as never,
        projection: {} as never,
      },
      assemblyValidation: {} as never,
      jobRepository: {} as never,
      artifactRepository: {} as never,
      mediaAccess: {} as never,
      blobStore: {} as never,
      finalStoryResult: { finalStoryResultRepository: {} as never },
      loadAssemblyRuntimeSources: async () => {
        throw new Error("assembly must not run during identity proof");
      },
    });

    await expect(
      coordinator.resumeAcceptedProviderAttemptFromDispatch({
        dispatchId: bundle.dispatch.dispatchId,
        providerAttemptId,
        providerExecutionId: bundle.providerExecutionId,
        providerRequestId: "cgt-other-task",
        compiledRequestId: COMPILED_REQUEST_ID,
        requestFingerprint: REQUEST_FINGERPRINT,
      })
    ).rejects.toBeInstanceOf(WorkerRuntimeError);

    await expect(
      coordinator.resumeAcceptedProviderAttemptFromDispatch({
        dispatchId: bundle.dispatch.dispatchId,
        providerAttemptId,
        providerExecutionId: bundle.providerExecutionId,
        providerRequestId: PROVIDER_TASK_ID,
        compiledRequestId: COMPILED_REQUEST_ID,
        requestFingerprint: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      })
    ).rejects.toBeInstanceOf(WorkerRuntimeError);
  });

  it("recovers a persisted terminal Worker Result without invoking any Provider adapter", async () => {
    const base = await recoveryBundle();
    const bundle = { ...base, sceneId: "scene-1", sceneOrder: 1 };
    const repository = new InMemoryWorkerRuntimeRepository(bundle);
    const workerResult = buildTerminalSuccessWorkerResult(bundle as never);
    repository.results.set(bundle.dispatch.dispatchId, workerResult);
    const { adapter, adapters } = seedanceAdapter("terminal_success");
    const projection = new InMemoryProjectionRepository();
    const accepted = {
      executionId: workerResult.providerExecutionId,
      attemptId: workerResult.providerAttemptId,
      jobId: workerResult.outboxJobId,
      workerId: "persisted-terminal-recovery-test",
      completedAt: workerResult.producedAt,
      resultReference: workerResult.normalizedResultReference!,
      responseHash: workerResult.deterministicIntegrityHash,
      providerId: workerResult.providerId,
      adapterVersion: workerResult.adapterVersion,
      completionMetadata: {},
      terminalKind: "SUCCEEDED" as const,
    };
    const coordinator = new AiStoryRuntimeContinuationCoordinator({
      worker: { repository, adapters },
      finalization: {
        chain: {
          loadValidatedBundleByDispatchId: (id: string) =>
            repository.loadValidatedBundleByDispatchId(id) as never,
          loadWorkerExecutionResultByDispatchId: (id: string) =>
            repository.getWorkerExecutionResultByDispatchId(id),
          async loadAcceptedProviderFinalization() {
            return accepted;
          },
        },
        bridge: { ledger: {} as never, outbox: {} as never },
        productionFinalizer: {} as never,
        projection,
      },
      assemblyValidation: {
        repository: {
          async getExecutionPlan() {
            return null;
          },
        } as never,
      },
      jobRepository: {} as never,
      artifactRepository: {} as never,
      mediaAccess: {} as never,
      blobStore: {} as never,
      finalStoryResult: { finalStoryResultRepository: {} as never },
      loadAssemblyRuntimeSources: async () => {
        throw new Error("Assembly must remain not-ready in this recovery test");
      },
      requireDurableSceneMedia: false,
      requirePostGenerationQc: false,
    });

    const outcome = await coordinator.recoverFromPersistedTerminalResult(
      bundle.dispatch.dispatchId
    );

    expect(outcome.status).toBe("ASSEMBLY_NOT_READY");
    expect(outcome.adapterInvoked).toBe(false);
    expect(outcome.projection?.outcome).toBe("PROJECTED");
    expect(adapter.submitCount).toBe(0);
    expect(adapter.lookupCount).toBe(0);
    expect(repository.prepareAttemptCalls).toBe(0);
    expect(repository.claimAttemptCalls).toBe(0);
  });
});
