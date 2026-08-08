/**
 * Sprint 3 PR 3.5 — Bridge from WorkerExecutionResult to Production Finalizer input.
 *
 * Validates the immutable chain and maps to CanonicalProviderResult / Finalizer input.
 * Append-or-returns Provider Attempt when missing.
 * Does NOT write Provider terminal state, usage, cost, or outbox completion.
 */
import {
  PHASE1_EXECUTION_LOCKED,
  PROVIDER_RELIABILITY_CONTRACT_VERSION,
  SCENE_ROUTER_VERSION,
  createProviderError,
  isFinalizerTerminalFailureState,
  type CanonicalProviderResult,
  type ProviderAttempt,
  type ProviderError,
  type SceneProjectionValidatedBundle,
  type WorkerExecutionResult,
} from "@ceo-agent/shared";
import {
  canonicalPersistenceHash,
} from "@ceo-agent/db";
import type { ProviderLedgerRepository } from "@ceo-agent/db";
import type { ProviderOutboxRepository } from "@ceo-agent/db";
import type { ProviderExecutionTerminalFailureInput } from "@ceo-agent/db";

export class ProviderWorkerResultFinalizerBridgeError extends Error {
  constructor(
    readonly code:
      | "BRIDGE_CHAIN_INVALID"
      | "BRIDGE_OWNERSHIP_VIOLATION"
      | "BRIDGE_BINDING_INVALID"
      | "BRIDGE_HASH_MISMATCH"
      | "BRIDGE_NON_TERMINAL"
      | "BRIDGE_ATTEMPT_CONFLICT"
      | "PHASE1_EXECUTION_LOCKED",
    message: string
  ) {
    super(message);
    this.name = "ProviderWorkerResultFinalizerBridgeError";
  }
}

export type BridgePrepareResult = {
  readonly finalizerInput: BridgeFinalizerInput;
  readonly canonicalResult: CanonicalProviderResult;
  readonly attempt: ProviderAttempt;
  readonly attemptCreated: boolean;
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
};

/** Finalizer input shape produced by the bridge (Production Finalizer consumes this). */
export type BridgeFinalizerInput = {
  readonly jobId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly workerId: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly result: CanonicalProviderResult;
  readonly dispatchTimestamp: string;
  readonly executionDurationMs: number;
  readonly completionMetadata: Readonly<Record<string, unknown>>;
};

export type BridgePrepareSuccess = BridgePrepareResult;

export type BridgePrepareTerminalFailure = {
  readonly finalizerInput: ProviderExecutionTerminalFailureInput;
  readonly attempt: ProviderAttempt;
  readonly attemptCreated: boolean;
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
};

export type BridgePrepareRetry = {
  readonly jobId: string;
  readonly leaseOwner: string;
  readonly nextVisibleAt: Date;
  readonly retryDelayMs: number;
  readonly retryClassification: "TRANSIENT_INFRA_FAILURE";
  readonly lastErrorCategory: string;
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
};

function assertOwnershipChain(bundle: SceneProjectionValidatedBundle): void {
  const ownership = bundle.runtimeAuthorization.ownership;
  const routing = bundle.routingDecision.ownership;
  const correlation = bundle.correlation.ownership;
  if (
    ownership.orgId !== routing.orgId ||
    ownership.workspaceId !== routing.workspaceId ||
    ownership.executionPlanId !== routing.executionPlanId ||
    ownership.orgId !== correlation.orgId ||
    ownership.workspaceId !== correlation.workspaceId ||
    ownership.executionPlanId !== correlation.executionPlanId
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_OWNERSHIP_VIOLATION",
      "Ownership identity diverges across authorization, routing, and correlation"
    );
  }
  if (
    bundle.dispatch.tenantId !== ownership.orgId ||
    bundle.dispatch.workspaceId !== ownership.workspaceId ||
    bundle.envelope.tenantId !== ownership.orgId ||
    bundle.envelope.workspaceId !== ownership.workspaceId
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_OWNERSHIP_VIOLATION",
      "Dispatch/Envelope ownership does not match RuntimeAuthorizedFact"
    );
  }
}

