import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
} from "@ceo-agent/db";
import type {
  CanonicalProviderRequest,
  CanonicalProviderResult,
  ProviderExecution,
} from "@ceo-agent/shared";
import {
  type ProviderAdapter,
} from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";
import { OutboxDispatchWorker } from "../apps/worker/src/provider-dispatch-worker";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.6A Outbox Dispatch Worker integration", () => {
  let sql: Sql;
  let outbox: ProviderOutboxRepository;
  let ledger: ProviderLedgerRepository;
  const executionIds = new Set<string>();

  beforeAll(() => {
    sql = createIntegrationSql();
    outbox = new ProviderOutboxRepository();
    ledger = new ProviderLedgerRepository();
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

  it("allows only the persistence-backed lease owner to dispatch", async () => {
    const executionId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const pipelineRunId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    executionIds.add(executionId);
    const execution: ProviderExecution = {
      contractVersion: "1",
      identity: {
        executionId,
        tenantId,
        workspaceId,
        pipelineRunId,
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: `dispatch:${executionId}`,
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
    const request: CanonicalProviderRequest = {
      contractVersion: "1",
      executionIdentity: execution.identity,
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      normalizedPayloadReference: {
        uri: `provider-payload://${executionId}`,
        contentHash: hash("b"),
        mediaType: "application/json",
      },
      outputSchema: { schemaId: "MarketingResult", schemaVersion: "1.0.0" },
      contextVersions: { CampaignAIContext: "1.0.0" },
      correlation: { correlationId, pipelineRunId, queueJobId: jobId },
      timeoutPolicy: { timeoutMs: 30_000, reconciliationDelayMs: 5_000 },
      retryPolicy: {
        maxAttempts: 3,
        initialDelayMs: 100,
        maximumDelayMs: 1_000,
        backoffMultiplier: 2,
      },
      providerConstraints: {},
    };
    const routingRequest: ProviderRoutingRequest = {
      routingRequestId: crypto.randomUUID(),
      capabilityId: "json-generation",
      capabilityVersion: "1.0.0",
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      tenantId,
      workspaceId,
      correlationId,
      policyVersion: "1.0.0",
      requiredFeatures: ["STRUCTURED_OUTPUT"],
      requireLookup: false,
      requireCancellation: false,
      requireCallbacks: false,
      requireStreaming: false,
      dataHandling: {
        sensitiveData: false,
        externalProcessingAllowed: true,
        providerTrainingAllowed: false,
        enterpriseControlsRequired: false,
        zeroRetentionRequired: false,
      },
    };
    const routingPolicy: ProviderRoutingPolicy = {
      policyVersion: "1.0.0",
      preferredProviders: [],
      requireTrainingOptOut: true,
    };
    const execute = vi.fn(
      async (
        _request: CanonicalProviderRequest,
        context: { providerAttemptId: string }
      ): Promise<CanonicalProviderResult> => ({
        contractVersion: "1",
        executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput: { ok: true },
        resultReference: `provider-result://${executionId}`,
        warnings: [],
        providerMetadata: {
          providerId: "provider-a",
          providerVersion: "provider-a-v1",
        },
        usage: {},
        cost: { amount: 0, currency: "USD", estimated: false },
        modelVersion: "model-a",
        requestHash: hash("c"),
        responseHash: hash("d"),
        retryable: false,
        validationStatus: "VALID",
      })
    );
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
            requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
            nativeIdempotency: true,
            lookup: false,
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
      execute,
    };
    const adapters = new ProviderAdapterRegistry();
    adapters.register(adapter);
    await outbox.createExecutionWithJob({
      execution,
      requestHash: hash("c"),
      job: {
        jobId,
        executionId,
        payloadReference: `provider-dispatch://${executionId}`,
        correlationId,
        nextVisibleAt: new Date(Date.now() - 1_000),
      },
    });
    const dependencies = {
      leaseDurationMs: 60_000,
      outbox,
      ledger,
      envelopeLoader: {
        load: async () => ({
          request,
          routingRequest,
          routingPolicy,
          dataHandling: {
            sensitiveData: false,
            retentionAllowed: false,
          },
          trace: { traceId: correlationId },
        }),
      },
      router: new CanonicalProviderRouter(adapters),
      adapters,
    };
    const workerA = new OutboxDispatchWorker({ ...dependencies, workerId: "worker-a" });
    const workerB = new OutboxDispatchWorker({ ...dependencies, workerId: "worker-b" });

    const outcomes = await Promise.all([workerA.dispatchOne(), workerB.dispatchOne()]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      "DISPATCHED",
      "NO_JOB",
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
