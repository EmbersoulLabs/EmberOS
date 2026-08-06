import {
  ProviderAdapterError,
  type ProviderExecutionContext,
} from "@ceo-agent/agents/provider-adapters";
import {
  NoEligibleProviderError,
  type ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
  type ProviderRouter,
} from "@ceo-agent/agents/provider-router";
import {
  validateExecutionDispatch,
  validateExecutionEnvelope,
  type CanonicalProviderResult,
  type ExecutionDispatch,
  type ExecutionEnvelope,
} from "@ceo-agent/shared";

export interface ProviderWorkerDispatchStore {
  getDispatch(dispatchId: string): Promise<ExecutionDispatch | null>;
}

export interface ProviderWorkerEnvelopeStore {
  getEnvelope(envelopeId: string): Promise<ExecutionEnvelope | null>;
}

export interface ProviderWorkerLogEntry {
  readonly event:
    | "provider_worker.started"
    | "provider_worker.dispatch_loaded"
    | "provider_worker.envelope_loaded"
    | "provider_worker.provider_resolved"
    | "provider_worker.adapter_invoked"
    | "provider_worker.finished"
    | "provider_worker.failed";
  readonly workerId: string;
  readonly dispatchId: string;
  readonly envelopeId?: string;
  readonly capabilityId?: string;
  readonly providerId?: string;
  readonly workspaceId?: string;
  readonly correlationId?: string;
  readonly status: ProviderWorkerOutcome["status"] | "STARTED";
  readonly durationMs?: number;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ProviderWorkerLogger {
  log(entry: ProviderWorkerLogEntry): void;
}

export type ProviderWorkerOutcome =
  | Readonly<{
      status: "DISPATCHED";
      dispatchId: string;
      envelopeId: string;
      jobId: string;
      executionId: string;
      attemptId: string;
      providerId: string;
      adapterVersion: string;
      result: CanonicalProviderResult;
      executionDurationMs: number;
      workerId: string;
      dispatchTimestamp: string;
    }>
  | Readonly<{
      status:
        | "DISPATCH_NOT_FOUND"
        | "ENVELOPE_NOT_FOUND"
        | "NO_ELIGIBLE_PROVIDER"
        | "ADAPTER_FAILURE"
        | "TIMEOUT_UNKNOWN"
        | "INVALID_HANDOFF"
        | "UNEXPECTED_INFRASTRUCTURE_FAILURE";
      dispatchId: string;
      workerId: string;
      dispatchTimestamp: string;
      reason: string;
    }>;

export type ProviderDispatchOutcome = ProviderWorkerOutcome;

export interface ProviderExecutionWorkerOptions {
  readonly workerId: string;
  readonly dispatches: ProviderWorkerDispatchStore;
  readonly envelopes: ProviderWorkerEnvelopeStore;
  readonly router: ProviderRouter;
  readonly adapters: ProviderAdapterRegistry;
  readonly logger?: ProviderWorkerLogger;
  readonly now?: () => Date;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
  }
  return value;
}

function routingContracts(envelope: ExecutionEnvelope): {
  routingRequest: ProviderRoutingRequest;
  routingPolicy: ProviderRoutingPolicy;
} {
  const snapshot = envelope.providerPolicySnapshot;
  const routingRequest = snapshot.routingRequest;
  const routingPolicy = snapshot.routingPolicy;
  if (
    !routingRequest ||
    typeof routingRequest !== "object" ||
    !routingPolicy ||
    typeof routingPolicy !== "object"
  ) {
    throw new Error(
      "Execution Envelope does not contain canonical routing contracts"
    );
  }
  return {
    routingRequest: freeze(structuredClone(routingRequest)) as ProviderRoutingRequest,
    routingPolicy: freeze(structuredClone(routingPolicy)) as ProviderRoutingPolicy,
  };
}

