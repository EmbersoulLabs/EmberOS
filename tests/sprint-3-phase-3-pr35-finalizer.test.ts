/**
 * Sprint 3 PR 3.5 (remediated) — bridge + coordinator + projection unit tests.
 */
import { describe, expect, it } from "vitest";
import {
  ProviderWorkerResultFinalizerBridge,
} from "../packages/agents/src/ai-story/provider-worker-result-finalizer-bridge";
import {
  SceneFinalizationCoordinator,
  SceneFinalizationCoordinatorError,
} from "../packages/agents/src/ai-story/scene-finalization-coordinator";
import { SceneResultProjectorError } from "../packages/agents/src/ai-story/scene-result-projector";
import {
  buildAcceptanceUnknownWorkerResult,
  buildPr35ProjectionBundle,
  buildTerminalFailureWorkerResult,
  buildTerminalSuccessWorkerResult,
  buildTransientInfraWorkerResult,
  InMemoryBridgeLedger,
  InMemoryBridgeOutbox,
  InMemoryProductionFinalizer,
  InMemoryProjectionRepository,
} from "./helpers/ai-story-pr35-finalizer";
import type {
  AcceptedProviderFinalization,
  SceneProjectionValidatedBundle,
  WorkerExecutionResult,
} from "@ceo-agent/shared";

function buildCoordinatorDeps(opts?: {
  failProjectionOnce?: boolean;
  preAccepted?: AcceptedProviderFinalization | null;
  workerFactory?: (
    bundle: SceneProjectionValidatedBundle
  ) => WorkerExecutionResult;
}) {
  const bundlePromise = buildPr35ProjectionBundle();
  const ledger = new InMemoryBridgeLedger();
  const outbox = new InMemoryBridgeOutbox();
  const productionFinalizer = new InMemoryProductionFinalizer();
  const projection = new InMemoryProjectionRepository();
  if (opts?.failProjectionOnce) projection.failNext = true;
  const workerFactory = opts?.workerFactory ?? buildTerminalSuccessWorkerResult;

  const state: {
    bundle: SceneProjectionValidatedBundle | null;
    worker: WorkerExecutionResult | null;
    accepted: AcceptedProviderFinalization | null;
  } = {
    bundle: null,
    worker: null,
    accepted: opts?.preAccepted ?? null,
  };

  const ready = bundlePromise.then((bundle) => {
    state.bundle = bundle;
    state.worker = workerFactory(bundle);
    return bundle;
  });

  const chain = {
    async loadValidatedBundleByDispatchId(dispatchId: string) {
      await ready;
      if (!state.bundle || state.bundle.dispatch.dispatchId !== dispatchId) {
        return null;
      }
      return state.bundle;
    },
    async loadWorkerExecutionResultByDispatchId(dispatchId: string) {
      await ready;
      if (!state.worker || state.worker.dispatchId !== dispatchId) return null;
      return state.worker;
    },
    async loadAcceptedProviderFinalization(executionId: string) {
      if (state.accepted?.executionId === executionId) return state.accepted;
      return productionFinalizer.accepted.get(executionId) ?? null;
    },
  };

  const coordinator = new SceneFinalizationCoordinator({
    chain,
    bridge: { ledger, outbox },
    productionFinalizer,
    projection: {
      async acceptOrConvergeProjection(input) {
        try {
          return await projection.acceptOrConvergeProjection(input);
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code: string }).code === "SCENE_PROJECTION_CONFLICT"
          ) {
            throw new SceneResultProjectorError(
              "SCENE_PROJECTION_CONFLICT",
              (error as Error).message
            );
          }
          throw new SceneResultProjectorError(
            "SCENE_PROJECTION_TRANSACTION_FAILED",
            error instanceof Error ? error.message : "projection failed"
          );
        }
      },
    },
  });

  return {
    ready,
    coordinator,
    ledger,
    outbox,
    productionFinalizer,
    projection,
    getDispatchId: async () => (await ready).dispatch.dispatchId,
    getBundle: async () => ready,
  };
}

