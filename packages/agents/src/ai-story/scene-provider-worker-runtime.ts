/**
 * Sprint 3 PR 3.3 — Scene Provider Worker runtime.
 *
 * Consumes accepted scheduling identities + Dispatch.
 * Resolves Adapter only from persisted Routing Decision.
 * Never reroutes. Never switches Provider. Never invokes Finalizer.
 * Public execution remains locked (PHASE1_EXECUTION_LOCKED).
 *
 * Legacy AI Story attempt IDs (randomUUID in story-execution-orchestrator)
 * are non-authoritative for corrected AI Story runtime.
 */
import {
  PHASE1_EXECUTION_LOCKED,
  SCENE_ROUTER_VERSION,
  WORKER_ATTEMPT_CONTRACT_VERSION,
  WORKER_RUNTIME_CONTRACT_VERSION,
  WorkerExecutionResultSchema,
  type CanonicalProviderState,
  type ExecutionDispatch,
  type ExecutionEnvelope,
  type PersistedSceneRoutingDecision,
  type ProviderAcceptanceClassification,
  type RuntimeAuthorizedFact,
  type SceneProviderSchedulingCorrelation,
  type WorkerExecutionResult,
  type WorkerExecutionState,
  type WorkerRuntimeErrorCode,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "@ceo-agent/db";
import {
  failureFromCode,
  type CanonicalAdapterRegistry,
  type CanonicalProviderAdapter,
} from "./canonical-provider-adapter";

export class WorkerRuntimeError extends Error {
  readonly code: WorkerRuntimeErrorCode;
  readonly status: number;

  constructor(code: WorkerRuntimeErrorCode, message: string, status = 409) {
    super(message);
    this.name = "WorkerRuntimeError";
    this.code = code;
    this.status = status;
  }
}

export type ProviderSubmissionOutcomeClassification =
  | "PROVEN_NOT_SUBMITTED"
  | "PROVEN_ACCEPTED"
  | "AMBIGUOUS_SUBMISSION_OUTCOME";

/**
 * Fail-closed historical reconciliation rule. Absence of a task/Attempt is
 * never positive proof that a network submission did not occur.
 */
export function classifyProviderSubmissionOutcome(input: {
  readonly durableNotSubmittedObservation: boolean;
  readonly durableAcceptedObservation: boolean;
  readonly providerTaskKnown: boolean;
  readonly commercialSubmissionClaimed: boolean;
  readonly adapterInvocationMayHaveStarted: boolean;
}): ProviderSubmissionOutcomeClassification {
  if (input.durableAcceptedObservation || input.providerTaskKnown) {
    return "PROVEN_ACCEPTED";
  }
  if (
    input.durableNotSubmittedObservation &&
    !input.commercialSubmissionClaimed &&
    !input.adapterInvocationMayHaveStarted
  ) {
    return "PROVEN_NOT_SUBMITTED";
  }
  return "AMBIGUOUS_SUBMISSION_OUTCOME";
}

export type WorkerValidatedBundle = {
  readonly dispatch: ExecutionDispatch;
  readonly outboxJobId: string;
  readonly providerExecutionId: string;
  readonly envelope: ExecutionEnvelope;
  readonly correlation: SceneProviderSchedulingCorrelation;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly runtimeAuthorization: RuntimeAuthorizedFact;
  readonly registrySnapshotHash: string;
};

export type WorkerRuntimeRepository = {
  loadValidatedBundleByDispatchId(
    dispatchId: string
  ): Promise<WorkerValidatedBundle | null>;
  getWorkerExecutionResultByDispatchId(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null>;
  acceptOrReturnWorkerExecutionResult(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }>;
  /** MODEL A: append-only non-terminal observation (optional for legacy test doubles). */
  appendWorkerAttemptObservation?(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }>;
  getLatestWorkerAttemptObservationByDispatchId?(
    dispatchId: string
  ): Promise<WorkerExecutionResult | null>;
  getProviderAttemptAdapterState?(
    providerAttemptId: string
  ): Promise<{
    readonly status: "READY" | "DISPATCHING" | "SUBMITTED" | "RUNNING" | "RECONCILIATION_REQUIRED" | "FAILED" | string;
    readonly providerTaskId?: string;
  } | null>;
  /**
   * Durably persists and exclusively claims the Provider Attempt authority.
   * Persistence is idempotent. A separate exclusive claim moves READY to
   * DISPATCHING; a replayed DISPATCHING Attempt is an unknown outcome and must
   * never be submitted again automatically.
   */
  prepareProviderAttemptBeforeAdapter?(input: {
    readonly bundle: WorkerValidatedBundle;
    readonly providerAttemptId: string;
    readonly commercialReservationId: string;
    readonly workerId: string;
    readonly preparedAt: string;
  }): Promise<{ readonly replayed: boolean }>;
  claimProviderAttemptForAdapter?(input: {
    readonly providerAttemptId: string;
    readonly workerId: string;
    readonly claimedAt: string;
  }): Promise<{ readonly adapterEligible: boolean }>;
  /** Persist the adapter boundary outcome onto the durable Attempt authority. */
  recordProviderAdapterOutcome?(input: {
    readonly providerAttemptId: string;
    readonly acceptanceClassification: ProviderAcceptanceClassification;
    readonly canonicalProviderState: CanonicalProviderState;
    readonly providerRequestId?: string;
    readonly occurredAt: string;
  }): Promise<void>;
};

export type ProcessDispatchInput = {
  readonly dispatchId: string;
  /** Optional mode for accepted request resume/lookup. */
  readonly mode?: "submit" | "lookup";
  readonly providerRequestId?: string;
};

export type ProcessDispatchOutcome = {
  readonly result: WorkerExecutionResult;
  readonly replayed: boolean;
  readonly adapterInvoked: boolean;
  readonly finalizerInvoked: false;
  readonly usageWritten: false;
  readonly costWritten: false;
  readonly sceneResultWritten: false;
  readonly executionAllowed: false;
  readonly automaticFallbackEnabled: false;
};

export type SceneProviderWorkerRuntimeDependencies = {
  readonly repository: WorkerRuntimeRepository;
  readonly adapters: CanonicalAdapterRegistry;
  readonly commercialReservation?: {
    previewBeforeSubmit?(input: {
      readonly bundle: WorkerValidatedBundle;
      readonly providerAttemptId: string;
      readonly reservedAt: string;
    }): Promise<void>;
    reserveBeforeSubmit(input: {
      readonly bundle: WorkerValidatedBundle;
      readonly providerAttemptId: string;
      readonly reservedAt: string;
    }): Promise<{ readonly reservationId: string }>;
    claimSubmissionBeforeAdapter?(input: {
      readonly reservationId: string;
      readonly providerAttemptId: string;
      readonly claimedAt: string;
    }): Promise<void>;
    releaseBeforeAdapterFailure?(input: {
      readonly reservationId: string;
      readonly occurredAt: string;
    }): Promise<void>;
    loadForOutcome(input: {
      readonly providerAttemptId: string;
    }): Promise<{ readonly reservationId: string } | null>;
    recordProviderOutcome(input: {
      readonly reservationId: string;
      readonly phase: "submit" | "lookup";
      readonly acceptanceClassification: ProviderAcceptanceClassification;
      readonly canonicalProviderState: CanonicalProviderState;
      readonly normalizedUsageFacts?: WorkerExecutionResult["normalizedUsageFacts"];
      readonly normalizedCostMetadata?: WorkerExecutionResult["normalizedCostMetadata"];
      readonly occurredAt: string;
    }): Promise<void>;
  };
  /** Production AI Story workers must fail closed when this dependency is absent. */
  readonly requireCommercialReservation?: boolean;
  /** Production workers require durable Attempt authority before any submit. */
  readonly requireProviderAttemptAuthority?: boolean;
  readonly workerId?: string;
  /** Operational fail-closed hold used for non-paid lineage certification. */
  readonly beforeCommercialReservation?: (input: {
    readonly bundle: WorkerValidatedBundle;
    readonly providerAttemptId: string;
    readonly mode: "submit" | "lookup";
  }) => Promise<void> | void;
  readonly expectedRegistrySnapshotHash?: string;
  readonly now?: () => Date;
};

export function buildWorkerAttemptIdentityInput(input: {
  readonly providerExecutionId: string;
  readonly dispatchId: string;
  readonly routingDecisionId: string;
  readonly selectedProviderId: string;
  readonly adapterVersion: string;
  readonly attemptContractVersion?: number;
}) {
  return {
    kind: "ai-story-worker-attempt-identity",
    providerExecutionId: input.providerExecutionId,
    dispatchId: input.dispatchId,
    routingDecisionId: input.routingDecisionId,
    selectedProviderId: input.selectedProviderId,
    adapterVersion: input.adapterVersion,
    attemptContractVersion:
      input.attemptContractVersion ?? WORKER_ATTEMPT_CONTRACT_VERSION,
  };
}

export function computeWorkerAttemptId(
  input: Parameters<typeof buildWorkerAttemptIdentityInput>[0]
): string {
  return deterministicPersistenceUuid(
    "ai-story-worker-attempt",
    buildWorkerAttemptIdentityInput(input)
  );
}

export function computeWorkerExecutionResultId(input: {
  readonly providerAttemptId: string;
  readonly dispatchId: string;
  readonly workerState: WorkerExecutionState;
  readonly acceptanceClassification: ProviderAcceptanceClassification;
  readonly canonicalProviderState: CanonicalProviderState;
  readonly providerRequestId?: string;
}): string {
  return deterministicPersistenceUuid("ai-story-worker-execution-result", {
    providerAttemptId: input.providerAttemptId,
    dispatchId: input.dispatchId,
    workerState: input.workerState,
    acceptanceClassification: input.acceptanceClassification,
    canonicalProviderState: input.canonicalProviderState,
    providerRequestId: input.providerRequestId ?? null,
    workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
  });
}

export function computeWorkerExecutionResultHash(
  result: Omit<WorkerExecutionResult, "deterministicIntegrityHash">
): string {
  const {
    producedAt: _producedAt,
    executionAllowed: _executionAllowed,
    executionLockCode: _executionLockCode,
    ...stable
  } = result;
  return canonicalPersistenceHash({
    kind: "ai-story-worker-execution-result",
    ...stable,
  });
}

export class SceneProviderWorkerRuntime {
  private readonly now: () => Date;

  constructor(private readonly dependencies: SceneProviderWorkerRuntimeDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async processDispatch(input: ProcessDispatchInput): Promise<ProcessDispatchOutcome> {
    const terminal =
      await this.dependencies.repository.getWorkerExecutionResultByDispatchId(
        input.dispatchId
      );
    const observation =
      terminal == null &&
      this.dependencies.repository.getLatestWorkerAttemptObservationByDispatchId
        ? await this.dependencies.repository.getLatestWorkerAttemptObservationByDispatchId(
            input.dispatchId
          )
        : null;
    const existing = terminal ?? observation;

    const bundle = await this.dependencies.repository.loadValidatedBundleByDispatchId(
      input.dispatchId
    );
    if (!bundle) {
      throw new WorkerRuntimeError(
        "WORKER_DISPATCH_INVALID",
        "Dispatch is missing or fails ownership/correlation validation"
      );
    }

    this.assertValidatedBundle(bundle);

    const providerAttemptId = computeWorkerAttemptId({
      providerExecutionId: bundle.providerExecutionId,
      dispatchId: bundle.dispatch.dispatchId,
      routingDecisionId: bundle.routingDecision.routingDecisionId,
      selectedProviderId: bundle.routingDecision.selectedProviderId,
      adapterVersion: bundle.routingDecision.selectedAdapterVersion,
    });

    const durableAttempt =
      await this.dependencies.repository.getProviderAttemptAdapterState?.(
        providerAttemptId
      );
    if (
      !existing &&
      durableAttempt &&
      ["DISPATCHING", "RECONCILIATION_REQUIRED"].includes(durableAttempt.status) &&
      !durableAttempt.providerTaskId
    ) {
      throw new WorkerRuntimeError(
        "RECONCILIATION_REQUIRED",
        "Durable Provider Attempt has an unknown submission outcome; automatic retry is denied"
      );
    }

    const adapter = this.resolveBoundAdapter(bundle.routingDecision);
    const resumeProviderRequestId =
      input.providerRequestId ?? existing?.providerRequestId ?? durableAttempt?.providerTaskId;
    const canResumeLookup =
      Boolean(existing || durableAttempt?.providerTaskId) &&
      !terminal &&
      Boolean(resumeProviderRequestId) &&
      (!existing || !isTerminalWorkerResult(existing)) &&
      (input.mode === "lookup" ||
        existing?.reconciliationRequired === true ||
        ["SUBMITTED", "RUNNING"].includes(durableAttempt?.status ?? ""));

    if (existing && !canResumeLookup) {
      return {
        result: existing,
        replayed: true,
        adapterInvoked: false,
        finalizerInvoked: false,
        usageWritten: false,
        costWritten: false,
        sceneResultWritten: false,
        executionAllowed: false,
        automaticFallbackEnabled: false,
      };
    }

    const mode = canResumeLookup ? "lookup" : (input.mode ?? "submit");

    if (this.dependencies.requireCommercialReservation && !this.dependencies.commercialReservation) {
      throw new WorkerRuntimeError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Commercial reservation authority is required before Provider submission"
      );
    }

    const reservationTimestamp = this.now().toISOString();
    if (mode === "submit") {
      await this.dependencies.commercialReservation?.previewBeforeSubmit?.({
        bundle,
        providerAttemptId,
        reservedAt: reservationTimestamp,
      });
    }

    await this.dependencies.beforeCommercialReservation?.({
      bundle,
      providerAttemptId,
      mode,
    });

    const reservation = this.dependencies.commercialReservation
      ? mode === "submit"
        ? await this.dependencies.commercialReservation.reserveBeforeSubmit({
            bundle,
            providerAttemptId,
            reservedAt: reservationTimestamp,
          })
        : await this.dependencies.commercialReservation.loadForOutcome({
            providerAttemptId,
          })
      : undefined;

    if (mode === "submit") {
      if (
        this.dependencies.requireProviderAttemptAuthority &&
        (!reservation ||
          !this.dependencies.repository.prepareProviderAttemptBeforeAdapter ||
          !this.dependencies.repository.claimProviderAttemptForAdapter ||
          !this.dependencies.commercialReservation?.claimSubmissionBeforeAdapter)
      ) {
        throw new WorkerRuntimeError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Durable Provider Attempt authority is required before Provider submission"
        );
      }
      if (reservation && this.dependencies.repository.prepareProviderAttemptBeforeAdapter) {
        try {
          await this.dependencies.repository.prepareProviderAttemptBeforeAdapter({
            bundle,
            providerAttemptId,
            commercialReservationId: reservation.reservationId,
            workerId: this.dependencies.workerId ?? "scene-provider-worker",
            preparedAt: this.now().toISOString(),
          });
        } catch (error) {
          await this.dependencies.commercialReservation?.releaseBeforeAdapterFailure?.({
            reservationId: reservation.reservationId,
            occurredAt: this.now().toISOString(),
          });
          throw error;
        }
        await this.dependencies.commercialReservation?.claimSubmissionBeforeAdapter?.({
          reservationId: reservation.reservationId,
          providerAttemptId,
          claimedAt: this.now().toISOString(),
        });
        const claimed = await this.dependencies.repository.claimProviderAttemptForAdapter?.({
          providerAttemptId,
          workerId: this.dependencies.workerId ?? "scene-provider-worker",
          claimedAt: this.now().toISOString(),
        });
        if (!claimed?.adapterEligible) {
          throw new WorkerRuntimeError(
            "RECONCILIATION_REQUIRED",
            "Provider Attempt already crossed the pre-adapter claim boundary; automatic resubmission is denied"
          );
        }
      }
    }

    let adapterResult:
      | {
          acceptanceClassification: ProviderAcceptanceClassification;
          canonicalProviderState: CanonicalProviderState;
          providerRequestId?: string;
          terminalMedia?: WorkerExecutionResult["terminalMedia"];
          normalizedResultReference?: string;
          normalizedUsageFacts?: WorkerExecutionResult["normalizedUsageFacts"];
          normalizedCostMetadata?: WorkerExecutionResult["normalizedCostMetadata"];
          failureClassification?: WorkerExecutionResult["failureClassification"];
          reconciliationRequired: boolean;
        };

    try {
      if (mode === "lookup") {
        if (!resumeProviderRequestId) {
          throw new WorkerRuntimeError(
            "RECONCILIATION_REQUIRED",
            "Lookup requires a persisted providerRequestId"
          );
        }
        adapterResult = await adapter.lookup({
          providerRequestId: resumeProviderRequestId,
          envelope: bundle.envelope,
          providerAttemptId,
          dispatchId: bundle.dispatch.dispatchId,
        });
      } else {
        adapterResult = await adapter.submit({
          envelope: bundle.envelope,
          providerAttemptId,
          dispatchId: bundle.dispatch.dispatchId,
          idempotencyKey: bundle.envelope.executionContext.idempotencyKey,
          timeoutDeadline: bundle.envelope.executionContext.timeoutDeadline,
        });
      }
    } catch (error) {
      const classified = adapter.classifyError({
        error,
        phase: mode === "lookup" ? "lookup" : "submit",
      });
      adapterResult = {
        acceptanceClassification: classified.reconciliationRequired
          ? "ACCEPTANCE_UNKNOWN"
          : classified.retryable
            ? "NOT_SUBMITTED"
            : "NOT_ACCEPTED",
        canonicalProviderState: classified.reconciliationRequired
          ? "ACCEPTANCE_UNKNOWN"
          : classified.retryable
            ? "NOT_SUBMITTED"
            : "FAILED",
        failureClassification: classified,
        reconciliationRequired: classified.reconciliationRequired,
      };
    }

    if (mode === "submit") {
      if (
        this.dependencies.requireProviderAttemptAuthority &&
        !this.dependencies.repository.recordProviderAdapterOutcome
      ) {
        throw new WorkerRuntimeError(
          "OWNERSHIP_INTEGRITY_VIOLATION",
          "Durable adapter outcome authority is required after Provider submission"
        );
      }
      await this.dependencies.repository.recordProviderAdapterOutcome?.({
        providerAttemptId,
        acceptanceClassification: adapterResult.acceptanceClassification,
        canonicalProviderState: adapterResult.canonicalProviderState,
        ...(adapterResult.providerRequestId
          ? { providerRequestId: adapterResult.providerRequestId }
          : {}),
        occurredAt: this.now().toISOString(),
      });
    }

    if (this.dependencies.commercialReservation && reservation) {
      await this.dependencies.commercialReservation.recordProviderOutcome({
        reservationId: reservation.reservationId,
        phase: mode,
        acceptanceClassification: adapterResult.acceptanceClassification,
        canonicalProviderState: adapterResult.canonicalProviderState,
        ...(adapterResult.normalizedUsageFacts
          ? { normalizedUsageFacts: adapterResult.normalizedUsageFacts }
          : {}),
        ...(adapterResult.normalizedCostMetadata
          ? { normalizedCostMetadata: adapterResult.normalizedCostMetadata }
          : {}),
        occurredAt: this.now().toISOString(),
      });
    }

    const workerState = mapWorkerState(
      adapterResult.acceptanceClassification,
      adapterResult.canonicalProviderState
    );
    const producedAt = this.now().toISOString();
    const withoutHash = {
      workerExecutionResultId: computeWorkerExecutionResultId({
        providerAttemptId,
        dispatchId: bundle.dispatch.dispatchId,
        workerState,
        acceptanceClassification: adapterResult.acceptanceClassification,
        canonicalProviderState: adapterResult.canonicalProviderState,
        providerRequestId: adapterResult.providerRequestId,
      }),
      providerExecutionId: bundle.providerExecutionId,
      providerAttemptId,
      dispatchId: bundle.dispatch.dispatchId,
      outboxJobId: bundle.outboxJobId,
      routingDecisionId: bundle.routingDecision.routingDecisionId,
      providerId: bundle.routingDecision.selectedProviderId,
      adapterVersion: bundle.routingDecision.selectedAdapterVersion,
      routerVersion: SCENE_ROUTER_VERSION,
      ...(adapterResult.providerRequestId
        ? { providerRequestId: adapterResult.providerRequestId }
        : {}),
      workerState,
      acceptanceClassification: adapterResult.acceptanceClassification,
      canonicalProviderState: adapterResult.canonicalProviderState,
      ...(adapterResult.normalizedResultReference
        ? { normalizedResultReference: adapterResult.normalizedResultReference }
        : {}),
      ...(adapterResult.terminalMedia
        ? { terminalMedia: adapterResult.terminalMedia }
        : {}),
      ...(adapterResult.normalizedUsageFacts
        ? { normalizedUsageFacts: adapterResult.normalizedUsageFacts }
        : {}),
      ...(adapterResult.normalizedCostMetadata
        ? { normalizedCostMetadata: adapterResult.normalizedCostMetadata }
        : {}),
      ...(adapterResult.failureClassification
        ? { failureClassification: adapterResult.failureClassification }
        : {}),
      reconciliationRequired: adapterResult.reconciliationRequired,
      workerContractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
      attemptContractVersion: WORKER_ATTEMPT_CONTRACT_VERSION,
      producedAt,
      executionAllowed: false as const,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      automaticFallbackEnabled: false as const,
    };
    const result = WorkerExecutionResultSchema.parse({
      ...withoutHash,
      deterministicIntegrityHash: computeWorkerExecutionResultHash(withoutHash),
    });

    const accepted = isTerminalWorkerResult(result)
      ? await this.dependencies.repository.acceptOrReturnWorkerExecutionResult(result)
      : await this.persistNonTerminalObservation(result);

    return {
      result: accepted.result,
      replayed: accepted.converged,
      adapterInvoked: true,
      finalizerInvoked: false,
      usageWritten: false,
      costWritten: false,
      sceneResultWritten: false,
      executionAllowed: false,
      automaticFallbackEnabled: false,
    };
  }

  private async persistNonTerminalObservation(
    result: WorkerExecutionResult
  ): Promise<{ result: WorkerExecutionResult; converged: boolean }> {
    const append = this.dependencies.repository.appendWorkerAttemptObservation;
    if (!append) {
      throw new WorkerRuntimeError(
        "WORKER_ATTEMPT_CONFLICT",
        "Repository does not support Worker Attempt Observations for non-terminal results"
      );
    }
    return append.call(this.dependencies.repository, result);
  }

  private resolveBoundAdapter(
    routingDecision: PersistedSceneRoutingDecision
  ): CanonicalProviderAdapter {
    if (routingDecision.routerVersion !== SCENE_ROUTER_VERSION) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Persisted routerVersion is incompatible with Worker runtime"
      );
    }
    if (routingDecision.automaticFallbackEnabled !== false) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Automatic cross-provider fallback must remain disabled"
      );
    }
    const adapter = this.dependencies.adapters.resolve(
      routingDecision.selectedProviderId,
      routingDecision.selectedAdapterVersion
    );
    if (!adapter) {
      throw new WorkerRuntimeError(
        "ADAPTER_NOT_REGISTERED",
        "No Adapter is registered for the persisted Provider binding"
      );
    }
    if (
      adapter.providerId !== routingDecision.selectedProviderId ||
      adapter.adapterVersion !== routingDecision.selectedAdapterVersion
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Resolved Adapter identity conflicts with persisted Routing Decision"
      );
    }
    return adapter;
  }

  private assertValidatedBundle(bundle: WorkerValidatedBundle): void {
    const { dispatch, envelope, correlation, routingDecision, runtimeAuthorization } =
      bundle;

    if (dispatch.jobId !== bundle.outboxJobId) {
      throw new WorkerRuntimeError(
        "WORKER_DISPATCH_INVALID",
        "Dispatch does not belong to the Outbox Job"
      );
    }
    if (dispatch.executionId !== bundle.providerExecutionId) {
      throw new WorkerRuntimeError(
        "WORKER_DISPATCH_INVALID",
        "Dispatch Provider Execution identity mismatch"
      );
    }
    if (
      dispatch.envelopeId !== envelope.envelopeId ||
      dispatch.requestHash !== envelope.requestHash ||
      dispatch.envelopeHash !== envelope.envelopeHash
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ENVELOPE_INVALID",
        "Dispatch Envelope identity does not match persisted Envelope"
      );
    }
    if (
      correlation.outboxJobId !== bundle.outboxJobId ||
      correlation.providerExecutionId !== bundle.providerExecutionId ||
      correlation.envelopeId !== envelope.envelopeId ||
      correlation.requestHash !== envelope.requestHash ||
      correlation.envelopeHash !== envelope.envelopeHash
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ENVELOPE_INVALID",
        "Scheduling correlation does not match Envelope/Outbox/Provider Execution"
      );
    }
    if (
      correlation.routingDecisionId !== routingDecision.routingDecisionId ||
      correlation.runtimeAuthorizationId !==
        runtimeAuthorization.runtimeAuthorizationId ||
      correlation.executionPlanId !== runtimeAuthorization.executionPlanId ||
      routingDecision.runtimeAuthorizationId !==
        runtimeAuthorization.runtimeAuthorizationId ||
      routingDecision.executionPlanId !== runtimeAuthorization.executionPlanId ||
      routingDecision.sceneExecutionId !== correlation.sceneExecutionId
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Routing Decision / RuntimeAuthorizedFact / correlation identity mismatch"
      );
    }
    if (routingDecision.routerVersion !== SCENE_ROUTER_VERSION) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Routing Decision routerVersion is not the frozen contract version"
      );
    }
    if (
      this.dependencies.expectedRegistrySnapshotHash &&
      this.dependencies.expectedRegistrySnapshotHash !==
        routingDecision.registrySnapshotHash
    ) {
      throw new WorkerRuntimeError(
        "WORKER_ROUTING_BINDING_INVALID",
        "Registry snapshot hash conflicts with persisted Routing Decision"
      );
    }
    if (
      correlation.ownership.workspaceId !== dispatch.workspaceId ||
      correlation.ownership.orgId !== dispatch.tenantId ||
      runtimeAuthorization.ownership.workspaceId !== dispatch.workspaceId ||
      routingDecision.ownership.workspaceId !== dispatch.workspaceId
    ) {
      throw new WorkerRuntimeError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Worker bundle ownership chain is inconsistent"
      );
    }
    if (
      !runtimeAuthorization.orderedSceneExecutionIds.includes(
        correlation.sceneExecutionId
      )
    ) {
      throw new WorkerRuntimeError(
        "OWNERSHIP_INTEGRITY_VIOLATION",
        "Scene is not covered by RuntimeAuthorizedFact"
      );
    }
  }
}

