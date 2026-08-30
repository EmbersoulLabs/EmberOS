import {
  createExecutionDispatch,
  validateExecutionEnvelope,
  type ExecutionDispatch,
  type ExecutionEnvelope,
} from "@ceo-agent/shared";

export interface DispatcherJob {
  readonly jobId: string;
  readonly executionId: string;
  readonly payloadReference: string;
  readonly correlationId: string;
  readonly status: "PENDING";
}

export interface DispatcherRepository {
  selectEligibleJob(
    now?: Date,
    options?: { readonly ownership?: "ANY" | "AI_STORY_SCENE" | "GENERIC_PROVIDER" }
  ): Promise<DispatcherJob | null>;
  createDispatch(dispatch: ExecutionDispatch): Promise<ExecutionDispatch>;
  getDispatchByJobId(jobId: string): Promise<ExecutionDispatch | null>;
}

export interface DispatcherEnvelopeStore {
  getEnvelopeByPayloadReference(
    payloadReference: string
  ): Promise<ExecutionEnvelope | null>;
}

export interface DispatcherLogEntry {
  readonly event:
    | "provider_dispatcher.started"
    | "provider_dispatcher.no_job"
    | "provider_dispatcher.envelope_resolved"
    | "provider_dispatcher.dispatch_created"
    | "provider_dispatcher.rejected";
  readonly jobId?: string;
  readonly envelopeId?: string;
  readonly dispatchId?: string;
  readonly capabilityId?: string;
  readonly workspaceId?: string;
  readonly status: "SELECTING" | "NO_JOB" | "VALIDATING" | "DISPATCHED" | "REJECTED";
  readonly reason?: string;
  readonly timestamp: string;
}

export interface DispatcherLogger {
  log(entry: DispatcherLogEntry): void;
}

export type DispatcherOutcome =
  | Readonly<{ status: "NO_JOB"; timestamp: string }>
  | Readonly<{ status: "DISPATCHED"; dispatch: ExecutionDispatch }>;

export class ProviderDispatcherError extends Error {
  readonly code = "PROVIDER_DISPATCH_REJECTED";

  constructor(message: string) {
    super(message);
    this.name = "ProviderDispatcherError";
  }
}

export class ProviderExecutionDispatcher {
  private readonly logger: DispatcherLogger;
  private readonly now: () => Date;

  constructor(
    private readonly repository: DispatcherRepository,
    private readonly envelopes: DispatcherEnvelopeStore,
    options: { logger?: DispatcherLogger; now?: () => Date } = {}
  ) {
    this.logger = options.logger ?? { log: () => undefined };
    this.now = options.now ?? (() => new Date());
  }

  async dispatchNext(
    options: { readonly ownership?: "ANY" | "AI_STORY_SCENE" | "GENERIC_PROVIDER" } = {}
  ): Promise<DispatcherOutcome> {
    const selectedAt = this.now();
    this.logger.log({
      event: "provider_dispatcher.started",
      status: "SELECTING",
      timestamp: selectedAt.toISOString(),
    });
    const job = await this.repository.selectEligibleJob(selectedAt, {
      ownership: options.ownership ?? "ANY",
    });
    if (!job) {
      const timestamp = this.now().toISOString();
      this.logger.log({
        event: "provider_dispatcher.no_job",
        status: "NO_JOB",
        timestamp,
      });
      return Object.freeze({ status: "NO_JOB", timestamp });
    }

    try {
      if (job.status !== "PENDING") {
        throw new ProviderDispatcherError("Job is not queued");
      }
      const stored = await this.envelopes.getEnvelopeByPayloadReference(
        job.payloadReference
      );
      if (!stored) {
        throw new ProviderDispatcherError("Execution Envelope does not exist");
      }
      const envelope = await validateExecutionEnvelope(stored);
      this.assertIdentity(job, envelope);
      this.logger.log({
        event: "provider_dispatcher.envelope_resolved",
        jobId: job.jobId,
        envelopeId: envelope.envelopeId,
        capabilityId: envelope.capabilityId,
        workspaceId: envelope.workspaceId,
        status: "VALIDATING",
        timestamp: this.now().toISOString(),
      });

      const existing = await this.repository.getDispatchByJobId(job.jobId);
      if (existing) {
        this.assertDispatchMatchesEnvelope(existing, envelope);
        return Object.freeze({ status: "DISPATCHED", dispatch: existing });
      }

      const dispatch = await createExecutionDispatch({
        version: "1",
        jobId: job.jobId,
        executionId: job.executionId,
        envelopeId: envelope.envelopeId,
        payloadReference: envelope.payloadReference,
        correlationId: envelope.executionContext.correlationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        capabilityId: envelope.capabilityId,
        capabilityVersion: envelope.capabilityVersion,
        requestHash: envelope.requestHash,
        envelopeHash: envelope.envelopeHash,
        workerHandoff: {
          envelopeId: envelope.envelopeId,
          payloadReference: envelope.payloadReference,
          dispatchContractVersion: "1",
        },
        createdAt: selectedAt.toISOString(),
      });
      const created = await this.repository.createDispatch(dispatch);
      this.logger.log({
        event: "provider_dispatcher.dispatch_created",
        jobId: created.jobId,
        envelopeId: created.envelopeId,
        dispatchId: created.dispatchId,
        capabilityId: created.capabilityId,
        workspaceId: created.workspaceId,
        status: "DISPATCHED",
        timestamp: this.now().toISOString(),
      });
      return Object.freeze({ status: "DISPATCHED", dispatch: created });
    } catch (error) {
      this.logger.log({
        event: "provider_dispatcher.rejected",
        jobId: job.jobId,
        status: "REJECTED",
        reason: error instanceof Error ? error.message : "Dispatch rejected",
        timestamp: this.now().toISOString(),
      });
      throw error;
    }
  }

  private assertIdentity(job: DispatcherJob, envelope: ExecutionEnvelope): void {
    if (
      envelope.payloadReference !== job.payloadReference ||
      envelope.executionContext.executionId !== job.executionId ||
      envelope.executionContext.correlationId !== job.correlationId ||
      (envelope.executionContext.queueJobId !== undefined &&
        envelope.executionContext.queueJobId !== job.jobId)
    ) {
      throw new ProviderDispatcherError(
        "Execution Envelope identity conflicts with queued job"
      );
    }
  }

  private assertDispatchMatchesEnvelope(
    dispatch: ExecutionDispatch,
    envelope: ExecutionEnvelope
  ): void {
    if (
      dispatch.envelopeId !== envelope.envelopeId ||
      dispatch.payloadReference !== envelope.payloadReference ||
      dispatch.executionId !== envelope.executionContext.executionId ||
      dispatch.correlationId !== envelope.executionContext.correlationId ||
      dispatch.requestHash !== envelope.requestHash ||
      dispatch.envelopeHash !== envelope.envelopeHash
    ) {
      throw new ProviderDispatcherError(
        "Persisted Dispatch conflicts with immutable Execution Envelope"
      );
    }
  }
}
