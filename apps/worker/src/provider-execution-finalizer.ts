import type {
  ProviderExecutionFinalizationRecord,
  ProviderExecutionFinalizationRepository,
} from "@ceo-agent/db";
import type { ProviderDispatchOutcome } from "./provider-dispatch-worker";

export interface ExecutionFinalizationLogEntry {
  readonly event:
    | "provider_finalization.started"
    | "provider_finalization.validation_passed"
    | "provider_finalization.ledger_accepted"
    | "provider_finalization.outbox_completed"
    | "provider_finalization.transaction_committed"
    | "provider_finalization.transaction_rolled_back";
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly timestamp: string;
  readonly reason?: string;
}

export interface ExecutionFinalizationLogger {
  log(entry: ExecutionFinalizationLogEntry): void;
}

export interface CompletedProviderDispatch {
  readonly status: "DISPATCHED";
  readonly jobId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly result: Extract<
    ProviderDispatchOutcome,
    { status: "DISPATCHED" }
  >["result"];
  readonly executionDurationMs: number;
  readonly workerId: string;
  readonly dispatchTimestamp: string;
}

export interface ExecutionFinalizationOutcome {
  readonly status: "FINALIZED";
  readonly executionId: string;
  readonly attemptId: string;
  readonly jobId: string;
  readonly workerId: string;
  readonly completedAt: string;
  readonly resultReference: string;
}

export class ExecutionFinalizer {
  private readonly logger: ExecutionFinalizationLogger;
  private readonly now: () => Date;

  constructor(
    private readonly repository: Pick<
      ProviderExecutionFinalizationRepository,
      "finalize"
    >,
    options: {
      logger?: ExecutionFinalizationLogger;
      now?: () => Date;
    } = {}
  ) {
    this.logger = options.logger ?? { log: () => undefined };
    this.now = options.now ?? (() => new Date());
  }

  async finalize(input: CompletedProviderDispatch): Promise<ExecutionFinalizationOutcome> {
    if (input.status !== "DISPATCHED") {
      throw new Error("ExecutionFinalizer accepts only completed dispatch outcomes");
    }
    if (
      !input.jobId.trim() ||
      !input.executionId.trim() ||
      !input.attemptId.trim() ||
      !input.workerId.trim()
    ) {
      throw new Error("Finalization identity is incomplete");
    }
    const base = {
      executionId: input.executionId,
      attemptId: input.attemptId,
      jobId: input.jobId,
      workerId: input.workerId,
    };
    this.logger.log({
      event: "provider_finalization.started",
      ...base,
      timestamp: this.now().toISOString(),
    });
    this.logger.log({
      event: "provider_finalization.validation_passed",
      ...base,
      timestamp: this.now().toISOString(),
    });

    let record: ProviderExecutionFinalizationRecord;
    try {
      record = await this.repository.finalize({
        ...base,
        providerId: input.providerId,
        adapterVersion: input.adapterVersion,
        result: input.result,
        dispatchTimestamp: input.dispatchTimestamp,
        executionDurationMs: input.executionDurationMs,
        completionMetadata: {
          resultReference: input.result.resultReference,
          providerRequestId: input.result.providerMetadata.providerRequestId,
        },
        now: this.now(),
      });
    } catch (error) {
      this.logger.log({
        event: "provider_finalization.transaction_rolled_back",
        ...base,
        timestamp: this.now().toISOString(),
        reason: error instanceof Error ? error.message : "Unknown finalization failure",
      });
      throw error;
    }

    for (const event of [
      "provider_finalization.ledger_accepted",
      "provider_finalization.outbox_completed",
      "provider_finalization.transaction_committed",
    ] as const) {
      this.logger.log({ event, ...base, timestamp: this.now().toISOString() });
    }
    return Object.freeze({
      status: "FINALIZED",
      ...base,
      completedAt: record.completedAt,
      resultReference: record.result.resultReference,
    });
  }
}
