import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  ProviderResumeRepository,
} from "@ceo-agent/db";
import type {
  CanonicalProviderResult,
  ProviderAttempt,
  ProviderExecution,
} from "@ceo-agent/shared";
import { ResumeCoordinator } from "../apps/worker/src/provider-resume-coordinator";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.6C Resume Coordinator integration", () => {
  let sql: Sql;
  const executionIds = new Set<string>();

  beforeAll(() => {
    sql = createIntegrationSql();
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

  it("evaluates a persisted atomic finalization without database writes", async () => {
    const outbox = new ProviderOutboxRepository();
    const ledger = new ProviderLedgerRepository();
    const finalizer = new ProviderExecutionFinalizationRepository();
    const executionId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
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
        idempotencyKey: `resume:${executionId}`,
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
      requestHash: hash("b"),
      responseHash: hash("c"),
      status: "SUCCEEDED",
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
      },
      usage: {},
      cost: { amount: 0, currency: "USD", estimated: false },
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
    await outbox.claimNextJob({ leaseOwner: "worker-1", leaseDurationMs: 60_000 });
    const finalized = await finalizer.finalize({
      jobId,
      executionId,
      attemptId,
      workerId: "worker-1",
      providerId: attempt.providerId,
      adapterVersion: "1.0.0",
      result,
      dispatchTimestamp: new Date().toISOString(),
      executionDurationMs: 25,
    });
    const coordinator = new ResumeCoordinator(
      new ProviderResumeRepository(),
      { hasResumeMarker: async () => false }
    );
    const before = await sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM provider_outbox_jobs WHERE job_id = ${jobId}
    `;
    const decision = await coordinator.evaluate({
      finalization: {
        status: "FINALIZED",
        executionId,
        attemptId,
        jobId,
        workerId: "worker-1",
        completedAt: finalized.completedAt,
        resultReference: result.resultReference,
      },
      policyVersion: "1.0.0",
      trace: { traceId: correlationId },
    });
    const after = await sql<{ updated_at: Date }[]>`
      SELECT updated_at FROM provider_outbox_jobs WHERE job_id = ${jobId}
    `;

    expect(decision.decision).toBe("READY_TO_RESUME");
    expect(decision.signal).toMatchObject({
      executionId,
      attemptId,
      providerId: "provider-a",
      capabilityId: "json-generation",
      correlationId,
    });
    expect(after).toEqual(before);
  });
});
