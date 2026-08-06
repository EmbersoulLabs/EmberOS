import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  ProviderLedgerConflictError,
  ProviderLedgerRepository,
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

describeIntegration("PR-3A.5C.2 Provider Ledger", () => {
  let sql: Sql;
  let repository: ProviderLedgerRepository;
  const executionIds = new Set<string>();

  function execution(overrides: Partial<ProviderExecution> = {}): ProviderExecution {
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
        capabilityId: "video-understanding",
        capabilityVersion: "1.0.0",
        idempotencyKey: `provider-ledger:${executionId}`,
        deterministicFingerprint: hash("a"),
      },
      metadata: {
        skillId: "AI-001",
        skillVersion: "1.0.0",
        contextVersions: { CampaignAIContext: "1.0.0" },
        outputSchemaId: "VideoUnderstandingResult",
        outputSchemaVersion: "1.0.0",
        correlationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      },
      status: "PENDING",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function attempt(
    owner: ProviderExecution,
    attemptNumber = 1,
    overrides: Partial<ProviderAttempt> = {}
  ): ProviderAttempt {
    return {
      contractVersion: "1",
      attemptId: crypto.randomUUID(),
      executionId: owner.identity.executionId,
      attemptNumber,
      providerId: "provider-a",
      providerVersion: "2026-01",
      modelVersion: "model-1",
      providerRequestId: crypto.randomUUID(),
      requestHash: hash("b"),
      responseHash: hash("c"),
      status: "SUCCEEDED",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function result(
    owner: ProviderExecution,
    providerAttempt: ProviderAttempt,
    overrides: Partial<CanonicalProviderResult> = {}
  ): CanonicalProviderResult {
    return {
      contractVersion: "1",
      executionId: owner.identity.executionId,
      providerAttemptId: providerAttempt.attemptId,
      normalizedOutput: { summary: "canonical" },
      resultReference: `provider-result://${owner.identity.executionId}`,
      warnings: [],
      providerMetadata: {
        providerId: providerAttempt.providerId,
        providerVersion: providerAttempt.providerVersion,
        providerRequestId: providerAttempt.providerRequestId,
      },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: { amount: 0.01, currency: "USD", estimated: false },
      modelVersion: providerAttempt.modelVersion,
      requestHash: providerAttempt.requestHash,
      responseHash: providerAttempt.responseHash!,
      retryable: false,
      validationStatus: "VALID",
      ...overrides,
    };
  }

  beforeAll(() => {
    sql = createIntegrationSql();
    repository = new ProviderLedgerRepository();
  });

  afterAll(async () => {
    const ids = [...executionIds];
    if (ids.length > 0) {
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

  it("creates an execution and reuses the same immutable identity", async () => {
    const value = execution();
    const created = await repository.createExecution(value, hash("b"));
    const reused = await repository.createExecution(value, hash("b"));

    expect(created).toEqual(reused);
    await expect(
      repository.createExecution(
        {
          ...value,
          identity: { ...value.identity, deterministicFingerprint: hash("d") },
        },
        hash("b")
      )
    ).rejects.toBeInstanceOf(ProviderLedgerConflictError);
  });

  it("keeps attempts append-only and ordered under one logical execution", async () => {
    const value = execution();
    await repository.createExecution(value, hash("b"));
    const first = attempt(value, 1);
    const second = attempt(value, 2, { status: "RETRYABLE_FAILURE", responseHash: undefined });
    await repository.appendAttempt({ attempt: first });
    await repository.appendAttempt({
      attempt: second,
      warnings: [{ code: "RATE_LIMIT", message: "Retry later", retryable: true }],
    });

    const ledger = await repository.findExecution(value.identity.executionId);
    expect(ledger?.attempts.map((entry) => entry.attempt.attemptNumber)).toEqual([1, 2]);
    await expect(
      repository.appendAttempt({
        attempt: { ...first, modelVersion: "different-model" },
      })
    ).rejects.toBeInstanceOf(ProviderLedgerConflictError);
  });

  it("records usage and cost once and rejects conflicting facts", async () => {
    const value = execution();
    await repository.createExecution(value, hash("b"));
    const providerAttempt = attempt(value);
    await repository.appendAttempt({ attempt: providerAttempt });

    await repository.recordUsage(providerAttempt.attemptId, {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
    await repository.recordCost(providerAttempt.attemptId, {
      amount: 0.01,
      currency: "USD",
      estimated: false,
    });
    await expect(
      repository.recordUsage(providerAttempt.attemptId, { totalTokens: 999 })
    ).rejects.toBeInstanceOf(ProviderLedgerConflictError);
    await expect(
      repository.recordCost(providerAttempt.attemptId, {
        amount: 1,
        currency: "USD",
        estimated: false,
      })
    ).rejects.toBeInstanceOf(ProviderLedgerConflictError);

    const ledger = await repository.findExecution(value.identity.executionId);
    expect(ledger?.attempts[0]?.usage?.totalTokens).toBe(15);
    expect(ledger?.attempts[0]?.cost?.amount).toBe(0.01);
  });

  it("reuses identical acceptance and rejects a conflicting result", async () => {
    const value = execution();
    await repository.createExecution(value, hash("b"));
    const providerAttempt = attempt(value);
    await repository.appendAttempt({ attempt: providerAttempt });
    const canonical = result(value, providerAttempt);

    expect(await repository.acceptResult(canonical)).toEqual(canonical);
    expect(await repository.acceptResult(canonical)).toEqual(canonical);
    await expect(
      repository.acceptResult({
        ...canonical,
        responseHash: hash("d"),
        normalizedOutput: { summary: "conflict" },
      })
    ).rejects.toBeInstanceOf(ProviderLedgerConflictError);
    expect(await repository.findAcceptedResult(value.identity.executionId)).toEqual(canonical);
  });

  it("serializes concurrent identical acceptance into one canonical result", async () => {
    const value = execution();
    await repository.createExecution(value, hash("b"));
    const providerAttempt = attempt(value);
    await repository.appendAttempt({ attempt: providerAttempt });
    const canonical = result(value, providerAttempt);

    const accepted = await Promise.all([
      repository.acceptResult(canonical),
      repository.acceptResult(canonical),
    ]);
    expect(accepted).toEqual([canonical, canonical]);

    const [row] = await sql<{ accepted_attempt_id: string; accepted_response_hash: string }[]>`
      SELECT accepted_attempt_id, accepted_response_hash
      FROM provider_executions
      WHERE execution_id = ${value.identity.executionId}
    `;
    expect(row).toEqual({
      accepted_attempt_id: providerAttempt.attemptId,
      accepted_response_hash: canonical.responseHash,
    });
  });

  it("accepts only one of two concurrent conflicting results", async () => {
    const value = execution();
    await repository.createExecution(value, hash("b"));
    const firstAttempt = attempt(value, 1);
    const secondAttempt = attempt(value, 2, {
      responseHash: hash("d"),
      providerRequestId: crypto.randomUUID(),
    });
    await repository.appendAttempt({ attempt: firstAttempt });
    await repository.appendAttempt({ attempt: secondAttempt });

    const settled = await Promise.allSettled([
      repository.acceptResult(result(value, firstAttempt)),
      repository.acceptResult(
        result(value, secondAttempt, {
          normalizedOutput: { summary: "different" },
          resultReference: `provider-result://${value.identity.executionId}/different`,
        })
      ),
    ]);
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(await repository.findAcceptedResult(value.identity.executionId)).not.toBeNull();
  });
});
