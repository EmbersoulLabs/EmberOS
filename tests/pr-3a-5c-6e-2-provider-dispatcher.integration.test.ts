import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ExecutionDispatchRepository,
  ExecutionEnvelopeRepository,
  ProviderOutboxRepository,
} from "@ceo-agent/db";
import {
  createExecutionDispatch,
  createExecutionEnvelope,
  type CanonicalProviderResult,
  type ProviderExecution,
} from "@ceo-agent/shared";
import type { ProviderAdapter } from "../packages/agents/src/provider-adapters";
import {
  CanonicalProviderRouter,
  ProviderAdapterRegistry,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
} from "../packages/agents/src/provider-router";
import { ProviderExecutionDispatcher } from "../apps/worker/src/provider-execution-dispatcher";
import { ProviderExecutionWorker } from "../apps/worker/src/provider-dispatch-worker";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { createEnvelopeInput } from "./helpers/provider-execution-envelope";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = (character: string) => `sha256:${character.repeat(64)}`;

describeIntegration("PR-3A.5C.6E.2 Production Dispatcher persistence", () => {
  let sql: Sql;
  const executionIds = new Set<string>();

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const file of [
      "provider-execution-envelope.sql",
      "provider-execution-dispatch.sql",
    ]) {
      const statements = readFileSync(
        resolve(__dirname, `../packages/db/sql/${file}`),
        "utf8"
      )
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);
      for (const statement of statements) await sql.unsafe(statement);
    }
  });

  afterAll(async () => {
    const ids = [...executionIds];
    if (ids.length > 0) {
      await sql`DELETE FROM provider_execution_dispatches WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_execution_envelopes
        WHERE (execution_context ->> 'executionId') = ANY(${ids})`;
      await sql`DELETE FROM provider_outbox_jobs WHERE execution_id = ANY(${ids})`;
      await sql`DELETE FROM provider_executions WHERE execution_id = ANY(${ids})`;
    }
    await sql.end();
    await closeDb();
  });

  async function createIntent() {
    const suffix = crypto.randomUUID();
    const executionId = `execution-${suffix}`;
    const jobId = `job-${suffix}`;
    const correlationId = `correlation-${suffix}`;
    const workspaceId = crypto.randomUUID();
    const tenantId = crypto.randomUUID();
    const routingRequest: ProviderRoutingRequest = {
      routingRequestId: `routing-${suffix}`,
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
    executionIds.add(executionId);
    const envelopeInput = createEnvelopeInput({
      envelopeId: `envelope-${suffix}`,
      payloadReference: `provider-envelope://${suffix}`,
      tenantId,
      workspaceId,
      providerPolicySnapshot: { routingRequest, routingPolicy },
      executionContext: {
        ...createEnvelopeInput().executionContext,
        executionId,
        queueJobId: jobId,
        correlationId,
        pipelineRunId: `pipeline-${suffix}`,
        idempotencyKey: `idempotency-${suffix}`,
      },
      canonicalRequest: {
        ...createEnvelopeInput().canonicalRequest,
        executionIdentity: {
          ...createEnvelopeInput().canonicalRequest.executionIdentity,
          executionId,
          tenantId,
          workspaceId,
          pipelineRunId: `pipeline-${suffix}`,
          idempotencyKey: `idempotency-${suffix}`,
        },
        correlation: {
          correlationId,
          pipelineRunId: `pipeline-${suffix}`,
          queueJobId: jobId,
        },
      },
      createdAt: new Date().toISOString(),
    });
    const envelope = await createExecutionEnvelope(envelopeInput);
    const execution: ProviderExecution = {
      contractVersion: "1",
      identity: envelope.canonicalRequest.executionIdentity,
      metadata: {
        skillId: "AI-TEST",
        skillVersion: "1.0.0",
        contextVersions: {},
        outputSchemaId: envelope.canonicalRequest.outputSchema.schemaId,
        outputSchemaVersion:
          envelope.canonicalRequest.outputSchema.schemaVersion,
        correlationId,
        createdAt: new Date().toISOString(),
      },
      status: "PENDING",
      createdAt: new Date().toISOString(),
    };
    await new ProviderOutboxRepository().createExecutionWithJob({
      execution,
      requestHash: hash("b"),
      job: {
        jobId,
        executionId,
        payloadReference: envelope.payloadReference,
        correlationId,
        priority: 100_000,
        nextVisibleAt: new Date(Date.now() - 1_000),
      },
    });
    await new ExecutionEnvelopeRepository().createEnvelope(envelope);
    return { envelope, jobId };
  }

  it("persists one dispatch and derives the state transition without mutating Outbox", async () => {
    const { envelope, jobId } = await createIntent();
    const repository = new ExecutionDispatchRepository();
    const dispatcher = new ProviderExecutionDispatcher(
      repository,
      new ExecutionEnvelopeRepository()
    );
    const result = await dispatcher.dispatchNext();
    expect(result.status).toBe("DISPATCHED");
    if (result.status !== "DISPATCHED") throw new Error("expected dispatch");
    expect(await repository.getDispatch(result.dispatch.dispatchId)).toEqual(
      result.dispatch
    );
    expect(await repository.exists(jobId)).toBe(true);

    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${jobId}
    `;
    expect(job?.status).toBe("PENDING");
    expect(result.dispatch.envelopeId).toBe(envelope.envelopeId);

    await expect(repository.createDispatch(result.dispatch)).resolves.toEqual(
      result.dispatch
    );
    expect((await dispatcher.dispatchNext()).status).toBe("NO_JOB");
  });

  it("converges concurrent identical dispatch attempts on one immutable record", async () => {
    const { envelope, jobId } = await createIntent();
    const repository = new ExecutionDispatchRepository();
    const dispatch = await createExecutionDispatch({
      version: "1",
      jobId,
      executionId: envelope.executionContext.executionId,
      envelopeId: envelope.envelopeId,
      payloadReference: envelope.payloadReference,
      correlationId: envelope.executionContext.correlationId,
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      capabilityId: envelope.capabilityId,
      capabilityVersion: envelope.capabilityVersion,
      requestHash: envelope.requestHash,
      envelopeHash: envelope.envelopeHash,
      workerHandoff: {
        envelopeId: envelope.envelopeId,
        payloadReference: envelope.payloadReference,
        dispatchContractVersion: "1",
      },
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    const dispatches = await Promise.all([
      repository.createDispatch(dispatch),
      repository.createDispatch(dispatch),
    ]);
    expect(dispatches[0]).toEqual(dispatches[1]);
    expect(Object.isFrozen(dispatches[0])).toBe(true);

    const [count] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM provider_execution_dispatches
      WHERE job_id = ${jobId}
    `;
    expect(count?.count).toBe(1);
    expect(await repository.getDispatchByJobId(jobId)).toEqual(dispatches[0]);
  });

  it("executes Dispatcher -> Dispatch -> Worker -> Adapter without repository mutation", async () => {
    const { envelope, jobId } = await createIntent();
    const dispatchRepository = new ExecutionDispatchRepository();
    const envelopeRepository = new ExecutionEnvelopeRepository();
    const dispatched = await new ProviderExecutionDispatcher(
      dispatchRepository,
      envelopeRepository
    ).dispatchNext();
    expect(dispatched.status).toBe("DISPATCHED");
    if (dispatched.status !== "DISPATCHED") throw new Error("expected dispatch");

    const execute = vi.fn(
      async (
        request: typeof envelope.canonicalRequest,
        context: { providerAttemptId: string }
      ): Promise<CanonicalProviderResult> => ({
        contractVersion: "1",
        executionId: envelope.executionContext.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput: { ok: true },
        resultReference: `provider-result://${dispatched.dispatch.dispatchId}`,
        warnings: [],
        providerMetadata: {
          providerId: "provider-a",
          providerVersion: "provider-a-v1",
        },
        usage: {},
        cost: { amount: 0, currency: "USD", estimated: false },
        modelVersion: "model-a",
        requestHash: envelope.requestHash,
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
    const worker = new ProviderExecutionWorker({
      workerId: "canonical-worker",
      dispatches: dispatchRepository,
      envelopes: envelopeRepository,
      router: new CanonicalProviderRouter(adapters),
      adapters,
    });
    const dispatchSnapshot = structuredClone(dispatched.dispatch);
    const envelopeSnapshot = structuredClone(envelope);
    const outcome = await worker.execute(dispatched.dispatch.dispatchId);

    expect(outcome).toMatchObject({
      status: "DISPATCHED",
      dispatchId: dispatched.dispatch.dispatchId,
      envelopeId: envelope.envelopeId,
      providerId: "provider-a",
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual(envelope.canonicalRequest);
    expect(await dispatchRepository.getDispatch(dispatched.dispatch.dispatchId)).toEqual(
      dispatchSnapshot
    );
    expect(await envelopeRepository.getEnvelope(envelope.envelopeId)).toEqual(
      envelopeSnapshot
    );
    const [job] = await sql<{ status: string }[]>`
      SELECT status FROM provider_outbox_jobs WHERE job_id = ${jobId}
    `;
    expect(job?.status).toBe("PENDING");
  });
});
