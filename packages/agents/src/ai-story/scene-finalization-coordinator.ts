/**
 * Sprint 3 PR 3.5R1 — Coordinates Production Finalizer (Tx A) then Scene Projection (Tx B).
 *
 * Not a Provider Finalizer. Does not write provider_executions / usage / cost / outbox terminal.
 * Invokes Production Provider FinalizationRepository for Transaction A only.
 * Routes SUCCEEDED and terminal failures; ACCEPTANCE_UNKNOWN → reconciliation;
 * TRANSIENT_INFRA_FAILURE → canonical outbox retry (no terminal write).
 */
import {
  SceneProjectionOutcomeSchema,
  type AcceptedProviderFinalization,
  type SceneProjectionOutcome,
  type SceneProjectionValidatedBundle,
  type WorkerExecutionResult,
} from "@ceo-agent/shared";
import type {
  ProviderExecutionFinalizationRecord,
  ProviderExecutionFinalizationRepository,
  ProviderExecutionTerminalFailureRecord,
  ProviderOutboxRepository,
} from "@ceo-agent/db";
import {
  ProviderWorkerResultFinalizerBridge,
  ProviderWorkerResultFinalizerBridgeError,
  classifyWorkerResultForCoordinator,
  type ProviderWorkerResultFinalizerBridgeDependencies,
} from "./provider-worker-result-finalizer-bridge";
import {
  SceneResultProjector,
  SceneResultProjectorError,
  type SceneProjectionRepository,
} from "./scene-result-projector";

export class SceneFinalizationCoordinatorError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SceneFinalizationCoordinatorError";
  }
}

export type SceneFinalizationCoordinatorRepository = {
  loadValidatedBundleByDispatchId(
    dispatchId: string
  ): Promise<SceneProjectionValidatedBundle | null>;
  loadWorkerExecutionResultByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null>;
  /**
   * Read-only: if Production Finalizer already terminalized this execution, return it.
   */
  loadAcceptedProviderFinalization(
    executionId: string
  ): Promise<AcceptedProviderFinalization | null>;
};

export type SceneFinalizationCoordinatorDependencies = {
  readonly chain: SceneFinalizationCoordinatorRepository;
  readonly bridge: ProviderWorkerResultFinalizerBridgeDependencies;
  readonly productionFinalizer: Pick<
    ProviderExecutionFinalizationRepository,
    "finalize" | "finalizeTerminalFailure"
  >;
  readonly outbox?: Pick<ProviderOutboxRepository, "releaseLease">;
  readonly projection: SceneProjectionRepository;
};

function toAcceptedSuccess(
  record: ProviderExecutionFinalizationRecord,
  adapterVersion: string,
  providerId: string
): AcceptedProviderFinalization {
  return {
    executionId: record.executionId,
    attemptId: record.attemptId,
    jobId: record.jobId,
    workerId: record.workerId,
    completedAt: record.completedAt,
    resultReference: record.result.resultReference,
    responseHash: record.result.responseHash,
    providerId,
    adapterVersion,
    completionMetadata: record.completionMetadata,
    terminalKind: "SUCCEEDED",
  };
}

function toAcceptedFailure(
  record: ProviderExecutionTerminalFailureRecord,
  adapterVersion: string,
  providerId: string
): AcceptedProviderFinalization {
  return {
    executionId: record.executionId,
    attemptId: record.attemptId,
    jobId: record.jobId,
    workerId: record.workerId,
    completedAt: record.completedAt,
    resultReference: record.resultReference,
    responseHash: record.responseHash,
    providerId,
    adapterVersion,
    completionMetadata: record.completionMetadata,
    terminalKind: "TERMINAL_FAILURE",
    failureCode: record.failureCode,
  };
}

export class SceneFinalizationCoordinator {
  private readonly bridge: ProviderWorkerResultFinalizerBridge;
  private readonly projector: SceneResultProjector;

  constructor(private readonly dependencies: SceneFinalizationCoordinatorDependencies) {
    this.bridge = new ProviderWorkerResultFinalizerBridge(dependencies.bridge);
    this.projector = new SceneResultProjector(dependencies.projection);
  }

  /**
   * Tx A: Production Finalizer (or read accepted finalization).
   * Tx B: Scene projection in a separate transaction — failure does not roll back Tx A.
   */
  async finalizeAndProject(input: {
    readonly dispatchId: string;
    readonly workerExecutionResultId?: string;
  }): Promise<SceneProjectionOutcome> {
    const bundle = await this.dependencies.chain.loadValidatedBundleByDispatchId(
      input.dispatchId
    );
    if (!bundle) {
      throw new SceneFinalizationCoordinatorError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Validated bundle not found for Dispatch"
      );
    }
    const workerResult =
      await this.dependencies.chain.loadWorkerExecutionResultByDispatchId(
        input.dispatchId
      );
    if (!workerResult) {
      throw new SceneFinalizationCoordinatorError(
        "SCENE_PROJECTION_CHAIN_INVALID",
        "Worker Execution Result not found for Dispatch"
      );
    }
    if (
      input.workerExecutionResultId &&
      workerResult.workerExecutionResultId !== input.workerExecutionResultId
    ) {
      throw new SceneFinalizationCoordinatorError(
        "SCENE_PROJECTION_HASH_MISMATCH",
        "Worker Execution Result id does not match requested identity"
      );
    }

