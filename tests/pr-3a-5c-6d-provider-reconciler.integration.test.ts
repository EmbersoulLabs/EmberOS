import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  ProviderReconciliationRepository,
} from "@ceo-agent/db";
import type { ProviderAttempt, ProviderExecution } from "@ceo-agent/shared";
import type { ProviderAdapter } from "../packages/agents/src/provider-adapters/contracts";
import { ProviderAdapterRegistry } from "../packages/agents/src/provider-router";
import { ProviderReconciler } from "../apps/worker/src/provider-reconciler";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.6D Provider Reconciler integration", () => {
  let sql: Sql;
  const executionIds = new Set<string>();

  beforeAll(() => {
    sql = createIntegrationSql();
  });

  afterAll(async () => {
    const ids = [...executionIds];
    if (ids.length > 0) {
      await sql`DELETE FROM provider_outbox_jobs WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_attempts WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_executions WHERE execution_id = ANY(${ids})`;
    }
    await sql.end();
    await closeDb();
  });

  it("looks up ambiguous Provider state without mutating Ledger or Outbox", async () => {
    const outbox = new ProviderOutboxRepository();
    const ledger = new ProviderLedgerRepository();
    const executionId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const providerRequestId = crypto.randomUUID();
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
        idempotencyKey: `reconcile:${executionId}`,
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
      status: "RECONCILING",
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
      providerRequestId,
      requestHash: hash("b"),
      status: "TIMEOUT_UNKNOWN",
      startedAt: new Date().toISOString(),
    };
    await outbox.createExecutionWithJob({
      execution,
      requestHash: attempt.requestHash,
      job: {
        jobId,
        executionId,
        payloadReference: `provider-dispatch://${executionId}`,
        correlationId,
        nextVisibleAt: new Date(Date.now() + 60_000),
      },
    });
    await ledger.appendAttempt({ attempt });

    const lookup = vi.fn().mockResolvedValue({
      status: "RUNNING",
      providerRequestId,
    });
    const adapter: ProviderAdapter = {
      providerId: "provider-a",
      adapterVersion: "1.0.0",
      capabilities: () =>
        new Set([
          {
            providerId: "provider-a",
            adapterVersion: "1.0.0",
            capabilityId: "json-generation",
            capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            requiredProviderFeatures: ["LOOKUP"],
            nativeIdempotency: true,
            lookup: true,
            cancellation: false,
            callbacks: false,
            streaming: false,
            routing: {
              costClass: "LOW",
              latencyClass: "FAST",
              qualityClass: "HIGH",
              reliabilityClass: "HIGH",
              regions: [],
              modelFamilies: ["model-a"],
              sensitiveDataAllowed: false,
              externalProcessing: true,
              trainingOptOut: true,
              zeroRetention: true,
              enterpriseControls: true,
            },
          },
        ]),
      execute: vi.fn(),
      lookup,
    };
    const adapters = new ProviderAdapterRegistry();
    adapters.register(adapter);
    const reconciler = new ProviderReconciler(
      new ProviderReconciliationRepository(),
      adapters
    );
    const before = await sql<{
      execution_status: string;
      outbox_status: string;
      execution_updated: Date;
    }[]>`
      SELECT e.status AS execution_status,
             o.status AS outbox_status,
             o.updated_at AS execution_updated
      FROM provider_executions e
      JOIN provider_outbox_jobs o ON o.execution_id = e.execution_id
      WHERE e.execution_id = ${executionId}
    `;
    const decision = await reconciler.reconcile({
      reconciliationRequestId: crypto.randomUUID(),
      executionId,
      attemptId,
      jobId,
      providerId: "provider-a",
      adapterVersion: "1.0.0",
      providerRequestId,
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      trigger: "TIMEOUT_UNKNOWN",
      policyVersion: "1.0.0",
      dataHandling: { sensitiveData: false, retentionAllowed: false },
      trace: { traceId: correlationId },
    });
    const after = await sql<{
      execution_status: string;
      outbox_status: string;
      execution_updated: Date;
    }[]>`
      SELECT e.status AS execution_status,
             o.status AS outbox_status,
             o.updated_at AS execution_updated
      FROM provider_executions e
      JOIN provider_outbox_jobs o ON o.execution_id = e.execution_id
      WHERE e.execution_id = ${executionId}
    `;

    expect(decision).toMatchObject({
      state: "RECOVERABLE",
      decision: "WAIT",
      providerState: "RUNNING",
      audit: { lookupPerformed: true },
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(after).toEqual(before);
  });
});
