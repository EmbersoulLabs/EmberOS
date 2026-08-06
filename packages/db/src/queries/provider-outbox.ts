import { and, eq, gt, sql } from "drizzle-orm";
import {
  ProviderOutboxJobSchema,
  type ProviderExecution,
  type ProviderOutboxJob,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { createProviderExecution } from "./provider-ledger";

type Db = ReturnType<typeof getDb>;

export class ProviderOutboxConflictError extends Error {
  readonly code = "PROVIDER_OUTBOX_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ProviderOutboxConflictError";
  }
}

export type CreateOutboxJobInput = {
  jobId: string;
  executionId: string;
  payloadReference: string;
  correlationId: string;
  priority?: number;
  nextVisibleAt?: Date;
};

export type ReleaseLeaseInput = {
  jobId: string;
  leaseOwner: string;
  nextVisibleAt: Date;
  retryDelayMs?: number;
  retryClassification?: string;
  lastErrorCategory?: string;
};

function toOutboxJob(row: typeof schema.providerOutboxJobs.$inferSelect): ProviderOutboxJob {
  return ProviderOutboxJobSchema.parse({
    contractVersion: row.contractVersion,
    jobId: row.jobId,
    executionId: row.executionId,
    payloadReference: row.payloadReference,
    correlationId: row.correlationId,
    status: row.status,
    priority: row.priority,
    attemptCount: row.attemptCount,
    nextVisibleAt: row.nextVisibleAt.toISOString(),
    leaseOwner: row.leaseOwner ?? undefined,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString(),
    retryDelayMs: row.retryDelayMs ?? undefined,
    retryClassification: row.retryClassification ?? undefined,
    lastErrorCategory: row.lastErrorCategory ?? undefined,
    deadLetterReason: row.deadLetterReason ?? undefined,
    deadLetterAt: row.deadLetterAt?.toISOString(),
    operatorNotes: row.operatorNotes ?? undefined,
    completedAt: row.completedAt?.toISOString(),
    completionWorkerId: row.completionWorkerId ?? undefined,
    completionMetadata: row.completionMetadata ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

function assertSameJob(
  existing: typeof schema.providerOutboxJobs.$inferSelect,
  input: CreateOutboxJobInput
): void {
  if (
    existing.executionId !== input.executionId ||
    existing.payloadReference !== input.payloadReference ||
    existing.correlationId !== input.correlationId ||
    existing.priority !== (input.priority ?? 0) ||
    (input.nextVisibleAt !== undefined &&
      existing.nextVisibleAt.getTime() !== input.nextVisibleAt.getTime())
  ) {
    throw new ProviderOutboxConflictError("Outbox identity conflicts with persisted intent");
  }
}

export class ProviderOutboxRepository {
  constructor(private readonly db: Db = getDb()) {}

  async createExecutionWithJob(input: {
    execution: ProviderExecution;
    requestHash: string;
    job: CreateOutboxJobInput;
  }): Promise<{ execution: ProviderExecution; job: ProviderOutboxJob }> {
    if (input.job.executionId !== input.execution.identity.executionId) {
      throw new ProviderOutboxConflictError("Outbox execution identity does not match");
    }
    return this.db.transaction(async (tx) => {
      const execution = await createProviderExecution(tx, input.execution, input.requestHash);
      const job = await this.createOutboxJobInTransaction(tx, input.job);
      return { execution, job };
    });
  }

  async createOutboxJob(input: CreateOutboxJobInput): Promise<ProviderOutboxJob> {
    return this.db.transaction((tx) => this.createOutboxJobInTransaction(tx, input));
  }

  private async createOutboxJobInTransaction(
    tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
    input: CreateOutboxJobInput
  ): Promise<ProviderOutboxJob> {
    const rows = await tx
      .insert(schema.providerOutboxJobs)
      .values({
        jobId: input.jobId,
        contractVersion: "1",
        executionId: input.executionId,
        payloadReference: input.payloadReference,
        correlationId: input.correlationId,
        priority: input.priority ?? 0,
        nextVisibleAt: input.nextVisibleAt ?? new Date(),
      })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return toOutboxJob(rows[0]);

    const [existing] = await tx
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
      .limit(1);
    if (!existing) {
      throw new ProviderOutboxConflictError(
        "Execution already owns a different outbox intent"
      );
    }
    assertSameJob(existing, input);
    return toOutboxJob(existing);
  }

  async findJob(jobId: string): Promise<ProviderOutboxJob | null> {
    const [row] = await this.db
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, jobId))
      .limit(1);
    return row ? toOutboxJob(row) : null;
  }

  async claimNextJob(input: {
    leaseOwner: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob | null> {
    if (!input.leaseOwner.trim()) throw new Error("leaseOwner is required");
    if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

    return this.db.transaction(async (tx) => {
      const candidates = (await tx.execute(sql`
        select ${schema.providerOutboxJobs.jobId} as job_id
        from ${schema.providerOutboxJobs}
        where (
          ${schema.providerOutboxJobs.status} in ('PENDING', 'RETRY_WAIT')
          and ${schema.providerOutboxJobs.nextVisibleAt} <= ${now.toISOString()}::timestamptz
        ) or (
          ${schema.providerOutboxJobs.status} = 'CLAIMED'
          and ${schema.providerOutboxJobs.leaseExpiresAt} <= ${now.toISOString()}::timestamptz
        )
        order by
          ${schema.providerOutboxJobs.priority} desc,
          ${schema.providerOutboxJobs.nextVisibleAt} asc,
          ${schema.providerOutboxJobs.createdAt} asc
        for update skip locked
        limit 1
      `)) as unknown as Array<{ job_id: string }>;
      const candidate = candidates[0];
      if (!candidate) return null;

      const rows = await tx
        .update(schema.providerOutboxJobs)
        .set({
          status: "CLAIMED",
          leaseOwner: input.leaseOwner,
          leaseExpiresAt,
          attemptCount: sql`${schema.providerOutboxJobs.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.providerOutboxJobs.jobId, candidate.job_id))
        .returning();
      return rows[0] ? toOutboxJob(rows[0]) : null;
    });
  }

  async renewLease(input: {
    jobId: string;
    leaseOwner: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob> {
    if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    const now = input.now ?? new Date();
    const rows = await this.db
      .update(schema.providerOutboxJobs)
      .set({
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.providerOutboxJobs.jobId, input.jobId),
          eq(schema.providerOutboxJobs.status, "CLAIMED"),
          eq(schema.providerOutboxJobs.leaseOwner, input.leaseOwner),
          gt(schema.providerOutboxJobs.leaseExpiresAt, now)
        )
      )
      .returning();
    if (!rows[0]) throw new ProviderOutboxConflictError("Lease is not active or not owned");
    return toOutboxJob(rows[0]);
  }

  async releaseLease(input: ReleaseLeaseInput): Promise<ProviderOutboxJob> {
    const now = new Date();
    const retryWait = input.nextVisibleAt.getTime() > now.getTime();
    const rows = await this.db
      .update(schema.providerOutboxJobs)
      .set({
        status: retryWait ? "RETRY_WAIT" : "PENDING",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextVisibleAt: input.nextVisibleAt,
        retryDelayMs: input.retryDelayMs,
        retryClassification: input.retryClassification,
        lastErrorCategory: input.lastErrorCategory,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.providerOutboxJobs.jobId, input.jobId),
          eq(schema.providerOutboxJobs.status, "CLAIMED"),
          eq(schema.providerOutboxJobs.leaseOwner, input.leaseOwner)
        )
      )
      .returning();
    if (!rows[0]) throw new ProviderOutboxConflictError("Lease is not owned");
    return toOutboxJob(rows[0]);
  }

  async completeJob(input: {
    jobId: string;
    leaseOwner: string;
    completionMetadata?: Record<string, unknown>;
    now?: Date;
  }): Promise<ProviderOutboxJob> {
    const now = input.now ?? new Date();
    const rows = await this.db
      .update(schema.providerOutboxJobs)
      .set({
        status: "COMPLETED",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: now,
        completionWorkerId: input.leaseOwner,
        completionMetadata: input.completionMetadata ?? {
          source: "provider-outbox-repository",
        },
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.providerOutboxJobs.jobId, input.jobId),
          eq(schema.providerOutboxJobs.status, "CLAIMED"),
          eq(schema.providerOutboxJobs.leaseOwner, input.leaseOwner),
          gt(schema.providerOutboxJobs.leaseExpiresAt, now)
        )
      )
      .returning();
    if (!rows[0]) throw new ProviderOutboxConflictError("Active lease is required");
    return toOutboxJob(rows[0]);
  }

  async moveToDeadLetter(input: {
    jobId: string;
    leaseOwner: string;
    reason: string;
    operatorNotes?: string;
    now?: Date;
  }): Promise<ProviderOutboxJob> {
    const now = input.now ?? new Date();
    if (!input.reason.trim()) throw new Error("Dead-letter reason is required");
    const rows = await this.db
      .update(schema.providerOutboxJobs)
      .set({
        status: "DEAD_LETTER",
        leaseOwner: null,
        leaseExpiresAt: null,
        deadLetterReason: input.reason,
        deadLetterAt: now,
        operatorNotes: input.operatorNotes,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.providerOutboxJobs.jobId, input.jobId),
          eq(schema.providerOutboxJobs.status, "CLAIMED"),
          eq(schema.providerOutboxJobs.leaseOwner, input.leaseOwner),
          gt(schema.providerOutboxJobs.leaseExpiresAt, now)
        )
      )
      .returning();
    if (!rows[0]) throw new ProviderOutboxConflictError("Active lease is required");
    return toOutboxJob(rows[0]);
  }

  /**
   * Claim a specific outbox job (or renew lease) so Production Finalizer can complete it.
   * Does not mark COMPLETED / DEAD_LETTER — Finalizer owns terminal outbox writes.
   */
  async claimOrRenewForFinalization(input: {
    jobId: string;
    leaseOwner: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob> {
    if (!input.leaseOwner.trim()) throw new Error("leaseOwner is required");
    if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new Error("leaseDurationMs must be a positive integer");
    }
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

    return this.db.transaction(async (tx) => {
      const [job] = await tx
        .select()
        .from(schema.providerOutboxJobs)
        .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
        .limit(1);
      if (!job) {
        throw new ProviderOutboxConflictError("Outbox job not found");
      }

      if (
        job.status === "CLAIMED" &&
        job.leaseOwner === input.leaseOwner &&
        job.leaseExpiresAt &&
        job.leaseExpiresAt.getTime() > now.getTime()
      ) {
        const renewed = await tx
          .update(schema.providerOutboxJobs)
          .set({ leaseExpiresAt, updatedAt: now })
          .where(
            and(
              eq(schema.providerOutboxJobs.jobId, input.jobId),
              eq(schema.providerOutboxJobs.leaseOwner, input.leaseOwner)
            )
          )
          .returning();
        if (!renewed[0]) {
          throw new ProviderOutboxConflictError("Failed to renew Finalizer lease");
        }
        return toOutboxJob(renewed[0]);
      }

      if (job.status === "COMPLETED") {
        return toOutboxJob(job);
      }

      if (
        job.status !== "PENDING" &&
        job.status !== "RETRY_WAIT" &&
        !(
          job.status === "CLAIMED" &&
          job.leaseExpiresAt &&
          job.leaseExpiresAt.getTime() <= now.getTime()
        )
      ) {
        throw new ProviderOutboxConflictError(
          `Outbox job status ${job.status} cannot be claimed for Finalizer`
        );
      }

      const claimed = await tx
        .update(schema.providerOutboxJobs)
        .set({
          status: "CLAIMED",
          leaseOwner: input.leaseOwner,
          leaseExpiresAt,
          attemptCount: sql`${schema.providerOutboxJobs.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.providerOutboxJobs.jobId, input.jobId))
        .returning();
      if (!claimed[0]) {
        throw new ProviderOutboxConflictError("Failed to claim outbox job for Finalizer");
      }
      return toOutboxJob(claimed[0]);
    });
  }
}
