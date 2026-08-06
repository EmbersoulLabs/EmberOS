import { eq } from "drizzle-orm";
import {
  CanonicalProviderResultSchema,
  ProviderAttemptSchema,
  ProviderExecutionSchema,
  ProviderOutboxJobSchema,
  type CanonicalProviderResult,
  type ProviderAttempt,
  type ProviderExecution,
  type ProviderOutboxJob,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export interface ProviderResumeSnapshot {
  readonly execution: ProviderExecution;
  readonly acceptedResult?: CanonicalProviderResult;
  readonly acceptedAttempt?: ProviderAttempt;
  readonly outboxJob?: ProviderOutboxJob;
}

function toExecution(
  row: typeof schema.providerExecutions.$inferSelect
): ProviderExecution {
  return ProviderExecutionSchema.parse({
    contractVersion: row.contractVersion,
    identity: {
      executionId: row.executionId,
      tenantId: row.orgId,
      workspaceId: row.workspaceId,
      campaignId: row.campaignId ?? undefined,
      pipelineRunId: row.pipelineRunId,
      capabilityId: row.capabilityId,
      capabilityVersion: row.capabilityVersion,
      idempotencyKey: row.idempotencyKey,
      deterministicFingerprint: row.deterministicFingerprint,
    },
    metadata: row.executionMetadata,
    status: row.status,
    acceptedAttemptId: row.acceptedAttemptId ?? undefined,
    resultReference: row.acceptedResult?.resultReference,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  });
}

function toAttempt(row: typeof schema.providerAttempts.$inferSelect): ProviderAttempt {
  return ProviderAttemptSchema.parse({
    contractVersion: row.contractVersion,
    attemptId: row.attemptId,
    executionId: row.executionId,
    attemptNumber: row.attemptNumber,
    providerId: row.providerId,
    providerVersion: row.providerVersion,
    modelVersion: row.modelVersion,
    providerRequestId: row.providerRequestId ?? undefined,
    requestHash: row.requestHash,
    responseHash: row.responseHash ?? undefined,
    status: row.status,
    startedAt: row.startedAt?.toISOString(),
    completedAt: row.completedAt?.toISOString(),
  });
}

function toOutboxJob(
  row: typeof schema.providerOutboxJobs.$inferSelect
): ProviderOutboxJob {
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

export class ProviderResumeRepository {
  constructor(private readonly db: Db = getDb()) {}

  async load(
    executionId: string,
    jobId: string
  ): Promise<ProviderResumeSnapshot | null> {
    const [execution] = await this.db
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, executionId))
      .limit(1);
    if (!execution) return null;

    const [attempt] = execution.acceptedAttemptId
      ? await this.db
          .select()
          .from(schema.providerAttempts)
          .where(eq(schema.providerAttempts.attemptId, execution.acceptedAttemptId))
          .limit(1)
      : [];
    const [outboxJob] = await this.db
      .select()
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.jobId, jobId))
      .limit(1);

    return Object.freeze({
      execution: toExecution(execution),
      acceptedResult: execution.acceptedResult
        ? CanonicalProviderResultSchema.parse(execution.acceptedResult)
        : undefined,
      acceptedAttempt: attempt ? toAttempt(attempt) : undefined,
      outboxJob: outboxJob ? toOutboxJob(outboxJob) : undefined,
    });
  }
}