    const route = classifyWorkerResultForCoordinator(workerResult);

    if (route === "ACCEPTANCE_UNKNOWN") {
      return SceneProjectionOutcomeSchema.parse({
        outcome: "RECONCILIATION_REQUIRED",
        dispatchId: workerResult.dispatchId,
        providerExecutionId: workerResult.providerExecutionId,
        outboxJobId: workerResult.outboxJobId,
        reason: "ACCEPTANCE_UNKNOWN requires reconciliation; Finalizer not invoked",
        finalizerInvoked: false,
        executionAllowed: false,
        automaticFallbackEnabled: false,
      });
    }

    if (route === "TRANSIENT_INFRA_FAILURE") {
      return this.scheduleTransientRetry({ bundle, workerResult });
    }

    if (route === "NON_TERMINAL") {
      throw new SceneFinalizationCoordinatorError(
        "SCENE_PROJECTION_NON_TERMINAL",
        `Worker result is not terminal for Finalizer routing: ${workerResult.canonicalProviderState}`
      );
    }

    let finalizerInvoked = false;
    let accepted =
      await this.dependencies.chain.loadAcceptedProviderFinalization(
        workerResult.providerExecutionId
      );

    if (!accepted) {
      if (route === "SUCCEEDED") {
        let prepared;
        try {
          prepared = await this.bridge.prepareFinalizerInput({
            bundle,
            workerResult,
          });
        } catch (error) {
          if (error instanceof ProviderWorkerResultFinalizerBridgeError) {
            throw new SceneFinalizationCoordinatorError(error.code, error.message);
          }
          throw error;
        }

        finalizerInvoked = true;
        const record = await this.dependencies.productionFinalizer.finalize(
          prepared.finalizerInput
        );
        accepted = toAcceptedSuccess(
          record,
          workerResult.adapterVersion,
          workerResult.providerId
        );
      } else {
        let prepared;
        try {
          prepared = await this.bridge.prepareTerminalFailureFinalizerInput({
            bundle,
            workerResult,
          });
        } catch (error) {
          if (error instanceof ProviderWorkerResultFinalizerBridgeError) {
            throw new SceneFinalizationCoordinatorError(error.code, error.message);
          }
          throw error;
        }

        finalizerInvoked = true;
        const record =
          await this.dependencies.productionFinalizer.finalizeTerminalFailure(
            prepared.finalizerInput
          );
        accepted = toAcceptedFailure(
          record,
          workerResult.adapterVersion,
          workerResult.providerId
        );
      }
    }

    // Transaction B — separate; must not roll back Tx A.
    let projected;
    try {
      projected = await this.projector.projectFromAcceptedFinalization({
        workerResult,
        bundle,
        finalization: accepted,
      });
    } catch (error) {
      if (error instanceof SceneResultProjectorError) {
        throw new SceneFinalizationCoordinatorError(error.code, error.message);
      }
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string" &&
        String((error as { code: string }).code).startsWith("SCENE_PROJECTION_")
      ) {
        throw new SceneFinalizationCoordinatorError(
          (error as { code: string }).code,
          error instanceof Error ? error.message : "Projection failed"
        );
      }
      throw new SceneFinalizationCoordinatorError(
        "SCENE_PROJECTION_TRANSACTION_FAILED",
        error instanceof Error ? error.message : "Projection failed"
      );
    }

    return SceneProjectionOutcomeSchema.parse({
      outcome: "PROJECTED",
      correlation: projected.correlation,
      sceneResult: projected.sceneResult,
      providerFinalizationReference:
        projected.sceneResult.providerFinalizationReference,
      replayed: projected.converged,
      finalizerInvoked,
      executionAllowed: false,
      automaticFallbackEnabled: false,
    });
  }

  private async scheduleTransientRetry(input: {
    readonly bundle: SceneProjectionValidatedBundle;
    readonly workerResult: WorkerExecutionResult;
  }): Promise<SceneProjectionOutcome> {
    const releaseApi =
      this.dependencies.outbox?.releaseLease ??
      this.dependencies.bridge.outbox.releaseLease.bind(
        this.dependencies.bridge.outbox
      );

    let prepared;
    try {
      prepared = await this.bridge.prepareTransientRetry(input);
    } catch (error) {
      if (error instanceof ProviderWorkerResultFinalizerBridgeError) {
        throw new SceneFinalizationCoordinatorError(error.code, error.message);
      }
      throw error;
    }

    await releaseApi({
      jobId: prepared.jobId,
      leaseOwner: prepared.leaseOwner,
      nextVisibleAt: prepared.nextVisibleAt,
      retryDelayMs: prepared.retryDelayMs,
      retryClassification: prepared.retryClassification,
      lastErrorCategory: prepared.lastErrorCategory,
    });

    return SceneProjectionOutcomeSchema.parse({
      outcome: "RETRY_SCHEDULED",
      dispatchId: input.workerResult.dispatchId,
      providerExecutionId: input.workerResult.providerExecutionId,
      outboxJobId: input.workerResult.outboxJobId,
      nextVisibleAt: prepared.nextVisibleAt.toISOString(),
      retryClassification: "TRANSIENT_INFRA_FAILURE",
      finalizerInvoked: false,
      executionAllowed: false,
      automaticFallbackEnabled: false,
    });
  }
}
