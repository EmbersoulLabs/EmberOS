/**
 * Sprint 3 PR 3.3 — Worker runtime live DB integration.
 * Live DB only; skips unless RUN_DB_INTEGRATION_TESTS=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import {
  SceneSchedulingCoordinator,
} from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  createPr33TestAdapterRegistry,
} from "../packages/agents/src/ai-story/canonical-provider-test-adapters";
import {
  SceneProviderWorkerRuntime,
} from "../packages/agents/src/ai-story/scene-provider-worker-runtime";
import {
  SceneProviderWorkerRuntimeRepository,
  closeDb,
  ExecutionEnvelopeRepository,
} from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { applyPhaseECommercialAuthorizationSql } from "./helpers/commercial-phase-e-sql";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

async function applySqlFile(sql: Sql, relative: string): Promise<void> {
  const migration = readFileSync(resolve(__dirname, relative), "utf8");
  for (const statement of migration
    .split(";")
    .map((part) =>
      part
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
}

describeIntegration("Sprint 3 PR 3.3 worker runtime integration", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/provider-ledger.sql",
      "../packages/db/sql/provider-outbox.sql",
      "../packages/db/sql/provider-execution-envelope.sql",
      "../packages/db/sql/provider-execution-dispatch.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
      "../packages/db/sql/ai-story-worker-runtime-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await applyPhaseECommercialAuthorizationSql(sql);
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql, undefined, PR32_USER_A, "pr33-worker");
  }, 120_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("validates accepted Dispatch bundle and produces Worker result without Finalizer writes", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "pr33-worker",
    });
    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });

    expect(scheduled.routingDecision.routerVersion).toBe(1);

    const envelope = await new ExecutionEnvelopeRepository().getEnvelope(
      scheduled.envelopeId
    );
    expect(envelope).toBeTruthy();

    const dispatch = await createExecutionDispatch({
      version: "1",
      dispatchId: `dispatch:${scheduled.outboxJobId}`,
      jobId: scheduled.outboxJobId,
      executionId: scheduled.providerExecutionId,
      envelopeId: scheduled.envelopeId,
      payloadReference: scheduled.payloadReference,
      correlationId: scheduled.correlation.correlationId,
      tenantId: scheduled.correlation.ownership.orgId,
      workspaceId: scheduled.correlation.ownership.workspaceId,
      capabilityId: scheduled.routingDecision.capabilityId,
      capabilityVersion: scheduled.routingDecision.capabilityVersion,
      requestHash: scheduled.requestHash,
      envelopeHash: scheduled.envelopeHash,
      workerHandoff: {
        envelopeId: scheduled.envelopeId,
        payloadReference: scheduled.payloadReference,
        dispatchContractVersion: "1",
      },
      status: "DISPATCHED",
      createdAt: scheduled.correlation.scheduledAt,
    });

    await sql`
      INSERT INTO provider_execution_dispatches (
        dispatch_id, version, job_id, execution_id, envelope_id,
        payload_reference, correlation_id, org_id, workspace_id,
        capability_id, capability_version, request_hash, envelope_hash,
        worker_handoff, dispatch_hash, status, created_at
      ) VALUES (
        ${dispatch.dispatchId},
        ${dispatch.version},
        ${dispatch.jobId},
        ${dispatch.executionId},
        ${dispatch.envelopeId},
        ${dispatch.payloadReference},
        ${dispatch.correlationId},
        ${dispatch.tenantId},
        ${dispatch.workspaceId},
        ${dispatch.capabilityId},
        ${dispatch.capabilityVersion},
        ${dispatch.requestHash},
        ${dispatch.envelopeHash},
        ${sql.json(dispatch.workerHandoff)},
        ${dispatch.dispatchHash},
        ${dispatch.status},
        ${dispatch.createdAt}
      )
    `;

    const repository = new SceneProviderWorkerRuntimeRepository();
    const worker = new SceneProviderWorkerRuntime({
      repository,
      adapters: createPr33TestAdapterRegistry("accepted_async"),
    });

    const first = await worker.processDispatch({
      dispatchId: dispatch.dispatchId,
    });
    expect(first.result.providerId).toBe("seedance");
    expect(first.result.routerVersion).toBe(1);
    expect(first.finalizerInvoked).toBe(false);
    expect(first.usageWritten).toBe(false);
    expect(first.costWritten).toBe(false);
    expect(first.sceneResultWritten).toBe(false);

    const second = await worker.processDispatch({
      dispatchId: dispatch.dispatchId,
    });
    expect(second.replayed).toBe(true);
    expect(second.result.workerExecutionResultId).toBe(
      first.result.workerExecutionResultId
    );

    const usage = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_usage
    `;
    const costs = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM provider_attempt_costs
    `;
    expect(usage[0]?.count).toBe(0);
    expect(costs[0]?.count).toBe(0);
  }, 180_000);

  it("blocks Adapter when scheduling correlation is missing", async () => {
    const repository = new SceneProviderWorkerRuntimeRepository();
    await expect(
      repository.loadValidatedBundleByDispatchId("missing-dispatch-pr33")
    ).resolves.toBeNull();
  }, 60_000);
});