function assertHandoff(
  dispatch: ExecutionDispatch,
  envelope: ExecutionEnvelope
): void {
  if (
    dispatch.envelopeId !== envelope.envelopeId ||
    dispatch.workerHandoff.envelopeId !== envelope.envelopeId ||
    dispatch.payloadReference !== envelope.payloadReference ||
    dispatch.workerHandoff.payloadReference !== envelope.payloadReference ||
    dispatch.executionId !== envelope.executionContext.executionId ||
    dispatch.correlationId !== envelope.executionContext.correlationId ||
    dispatch.tenantId !== envelope.tenantId ||
    dispatch.workspaceId !== envelope.workspaceId ||
    dispatch.capabilityId !== envelope.capabilityId ||
    dispatch.capabilityVersion !== envelope.capabilityVersion ||
    dispatch.requestHash !== envelope.requestHash ||
    dispatch.envelopeHash !== envelope.envelopeHash
  ) {
    throw new Error("Dispatch conflicts with immutable Execution Envelope");
  }
}

function executionContext(
  dispatch: ExecutionDispatch,
  envelope: ExecutionEnvelope
): ProviderExecutionContext {
  const dataHandling = envelope.executionContext.dataHandling;
  return freeze({
    executionId: dispatch.executionId,
    providerAttemptId: `${dispatch.executionId}:dispatch:${dispatch.dispatchId}`,
    correlationId: dispatch.correlationId,
    tenantId: dispatch.tenantId,
    workspaceId: dispatch.workspaceId,
    timeoutDeadline: envelope.executionContext.timeoutDeadline,
    idempotencyKey: envelope.executionContext.idempotencyKey,
    capability: {
      capabilityId: envelope.capabilityId,
      capabilityVersion: envelope.capabilityVersion,
      requestSchemaVersion: envelope.canonicalRequest.requestSchemaVersion,
      resultSchemaVersion: envelope.canonicalRequest.resultSchemaVersion,
    },
    dataHandling: {
      allowedRegions: Array.isArray(dataHandling.allowedRegions)
        ? (dataHandling.allowedRegions as string[])
        : undefined,
      sensitiveData: dataHandling.sensitiveData === true,
      retentionAllowed: dataHandling.retentionAllowed === true,
    },
    trace: envelope.executionContext.trace,
  }) as ProviderExecutionContext;
}

export class ProviderExecutionWorker {
  private readonly now: () => Date;
  private readonly logger: ProviderWorkerLogger;

  constructor(private readonly options: ProviderExecutionWorkerOptions) {
    if (!options.workerId.trim()) throw new Error("workerId is required");
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? { log: () => undefined };
  }

