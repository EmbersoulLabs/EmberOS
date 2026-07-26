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
import type {
  CanonicalProviderRequest,
  CanonicalProviderResult,
  ProviderExecution,
  ProviderOutboxJob,
} from "@ceo-agent/shared";

export interface ProviderDispatchEnvelope {
  readonly request: CanonicalProviderRequest;
  readonly routingRequest: ProviderRoutingRequest;
  readonly routingPolicy: ProviderRoutingPolicy;
  readonly dataHandling: ProviderExecutionContext["dataHandling"];
  readonly trace: Readonly<Record<string, string>>;
}

export interface ProviderDispatchEnvelopeLoader {
  load(payloadReference: string): Promise<ProviderDispatchEnvelope>;
}

export interface ProviderDispatchOutbox {
  claimNextJob(input: {
    leaseOwner: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob | null>;
  findJob(jobId: string): Promise<ProviderOutboxJob | null>;
}

export interface ProviderDispatchLedger {
  findExecution(
    executionId: string
  ): Promise<{ execution: ProviderExecution; requestHash: string } | null>;
}

export interface ProviderDispatchLogEntry {
  readonly event:
    | "provider_dispatch.worker_started"
    | "provider_dispatch.no_job"
    | "provider_dispatch.job_claimed"
    | "provider_dispatch.router_decision"
    | "provider_dispatch.adapter_invoked"
    | "provider_dispatch.finished"
    | "provider_dispatch.failed";
  readonly workerId: string;
  readonly jobId?: string;
  readonly executionId?: string;
  readonly providerId?: string;
  readonly adapterVersion?: string;
  readonly outcome?: ProviderDispatchOutcome["status"];
  readonly durationMs?: number;
  readonly reason?: string;
  readonly timestamp: string;
}

export interface ProviderDispatchLogger {
  log(entry: ProviderDispatchLogEntry): void;
}

export type ProviderDispatchOutcome =
  | Readonly<{ status: "NO_JOB"; workerId: string; dispatchTimestamp: string }>
  | Readonly<{
      status: "DISPATCHED";
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
        | "LEASE_LOST"
        | "NO_ELIGIBLE_PROVIDER"
        | "ADAPTER_FAILURE"
        | "TIMEOUT_UNKNOWN"
        | "UNEXPECTED_INFRASTRUCTURE_FAILURE";
      workerId: string;
      dispatchTimestamp: string;
      jobId?: string;
      executionId?: string;
      reason: string;
    }>;

export interface OutboxDispatchWorkerOptions {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly outbox: ProviderDispatchOutbox;
  readonly ledger: ProviderDispatchLedger;
  readonly envelopeLoader: ProviderDispatchEnvelopeLoader;
  readonly router: ProviderRouter;
  readonly adapters: ProviderAdapterRegistry;
  readonly logger?: ProviderDispatchLogger;
  readonly now?: () => Date;
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function assertLease(
  job: ProviderOutboxJob | null,
  workerId: string,
  now: Date
): asserts job is ProviderOutboxJob {
  if (
    !job ||
    job.status !== "CLAIMED" ||
    job.leaseOwner !== workerId ||
    !job.leaseExpiresAt ||
    Date.parse(job.leaseExpiresAt) <= now.getTime()
  ) {
    throw new Error("Claimed Outbox lease is missing, expired, or owned by another worker");
  }
}

function assertEnvelope(
  job: ProviderOutboxJob,
  execution: ProviderExecution,
  envelope: ProviderDispatchEnvelope
): void {
  const request = envelope.request;
  const identity = execution.identity;
  if (
    job.executionId !== identity.executionId ||
    job.correlationId !== execution.metadata.correlationId ||
    request.executionIdentity.executionId !== identity.executionId ||
    request.executionIdentity.idempotencyKey !== identity.idempotencyKey ||
    request.executionIdentity.deterministicFingerprint !==
      identity.deterministicFingerprint ||
    request.correlation.correlationId !== job.correlationId ||
    envelope.routingRequest.tenantId !== identity.tenantId ||
    envelope.routingRequest.workspaceId !== identity.workspaceId ||
    envelope.routingRequest.correlationId !== job.correlationId ||
    envelope.routingRequest.capabilityId !== identity.capabilityId ||
    envelope.routingRequest.capabilityVersion !== identity.capabilityVersion
  ) {
    throw new Error("Dispatch envelope conflicts with Outbox or Ledger identity");
  }
}

export class OutboxDispatchWorker {
  private readonly now: () => Date;
  private readonly logger: ProviderDispatchLogger;

  constructor(private readonly options: OutboxDispatchWorkerOptions) {
    if (!options.workerId.trim()) throw new Error("workerId is required");
    if (!Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? { log: () => undefined };
  }

  async dispatchOne(): Promise<ProviderDispatchOutcome> {
    const startedAt = this.now();
    const dispatchTimestamp = startedAt.toISOString();
    const base = { workerId: this.options.workerId, timestamp: dispatchTimestamp };
    this.logger.log({ event: "provider_dispatch.worker_started", ...base });

    let claimed: ProviderOutboxJob | null = null;
    try {
      claimed = await this.options.outbox.claimNextJob({
        leaseOwner: this.options.workerId,
        leaseDurationMs: this.options.leaseDurationMs,
        now: startedAt,
      });
      if (!claimed) {
        this.logger.log({ event: "provider_dispatch.no_job", ...base });
        return freeze({
          status: "NO_JOB",
          workerId: this.options.workerId,
          dispatchTimestamp,
        }) as ProviderDispatchOutcome;
      }

      this.logger.log({
        event: "provider_dispatch.job_claimed",
        ...base,
        jobId: claimed.jobId,
        executionId: claimed.executionId,
      });
      assertLease(
        await this.options.outbox.findJob(claimed.jobId),
        this.options.workerId,
        this.now()
      );

      const ledgerEntry = await this.options.ledger.findExecution(claimed.executionId);
      if (!ledgerEntry) throw new Error("Provider execution was not found");
      const envelope = freeze(
        structuredClone(await this.options.envelopeLoader.load(claimed.payloadReference))
      ) as ProviderDispatchEnvelope;
      assertEnvelope(claimed, ledgerEntry.execution, envelope);

      const decision = await this.options.router.route(
        envelope.routingRequest,
        envelope.routingPolicy
      );
      this.logger.log({
        event: "provider_dispatch.router_decision",
        ...base,
        jobId: claimed.jobId,
        executionId: claimed.executionId,
        providerId: decision.selectedProviderId,
        adapterVersion: decision.selectedAdapterVersion,
      });

      assertLease(
        await this.options.outbox.findJob(claimed.jobId),
        this.options.workerId,
        this.now()
      );
      const adapter = this.options.adapters.resolve(
        decision.selectedProviderId,
        decision.selectedAdapterVersion
      );
      if (!adapter) throw new Error("Router selected an unavailable Provider Adapter");

      const attemptId = `${claimed.executionId}:attempt:${claimed.attemptCount}`;
      const context: ProviderExecutionContext = freeze({
        executionId: claimed.executionId,
        providerAttemptId: attemptId,
        correlationId: claimed.correlationId,
        tenantId: ledgerEntry.execution.identity.tenantId,
        workspaceId: ledgerEntry.execution.identity.workspaceId,
        timeoutDeadline: new Date(
          this.now().getTime() + envelope.request.timeoutPolicy.timeoutMs
        ).toISOString(),
        idempotencyKey: ledgerEntry.execution.identity.idempotencyKey,
        capability: {
          capabilityId: envelope.request.executionIdentity.capabilityId,
          capabilityVersion: envelope.request.executionIdentity.capabilityVersion,
          requestSchemaVersion: envelope.request.requestSchemaVersion,
          resultSchemaVersion: envelope.request.resultSchemaVersion,
        },
        dataHandling: envelope.dataHandling,
        trace: envelope.trace,
      }) as ProviderExecutionContext;

      this.logger.log({
        event: "provider_dispatch.adapter_invoked",
        ...base,
        jobId: claimed.jobId,
        executionId: claimed.executionId,
        providerId: adapter.providerId,
        adapterVersion: adapter.adapterVersion,
      });
      const result = await adapter.execute(envelope.request, context);
      if (
        result.executionId !== claimed.executionId ||
        result.providerAttemptId !== attemptId ||
        result.providerMetadata.providerId !== decision.selectedProviderId
      ) {
        throw new Error("Provider Adapter returned a conflicting canonical result");
      }

      const executionDurationMs = Math.max(0, this.now().getTime() - startedAt.getTime());
      const outcome = freeze({
        status: "DISPATCHED",
        executionId: claimed.executionId,
        attemptId,
        providerId: adapter.providerId,
        adapterVersion: adapter.adapterVersion,
        result,
        executionDurationMs,
        workerId: this.options.workerId,
        dispatchTimestamp,
      }) as ProviderDispatchOutcome;
      this.logger.log({
        event: "provider_dispatch.finished",
        ...base,
        jobId: claimed.jobId,
        executionId: claimed.executionId,
        providerId: adapter.providerId,
        adapterVersion: adapter.adapterVersion,
        outcome: "DISPATCHED",
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
            : /lease/i.test(error instanceof Error ? error.message : "")
              ? "LEASE_LOST"
              : "UNEXPECTED_INFRASTRUCTURE_FAILURE";
      const reason =
        error instanceof Error ? error.message : "Unknown provider dispatch failure";
      const outcome = freeze({
        status,
        workerId: this.options.workerId,
        dispatchTimestamp,
        jobId: claimed?.jobId,
        executionId: claimed?.executionId,
        reason,
      }) as ProviderDispatchOutcome;
      this.logger.log({
        event: "provider_dispatch.failed",
        ...base,
        jobId: claimed?.jobId,
        executionId: claimed?.executionId,
        outcome: status,
        reason,
      });
      return outcome;
    }
  }
}
