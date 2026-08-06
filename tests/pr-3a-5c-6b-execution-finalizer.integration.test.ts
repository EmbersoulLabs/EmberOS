import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderExecutionFinalizationError,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
} from "@ceo-agent/db";
import type {
  CanonicalProviderResult,
  ProviderAttempt,
  ProviderExecution,
} from "@ceo-agent/shared";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.6B Execution Finalizer integration", () => {
  let sql: Sql;
  let outbox: ProviderOutboxRepository;
  let ledger: ProviderLedgerRepository;
  let repository: ProviderExecutionFinalizationRepository;
  const executionIds = new Set<string>();

  beforeAll(() => {
    sql = createIntegrationSql();
    outbox = new ProviderOutboxRepository();
    ledger = new ProviderLedgerRepository();
    repository = new ProviderExecutionFinalizationRepository();
  });

  afterAll(async () => {
    const ids = [...executionIds];
    if (ids.length > 0) {
      await sql`DELETE FROM provider_outbox_jobs WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_attempt_costs WHERE attempt_id IN (
        SELECT attempt_id FROM provider_attempts WHERE execution_id = ANY(${ids})
      )`;
      await sql`DELETE FROM provider_attempt_usage WHERE attempt_id IN (
        SELECT attempt_id FROM provider_attempts WHERE execution_id = ANY(${ids})
      )`;
      await sql`DELETE FROM provider_attempts WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_executions WHERE execution_id = ANY(${ids})`;
    }
    await sql.end();
    await closeDb();
  });

  async function fixture() {
    const executionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    executionIds.add(executionId);
    const execution: ProviderExecution = {
      contractVersion: "1",
      identity: {
        executionId,
        tenantId: crypto.randomUUID(),
        workspaceId: crypto.randomUUID(),
        pipelineRunId: crypto.randomUUID(),
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: `finalize:${executionId}`,
        deterministicFingerprint: hash("a"),
      },
      metadata: {
        skillId: "AI-005",
        skillVersion: "1.0.0",
        contextVersions: { CampaignAIContext: "1.0.0" },
        outputSchemaId: "MarketingResult",
        outputSchemaVersion: "1.0.0",
        correlationId,
        createdAt: new Date().toISOString(),
      },
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    const attempt: ProviderAttempt = {
      contractVersion: "1",
      attemptId,
      executionId,
      attemptNumber: 1,
      providerId: "provider-a",
      providerVersion: "provider-a-v1",
      modelVersion: "model-a",
      providerRequestId: crypto.randomUUID(),
      requestHash: hash("c"),
      responseHash: hash("d"),
      status: "SUCCEEDED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    const result: CanonicalProviderResult = {
      contractVersion: "1",
      executionId,
      providerAttemptId: attemptId,
      normalizedOutput: { summary: "canonical" },
      resultReference: `provider-result://${executionId}`,
      warnings: [],
      providerMetadata: {
        providerId: attempt.providerId,
        providerVersion: attempt.providerVersion,
        providerRequestId: attempt.providerRequestId,
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: { amount: 0.01, currency: "USD", estimated: false },
      modelVersion: attempt.modelVersion,
      requestHash: attempt.requestHash,
      responseHash: attempt.responseHash!,
      retryable: false,
      validationStatus: "VALID",
    };
    await outbox.createExecutionWithJob({
      execution,
      requestHash: attempt.requestHash,
      job: {
        jobId,
        executionId,
        payloadReference: `provider-dispatch://${executionId}`,
        correlationId,
        nextVisibleAt: new Date(Date.now() - 1_000),
      },
    });
    await ledger.appendAttempt({ attempt });
    await outbox.claimNextJob({
      leaseOwner: "worker-1",
      leaseDurationMs: 60_000,
    });
    return {
      execution,
      attempt,
      result,
      input: {
        jobId,
        executionId,
        attemptId,
        workerId: "worker-1",
        providerId: attempt.providerId,
        adapterVersion: "1.0.0",
        result,
        dispatchTimestamp: new Date().toISOString(),
        executionDurationMs: 125,
      },
    };
  }

  it("atomically accepts result, usage, cost, and Outbox completion", async () => {
    const value = await fixture();
    const finalized = await repository.finalize(value.input);
    expect(finalized.result).toEqual(value.result);

    const [executionRow] = await sql<{
      status: string;
      accepted_attempt_id: string;
    }[]>`
      SELECT status, accepted_attempt_id
      FROM provider_executions
      WHERE execution_id = ${value.execution.identity.executionId}
    `;
    const [jobRow] = await sql<{
      status: string;
      completed_at: Date;
      completion_worker_id: string;
      completion_metadata: Record<string, unknown>;
    }[]>`
      SELECT status, completed_at, completion_worker_id, completion_metadata
      FROM provider_outbox_jobs
      WHERE job_id = ${value.input.jobId}
    `;
    const ledgerEntry = await ledger.findExecution(value.input.executionId);
    expect(executionRow).toMatchObject({
      status: "SUCCEEDED",
      accepted_attempt_id: value.attempt.attemptId,
    });
    expect(jobRow).toMatchObject({
      status: "COMPLETED",
      completion_worker_id: "worker-1",
    });
    expect(jobRow?.completed_at).toBeTruthy();
    expect(jobRow?.completion_metadata).toMatchObject({
      providerId: "provider-a",
      adapterVersion: "1.0.0",
      executionDurationMs: 125,
    });
    expect(ledgerEntry?.attempts[0]?.usage).toEqual(value.result.usage);
    expect(ledgerEntry?.attempts[0]?.cost).toEqual(value.result.cost);
  });

  it("rejects duplicate and conflicting acceptance after finalization", async () => {
    const value = await fixture();
    await repository.finalize(value.input);
    await expect(repository.finalize(value.input)).rejects.toBeInstanceOf(
      ProviderExecutionFinalizationError
    );
    await expect(
      repository.finalize({
        ...value.input,
        result: {
          ...value.result,
          responseHash: hash("e"),
          normalizedOutput: { summary: "conflict" },
        },
      })
    ).rejects.toBeInstanceOf(ProviderExecutionFinalizationError);
    expect(await ledger.findAcceptedResult(value.input.executionId)).toEqual(value.result);
  });

  it("rejects stale or unrelated attempts", async () => {
    const value = await fixture();
    await expect(
      repository.finalize({ ...value.input, attemptId: crypto.randomUUID() })
    ).rejects.toThrow("does not belong");
  });

  it("rolls back every finalization write when usage conflicts", async () => {
    const value = await fixture();
    await ledger.recordUsage(value.attempt.attemptId, { totalTokens: 999 });
    await expect(repository.finalize(value.input)).rejects.toThrow("usage conflicts");

    const [executionRow] = await sql<{ status: string; accepted_result: unknown }[]>`
      SELECT status, accepted_result
      FROM provider_executions
      WHERE execution_id = ${value.input.executionId}
    `;
    const [jobRow] = await sql<{ status: string }[]>`
      SELECT status
      FROM provider_outbox_jobs
      WHERE job_id = ${value.input.jobId}
    `;
    const [costRow] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM provider_attempt_costs
      WHERE attempt_id = ${value.attempt.attemptId}
    `;
    expect(executionRow).toEqual({ status: "PENDING", accepted_result: null });
    expect(jobRow?.status).toBe("CLAIMED");
    expect(costRow?.count).toBe(0);
  });

  it("allows only one concurrent finalization to commit", async () => {
    const value = await fixture();
    const settled = await Promise.allSettled([
      repository.finalize(value.input),
      repository.finalize(value.input),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);

    const [jobRow] = await sql<{ status: string; completion_worker_id: string }[]>`
      SELECT status, completion_worker_id
      FROM provider_outbox_jobs
      WHERE job_id = ${value.input.jobId}
    `;
    expect(jobRow).toEqual({
      status: "COMPLETED",
      completion_worker_id: "worker-1",
    });
  });
});
