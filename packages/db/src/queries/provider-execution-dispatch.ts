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

  async selectEligibleJob(
    now: Date = new Date(),
    options: { readonly ownership?: "ANY" | "AI_STORY_SCENE" | "GENERIC_PROVIDER" } = {}
  ): Promise<DispatchableProviderJob | null> {
    const ownership = options.ownership ?? "ANY";
    const ownershipPredicate =
      ownership === "AI_STORY_SCENE"
        ? sql`and exists (
            select 1
            from ai_story_scene_scheduling_correlations correlation
            where correlation.outbox_job_id = job.job_id
          )`
        : ownership === "GENERIC_PROVIDER"
          ? sql`and not exists (
              select 1
              from ai_story_scene_scheduling_correlations correlation
              where correlation.outbox_job_id = job.job_id
            )`
          : sql``;

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
        ${ownershipPredicate}
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

  /**
   * Claims one explicitly authorized pre-dispatch recovery without creating a
   * new Dispatch. The marker can only be written by the atomic recovery
   * transaction; ordinary PENDING jobs are deliberately excluded.
   */
  async claimAuthorizedRecoveryDispatch(input: {
    readonly workerId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  }): Promise<ExecutionDispatch | null> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 60_000));
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select dispatch.dispatch_id
        from provider_outbox_jobs job
        join provider_execution_dispatches dispatch on dispatch.job_id = job.job_id
        join admin_runtime_recovery_receipts receipt
          on receipt.command_type = 'RecoverAiStoryPreDispatch'
         and receipt.target_id = dispatch.dispatch_id
        where job.operator_notes = concat('ai-story-pre-dispatch-recovery:', receipt.recovery_receipt_id::text)
          and job.next_visible_at <= ${now.toISOString()}::timestamptz
          and (
            job.status = 'PENDING'
            or (job.status = 'CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz)
          )
        order by job.next_visible_at asc, job.created_at asc
        for update of job skip locked
        limit 1
      `)) as unknown as Array<{ dispatch_id: string }>;
      const selected = rows[0];
      if (!selected) return null;
      await tx.execute(sql`
        update provider_outbox_jobs job
        set status = 'CLAIMED',
            lease_owner = ${input.workerId},
            lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz
        from provider_execution_dispatches dispatch
        where dispatch.job_id = job.job_id
          and dispatch.dispatch_id = ${selected.dispatch_id}
      `);
      const [row] = await tx
        .select()
        .from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.dispatchId, selected.dispatch_id))
        .limit(1);
      return row ? validateExecutionDispatch(toDispatch(row)) : null;
    });
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