function isTerminalWorkerResult(result: WorkerExecutionResult): boolean {
  return (
    result.workerState === "TERMINAL_SUCCESS" ||
    result.workerState === "TERMINAL_FAILURE" ||
    result.workerState === "NOT_ACCEPTED" ||
    result.canonicalProviderState === "SUCCEEDED" ||
    result.canonicalProviderState === "FAILED" ||
    result.canonicalProviderState === "REJECTED" ||
    result.canonicalProviderState === "TIMED_OUT" ||
    result.acceptanceClassification === "NOT_ACCEPTED"
  );
}

function mapWorkerState(
  acceptance: ProviderAcceptanceClassification,
  providerState: CanonicalProviderState
): WorkerExecutionState {
  if (acceptance === "NOT_SUBMITTED") return "SUBMISSION_PENDING";
  if (acceptance === "NOT_ACCEPTED") return "NOT_ACCEPTED";
  if (acceptance === "ACCEPTANCE_UNKNOWN") return "ACCEPTANCE_UNKNOWN";
  if (providerState === "PROCESSING") return "PROCESSING";
  if (providerState === "SUCCEEDED") return "TERMINAL_SUCCESS";
  if (
    providerState === "FAILED" ||
    providerState === "REJECTED" ||
    providerState === "TIMED_OUT"
  ) {
    return "TERMINAL_FAILURE";
  }
  if (acceptance === "ACCEPTED") return "ACCEPTED";
  return "VALIDATED";
}

export function assertNoProviderFallback(result: WorkerExecutionResult): void {
  if (result.automaticFallbackEnabled !== false) {
    throw new WorkerRuntimeError(
      "WORKER_ROUTING_BINDING_INVALID",
      "Worker result must keep automatic fallback disabled"
    );
  }
}

export { failureFromCode };