function assertImmutableChain(
  bundle: SceneProjectionValidatedBundle,
  workerResult: WorkerExecutionResult
): void {
  if (bundle.routingDecision.routerVersion !== SCENE_ROUTER_VERSION) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_BINDING_INVALID",
      "Persisted routerVersion is incompatible with Finalizer bridge"
    );
  }
  if (bundle.routingDecision.automaticFallbackEnabled !== false) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_BINDING_INVALID",
      "automaticFallbackEnabled must remain false"
    );
  }
  if (
    !bundle.runtimeAuthorization.orderedSceneExecutionIds.includes(
      bundle.routingDecision.sceneExecutionId
    )
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_CHAIN_INVALID",
      "Routing sceneExecutionId is not covered by RuntimeAuthorizedFact"
    );
  }
  if (
    bundle.correlation.routingDecisionId !== bundle.routingDecision.routingDecisionId ||
    bundle.correlation.runtimeAuthorizationId !==
      bundle.runtimeAuthorization.runtimeAuthorizationId ||
    bundle.correlation.providerExecutionId !== bundle.providerExecutionId ||
    bundle.correlation.outboxJobId !== bundle.outboxJobId ||
    bundle.correlation.sceneExecutionId !== bundle.routingDecision.sceneExecutionId
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_CHAIN_INVALID",
      "Scheduling correlation does not match authorization/routing/provider binding"
    );
  }
  if (
    workerResult.dispatchId !== bundle.dispatch.dispatchId ||
    workerResult.outboxJobId !== bundle.outboxJobId ||
    workerResult.providerExecutionId !== bundle.providerExecutionId ||
    workerResult.routingDecisionId !== bundle.routingDecision.routingDecisionId
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_CHAIN_INVALID",
      "Worker Execution Result does not match validated Dispatch chain"
    );
  }
  if (
    workerResult.providerId !== bundle.routingDecision.selectedProviderId ||
    workerResult.adapterVersion !== bundle.routingDecision.selectedAdapterVersion ||
    workerResult.routerVersion !== SCENE_ROUTER_VERSION
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_BINDING_INVALID",
      "Worker result provider binding diverges from persisted RoutingDecision"
    );
  }
  if (workerResult.automaticFallbackEnabled !== false) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_BINDING_INVALID",
      "Worker result must keep automaticFallbackEnabled=false"
    );
  }
  if (workerResult.executionAllowed !== false) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "PHASE1_EXECUTION_LOCKED",
      "Bridge refuses unlock; Phase 1 execution remains locked"
    );
  }
  if (
    bundle.correlation.routingDecisionHash !==
      bundle.routingDecision.deterministicIntegrityHash ||
    bundle.correlation.authorizationHash !==
      bundle.runtimeAuthorization.deterministicIntegrityHash
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_HASH_MISMATCH",
      "Correlation hash does not match persisted authorization/routing integrity"
    );
  }
}

function assertTerminalSuccess(workerResult: WorkerExecutionResult): void {
  if (workerResult.canonicalProviderState !== "SUCCEEDED") {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_NON_TERMINAL",
      `Bridge maps only SUCCEEDED Worker results to success Finalizer; got ${workerResult.canonicalProviderState}`
    );
  }
  if (workerResult.workerState !== "TERMINAL_SUCCESS") {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_NON_TERMINAL",
      `Bridge requires TERMINAL_SUCCESS worker state; got ${workerResult.workerState}`
    );
  }
}

function assertTerminalFailure(workerResult: WorkerExecutionResult): void {
  if (!isFinalizerTerminalFailureState(workerResult.canonicalProviderState)) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_NON_TERMINAL",
      `Bridge maps only FAILED/REJECTED/TIMED_OUT to failure Finalizer; got ${workerResult.canonicalProviderState}`
    );
  }
  if (
    workerResult.workerState !== "TERMINAL_FAILURE" &&
    workerResult.workerState !== "NOT_ACCEPTED"
  ) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_NON_TERMINAL",
      `Bridge requires TERMINAL_FAILURE or NOT_ACCEPTED worker state; got ${workerResult.workerState}`
    );
  }
  if (!workerResult.failureClassification?.terminal) {
    throw new ProviderWorkerResultFinalizerBridgeError(
      "BRIDGE_NON_TERMINAL",
      "Terminal failure Finalizer requires failureClassification.terminal=true"
    );
  }
}

