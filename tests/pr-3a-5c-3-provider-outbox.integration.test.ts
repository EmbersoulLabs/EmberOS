import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderOutboxConflictError,
  ProviderOutboxRepository,
} from "@ceo-agent/db";
import type { ProviderExecution } from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.3 Transactional Outbox", () => {
  let sql: Sql;
  let repository: ProviderOutboxRepository;
  const executionIds = new Set<string>();
  const jobIds = new Set<string>();

  function execution(): ProviderExecution {
    const executionId = crypto.randomUUID();
    executionIds.add(executionId);
    return {
      contractVersion: "1",
      identity: {
        executionId,
        tenantId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        campaignId: crypto.randomUUID(),
        pipelineRunId: crypto.randomUUID(),
        capabilityId: "marketing-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: `provider-outbox:${executionId}`,
        deterministicFingerprint: hash("a"),
      },
      metadata: {
        skillId: "AI-005",
        skillVersion: "1.0.0",
        contextVersions: { CampaignAIContext: "1.0.0" },
        outputSchemaId: "MarketingGenerationResult",
        outputSchemaVersion: "1.0.0",
        correlationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
  }

  async function createIntent(options: {
    nextVisibleAt?: Date;
    priority?: number;
    jobId?: string;
  } = {}) {
    const providerExecution = execution();
    const jobId = options.jobId ?? crypto.randomUUID();
    jobIds.add(jobId);
    return repository.createExecutionWithJob({
      execution: providerExecution,
      requestHash: hash("b"),
      job: {
        jobId,
        executionId: providerExecution.identity.executionId,
        payloadReference: `provider-payload://${providerExecution.identity.executionId}`,
        correlationId: providerExecution.metadata.correlationId,
        priority: options.priority,
        nextVisibleAt:
          options.nextVisibleAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  beforeAll(() => {
    sql = createIntegrationSql();
    repository = new ProviderOutboxRepository();
  });

  afterAll(async () => {
    const ids = [...executionIds];
    if (ids.length > 0) {
      await sql`DELETE FROM provider_outbox_jobs WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_executions WHERE execution_id = ANY(${ids})`;
    }
    await sql.end();
    await closeDb();
  });

  it("creates ProviderExecution and Outbox intent atomically", async () => {
    const created = await createIntent();
    const [row] = await sql<{ execution_id: string; job_id: string }[]>`
      SELECT execution_id, job_id
      FROM provider_outbox_jobs
      WHERE job_id = ${created.job.jobId}
    `;
    expect(row).toEqual({
      execution_id: created.execution.identity.executionId,
      job_id: created.job.jobId,
    });

    const conflictingExecution = execution();
    await expect(
      repository.createExecutionWithJob({
        execution: conflictingExecution,
        requestHash: hash("b"),
        job: {
          jobId: created.job.jobId,
          executionId: conflictingExecution.identity.executionId,
          payloadReference: "provider-payload://conflict",
          correlationId: conflictingExecution.metadata.correlationId,
        },
      })
    ).rejects.toBeInstanceOf(ProviderOutboxConflictError);

    const [rolledBack] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM provider_executions
      WHERE execution_id = ${conflictingExecution.identity.executionId}
    `;
    expect(rolledBack?.count).toBe(0);
  });

  it("allows only one concurrent worker to claim a visible job", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 10_000,
    });

    const claims = await Promise.all([
      repository.claimNextJob({ leaseOwner: "worker-a", leaseDurationMs: 60_000, now }),
      repository.claimNextJob({ leaseOwner: "worker-b", leaseDurationMs: 60_000, now }),
    ]);
    const accepted = claims.filter((claim) => claim?.jobId === created.job.jobId);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.attemptCount).toBe(1);
  });

  it("enforces lease ownership and supports renewal", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 20_000,
    });
    await repository.claimNextJob({
      leaseOwner: "lease-owner",
      leaseDurationMs: 1_000,
      now,
    });

    await expect(
      repository.renewLease({
        jobId: created.job.jobId,
        leaseOwner: "wrong-owner",
        leaseDurationMs: 5_000,
        now,
      })
    ).rejects.toBeInstanceOf(ProviderOutboxConflictError);
    const renewed = await repository.renewLease({
      jobId: created.job.jobId,
      leaseOwner: "lease-owner",
      leaseDurationMs: 5_000,
      now,
    });
    expect(renewed.leaseExpiresAt).toBe(
      new Date(now.getTime() + 5_000).toISOString()
    );
  });

  it("recovers an expired lease after a simulated worker crash", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 30_000,
    });
    const first = await repository.claimNextJob({
      leaseOwner: "crashed-worker",
      leaseDurationMs: 1_000,
      now,
    });
    expect(first?.jobId).toBe(created.job.jobId);

    const recovered = await repository.claimNextJob({
      leaseOwner: "recovery-worker",
      leaseDurationMs: 10_000,
      now: new Date(now.getTime() + 1_001),
    });
    expect(recovered?.jobId).toBe(created.job.jobId);
    expect(recovered?.leaseOwner).toBe("recovery-worker");
    expect(recovered?.attemptCount).toBe(2);
  });

  it("persists retry scheduling metadata without executing retry logic", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 40_000,
    });
    await repository.claimNextJob({
      leaseOwner: "retry-worker",
      leaseDurationMs: 60_000,
      now,
    });
    const nextVisibleAt = new Date(Date.now() + 60_000);
    const released = await repository.releaseLease({
      jobId: created.job.jobId,
      leaseOwner: "retry-worker",
      nextVisibleAt,
      retryDelayMs: 60_000,
      retryClassification: "RATE_LIMITED",
      lastErrorCategory: "RATE_LIMIT",
    });

    expect(released.status).toBe("RETRY_WAIT");
    expect(released.retryDelayMs).toBe(60_000);
    expect(released.retryClassification).toBe("RATE_LIMITED");
    expect(released.lastErrorCategory).toBe("RATE_LIMIT");
    expect(
      await repository.claimNextJob({
        leaseOwner: "early-worker",
        leaseDurationMs: 10_000,
        now: new Date(nextVisibleAt.getTime() - 1),
      })
    ).not.toMatchObject({ jobId: created.job.jobId });
  });

  it("persists terminal dead-letter facts and removes the lease", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 50_000,
    });
    await repository.claimNextJob({
      leaseOwner: "terminal-worker",
      leaseDurationMs: 60_000,
      now,
    });
    const deadLetter = await repository.moveToDeadLetter({
      jobId: created.job.jobId,
      leaseOwner: "terminal-worker",
      reason: "Retry attempts exhausted",
      operatorNotes: "Inspect provider availability",
      now,
    });

    expect(deadLetter.status).toBe("DEAD_LETTER");
    expect(deadLetter.deadLetterReason).toBe("Retry attempts exhausted");
    expect(deadLetter.deadLetterAt).toBe(now.toISOString());
    expect(deadLetter.leaseOwner).toBeUndefined();
  });

  it("completes only with an active persisted lease", async () => {
    const now = new Date();
    const created = await createIntent({
      nextVisibleAt: new Date(now.getTime() - 1),
      priority: 60_000,
    });
    await repository.claimNextJob({
      leaseOwner: "completion-worker",
      leaseDurationMs: 60_000,
      now,
    });
    await expect(
      repository.completeJob({
        jobId: created.job.jobId,
        leaseOwner: "other-worker",
        now,
      })
    ).rejects.toBeInstanceOf(ProviderOutboxConflictError);
    const completed = await repository.completeJob({
      jobId: created.job.jobId,
      leaseOwner: "completion-worker",
      now,
    });
    expect(completed.status).toBe("COMPLETED");
    expect(completed.leaseOwner).toBeUndefined();
  });
});
