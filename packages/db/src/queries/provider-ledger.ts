import { and, eq, inArray, sql } from "drizzle-orm";
import {
  CanonicalProviderResultSchema,
  ProviderAttemptSchema,
  ProviderCostSchema,
  ProviderErrorSchema,
  ProviderExecutionSchema,
  ProviderUsageSchema,
  type CanonicalProviderResult,
  type ProviderAttempt,
  type ProviderCost,
  type ProviderError,
  type ProviderExecution,
  type ProviderUsage,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

export class ProviderLedgerConflictError extends Error {
  readonly code = "PROVIDER_LEDGER_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ProviderLedgerConflictError";
  }
}

export type AppendProviderAttemptInput = {
  attempt: ProviderAttempt;
  failure?: ProviderError;
  warnings?: Array<{ code: string; message: string; retryable: boolean }>;
  providerMetadata?: Record<string, unknown>;
};

export type ProviderLedgerExecution = {
  execution: ProviderExecution;
  requestHash: string;
  attempts: Array<{
    attempt: ProviderAttempt;
    failure?: ProviderError;
    warnings: Array<{ code: string; message: string; retryable: boolean }>;
    providerMetadata: Record<string, unknown>;
    usage?: ProviderUsage;
    cost?: ProviderCost;
  }>;
  acceptedResult?: CanonicalProviderResult;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toExecution(row: typeof schema.providerExecutions.$inferSelect): ProviderExecution {
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

function assertExecutionIdentity(
  existing: typeof schema.providerExecutions.$inferSelect,
  execution: ProviderExecution,
  requestHash: string
): void {
  const identity = execution.identity;
  const conflicts: string[] = [];
  if (existing.orgId !== identity.tenantId) conflicts.push("tenantId");
  if (existing.workspaceId !== identity.workspaceId) conflicts.push("workspaceId");
  if ((existing.campaignId ?? undefined) !== identity.campaignId) conflicts.push("campaignId");
  if (existing.pipelineRunId !== identity.pipelineRunId) conflicts.push("pipelineRunId");
  if (existing.capabilityId !== identity.capabilityId) conflicts.push("capabilityId");
  if (existing.capabilityVersion !== identity.capabilityVersion) conflicts.push("capabilityVersion");
  if (existing.idempotencyKey !== identity.idempotencyKey) conflicts.push("idempotencyKey");
  if (existing.deterministicFingerprint !== identity.deterministicFingerprint) {
    conflicts.push("deterministicFingerprint");
  }
  if (existing.requestHash !== requestHash) conflicts.push("requestHash");
  if (existing.outputSchemaId !== execution.metadata.outputSchemaId) conflicts.push("outputSchemaId");
  if (existing.outputSchemaVersion !== execution.metadata.outputSchemaVersion) {
    conflicts.push("outputSchemaVersion");
  }
  if (conflicts.length > 0) {
    throw new ProviderLedgerConflictError(
      `Execution identity conflicts with persisted ledger fields: ${conflicts.join(", ")}`
    );
  }
}

export class ProviderLedgerRepository {
  constructor(private readonly db: Db = getDb()) {}

  async createExecution(
    input: ProviderExecution,
    requestHash: string
  ): Promise<ProviderExecution> {
    const execution = ProviderExecutionSchema.parse(input);
    const identity = execution.identity;
    const inserted = await this.db
      .insert(schema.providerExecutions)
      .values({
        executionId: identity.executionId,
        contractVersion: execution.contractVersion,
        orgId: identity.tenantId,
        workspaceId: identity.workspaceId,
        campaignId: identity.campaignId,
        pipelineRunId: identity.pipelineRunId,
        capabilityId: identity.capabilityId,
        capabilityVersion: identity.capabilityVersion,
        idempotencyKey: identity.idempotencyKey,
        deterministicFingerprint: identity.deterministicFingerprint,
        requestHash,
        outputSchemaId: execution.metadata.outputSchemaId,
        outputSchemaVersion: execution.metadata.outputSchemaVersion,
        status: execution.status,
        executionMetadata: execution.metadata,
        createdAt: new Date(execution.createdAt),
        completedAt: execution.completedAt ? new Date(execution.completedAt) : undefined,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return toExecution(inserted[0]);

    const [existing] = await this.db
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, identity.executionId))
      .limit(1);
    if (!existing) {
      throw new ProviderLedgerConflictError(
        "Idempotency key is already owned by another execution"
      );
    }
    assertExecutionIdentity(existing, execution, requestHash);
    return toExecution(existing);
  }

  async appendAttempt(input: AppendProviderAttemptInput): Promise<ProviderAttempt> {
    const attempt = ProviderAttemptSchema.parse(input.attempt);
    const failure = input.failure ? ProviderErrorSchema.parse(input.failure) : undefined;
    const inserted = await this.db
      .insert(schema.providerAttempts)
      .values({
        attemptId: attempt.attemptId,
        executionId: attempt.executionId,
        contractVersion: attempt.contractVersion,
        attemptNumber: attempt.attemptNumber,
        providerId: attempt.providerId,
        providerVersion: attempt.providerVersion,
        modelVersion: attempt.modelVersion,
        providerRequestId: attempt.providerRequestId,
        requestHash: attempt.requestHash,
        responseHash: attempt.responseHash,
        status: attempt.status,
        startedAt: attempt.startedAt ? new Date(attempt.startedAt) : undefined,
        completedAt: attempt.completedAt ? new Date(attempt.completedAt) : undefined,
        failure,
        warnings: input.warnings ?? [],
        providerMetadata: input.providerMetadata ?? {},
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return toAttempt(inserted[0]);

    const [existing] = await this.db
      .select()
      .from(schema.providerAttempts)
      .where(eq(schema.providerAttempts.attemptId, attempt.attemptId))
      .limit(1);
    if (!existing || !sameJson(toAttempt(existing), attempt)) {
      throw new ProviderLedgerConflictError("Attempt identity or history position conflicts");
    }
    if (
      !sameJson(existing.failure ?? undefined, failure) ||
      !sameJson(existing.warnings, input.warnings ?? []) ||
      !sameJson(existing.providerMetadata, input.providerMetadata ?? {})
    ) {
      throw new ProviderLedgerConflictError("Attempt facts conflict with persisted history");
    }
    return toAttempt(existing);
  }

  async recordUsage(attemptId: string, input: ProviderUsage): Promise<ProviderUsage> {
    const usage = ProviderUsageSchema.parse(input);
    const rows = await this.db
      .insert(schema.providerAttemptUsage)
      .values({ attemptId, usage })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0].usage;
    const [existing] = await this.db
      .select()
      .from(schema.providerAttemptUsage)
      .where(eq(schema.providerAttemptUsage.attemptId, attemptId))
      .limit(1);
    if (!existing || !sameJson(existing.usage, usage)) {
      throw new ProviderLedgerConflictError("Usage conflicts with persisted ledger fact");
    }
    return existing.usage;
  }

  async recordCost(attemptId: string, input: ProviderCost): Promise<ProviderCost> {
    const cost = ProviderCostSchema.parse(input);
    const rows = await this.db
      .insert(schema.providerAttemptCosts)
      .values({ attemptId, cost })
      .onConflictDoNothing()
      .returning();
    if (rows[0]) return rows[0].cost;
    const [existing] = await this.db
      .select()
      .from(schema.providerAttemptCosts)
      .where(eq(schema.providerAttemptCosts.attemptId, attemptId))
      .limit(1);
    if (!existing || !sameJson(existing.cost, cost)) {
      throw new ProviderLedgerConflictError("Cost conflicts with persisted ledger fact");
    }
    return existing.cost;
  }

  async acceptResult(input: CanonicalProviderResult): Promise<CanonicalProviderResult> {
    const result = CanonicalProviderResultSchema.parse(input);
    return this.db.transaction(async (tx) => this.acceptResultInTransaction(tx, result));
  }

  private async acceptResultInTransaction(
    tx: Transaction,
    result: CanonicalProviderResult
  ): Promise<CanonicalProviderResult> {
    await tx.execute(
      sql`select ${schema.providerExecutions.executionId}
          from ${schema.providerExecutions}
          where ${schema.providerExecutions.executionId} = ${result.executionId}
          for update`
    );

    const [execution] = await tx
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, result.executionId))
      .limit(1);
    if (!execution) throw new Error("Provider execution not found");
    if (execution.requestHash !== result.requestHash) {
      throw new ProviderLedgerConflictError("Accepted result request hash conflicts");
    }
    if (execution.acceptedResult) {
      const accepted = CanonicalProviderResultSchema.parse(execution.acceptedResult);
      if (!sameJson(accepted, result)) {
        throw new ProviderLedgerConflictError("Accepted provider result cannot be replaced");
      }
      return accepted;
    }

    const [attempt] = await tx
      .select()
      .from(schema.providerAttempts)
      .where(
        and(
          eq(schema.providerAttempts.attemptId, result.providerAttemptId),
          eq(schema.providerAttempts.executionId, result.executionId)
        )
      )
      .limit(1);
    if (!attempt) throw new ProviderLedgerConflictError("Accepted attempt does not exist");
    if (attempt.requestHash !== result.requestHash) {
      throw new ProviderLedgerConflictError("Attempt request hash conflicts");
    }
    if (attempt.responseHash && attempt.responseHash !== result.responseHash) {
      throw new ProviderLedgerConflictError("Attempt response hash conflicts");
    }
    if (
      attempt.providerId !== result.providerMetadata.providerId ||
      attempt.providerVersion !== result.providerMetadata.providerVersion ||
      attempt.modelVersion !== result.modelVersion
    ) {
      throw new ProviderLedgerConflictError("Provider identity conflicts");
    }

    const acceptedAt = new Date();
    const updated = await tx
      .update(schema.providerExecutions)
      .set({
        status: "SUCCEEDED",
        acceptedAttemptId: result.providerAttemptId,
        acceptedResult: result,
        acceptedResponseHash: result.responseHash,
        acceptedAt,
        completedAt: acceptedAt,
      })
      .where(
        and(
          eq(schema.providerExecutions.executionId, result.executionId),
          sql`${schema.providerExecutions.acceptedResult} is null`
        )
      )
      .returning({ acceptedResult: schema.providerExecutions.acceptedResult });
    if (!updated[0]?.acceptedResult) {
      throw new ProviderLedgerConflictError("Concurrent result acceptance conflict");
    }
    return CanonicalProviderResultSchema.parse(updated[0].acceptedResult);
  }

  async findExecution(executionId: string): Promise<ProviderLedgerExecution | null> {
    const [execution] = await this.db
      .select()
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, executionId))
      .limit(1);
    if (!execution) return null;

    const attempts = await this.db
      .select()
      .from(schema.providerAttempts)
      .where(eq(schema.providerAttempts.executionId, executionId))
      .orderBy(schema.providerAttempts.attemptNumber);
    const attemptIds = attempts.map((attempt) => attempt.attemptId);
    const usageRows =
      attemptIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.providerAttemptUsage)
            .where(inArray(schema.providerAttemptUsage.attemptId, attemptIds));
    const costRows =
      attemptIds.length === 0
        ? []
        : await this.db
            .select()
            .from(schema.providerAttemptCosts)
            .where(inArray(schema.providerAttemptCosts.attemptId, attemptIds));
    const usage = new Map(usageRows.map((row) => [row.attemptId, row.usage]));
    const costs = new Map(costRows.map((row) => [row.attemptId, row.cost]));

    return {
      execution: toExecution(execution),
      requestHash: execution.requestHash,
      attempts: attempts.map((row) => ({
        attempt: toAttempt(row),
        failure: row.failure ?? undefined,
        warnings: row.warnings,
        providerMetadata: row.providerMetadata,
        usage: usage.get(row.attemptId),
        cost: costs.get(row.attemptId),
      })),
      acceptedResult: execution.acceptedResult
        ? CanonicalProviderResultSchema.parse(execution.acceptedResult)
        : undefined,
    };
  }

  async findAcceptedResult(executionId: string): Promise<CanonicalProviderResult | null> {
    const [row] = await this.db
      .select({ result: schema.providerExecutions.acceptedResult })
      .from(schema.providerExecutions)
      .where(eq(schema.providerExecutions.executionId, executionId))
      .limit(1);
    return row?.result ? CanonicalProviderResultSchema.parse(row.result) : null;
  }
}