export function classifyWorkerResultForCoordinator(
  workerResult: WorkerExecutionResult
):
  | "SUCCEEDED"
  | "TERMINAL_FAILURE"
  | "ACCEPTANCE_UNKNOWN"
  | "TRANSIENT_INFRA_FAILURE"
  | "NON_TERMINAL" {
  if (
    workerResult.canonicalProviderState === "ACCEPTANCE_UNKNOWN" ||
    workerResult.acceptanceClassification === "ACCEPTANCE_UNKNOWN" ||
    workerResult.workerState === "ACCEPTANCE_UNKNOWN"
  ) {
    return "ACCEPTANCE_UNKNOWN";
  }
  if (
    workerResult.failureClassification?.retryable === true &&
    workerResult.failureClassification.terminal === false &&
    workerResult.failureClassification.reconciliationRequired === false
  ) {
    return "TRANSIENT_INFRA_FAILURE";
  }
  if (workerResult.canonicalProviderState === "SUCCEEDED") {
    return "SUCCEEDED";
  }
  if (isFinalizerTerminalFailureState(workerResult.canonicalProviderState)) {
    return "TERMINAL_FAILURE";
  }
  return "NON_TERMINAL";
}

function mapFailureCodeToProviderError(
  workerResult: WorkerExecutionResult
): ProviderError {
  const code = workerResult.failureClassification?.code ?? "PROVIDER_FAILED";
  const message =
    workerResult.failureClassification?.sanitizedMessage ??
    "Provider terminal failure";
  if (code === "PROVIDER_TIMEOUT") {
    // AI Story treats PROVIDER_TIMEOUT as Production-Finalizer terminal (DEAD_LETTER),
    // not TIMEOUT_UNKNOWN reconciliation.
    return createProviderError("TERMINAL_FAILURE", {
      code,
      message,
    });
  }
  if (
    code === "PROVIDER_REJECTED" ||
    code === "PROVIDER_MODERATION_REJECTED"
  ) {
    return createProviderError("POLICY_REJECTION", {
      code,
      message,
    });
  }
  return createProviderError("TERMINAL_FAILURE", {
    code,
    message,
  });
}

function ensureSha256Hash(value: string, seed: unknown): string {
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return value;
  return canonicalPersistenceHash(seed);
}

