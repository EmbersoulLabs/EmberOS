/**
 * Sprint 4 Phase F — Admin Runtime Operations read models + recovery receipts.
 *
 * Trusted Admin context required. No commercial mutations. No signed URLs.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  AdminRuntimeReadModelSchema,
  DurableMediaDiagnosticSchema,
  ProviderHealthSnapshotSchema,
  QueueHealthSnapshotSchema,
  RuntimeExecutionTimelineSchema,
  WorkerHealthSnapshotSchema,
  parseRuntimeRecoveryCommandResult,
  type AdminRuntimeReadModel,
  type DurableMediaDiagnostic,
  type ProviderHealthSnapshot,
  type QueueHealthSnapshot,
  type RuntimeExecutionTimeline,
  type RuntimeRecoveryCommandResult,
  type RuntimeTimelineStage,
  type WorkerHealthSnapshot,
} from "@ceo-agent/shared";
import {
  assertTrustedAdminCommandContext,
  commercialExecutionIdentityForPlan,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { isUniqueViolation } from "./billing-account";
import type { AcceptOrConvergeResult } from "./platform-admin";

type Db = ReturnType<typeof getDb>;

export class AdminRuntimeOperationsError extends Error {
  readonly status: number;

  constructor(
    readonly code:
      | "RUNTIME_OPS_NOT_FOUND"
      | "RUNTIME_OPS_TRUST_REQUIRED"
      | "RUNTIME_OPS_CONFLICT"
      | "RUNTIME_OPS_DENIED",
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "AdminRuntimeOperationsError";
    this.status =
      status ??
      (code === "RUNTIME_OPS_NOT_FOUND"
        ? 404
        : code === "RUNTIME_OPS_TRUST_REQUIRED" || code === "RUNTIME_OPS_DENIED"
          ? 403
          : 409);
  }
}

function requireTrusted(context: unknown): TrustedAdminCommandContext {
  assertTrustedAdminCommandContext(context);
  return context;
}

function stage(
  partial: RuntimeTimelineStage
): RuntimeTimelineStage {
  return partial;
}

async function countOutboxByWorkspace(
  db: Db,
  workspaceId: string
): Promise<{ pending: number; dead: number }> {
  const rows = await db.execute<{ pending: string; dead: string }>(sql`
    SELECT
      count(*) FILTER (WHERE j.status IN ('PENDING','CLAIMED'))::text AS pending,
      count(*) FILTER (WHERE j.status = 'DEAD_LETTER')::text AS dead
    FROM provider_outbox_jobs j
    JOIN provider_executions e ON e.execution_id = j.execution_id
    WHERE e.workspace_id = ${workspaceId}::uuid
  `);
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return {
    pending: Number(row?.pending ?? 0),
    dead: Number(row?.dead ?? 0),
  };
}

export class AdminRuntimeRecoveryReceiptRepositoryImpl {
  constructor(private readonly db: Db = getDb()) {}

  async getByIdempotency(input: {
    commandType: string;
    idempotencyKey: string;
    targetId: string;
  }): Promise<RuntimeRecoveryCommandResult | null> {
    const rows = await this.db
      .select()
      .from(schema.adminRuntimeRecoveryReceipts)
      .where(
        and(
          eq(schema.adminRuntimeRecoveryReceipts.commandType, input.commandType),
          eq(
            schema.adminRuntimeRecoveryReceipts.idempotencyKey,
            input.idempotencyKey
          ),
          eq(schema.adminRuntimeRecoveryReceipts.targetId, input.targetId)
        )
      )
      .limit(1);
    return rows[0]
      ? parseRuntimeRecoveryCommandResult(rows[0].resultBody)
      : null;
  }

  async acceptOrConverge(input: {
    recoveryReceiptId: string;
    result: RuntimeRecoveryCommandResult;
    orgId?: string | null;
    workspaceId?: string | null;
    actorUserId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<AcceptOrConvergeResult<RuntimeRecoveryCommandResult>> {
    const existing = await this.getByIdempotency({
      commandType: input.result.commandType,
      idempotencyKey: input.idempotencyKey,
      targetId: input.result.targetId,
    });
    if (existing) {
      if (existing.integrityHash !== input.result.integrityHash) {
        throw new AdminRuntimeOperationsError(
          "RUNTIME_OPS_CONFLICT",
          "Conflicting Runtime Recovery receipt for idempotency key"
        );
      }
      return { value: existing, replayed: true };
    }

    try {
      await this.db.insert(schema.adminRuntimeRecoveryReceipts).values({
        recoveryReceiptId: input.recoveryReceiptId,
        commandType: input.result.commandType,
        commandId: input.result.commandId,
        orgId: input.orgId ?? null,
        workspaceId: input.workspaceId ?? null,
        executionPlanId: input.result.executionPlanId,
        targetId: input.result.targetId,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId,
        reason: input.reason,
        status: input.result.status,
        acceptedAt: new Date(input.result.acceptedAt),
        integrityHash: input.result.integrityHash,
        contractVersion: input.result.contractVersion,
        resultBody: input.result,
      });
      return { value: input.result, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getByIdempotency({
        commandType: input.result.commandType,
        idempotencyKey: input.idempotencyKey,
        targetId: input.result.targetId,
      });
      if (!raced) {
        throw new AdminRuntimeOperationsError(
          "RUNTIME_OPS_CONFLICT",
          "Recovery receipt unique conflict without readable row"
        );
      }
      if (raced.integrityHash !== input.result.integrityHash) {
        throw new AdminRuntimeOperationsError(
          "RUNTIME_OPS_CONFLICT",
          "Conflicting Runtime Recovery receipt on unique converge"
        );
      }
      return { value: raced, replayed: true };
    }
  }
}

export class AdminRuntimeOperationsReadRepositoryImpl {
  constructor(private readonly db: Db = getDb()) {}

  async getExecutionReadModel(
    context: TrustedAdminCommandContext,
    executionPlanId: string
  ): Promise<AdminRuntimeReadModel> {
    requireTrusted(context);
    const now = new Date().toISOString();

    const planRows = await this.db
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
      .limit(1);
    const plan = planRows[0];
    if (!plan) {
      throw new AdminRuntimeOperationsError(
        "RUNTIME_OPS_NOT_FOUND",
        "Execution Plan not found"
      );
    }
    if (context.targetOrgId && context.targetOrgId !== plan.orgId) {
      throw new AdminRuntimeOperationsError(
        "RUNTIME_OPS_DENIED",
        "Cross-tenant Runtime read denied"
      );
    }

    const executionIdentity = commercialExecutionIdentityForPlan(executionPlanId);
    const commercial = await this.db
      .select()
      .from(schema.commercialExecutionAuthorizations)
      .where(
        and(
          eq(schema.commercialExecutionAuthorizations.orgId, plan.orgId),
          eq(
            schema.commercialExecutionAuthorizations.workspaceId,
            plan.workspaceId
          ),
          eq(
            schema.commercialExecutionAuthorizations.executionIdentity,
            executionIdentity
          )
        )
      )
      .limit(1);

    const runtimeAuth = await this.db
      .select()
      .from(schema.aiStoryRuntimeAuthorizedFacts)
      .where(
        eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, executionPlanId)
      )
      .limit(1);

    const scenes = await this.db
      .select({ id: schema.aiStorySceneExecutions.id })
      .from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.executionPlanId, executionPlanId));

    const attempts = await this.db
      .select({
        attemptId: schema.providerAttempts.attemptId,
        status: schema.providerAttempts.status,
      })
      .from(schema.providerAttempts)
      .innerJoin(
        schema.providerExecutions,
        eq(
          schema.providerAttempts.executionId,
          schema.providerExecutions.executionId
        )
      )
      .where(eq(schema.providerExecutions.workspaceId, plan.workspaceId));

    const assembly = await this.db
      .select()
      .from(schema.aiStoryAssemblyJobs)
      .where(eq(schema.aiStoryAssemblyJobs.executionPlanId, executionPlanId))
      .limit(1);

    let assemblyStatus: string | null = null;
    if (assembly[0]) {
      const facts = await this.db
        .select({ factKind: schema.aiStoryAssemblyJobFacts.factKind })
        .from(schema.aiStoryAssemblyJobFacts)
        .where(
          eq(
            schema.aiStoryAssemblyJobFacts.assemblyJobId,
            assembly[0].assemblyJobId
          )
        )
        .orderBy(desc(schema.aiStoryAssemblyJobFacts.recordedAt))
        .limit(1);
      assemblyStatus = facts[0]?.factKind ?? "ACCEPTED";
    }

    const fsr = await this.db
      .select()
      .from(schema.aiStoryFinalStoryResults)
      .where(
        eq(schema.aiStoryFinalStoryResults.executionPlanId, executionPlanId)
      )
      .limit(1);

    const media = await this.db
      .select({
        id: schema.aiStoryDurableSceneMediaAttestations.mediaAttestationId,
      })
      .from(schema.aiStoryDurableSceneMediaAttestations)
      .where(
        eq(
          schema.aiStoryDurableSceneMediaAttestations.executionPlanId,
          executionPlanId
        )
      );

    const dispatches = await this.db
      .select({ id: schema.providerExecutionDispatches.dispatchId })
      .from(schema.providerExecutionDispatches)
      .where(
        eq(schema.providerExecutionDispatches.workspaceId, plan.workspaceId)
      );

    const outbox = await countOutboxByWorkspace(this.db, plan.workspaceId);
    const acceptanceUnknown = attempts.filter((a) =>
      String(a.status).toUpperCase().includes("UNKNOWN")
    ).length;

    return AdminRuntimeReadModelSchema.parse({
      contractVersion: "1",
      executionPlanId,
      orgId: plan.orgId,
      workspaceId: plan.workspaceId,
      campaignId: plan.campaignId ?? null,
      storyId: plan.storyId ?? null,
      productRuntimeStatus: plan.status ?? null,
      commercialAuthorizationId:
        commercial[0]?.commercialAuthorizationId ?? null,
      runtimeAuthorizationId: runtimeAuth[0]?.runtimeAuthorizationId ?? null,
      sceneCount: scenes.length,
      providerAttemptCount: attempts.length,
      assemblyJobId: assembly[0]?.assemblyJobId ?? null,
      assemblyStatus,
      finalStoryResultId: fsr[0]?.finalStoryResultId ?? null,
      durableMediaAttestationCount: media.length,
      workerDispatchCount: dispatches.length,
      outboxPendingCount: outbox.pending,
      outboxDeadLetterCount: outbox.dead,
      reconciliationRequired: acceptanceUnknown > 0,
      projectedAt: now,
    });
  }

  async getExecutionTimeline(
    context: TrustedAdminCommandContext,
    executionPlanId: string
  ): Promise<RuntimeExecutionTimeline> {
    requireTrusted(context);
    const readModel = await this.getExecutionReadModel(context, executionPlanId);
    const now = readModel.projectedAt;

    const stages: RuntimeTimelineStage[] = [
      stage({
        stage: "COMMERCIAL_AUTHORIZATION",
        status: readModel.commercialAuthorizationId ? "SUCCEEDED" : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "commercial_execution_authorization",
        evidenceId: readModel.commercialAuthorizationId,
        summary: readModel.commercialAuthorizationId
          ? "Commercial Authorization present"
          : "Commercial Authorization missing",
        eligibleRecoveryCommands: [],
      }),
      stage({
        stage: "RUNTIME_AUTHORIZATION",
        status: readModel.runtimeAuthorizationId ? "SUCCEEDED" : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "runtime_authorized_fact",
        evidenceId: readModel.runtimeAuthorizationId,
        summary: readModel.runtimeAuthorizationId
          ? "Runtime Authorization present"
          : "Runtime Authorization missing",
        eligibleRecoveryCommands: [],
      }),
      stage({
        stage: "SCENE_SCHEDULING",
        status:
          readModel.sceneCount > 0 && readModel.providerAttemptCount > 0
            ? "SUCCEEDED"
            : readModel.runtimeAuthorizationId
              ? "IN_PROGRESS"
              : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "scene_scheduling",
        evidenceId: executionPlanId,
        summary: `${readModel.sceneCount} scenes / ${readModel.providerAttemptCount} provider attempts`,
        eligibleRecoveryCommands: [],
      }),
      stage({
        stage: "PROVIDER_ACCEPTANCE",
        status: readModel.reconciliationRequired
          ? "RECONCILIATION_REQUIRED"
          : readModel.providerAttemptCount > 0
            ? "SUCCEEDED"
            : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "provider_attempt",
        evidenceId: null,
        summary: readModel.reconciliationRequired
          ? "Acceptance Unknown detected"
          : "Provider acceptance observational",
        eligibleRecoveryCommands: readModel.reconciliationRequired
          ? ["ReconcileProviderAcceptance"]
          : [],
      }),
      stage({
        stage: "PROVIDER_COMPLETION",
        status:
          readModel.outboxDeadLetterCount > 0
            ? "FAILED"
            : readModel.outboxPendingCount > 0
              ? "IN_PROGRESS"
              : readModel.providerAttemptCount > 0
                ? "SUCCEEDED"
                : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "provider_outbox",
        evidenceId: null,
        summary: `outbox pending=${readModel.outboxPendingCount} deadLetter=${readModel.outboxDeadLetterCount}`,
        eligibleRecoveryCommands: [],
      }),
      stage({
        stage: "ASSEMBLY",
        status: readModel.assemblyStatus
          ? String(readModel.assemblyStatus).includes("FAIL")
            ? "FAILED"
            : String(readModel.assemblyStatus).includes("SUCC")
              ? "SUCCEEDED"
              : "IN_PROGRESS"
          : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "assembly_job",
        evidenceId: readModel.assemblyJobId,
        summary: readModel.assemblyStatus
          ? `Assembly status ${readModel.assemblyStatus}`
          : "Assembly not started",
        eligibleRecoveryCommands: readModel.assemblyJobId
          ? ["RetryProjection"]
          : [],
      }),
      stage({
        stage: "FINAL_STORY_RESULT",
        status: readModel.finalStoryResultId ? "SUCCEEDED" : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "final_story_result",
        evidenceId: readModel.finalStoryResultId,
        summary: readModel.finalStoryResultId
          ? "Final Story Result present"
          : "Final Story Result missing",
        eligibleRecoveryCommands: ["RetryProjection", "RebuildReadModel"],
      }),
      stage({
        stage: "DURABLE_MEDIA",
        status:
          readModel.durableMediaAttestationCount > 0
            ? "SUCCEEDED"
            : "NOT_STARTED",
        occurredAt: null,
        evidenceKind: "durable_scene_media_attestation",
        evidenceId: null,
        summary: `${readModel.durableMediaAttestationCount} attestations`,
        eligibleRecoveryCommands: ["RebuildReadModel"],
      }),
    ];

    return RuntimeExecutionTimelineSchema.parse({
      contractVersion: "1",
      executionPlanId,
      orgId: readModel.orgId,
      workspaceId: readModel.workspaceId,
      projectedAt: now,
      stages,
    });
  }

  async getProviderHealth(
    context: TrustedAdminCommandContext,
    orgId?: string | null
  ): Promise<ProviderHealthSnapshot> {
    requireTrusted(context);
    const scopedOrg = orgId ?? context.targetOrgId;
    const now = new Date().toISOString();

    const rows = await this.db
      .select({
        providerId: schema.providerAttempts.providerId,
        status: schema.providerAttempts.status,
        startedAt: schema.providerAttempts.startedAt,
        completedAt: schema.providerAttempts.completedAt,
        attemptId: schema.providerAttempts.attemptId,
      })
      .from(schema.providerAttempts)
      .innerJoin(
        schema.providerExecutions,
        eq(
          schema.providerAttempts.executionId,
          schema.providerExecutions.executionId
        )
      )
      .where(
        scopedOrg
          ? eq(schema.providerExecutions.orgId, scopedOrg)
          : sql`true`
      );

    const byProvider = new Map<
      string,
      {
        attemptCount: number;
        succeededCount: number;
        failedCount: number;
        acceptanceUnknownCount: number;
        latencies: number[];
        usageEventCount: number;
        costEventCount: number;
      }
    >();

    for (const row of rows) {
      const bucket = byProvider.get(row.providerId) ?? {
        attemptCount: 0,
        succeededCount: 0,
        failedCount: 0,
        acceptanceUnknownCount: 0,
        latencies: [],
        usageEventCount: 0,
        costEventCount: 0,
      };
      bucket.attemptCount += 1;
      const status = String(row.status).toUpperCase();
      if (status.includes("SUCC")) bucket.succeededCount += 1;
      if (status.includes("FAIL") || status.includes("ERROR"))
        bucket.failedCount += 1;
      if (status.includes("UNKNOWN")) bucket.acceptanceUnknownCount += 1;
      if (row.startedAt && row.completedAt) {
        bucket.latencies.push(
          new Date(row.completedAt).getTime() - new Date(row.startedAt).getTime()
        );
      }
      byProvider.set(row.providerId, bucket);
    }

    const attemptIds = rows.map((r) => r.attemptId);
    if (attemptIds.length > 0) {
      const usage = await this.db
        .select({ attemptId: schema.providerAttemptUsage.attemptId })
        .from(schema.providerAttemptUsage)
        .where(inArray(schema.providerAttemptUsage.attemptId, attemptIds));
      const costs = await this.db
        .select({ attemptId: schema.providerAttemptCosts.attemptId })
        .from(schema.providerAttemptCosts)
        .where(inArray(schema.providerAttemptCosts.attemptId, attemptIds));
      const usageSet = new Set(usage.map((u) => u.attemptId));
      const costSet = new Set(costs.map((c) => c.attemptId));
      for (const row of rows) {
        const bucket = byProvider.get(row.providerId);
        if (!bucket) continue;
        if (usageSet.has(row.attemptId)) bucket.usageEventCount += 1;
        if (costSet.has(row.attemptId)) bucket.costEventCount += 1;
      }
    }

    return ProviderHealthSnapshotSchema.parse({
      contractVersion: "1",
      projectedAt: now,
      orgId: scopedOrg ?? null,
      providers: [...byProvider.entries()].map(([providerId, b]) => {
        const total = b.attemptCount || 1;
        const avg =
          b.latencies.length > 0
            ? b.latencies.reduce((a, c) => a + c, 0) / b.latencies.length
            : null;
        return {
          providerId,
          attemptCount: b.attemptCount,
          succeededCount: b.succeededCount,
          failedCount: b.failedCount,
          acceptanceUnknownCount: b.acceptanceUnknownCount,
          successRate: b.attemptCount ? b.succeededCount / total : null,
          failureRate: b.attemptCount ? b.failedCount / total : null,
          averageLatencyMs: avg,
          usageEventCount: b.usageEventCount,
          costEventCount: b.costEventCount,
        };
      }),
    });
  }

  async getWorkerHealth(
    context: TrustedAdminCommandContext
  ): Promise<WorkerHealthSnapshot> {
    requireTrusted(context);
    const now = new Date().toISOString();
    const claimed = await this.db
      .select({
        jobId: schema.providerOutboxJobs.jobId,
        status: schema.providerOutboxJobs.status,
        leaseOwner: schema.providerOutboxJobs.leaseOwner,
        leaseExpiresAt: schema.providerOutboxJobs.leaseExpiresAt,
      })
      .from(schema.providerOutboxJobs)
      .where(eq(schema.providerOutboxJobs.status, "CLAIMED"))
      .orderBy(desc(schema.providerOutboxJobs.updatedAt))
      .limit(50);

    const workers = claimed.map((row) => ({
      workerKey: row.leaseOwner ?? "unknown-worker",
      state: "CLAIMED_OUTBOX",
      currentJobId: row.jobId,
      build: null,
      queueAssignment: "provider_outbox",
      lastObservedAt: row.leaseExpiresAt
        ? new Date(row.leaseExpiresAt).toISOString()
        : null,
    }));

    return WorkerHealthSnapshotSchema.parse({
      contractVersion: "1",
      projectedAt: now,
      heartbeatAvailable: false,
      workers,
    });
  }

  async getQueueHealth(
    context: TrustedAdminCommandContext
  ): Promise<QueueHealthSnapshot> {
    requireTrusted(context);
    const now = new Date().toISOString();

    let bullmq = {
      available: false,
      pending: null as number | null,
      active: null as number | null,
      failed: null as number | null,
      delayed: null as number | null,
    };
    // BullMQ counts are enriched by Admin API / health layer when Redis is available.
    // packages/db must not depend on @ceo-agent/queue.

    const rows = await this.db.execute<{
      pending: string;
      claimed: string;
      completed: string;
      dead: string;
      oldest: Date | null;
      expired: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE status = 'PENDING')::text AS pending,
        count(*) FILTER (WHERE status = 'CLAIMED')::text AS claimed,
        count(*) FILTER (WHERE status = 'COMPLETED')::text AS completed,
        count(*) FILTER (WHERE status = 'DEAD_LETTER')::text AS dead,
        min(created_at) FILTER (WHERE status = 'PENDING') AS oldest,
        count(*) FILTER (
          WHERE status = 'CLAIMED'
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < now()
        )::text AS expired
      FROM provider_outbox_jobs
    `);
    const row = Array.isArray(rows) ? rows[0] : undefined;

    return QueueHealthSnapshotSchema.parse({
      contractVersion: "1",
      projectedAt: now,
      bullmq,
      providerOutbox: {
        pending: Number(row?.pending ?? 0),
        claimed: Number(row?.claimed ?? 0),
        completed: Number(row?.completed ?? 0),
        deadLetter: Number(row?.dead ?? 0),
        oldestPendingAt: row?.oldest
          ? new Date(row.oldest).toISOString()
          : null,
        expiredLeaseCount: Number(row?.expired ?? 0),
      },
    });
  }

  async getDurableMediaDiagnostics(
    context: TrustedAdminCommandContext,
    executionPlanId: string
  ): Promise<DurableMediaDiagnostic> {
    requireTrusted(context);
    const readModel = await this.getExecutionReadModel(context, executionPlanId);
    const rows = await this.db
      .select()
      .from(schema.aiStoryDurableSceneMediaAttestations)
      .where(
        eq(
          schema.aiStoryDurableSceneMediaAttestations.executionPlanId,
          executionPlanId
        )
      )
      .orderBy(asc(schema.aiStoryDurableSceneMediaAttestations.acceptedAt));

    return DurableMediaDiagnosticSchema.parse({
      contractVersion: "1",
      executionPlanId,
      orgId: readModel.orgId,
      workspaceId: readModel.workspaceId,
      projectedAt: new Date().toISOString(),
      items: rows.map((row) => ({
        mediaAttestationId: row.mediaAttestationId,
        sceneExecutionId: row.sceneExecutionId,
        durableObjectReference: row.durableObjectReference,
        contentHash: row.contentHash,
        availability: "ATTESTED" as const,
        retentionClass: "workspace_scoped_object" as const,
        verification: "HASH_PRESENT" as const,
        attestedAt: row.acceptedAt
          ? new Date(row.acceptedAt).toISOString()
          : null,
      })),
    });
  }
}