  async execute(dispatchId: string): Promise<ProviderWorkerOutcome> {
    const startedAt = this.now();
    const dispatchTimestamp = startedAt.toISOString();
    const base = {
      workerId: this.options.workerId,
      dispatchId,
      timestamp: dispatchTimestamp,
    };
    this.logger.log({
      event: "provider_worker.started",
      ...base,
      status: "STARTED",
    });

    try {
      const storedDispatch = await this.options.dispatches.getDispatch(dispatchId);
      if (!storedDispatch) {
        return this.failure("DISPATCH_NOT_FOUND", "Dispatch was not found", base);
      }
      const dispatch = await validateExecutionDispatch(storedDispatch);
      this.logger.log({
        event: "provider_worker.dispatch_loaded",
        ...base,
        envelopeId: dispatch.envelopeId,
        capabilityId: dispatch.capabilityId,
        workspaceId: dispatch.workspaceId,
        correlationId: dispatch.correlationId,
        status: "STARTED",
      });

      const storedEnvelope = await this.options.envelopes.getEnvelope(
        dispatch.workerHandoff.envelopeId
      );
      if (!storedEnvelope) {
        return this.failure("ENVELOPE_NOT_FOUND", "Execution Envelope was not found", base);
      }
      const envelope = await validateExecutionEnvelope(storedEnvelope);
      assertHandoff(dispatch, envelope);
      this.logger.log({
        event: "provider_worker.envelope_loaded",
        ...base,
        envelopeId: envelope.envelopeId,
        capabilityId: envelope.capabilityId,
        workspaceId: envelope.workspaceId,
        correlationId: envelope.executionContext.correlationId,
        status: "STARTED",
      });

      const { routingRequest, routingPolicy } = routingContracts(envelope);
      const decision = await this.options.router.route(
        routingRequest,
        routingPolicy
      );
      const adapter = this.options.adapters.resolve(
        decision.selectedProviderId,
        decision.selectedAdapterVersion
      );
      if (!adapter) {
        throw new Error("Provider Registry could not resolve Router decision");
      }
      this.logger.log({
        event: "provider_worker.provider_resolved",
        ...base,
        envelopeId: envelope.envelopeId,
        capabilityId: envelope.capabilityId,
        providerId: adapter.providerId,
        workspaceId: envelope.workspaceId,
        correlationId: dispatch.correlationId,
        status: "STARTED",
      });

      const context = executionContext(dispatch, envelope);
      this.logger.log({
        event: "provider_worker.adapter_invoked",
        ...base,
        envelopeId: envelope.envelopeId,
        capabilityId: envelope.capabilityId,
        providerId: adapter.providerId,
        workspaceId: envelope.workspaceId,
        correlationId: dispatch.correlationId,
        status: "STARTED",
      });
      const result = await adapter.execute(envelope.canonicalRequest, context);
      if (
        result.executionId !== dispatch.executionId ||
        result.providerAttemptId !== context.providerAttemptId ||
        result.providerMetadata.providerId !== decision.selectedProviderId
      ) {
        throw new Error("Provider Adapter returned a conflicting canonical result");
      }

      const executionDurationMs = Math.max(
        0,
        this.now().getTime() - startedAt.getTime()
      );
      const outcome = freeze({
        status: "DISPATCHED",
        dispatchId: dispatch.dispatchId,
        envelopeId: envelope.envelopeId,
        jobId: dispatch.jobId,
        executionId: dispatch.executionId,
        attemptId: context.providerAttemptId,
        providerId: adapter.providerId,
        adapterVersion: adapter.adapterVersion,
        result,
        executionDurationMs,
        workerId: this.options.workerId,
        dispatchTimestamp,
      }) as ProviderWorkerOutcome;
      this.logger.log({
        event: "provider_worker.finished",
        ...base,
        envelopeId: envelope.envelopeId,
        capabilityId: envelope.capabilityId,
        providerId: adapter.providerId,
        workspaceId: envelope.workspaceId,
        correlationId: dispatch.correlationId,
        status: "DISPATCHED",
        durationMs: executionDurationMs,
      });
      return outcome;
    } catch (error) {
      const status =
        error instanceof NoEligibleProviderError
          ? "NO_ELIGIBLE_PROVIDER"
          : error instanceof ProviderAdapterError
            ? error.providerError.kind === "TIMEOUT_UNKNOWN"
              ? "TIMEOUT_UNKNOWN"
              : "ADAPTER_FAILURE"
            : /Dispatch conflicts|routing contracts/.test(
                  error instanceof Error ? error.message : ""
                )
              ? "INVALID_HANDOFF"
              : "UNEXPECTED_INFRASTRUCTURE_FAILURE";
      return this.failure(
        status,
        error instanceof Error ? error.message : "Unknown Worker failure",
        base
      );
    }
  }

  private failure(
    status: Exclude<ProviderWorkerOutcome, { status: "DISPATCHED" }>["status"],
    reason: string,
    base: { workerId: string; dispatchId: string; timestamp: string }
  ): ProviderWorkerOutcome {
    this.logger.log({
      event: "provider_worker.failed",
      ...base,
      status,
      reason,
    });
    return freeze({
      status,
      dispatchId: base.dispatchId,
      workerId: base.workerId,
      dispatchTimestamp: base.timestamp,
      reason,
    }) as ProviderWorkerOutcome;
  }
}