export function mapWorkerResultToCanonicalProviderResult(input: {
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
}): CanonicalProviderResult {
  const { workerResult, bundle } = input;
  const requestHash = ensureSha256Hash(
    bundle.envelope.requestHash,
    { kind: "bridge-request-hash", envelopeId: bundle.envelope.envelopeId }
  );
  const responseHash = ensureSha256Hash(
    workerResult.deterministicIntegrityHash,
    {
      kind: "bridge-response-hash",
      workerExecutionResultId: workerResult.workerExecutionResultId,
    }
  );
  const resultReference =
    workerResult.terminalMedia?.uriReference ??
    workerResult.normalizedResultReference ??
    `worker-result://${workerResult.workerExecutionResultId}`;

  const usage = {
    ...(workerResult.normalizedUsageFacts?.inputTokens !== undefined
      ? { inputTokens: workerResult.normalizedUsageFacts.inputTokens }
      : {}),
    ...(workerResult.normalizedUsageFacts?.outputTokens !== undefined
      ? { outputTokens: workerResult.normalizedUsageFacts.outputTokens }
      : {}),
  };
  const cost = {
    amount: workerResult.normalizedCostMetadata?.amount ?? 0,
    currency: (workerResult.normalizedCostMetadata?.currency ?? "USD").toUpperCase(),
    estimated: workerResult.normalizedCostMetadata?.estimated ?? true,
  };

  return {
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    executionId: workerResult.providerExecutionId,
    providerAttemptId: workerResult.providerAttemptId,
    normalizedOutput: {
      sceneId: bundle.sceneId,
      sceneOrder: bundle.sceneOrder,
      durationMs: workerResult.terminalMedia?.durationMs ??
        workerResult.normalizedUsageFacts?.durationMs ??
        null,
      units: workerResult.normalizedUsageFacts?.units ?? null,
      unitKind: workerResult.normalizedUsageFacts?.unitKind ?? null,
      mediaType: workerResult.terminalMedia?.mediaType ?? null,
      contentHash: workerResult.terminalMedia?.contentHash ?? null,
    },
    resultReference,
    warnings: [],
    providerMetadata: {
      providerId: workerResult.providerId,
      providerVersion: workerResult.adapterVersion,
      ...(workerResult.providerRequestId
        ? { providerRequestId: workerResult.providerRequestId }
        : {}),
    },
    provenance: [
      {
        providerId: workerResult.providerId,
        adapterVersion: workerResult.adapterVersion,
        modelVersion: workerResult.adapterVersion,
        ...(workerResult.providerRequestId
          ? { providerRequestId: workerResult.providerRequestId }
          : {}),
      },
    ],
    usage,
    cost,
    modelVersion: workerResult.adapterVersion,
    requestHash,
    responseHash,
    retryable: false,
    validationStatus: "VALID",
  };
}

export function buildBridgeProviderAttempt(input: {
  readonly workerResult: WorkerExecutionResult;
  readonly canonicalResult: CanonicalProviderResult;
}): ProviderAttempt {
  return {
    contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
    attemptId: input.workerResult.providerAttemptId,
    executionId: input.workerResult.providerExecutionId,
    attemptNumber: 1,
    providerId: input.workerResult.providerId,
    providerVersion: input.workerResult.adapterVersion,
    modelVersion: input.canonicalResult.modelVersion,
    ...(input.workerResult.providerRequestId
      ? { providerRequestId: input.workerResult.providerRequestId }
      : {}),
    requestHash: input.canonicalResult.requestHash,
    responseHash: input.canonicalResult.responseHash,
    status: "SUCCEEDED",
    startedAt: input.workerResult.producedAt,
    completedAt: input.workerResult.producedAt,
  };
}

export function buildBridgeTerminalFailureAttempt(input: {
  readonly workerResult: WorkerExecutionResult;
  readonly bundle: SceneProjectionValidatedBundle;
  readonly failure: ProviderError;
}): {
  readonly attempt: ProviderAttempt;
  readonly requestHash: string;
  readonly responseHash: string;
  readonly resultReference: string;
} {
  const requestHash = ensureSha256Hash(input.bundle.envelope.requestHash, {
    kind: "bridge-failure-request-hash",
    envelopeId: input.bundle.envelope.envelopeId,
  });
  const responseHash = ensureSha256Hash(
    input.workerResult.deterministicIntegrityHash,
    {
      kind: "bridge-failure-response-hash",
      workerExecutionResultId: input.workerResult.workerExecutionResultId,
    }
  );
  const resultReference = `terminal-failure://${input.workerResult.workerExecutionResultId}`;
  return {
    requestHash,
    responseHash,
    resultReference,
    attempt: {
      contractVersion: PROVIDER_RELIABILITY_CONTRACT_VERSION,
      attemptId: input.workerResult.providerAttemptId,
      executionId: input.workerResult.providerExecutionId,
      attemptNumber: 1,
      providerId: input.workerResult.providerId,
      providerVersion: input.workerResult.adapterVersion,
      modelVersion: input.workerResult.adapterVersion,
      ...(input.workerResult.providerRequestId
        ? { providerRequestId: input.workerResult.providerRequestId }
        : {}),
      requestHash,
      responseHash,
      status: "TERMINAL_FAILURE",
      startedAt: input.workerResult.producedAt,
      completedAt: input.workerResult.producedAt,
    },
  };
}

