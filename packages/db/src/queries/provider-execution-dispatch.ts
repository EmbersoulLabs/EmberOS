import { eq, sql } from "drizzle-orm";
import {
  validateExecutionDispatch,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export interface DispatchableProviderJob {
  readonly jobId: string;
  readonly executionId: string;
  readonly payloadReference: string;
  readonly correlationId: string;
  readonly status: "PENDING";
}

export class ExecutionDispatchConflictError extends Error {
  readonly code = "EXECUTION_DISPATCH_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ExecutionDispatchConflictError";
  }
}

function toDispatch(
  row: typeof schema.providerExecutionDispatches.$inferSelect
): ExecutionDispatch {
  return {
    version: row.version as "1",
    dispatchId: row.dispatchId,
    jobId: row.jobId,
    executionId: row.executionId,
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    correlationId: row.correlationId,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    workerHandoff: row.workerHandoff,
    dispatchHash: row.dispatchHash,
    status: row.status as "DISPATCHED",
    createdAt: row.createdAt.toISOString(),
  };
}

function assertEquivalentDispatch(
  existing: ExecutionDispatch,
  requested: ExecutionDispatch
): ExecutionDispatch {
  if (
    existing.dispatchId !== requested.dispatchId ||
    existing.dispatchHash !== requested.dispatchHash ||
    existing.jobId !== requested.jobId ||
    existing.executionId !== requested.executionId ||
    existing.envelopeId !== requested.envelopeId ||
    existing.requestHash !== requested.requestHash ||
    existing.envelopeHash !== requested.envelopeHash ||
    existing.correlationId !== requested.correlationId
  ) {
    throw new ExecutionDispatchConflictError(
      "Persisted Dispatch conflicts with requested immutable identity"
    );
  }
  return existing;
}

export class ExecutionDispatchRepository {
  constructor(private readonly db: Db = getDb()) {}

  async selectEligibleJob(now: Date = new Date()): Promise<DispatchableProviderJob | null> {
    const rows = (await this.db.execute(sql`
      select
        job.job_id,
        job.execution_id,
        job.payload_reference,
        job.correlation_id,
        job.status
      from provider_outbox_jobs job
      join provider_executions execution
        on execution.execution_id = job.execution_id
      left join provider_execution_dispatches dispatch
        on dispatch.job_id = job.job_id
      where job.status = 'PENDING'
        and job.next_visible_at <= ${now.toISOString()}::timestamptz
        and execution.status in ('PENDING', 'DISPATCHABLE')
        and dispatch.dispatch_id is null
      order by
        job.priority desc,
        job.next_visible_at asc,
        job.created_at asc,
        job.job_id asc
      limit 1
    `)) as unknown as Array<{
      job_id: string;
      execution_id: string;
      payload_reference: string;
      correlation_id: string;
      status: "PENDING";
    }>;
    const row = rows[0];
    return row
      ? {
          jobId: row.job_id,
          executionId: row.execution_id,
          payloadReference: row.payload_reference,
          correlationId: row.correlation_id,
          status: row.status,
        }
      : null;
  }

  async createDispatch(input: ExecutionDispatch): Promise<ExecutionDispatch> {
    const dispatch = await validateExecutionDispatch(input);
    return this.db.transaction(async (tx) => {
      const jobs = (await tx.execute(sql`
        select job_id, execution_id, payload_reference, correlation_id, status
        from provider_outbox_jobs
        where job_id = ${dispatch.jobId}
        for update
      `)) as unknown as Array<{
        job_id: string;
        execution_id: string;
        payload_reference: string;
        correlation_id: string;
        status: string;
      }>;
      const job = jobs[0];
      if (!job) throw new ExecutionDispatchConflictError("Outbox job does not exist");
      const [persisted] = await tx
        .select()
        .from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.jobId, dispatch.jobId))
        .limit(1);
      if (persisted) {
        return assertEquivalentDispatch(
          await validateExecutionDispatch(toDispatch(persisted)),
          dispatch
        );
      }
      if (job.status !== "PENDING") {
        throw new ExecutionDispatchConflictError("Outbox job is not dispatchable");
      }
      if (
        job.execution_id !== dispatch.executionId ||
        job.payload_reference !== dispatch.payloadReference
      ) {
        throw new ExecutionDispatchConflictError(
          "Dispatch identity conflicts with outbox intent"
        );
      }

      const rows = await tx
        .insert(schema.providerExecutionDispatches)
        .values({
          dispatchId: dispatch.dispatchId,
          version: dispatch.version,
          jobId: dispatch.jobId,
          executionId: dispatch.executionId,
          envelopeId: dispatch.envelopeId,
          payloadReference: dispatch.payloadReference,
          correlationId: dispatch.correlationId,
          orgId: dispatch.tenantId,
          workspaceId: dispatch.workspaceId,
          capabilityId: dispatch.capabilityId,
          capabilityVersion: dispatch.capabilityVersion,
          requestHash: dispatch.requestHash,
          envelopeHash: dispatch.envelopeHash,
          workerHandoff: dispatch.workerHandoff,
          dispatchHash: dispatch.dispatchHash,
          status: dispatch.status,
          createdAt: new Date(dispatch.createdAt),
        })
        .onConflictDoNothing()
        .returning();
      if (!rows[0]) {
        const [accepted] = await tx
          .select()
          .from(schema.providerExecutionDispatches)
          .where(eq(schema.providerExecutionDispatches.jobId, dispatch.jobId))
          .limit(1);
        if (!accepted) {
          throw new ExecutionDispatchConflictError(
            "Dispatch persistence did not produce an accepted record"
          );
        }
        return assertEquivalentDispatch(
          await validateExecutionDispatch(toDispatch(accepted)),
          dispatch
        );
      }
      return validateExecutionDispatch(toDispatch(rows[0]));
    });
  }

  async getDispatch(dispatchId: string): Promise<ExecutionDispatch | null> {
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, dispatchId))
      .limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  async getDispatchByJobId(jobId: string): Promise<ExecutionDispatch | null> {
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.jobId, jobId))
      .limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  async exists(jobId: string): Promise<boolean> {
    return (await this.getDispatchByJobId(jobId)) !== null;
  }
}