describe("Sprint 3 PR 3.5 remediated Finalizer bridge + projection", () => {
  it("bridge never writes usage/cost/outbox completion or provider terminal", async () => {
    const bundle = await buildPr35ProjectionBundle();
    const worker = buildTerminalSuccessWorkerResult(bundle);
    const ledger = new InMemoryBridgeLedger();
    const outbox = new InMemoryBridgeOutbox();
    const bridge = new ProviderWorkerResultFinalizerBridge({ ledger, outbox });

    const prepared = await bridge.prepareFinalizerInput({ bundle, workerResult: worker });

    expect(prepared.finalizerInput.result.executionId).toBe(
      bundle.providerExecutionId
    );
    expect(ledger.attempts.has(worker.providerAttemptId)).toBe(true);
    expect(ledger.usageWrites).toHaveLength(0);
    expect(ledger.costWrites).toHaveLength(0);
    expect(outbox.completions).toHaveLength(0);
    expect(outbox.claims).toEqual([worker.outboxJobId]);
  });

  it("only Production Finalizer writes usage/cost/execution/outbox terminal", async () => {
    const deps = buildCoordinatorDeps();
    const dispatchId = await deps.getDispatchId();
    const outcome = await deps.coordinator.finalizeAndProject({ dispatchId });

    expect(outcome.finalizerInvoked).toBe(true);
    expect(deps.productionFinalizer.calls).toHaveLength(1);
    expect(deps.productionFinalizer.usageInserted).toHaveLength(1);
    expect(deps.productionFinalizer.costInserted).toHaveLength(1);
    expect(deps.productionFinalizer.executionTerminal).toEqual([
      {
        executionId: deps.productionFinalizer.calls[0]!.executionId,
        status: "SUCCEEDED",
      },
    ]);
    expect(deps.productionFinalizer.outboxTerminal).toEqual([
      { jobId: deps.productionFinalizer.calls[0]!.jobId, status: "COMPLETED" },
    ]);
    expect(deps.ledger.usageWrites).toHaveLength(0);
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(outcome.sceneResult.providerUsageReference).toMatch(
      /^provider-attempt-usage:\/\//
    );
    expect(outcome.sceneResult.providerCostReference).toMatch(
      /^provider-attempt-cost:\/\//
    );
    expect(JSON.stringify(outcome.sceneResult)).not.toMatch(/apiKey|rawProvider/i);
  });

  it("projection retry after accepted finalization does not re-invoke Finalizer", async () => {
    const deps = buildCoordinatorDeps();
    const dispatchId = await deps.getDispatchId();
    const first = await deps.coordinator.finalizeAndProject({ dispatchId });
    expect(first.finalizerInvoked).toBe(true);

    const second = await deps.coordinator.finalizeAndProject({ dispatchId });
    expect(second.finalizerInvoked).toBe(false);
    expect(second.replayed).toBe(true);
    expect(deps.productionFinalizer.calls).toHaveLength(1);
    expect(deps.productionFinalizer.usageInserted).toHaveLength(1);
    expect(deps.productionFinalizer.outboxTerminal).toHaveLength(1);
    expect(first.outcome).toBe("PROJECTED");
    expect(second.outcome).toBe("PROJECTED");
    if (first.outcome !== "PROJECTED" || second.outcome !== "PROJECTED") {
      throw new Error("expected PROJECTED");
    }
    expect(second.sceneResult.integrityHash).toBe(first.sceneResult.integrityHash);
  });

  it("projection failure leaves Provider Finalization intact", async () => {
    const deps = buildCoordinatorDeps({ failProjectionOnce: true });
    const dispatchId = await deps.getDispatchId();

    await expect(
      deps.coordinator.finalizeAndProject({ dispatchId })
    ).rejects.toBeInstanceOf(SceneFinalizationCoordinatorError);

    expect(deps.productionFinalizer.calls).toHaveLength(1);
    expect(deps.productionFinalizer.usageInserted).toHaveLength(1);
    expect(deps.productionFinalizer.outboxTerminal).toHaveLength(1);
    expect(deps.projection.projections.size).toBe(0);

    const recovered = await deps.coordinator.finalizeAndProject({ dispatchId });
    expect(recovered.finalizerInvoked).toBe(false);
    expect(deps.productionFinalizer.calls).toHaveLength(1);
    expect(recovered.outcome).toBe("PROJECTED");
    if (recovered.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(recovered.sceneResult.status).toBe("SUCCEEDED");
  });

  it("projection conflict fails closed", async () => {
    const deps = buildCoordinatorDeps();
    const dispatchId = await deps.getDispatchId();
    const first = await deps.coordinator.finalizeAndProject({ dispatchId });

    const stored = deps.projection.projections.values().next().value!;
    deps.projection.projections.set(stored.correlation.sceneExecutionId, {
      ...stored,
      correlation: {
        ...stored.correlation,
        integrityHash:
          "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    });

    await expect(
      deps.coordinator.finalizeAndProject({ dispatchId })
    ).rejects.toMatchObject({ code: "SCENE_PROJECTION_CONFLICT" });
    expect(first.sceneResult.sceneResultId).toBeTruthy();
  });

  it("rejects non-SUCCEEDED worker results at the success bridge", async () => {
    const bundle = await buildPr35ProjectionBundle();
    const worker = buildTerminalSuccessWorkerResult(bundle, {
      workerState: "PROCESSING",
      canonicalProviderState: "PROCESSING",
      terminalMedia: undefined,
      normalizedResultReference: undefined,
    });
    const bridge = new ProviderWorkerResultFinalizerBridge({
      ledger: new InMemoryBridgeLedger(),
      outbox: new InMemoryBridgeOutbox(),
    });
    await expect(
      bridge.prepareFinalizerInput({ bundle, workerResult: worker })
    ).rejects.toMatchObject({ code: "BRIDGE_NON_TERMINAL" });
  });

  it("routes FAILED through Production Finalizer terminal failure + FAILED projection", async () => {
    const deps = buildCoordinatorDeps({
      workerFactory: (bundle) =>
        buildTerminalFailureWorkerResult(bundle, { failureCode: "PROVIDER_FAILED" }),
    });
    const dispatchId = await deps.getDispatchId();
    const outcome = await deps.coordinator.finalizeAndProject({ dispatchId });

    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
    expect(outcome.sceneResult.status).toBe("FAILED");
    expect(deps.productionFinalizer.failureCalls).toHaveLength(1);
    expect(deps.productionFinalizer.usageInserted).toHaveLength(0);
    expect(deps.productionFinalizer.costInserted).toHaveLength(0);
    expect(deps.productionFinalizer.outboxTerminal).toHaveLength(1);
    expect(deps.productionFinalizer.outboxTerminal[0]?.status).toBe("DEAD_LETTER");
  });

  it("routes REJECTED / TIMEOUT / MODERATION through Finalizer without usage/cost", async () => {
    for (const [failureCode, sceneStatus] of [
      ["PROVIDER_REJECTED", "REJECTED"],
      ["PROVIDER_MODERATION_REJECTED", "REJECTED"],
      ["PROVIDER_TIMEOUT", "TIMEOUT"],
    ] as const) {
      const deps = buildCoordinatorDeps({
        workerFactory: (bundle) =>
          buildTerminalFailureWorkerResult(bundle, { failureCode }),
      });
      const dispatchId = await deps.getDispatchId();
      const outcome = await deps.coordinator.finalizeAndProject({ dispatchId });
      expect(outcome.outcome).toBe("PROJECTED");
      if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");
      expect(outcome.sceneResult.status).toBe(sceneStatus);
      expect(deps.productionFinalizer.usageInserted).toHaveLength(0);
      expect(deps.productionFinalizer.outboxTerminal[0]?.status).toBe("DEAD_LETTER");
    }
  });

  it("ACCEPTANCE_UNKNOWN does not invoke Finalizer", async () => {
    const deps = buildCoordinatorDeps({
      workerFactory: buildAcceptanceUnknownWorkerResult,
    });
    const dispatchId = await deps.getDispatchId();
    const outcome = await deps.coordinator.finalizeAndProject({ dispatchId });
    expect(outcome).toMatchObject({
      outcome: "RECONCILIATION_REQUIRED",
      finalizerInvoked: false,
    });
    expect(deps.productionFinalizer.calls).toHaveLength(0);
    expect(deps.productionFinalizer.failureCalls).toHaveLength(0);
  });

  it("TRANSIENT_INFRA_FAILURE terminalizes and waits for explicit human retry", async () => {
    const deps = buildCoordinatorDeps({
      workerFactory: buildTransientInfraWorkerResult,
    });
    const dispatchId = await deps.getDispatchId();
    const outcome = await deps.coordinator.finalizeAndProject({ dispatchId });
    expect(outcome).toMatchObject({
      outcome: "PROJECTED",
      finalizerInvoked: true,
    });
    expect(deps.outbox.releases).toHaveLength(0);
    expect(deps.productionFinalizer.calls).toHaveLength(0);
    expect(deps.productionFinalizer.failureCalls).toHaveLength(1);
    expect(deps.productionFinalizer.usageInserted).toHaveLength(1);
    expect(deps.productionFinalizer.costInserted).toHaveLength(1);
    expect(deps.productionFinalizer.executionTerminal[0]?.status).toBe(
      "TERMINAL_FAILURE"
    );
    expect(deps.productionFinalizer.outboxTerminal[0]?.status).toBe(
      "DEAD_LETTER"
    );
    const attempt = [...deps.ledger.attempts.values()][0];
    expect(attempt?.status).toBe("TERMINAL_FAILURE");
    expect(deps.ledger.failures.get(attempt!.attemptId)).toMatchObject({
      retryable: true,
      terminal: false,
      safeDetails: {
        retryEligible: true,
        automaticRetry: false,
        humanRetryRequired: true,
      },
    });
  });

  it("human-authorized retry generation persists as the new attempt ordinal", async () => {
    const base = await buildPr35ProjectionBundle();
    const bundle = {
      ...base,
      correlation: { ...base.correlation, retryGeneration: 2 },
    };
    const worker = buildTransientInfraWorkerResult(bundle);
    const ledger = new InMemoryBridgeLedger();
    const bridge = new ProviderWorkerResultFinalizerBridge({
      ledger,
      outbox: new InMemoryBridgeOutbox(),
    });

    const prepared = await bridge.prepareTerminalFailureFinalizerInput({
      bundle,
      workerResult: worker,
    });

    expect(prepared.attempt.attemptNumber).toBe(2);
    expect(prepared.attempt.attemptId).toBe(worker.providerAttemptId);
    expect(prepared.attempt.status).toBe("TERMINAL_FAILURE");
  });
});