export type ProviderWorkerResultFinalizerBridgeDependencies = {
  readonly ledger: Pick<ProviderLedgerRepository, "appendAttempt">;
  readonly outbox: Pick<ProviderOutboxRepository, "findJob" | "releaseLease"> & {
    /**
     * Ensures the outbox job is CLAIMED by workerId with an active lease.
     * Not a terminal write — Finalizer still owns COMPLETED / DEAD_LETTER.
     */
    claimOrRenewForFinalization(input: {
      jobId: string;
      leaseOwner: string;
      leaseDurationMs: number;
      now?: Date;
    }): Promise<void>;
  };
  readonly workerId?: string;
  readonly leaseDurationMs?: number;
  readonly retryDelayMs?: number;
};

export class ProviderWorkerResultFinalizerBridge {
  private readonly workerId: string;
  private readonly leaseDurationMs: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly dependencies: ProviderWorkerResultFinalizerBridgeDependencies
  ) {
    this.workerId = dependencies.workerId ?? "ai-story-finalizer-bridge";
    this.leaseDurationMs = dependencies.leaseDurationMs ?? 60_000;
    this.retryDelayMs = dependencies.retryDelayMs ?? 5_000;
  }

  /**
   * Validate chain, map to Finalizer input, append-or-return attempt, ensure lease.
   * Performs no Provider terminal / usage / cost / outbox COMPLETED writes.
   */
  async prepareFinalizerInput(input: {
    readonly bundle: SceneProjectionValidatedBundle;
    readonly workerResult: WorkerExecutionResult;
  }): Promise<BridgePrepareSuccess> {
    const { bundle, workerResult } = input;
    assertOwnershipChain(bundle);
    assertImmutableChain(bundle, workerResult);
    assertTerminalSuccess(workerResult);
    void PHASE1_EXECUTION_LOCKED;

    const canonicalResult = mapWorkerResultToCanonicalProviderResult({
      workerResult,
      bundle,
    });
    const attemptCandidate = buildBridgeProviderAttempt({
      workerResult,
      canonicalResult,
    });

    let attemptCreated = false;
    let attempt: ProviderAttempt;
    try {
      const before = await this.dependencies.ledger.appendAttempt({
        attempt: attemptCandidate,
        providerMetadata: {
          source: "ai-story-worker-result-bridge",
          workerExecutionResultId: workerResult.workerExecutionResultId,
        },
      });
      // appendAttempt returns existing or inserted; detect creation via status match only.
      attempt = before;
      attemptCreated = before.attemptId === attemptCandidate.attemptId;
    } catch (error) {
      throw new ProviderWorkerResultFinalizerBridgeError(
        "BRIDGE_ATTEMPT_CONFLICT",
        error instanceof Error ? error.message : "Provider attempt conflict"
      );
    }

    await this.dependencies.outbox.claimOrRenewForFinalization({
      jobId: workerResult.outboxJobId,
      leaseOwner: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
    });

    const finalizerInput: BridgeFinalizerInput = {
      jobId: workerResult.outboxJobId,
      executionId: workerResult.providerExecutionId,
      attemptId: workerResult.providerAttemptId,
      workerId: this.workerId,
      providerId: workerResult.providerId,
      adapterVersion: workerResult.adapterVersion,
      result: canonicalResult,
      dispatchTimestamp: bundle.dispatch.createdAt,
      executionDurationMs:
        workerResult.terminalMedia?.durationMs ??
        workerResult.normalizedUsageFacts?.durationMs ??
        0,
      completionMetadata: {
        resultReference: canonicalResult.resultReference,
        providerRequestId: canonicalResult.providerMetadata.providerRequestId,
        workerExecutionResultId: workerResult.workerExecutionResultId,
        source: "ai-story-worker-result-bridge",
      },
    };

    return {
      finalizerInput,
      canonicalResult,
      attempt,
      attemptCreated,
      workerResult,
      bundle,
    };
  }

  /**
   * Prepare Production Finalizer terminal-failure input.
   * Appends TERMINAL_FAILURE attempt; does not write usage/cost/outbox terminal.
   */
  async prepareTerminalFailureFinalizerInput(input: {
    readonly bundle: SceneProjectionValidatedBundle;
    readonly workerResult: WorkerExecutionResult;
  }): Promise<BridgePrepareTerminalFailure> {
    const { bundle, workerResult } = input;
    assertOwnershipChain(bundle);
    assertImmutableChain(bundle, workerResult);
    assertTerminalFailure(workerResult);
    void PHASE1_EXECUTION_LOCKED;

    const failure = mapFailureCodeToProviderError(workerResult);
    const built = buildBridgeTerminalFailureAttempt({
      workerResult,
      bundle,
      failure,
    });

    let attemptCreated = false;
    let attempt: ProviderAttempt;
    try {
      attempt = await this.dependencies.ledger.appendAttempt({
        attempt: built.attempt,
        failure,
        providerMetadata: {
          source: "ai-story-worker-result-bridge",
          workerExecutionResultId: workerResult.workerExecutionResultId,
          terminalKind: "TERMINAL_FAILURE",
          failureCode: failure.code,
        },
      });
      attemptCreated = attempt.attemptId === built.attempt.attemptId;
    } catch (error) {
      throw new ProviderWorkerResultFinalizerBridgeError(
        "BRIDGE_ATTEMPT_CONFLICT",
        error instanceof Error ? error.message : "Provider attempt conflict"
      );
    }

    await this.dependencies.outbox.claimOrRenewForFinalization({
      jobId: workerResult.outboxJobId,
      leaseOwner: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
    });

    return {
      finalizerInput: {
        jobId: workerResult.outboxJobId,
        executionId: workerResult.providerExecutionId,
        attemptId: workerResult.providerAttemptId,
        workerId: this.workerId,
        providerId: workerResult.providerId,
        adapterVersion: workerResult.adapterVersion,
        failureCode: failure.code,
        failureReason: failure.message,
        resultReference: built.resultReference,
        requestHash: built.requestHash,
        responseHash: built.responseHash,
        dispatchTimestamp: bundle.dispatch.createdAt,
        executionDurationMs:
          workerResult.normalizedUsageFacts?.durationMs ?? 0,
        completionMetadata: {
          workerExecutionResultId: workerResult.workerExecutionResultId,
          canonicalProviderState: workerResult.canonicalProviderState,
          source: "ai-story-worker-result-bridge",
        },
      },
      attempt,
      attemptCreated,
      workerResult,
      bundle,
    };
  }

  /**
   * Claim lease and return release instructions for TRANSIENT_INFRA_FAILURE.
   * Does not terminalize Provider execution or outbox.
   */
  async prepareTransientRetry(input: {
    readonly bundle: SceneProjectionValidatedBundle;
    readonly workerResult: WorkerExecutionResult;
  }): Promise<BridgePrepareRetry> {
    const { bundle, workerResult } = input;
    assertOwnershipChain(bundle);
    assertImmutableChain(bundle, workerResult);
    if (classifyWorkerResultForCoordinator(workerResult) !== "TRANSIENT_INFRA_FAILURE") {
      throw new ProviderWorkerResultFinalizerBridgeError(
        "BRIDGE_NON_TERMINAL",
        "prepareTransientRetry requires TRANSIENT_INFRA_FAILURE classification"
      );
    }
    void PHASE1_EXECUTION_LOCKED;

    await this.dependencies.outbox.claimOrRenewForFinalization({
      jobId: workerResult.outboxJobId,
      leaseOwner: this.workerId,
      leaseDurationMs: this.leaseDurationMs,
    });

    const nextVisibleAt = new Date(Date.now() + this.retryDelayMs);
    return {
      jobId: workerResult.outboxJobId,
      leaseOwner: this.workerId,
      nextVisibleAt,
      retryDelayMs: this.retryDelayMs,
      retryClassification: "TRANSIENT_INFRA_FAILURE",
      lastErrorCategory:
        workerResult.failureClassification?.code ?? "TRANSIENT_INFRA_FAILURE",
      workerResult,
      bundle,
    };
  }
}

