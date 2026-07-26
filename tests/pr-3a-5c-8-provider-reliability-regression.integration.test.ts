import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  ProviderReconciliationRepository,
  ProviderResumeRepository,
} from "@ceo-agent/db";
import type {
  CanonicalProviderRequest,
  CanonicalProviderResult,
  ProviderAttempt,
  ProviderExecution,
} from "@ceo-agent/shared";
import type { ProviderAdapter } from "../packages/agents/src/provider-adapters/contracts";
import {
  CanonicalProviderRouter,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";
import { OutboxDispatchWorker } from "../apps/worker/src/provider-dispatch-worker";
import { ExecutionFinalizer } from "../apps/worker/src/provider-execution-finalizer";
import { ResumeCoordinator } from "../apps/worker/src/provider-resume-coordinator";
import { ProviderReconciler } from "../apps/worker/src/provider-reconciler";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.8 Provider Reliability regression", () => {
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

  async function fixture(options: { providerId?: string } = {}) {
    const providerId = options.providerId ?? "provider-a";
    const executionId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const correlationId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const pipelineRunId = crypto.randomUUID();
    executionIds.add(executionId);
    const requestHash = hash("c");
    const responseHash = hash("d");
    const execution: ProviderExecution = {
      contractVersion: "1",
      identity: {
        executionId,
        tenantId,
        workspaceId,
        pipelineRunId,
        capabilityId: "json-generation",
        capabilityVersion: "1.0.0",
        idempotencyKey: `regression:${executionId}`,
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
      routingRequestId: `route:${executionId}`,
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
    const logicalProviderResults = new Map<string, CanonicalProviderResult>();
    const providerSideEffects = vi.fn();
    const execute = vi.fn(
      async (
        _providerRequest: CanonicalProviderRequest,
        context: { providerAttemptId: string; idempotencyKey: string }
      ): Promise<CanonicalProviderResult> => {
        const existing = logicalProviderResults.get(context.idempotencyKey);
        if (existing) {
          return { ...existing, providerAttemptId: context.providerAttemptId };
        }
        providerSideEffects(context.idempotencyKey);
        const result: CanonicalProviderResult = {
          contractVersion: "1",
          executionId,
          providerAttemptId: context.providerAttemptId,
          normalizedOutput: { summary: "canonical" },
          resultReference: `provider-result://${executionId}`,
          warnings: [],
          providerMetadata: {
            providerId,
            providerVersion: `${providerId}-v1`,
            providerRequestId: `request:${executionId}`,
          },
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          cost: { amount: 0.01, currency: "USD", estimated: false },
          modelVersion: "model-a",
          requestHash,
          responseHash,
          retryable: false,
          validationStatus: "VALID",
        };
        logicalProviderResults.set(context.idempotencyKey, result);
        return result;
      }
    );
    const lookup = vi.fn(async () => ({
      status: "SUCCEEDED" as const,
      providerRequestId: `request:${executionId}`,
      result: logicalProviderResults.get(execution.identity.idempotencyKey),
    }));
    const adapter: ProviderAdapter = {
      providerId,
      adapterVersion: "1.0.0",
      capabilities: () =>
        new Set([
          {
            providerId,
            adapterVersion: "1.0.0",
            capabilityId: "json-generation",
            capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
            requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
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
      execute,
      lookup,
    };
    const adapters = new ProviderAdapterRegistry();
    adapters.register(adapter);
    const outbox = new ProviderOutboxRepository();
    const ledger = new ProviderLedgerRepository();
    await outbox.createExecutionWithJob({
      execution,
      requestHash,
      job: {
        jobId,
        executionId,
        payloadReference: `provider-dispatch://${executionId}`,
        correlationId,
        nextVisibleAt: new Date(Date.now() - 1_000),
      },
    });
    const worker = (workerId: string, now?: () => Date) =>
      new OutboxDispatchWorker({
        workerId,
        leaseDurationMs: 60_000,
        outbox,
        ledger,
        envelopeLoader: {
          load: async () => ({
            request,
            routingRequest,
            routingPolicy,
            dataHandling: { sensitiveData: false, retentionAllowed: false },
            trace: { traceId: correlationId },
          }),
        },
        router: new CanonicalProviderRouter(adapters),
        adapters,
        now,
      });
    return {
      execution,
      request,
      routingRequest,
      routingPolicy,
      jobId,
      correlationId,
      requestHash,
      responseHash,
      providerId,
      adapter,
      adapters,
      outbox,
      ledger,
      execute,
      lookup,
      providerSideEffects,
      worker,
    };
  }

  async function appendSuccessfulAttempt(
    value: Awaited<ReturnType<typeof fixture>>,
    dispatch: Extract<
      Awaited<ReturnType<OutboxDispatchWorker["dispatchOne"]>>,
      { status: "DISPATCHED" }
    >
  ) {
    const attempt: ProviderAttempt = {
      contractVersion: "1",
      attemptId: dispatch.attemptId,
      executionId: dispatch.executionId,
      attemptNumber: 1,
      providerId: dispatch.providerId,
      providerVersion: dispatch.result.providerMetadata.providerVersion,
      modelVersion: dispatch.result.modelVersion,
      providerRequestId: dispatch.result.providerMetadata.providerRequestId,
      requestHash: dispatch.result.requestHash,
      responseHash: dispatch.result.responseHash,
      status: "SUCCEEDED",
      startedAt: dispatch.dispatchTimestamp,
      completedAt: new Date().toISOString(),
    };
    await value.ledger.appendAttempt({ attempt });
    return attempt;
  }

  it("executes the complete durable flow and produces consistent read-only decisions", async () => {
    const value = await fixture();
    const dispatch = await value.worker("worker-normal").dispatchOne();
    expect(dispatch.status).toBe("DISPATCHED");
    if (dispatch.status !== "DISPATCHED") throw new Error("dispatch failed");
    const attempt = await appendSuccessfulAttempt(value, dispatch);
    const finalized = await new ExecutionFinalizer(
      new ProviderExecutionFinalizationRepository()
    ).finalize(dispatch);

    const coordinator = new ResumeCoordinator(
      new ProviderResumeRepository(),
      { hasResumeMarker: async () => false }
    );
    const resumeInput = {
      finalization: finalized,
      policyVersion: "1.0.0",
      trace: { traceId: value.correlationId },
    };
    const resumeA = await coordinator.evaluate(resumeInput);
    const resumeB = await coordinator.evaluate(resumeInput);
    expect(resumeA.decision).toBe("READY_TO_RESUME");
    expect(resumeA.signal.signalHash).toBe(resumeB.signal.signalHash);
    expect(resumeA.audit.decisionHash).toBe(resumeB.audit.decisionHash);

    const reconciler = new ProviderReconciler(
      new ProviderReconciliationRepository(),
      value.adapters
    );
    const reconciliationInput = {
      reconciliationRequestId: `reconcile:${value.execution.identity.executionId}`,
      executionId: value.execution.identity.executionId,
      attemptId: attempt.attemptId,
      jobId: value.jobId,
      providerId: value.providerId,
      adapterVersion: "1.0.0",
      providerRequestId: attempt.providerRequestId,
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      trigger: "STATE_DISAGREEMENT" as const,
      policyVersion: "1.0.0",
      dataHandling: { sensitiveData: false, retentionAllowed: false },
      trace: { traceId: value.correlationId },
    };
    const reconciliationA = await reconciler.reconcile(reconciliationInput);
    const reconciliationB = await reconciler.reconcile(reconciliationInput);
    expect(reconciliationA).toMatchObject({
      state: "CONSISTENT",
      decision: "CONSISTENT",
      audit: { lookupPerformed: false },
    });
    expect(reconciliationA.audit.decisionHash).toBe(
      reconciliationB.audit.decisionHash
    );
    expect(value.lookup).not.toHaveBeenCalled();

    const persisted = await value.ledger.findExecution(
      value.execution.identity.executionId
    );
    const job = await value.outbox.findJob(value.jobId);
    expect(persisted?.execution).toMatchObject({
      status: "SUCCEEDED",
      acceptedAttemptId: attempt.attemptId,
    });
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.acceptedResult).toEqual(dispatch.result);
    expect(job?.status).toBe("COMPLETED");
  });

  it("recovers an expired worker lease without duplicating the logical provider execution", async () => {
    const value = await fixture();
    const first = await value.worker("worker-crashed").dispatchOne();
    expect(first.status).toBe("DISPATCHED");
    if (first.status !== "DISPATCHED") throw new Error("dispatch failed");

    const afterExpiry = new Date(Date.now() + 120_000);
    const replay = await value
      .worker("worker-restarted", () => afterExpiry)
      .dispatchOne();
    expect(replay.status).toBe("DISPATCHED");
    if (replay.status !== "DISPATCHED") throw new Error("replay failed");
    expect(value.execute).toHaveBeenCalledTimes(2);
    expect(value.providerSideEffects).toHaveBeenCalledTimes(1);
    expect(replay.result.resultReference).toBe(first.result.resultReference);

    const attempt = await appendSuccessfulAttempt(value, replay);
    await new ExecutionFinalizer(
      new ProviderExecutionFinalizationRepository()
    ).finalize(replay);
    const ledger = await value.ledger.findExecution(
      value.execution.identity.executionId
    );
    expect(ledger?.execution.acceptedAttemptId).toBe(attempt.attemptId);
    expect(ledger?.attempts).toHaveLength(1);
  });

  it("detects FINALIZE_REQUIRED after provider success without a finalizer commit", async () => {
    const value = await fixture();
    const dispatch = await value.worker("worker-interrupted").dispatchOne();
    expect(dispatch.status).toBe("DISPATCHED");
    if (dispatch.status !== "DISPATCHED") throw new Error("dispatch failed");
    const attempt = await appendSuccessfulAttempt(value, dispatch);

    const decision = await new ProviderReconciler(
      new ProviderReconciliationRepository(),
      value.adapters
    ).reconcile({
      reconciliationRequestId: crypto.randomUUID(),
      executionId: value.execution.identity.executionId,
      attemptId: attempt.attemptId,
      jobId: value.jobId,
      providerId: value.providerId,
      adapterVersion: "1.0.0",
      providerRequestId: attempt.providerRequestId,
      requestSchemaVersion: "1.0.0",
      resultSchemaVersion: "1.0.0",
      trigger: "MISSING_FINALIZATION",
      policyVersion: "1.0.0",
      dataHandling: { sensitiveData: false, retentionAllowed: false },
      trace: { traceId: value.correlationId },
    });
    expect(decision).toMatchObject({
      state: "RECOVERABLE",
      decision: "FINALIZE_REQUIRED",
      reasons: ["PROVIDER_RESULT_VERIFIED"],
    });
    expect((await value.outbox.findJob(value.jobId))?.status).toBe("CLAIMED");
    expect(
      (await value.ledger.findExecution(value.execution.identity.executionId))
        ?.acceptedResult
    ).toBeUndefined();
  });

  it("converges duplicate dispatch and finalization attempts on one accepted result", async () => {
    const value = await fixture();
    const [first, duplicate] = await Promise.all([
      value.worker("worker-a").dispatchOne(),
      value.worker("worker-b").dispatchOne(),
    ]);
    const dispatched = [first, duplicate].filter(
      (item): item is Extract<typeof item, { status: "DISPATCHED" }> =>
        item.status === "DISPATCHED"
    );
    expect(dispatched).toHaveLength(1);
    expect(value.providerSideEffects).toHaveBeenCalledTimes(1);
    await appendSuccessfulAttempt(value, dispatched[0]!);

    const finalizer = new ExecutionFinalizer(
      new ProviderExecutionFinalizationRepository()
    );
    const settled = await Promise.allSettled([
      finalizer.finalize(dispatched[0]!),
      finalizer.finalize(dispatched[0]!),
    ]);
    expect(settled.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((item) => item.status === "rejected")).toHaveLength(1);
    const persisted = await value.ledger.findExecution(
      value.execution.identity.executionId
    );
    expect(persisted?.attempts).toHaveLength(1);
    expect(persisted?.acceptedResult?.responseHash).toBe(value.responseHash);
    expect((await value.outbox.findJob(value.jobId))?.status).toBe("COMPLETED");
  });
});
