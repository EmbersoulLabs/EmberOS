/**
 * Sprint 3 PR 3.2 — Scene Scheduling RLS policy integration tests.
 * Live DB only; skips unless RUN_DB_INTEGRATION_TESTS=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RuntimeAuthorizationPersistenceRepository,
  closeDb,
  type ScheduleAcceptedBundleInput,
} from "@ceo-agent/db";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
  isRlsEnabled,
  withAuthenticatedUser,
} from "./helpers/db-integration";
import {
  PHASE_2A_IDS,
  PHASE_2A_WORKSPACE_B_IDS,
} from "./helpers/ai-story-phase-2a";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  PR32_USER_B,
  captureScheduleAcceptedBundleInput,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) {
  throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
}
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

const SCHEDULING_TABLES = [
  "ai_story_runtime_authorized_facts",
  "ai_story_scene_routing_decisions",
  "ai_story_scene_scheduling_correlations",
] as const;

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

function isRlsViolation(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error);
  const code = String((error as { code?: string })?.code ?? "");
  return (
    /row-level security|violates row-level security|permission denied/i.test(
      message
    ) || code === "42501"
  );
}

async function expectRlsInsertRejected(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    expect.fail("expected PostgreSQL RLS to reject INSERT");
  } catch (error) {
    expect(isRlsViolation(error)).toBe(true);
  }
}

async function expectDeniedOrZero(fn: () => Promise<{ count: number }>): Promise<void> {
  try {
    const result = await fn();
    expect(result.count).toBe(0);
  } catch (error) {
    expect(isRlsViolation(error)).toBe(true);
  }
}

async function insertProviderTriplet(
  sql: Sql,
  input: ScheduleAcceptedBundleInput
): Promise<void> {
  const execution = input.providerExecution;
  const identity = execution.identity;
  const envelope = input.envelope;
  await sql`
    INSERT INTO provider_executions (
      execution_id, contract_version, org_id, workspace_id, campaign_id,
      pipeline_run_id, capability_id, capability_version, idempotency_key,
      deterministic_fingerprint, request_hash, output_schema_id,
      output_schema_version, status, execution_metadata, created_at
    ) VALUES (
      ${identity.executionId}, ${execution.contractVersion}, ${identity.tenantId},
      ${identity.workspaceId}, ${identity.campaignId ?? null},
      ${identity.pipelineRunId}, ${identity.capabilityId},
      ${identity.capabilityVersion}, ${identity.idempotencyKey},
      ${identity.deterministicFingerprint}, ${input.requestHash},
      ${execution.metadata.outputSchemaId}, ${execution.metadata.outputSchemaVersion},
      ${execution.status}, ${sql.json(execution.metadata)}, ${execution.createdAt}
    )
  `;
  await sql`
    INSERT INTO provider_execution_envelopes (
      envelope_id, version, payload_reference, org_id, workspace_id,
      execution_context, capability_id, capability_version,
      provider_policy_snapshot, canonical_request, request_hash,
      envelope_hash, created_at
    ) VALUES (
      ${envelope.envelopeId}, ${envelope.version}, ${envelope.payloadReference},
      ${envelope.tenantId}, ${envelope.workspaceId},
      ${sql.json(envelope.executionContext)}, ${envelope.capabilityId},
      ${envelope.capabilityVersion}, ${sql.json(envelope.providerPolicySnapshot)},
      ${sql.json(envelope.canonicalRequest)}, ${envelope.requestHash},
      ${envelope.envelopeHash}, ${envelope.createdAt}
    )
  `;
  await sql`
    INSERT INTO provider_outbox_jobs (
      job_id, contract_version, execution_id, payload_reference,
      correlation_id, priority, next_visible_at
    ) VALUES (
      ${input.outboxJob.jobId}, '1', ${input.outboxJob.executionId},
      ${input.outboxJob.payloadReference}, ${input.outboxJob.correlationId},
      ${input.outboxJob.priority ?? 0}, ${input.outboxJob.nextVisibleAt ?? new Date()}
    )
  `;
}

describeIntegration("Sprint 3 PR 3.2 scene scheduling RLS", () => {
  let sql: Sql;
  let planAId = "";
  let sceneAId = "";
  let sceneBId = "";
  let authAId = "";
  let authBId = "";
  let routingAId = "";
  let correlationAId = "";
  let capturedA2: ScheduleAcceptedBundleInput;
  let issuedFactA: Awaited<
    ReturnType<typeof prepareAuthorizedSchedulingPlan>
  >["issuedAuthorization"];

  beforeAll(async () => {
    sql = createIntegrationSql();
    for (const relative of [
      "../packages/db/sql/ai-story-scene-execution-persistence-v1.sql",
      "../packages/db/sql/ai-story-human-review-persistence-v1.sql",
      "../packages/db/sql/ai-story-assembly-definition-persistence-v1.sql",
      "../packages/db/sql/provider-ledger.sql",
      "../packages/db/sql/provider-outbox.sql",
      "../packages/db/sql/provider-execution-envelope.sql",
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }

    await cleanupPr32Tenant(sql, PHASE_2A_IDS);
    await cleanupPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS);
    await seedPr32Tenant(sql, PHASE_2A_IDS, PR32_USER_A, "pr32-rls-a");
    await seedPr32Tenant(
      sql,
      PHASE_2A_WORKSPACE_B_IDS,
      PR32_USER_B,
      "pr32-rls-b"
    );

    const preparedA = await prepareAuthorizedSchedulingPlan({
      purpose: "rls-a",
      ids: PHASE_2A_IDS,
      userId: PR32_USER_A,
    });
    const preparedB = await prepareAuthorizedSchedulingPlan({
      purpose: "rls-b",
      ids: PHASE_2A_WORKSPACE_B_IDS,
      userId: PR32_USER_B,
    });
    planAId = preparedA.executionPlanId;
    sceneAId = preparedA.sceneExecutionIds[0]!;
    sceneBId = preparedB.sceneExecutionIds[0]!;
    authAId = preparedA.acceptedAuthorization.runtimeAuthorizationId;
    authBId = preparedB.acceptedAuthorization.runtimeAuthorizationId;
    issuedFactA = preparedA.issuedAuthorization;

    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: preparedA.executionPlanId,
      sceneExecutionId: sceneAId,
      runtimeAuthorizationId: authAId,
      actorUserId: PR32_USER_A,
    });
    routingAId = scheduled.routingDecision.routingDecisionId;
    correlationAId = scheduled.correlation.correlationId;
    capturedA2 = await captureScheduleAcceptedBundleInput({
      executionPlanId: preparedA.executionPlanId,
      sceneExecutionId: preparedA.sceneExecutionIds[1]!,
      runtimeAuthorizationId: authAId,
      actorUserId: PR32_USER_A,
      router: new FixedSeedanceRouter({
        registrySnapshotHash:
          "sha256:3333333333333333333333333333333333333333333333333333333333333333",
      }),
    });
    await insertProviderTriplet(sql, capturedA2);
  }, 120_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql, PHASE_2A_IDS);
    await cleanupPr32Tenant(sql, PHASE_2A_WORKSPACE_B_IDS);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("enables RLS and SELECT/INSERT policies for the three scheduling tables", async () => {
    for (const table of SCHEDULING_TABLES) {
      expect(await isRlsEnabled(sql, table)).toBe(true);
    }

    const policies = await sql<{
      tablename: string;
      policyname: string;
      cmd: string;
    }[]>`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY(${SCHEDULING_TABLES as unknown as string[]})
      ORDER BY tablename, policyname
    `;

    for (const table of SCHEDULING_TABLES) {
      const rows = policies.filter((row) => row.tablename === table);
      expect(rows.some((row) => row.cmd === "SELECT")).toBe(true);
      expect(rows.some((row) => row.cmd === "INSERT")).toBe(true);
    }

    expect(policies.some((row) => row.cmd === "UPDATE")).toBe(false);
    expect(policies.some((row) => row.cmd === "DELETE")).toBe(false);
    expect(policies.some((row) => row.cmd === "ALL")).toBe(false);
  });

  it("authenticated UPDATE and DELETE are denied", async () => {
    await expectDeniedOrZero(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          UPDATE ai_story_scene_routing_decisions
          SET selected_provider_id = 'hacked'
          WHERE routing_decision_id = ${routingAId}
        `
      )
    );

    await expectDeniedOrZero(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          DELETE FROM ai_story_scene_scheduling_correlations
          WHERE correlation_id = ${correlationAId}
        `
      )
    );
  }, 60_000);

  it("cross-workspace scheduling INSERT is denied", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          INSERT INTO ai_story_scene_routing_decisions (
            routing_decision_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            scene_execution_id, runtime_authorization_id, capability_id,
            capability_version, selected_provider_id, selected_adapter_version,
            registry_snapshot_hash, capability_snapshot, policy_snapshot,
            candidate_summary, decided_at, deterministic_integrity_hash,
            automatic_fallback_enabled, contract_version, decision
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_WORKSPACE_B_IDS.orgId},
            ${PHASE_2A_WORKSPACE_B_IDS.workspaceId},
            ${PHASE_2A_WORKSPACE_B_IDS.campaignId},
            ${PHASE_2A_WORKSPACE_B_IDS.storyId},
            ${PHASE_2A_WORKSPACE_B_IDS.storyVersionId},
            ${PHASE_2A_WORKSPACE_B_IDS.animationPackageId},
            ${capturedA2.runtimeAuthorizedFact.executionPlanId},
            ${sceneBId},
            ${authBId},
            'animation-video-generation',
            '1.0.0',
            'seedance',
            '1.0.0',
            'sha256:4444444444444444444444444444444444444444444444444444444444444444',
            ${tx.json({})},
            ${tx.json({ policyVersion: '1.0.0', preferredProviders: [] })},
            ${tx.json([])},
            NOW(),
            'sha256:4555555555555555555555555555555555555555555555555555555555555555',
            FALSE,
            '1',
            ${tx.json({ attack: 'cross-workspace' })}
          )
        `
      )
    );
  }, 60_000);

  it("foreign Scene and foreign authorization INSERTs are denied", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          INSERT INTO ai_story_scene_routing_decisions (
            routing_decision_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            scene_execution_id, runtime_authorization_id, capability_id,
            capability_version, selected_provider_id, selected_adapter_version,
            registry_snapshot_hash, capability_snapshot, policy_snapshot,
            candidate_summary, decided_at, deterministic_integrity_hash,
            automatic_fallback_enabled, contract_version, decision
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId},
            ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId},
            ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId},
            ${PHASE_2A_IDS.animationPackageId},
            ${planAId},
            ${sceneBId},
            ${authAId},
            'animation-video-generation',
            '1.0.0',
            'seedance',
            '1.0.0',
            'sha256:5555555555555555555555555555555555555555555555555555555555555555',
            ${tx.json({})},
            ${tx.json({ policyVersion: '1.0.0', preferredProviders: [] })},
            ${tx.json([])},
            NOW(),
            'sha256:5666666666666666666666666666666666666666666666666666666666666666',
            FALSE,
            '1',
            ${tx.json({ attack: 'foreign-scene' })}
          )
        `
      )
    );

    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          INSERT INTO ai_story_scene_routing_decisions (
            routing_decision_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            scene_execution_id, runtime_authorization_id, capability_id,
            capability_version, selected_provider_id, selected_adapter_version,
            registry_snapshot_hash, capability_snapshot, policy_snapshot,
            candidate_summary, decided_at, deterministic_integrity_hash,
            automatic_fallback_enabled, contract_version, decision
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId},
            ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId},
            ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId},
            ${PHASE_2A_IDS.animationPackageId},
            ${planAId},
            ${sceneAId},
            ${authBId},
            'animation-video-generation',
            '1.0.0',
            'seedance',
            '1.0.0',
            'sha256:6666666666666666666666666666666666666666666666666666666666666666',
            ${tx.json({})},
            ${tx.json({ policyVersion: '1.0.0', preferredProviders: [] })},
            ${tx.json([])},
            NOW(),
            'sha256:6777777777777777777777777777777777777777777777777777777777777777',
            FALSE,
            '1',
            ${tx.json({ attack: 'foreign-auth' })}
          )
        `
      )
    );
  }, 60_000);

  it("foreign correlation INSERT is denied", async () => {
    await expectRlsInsertRejected(() =>
      withAuthenticatedUser(sql, PR32_USER_A, (tx) =>
        tx`
          INSERT INTO ai_story_scene_scheduling_correlations (
            correlation_id, org_id, workspace_id, campaign_id, story_id,
            story_version_id, animation_package_id, execution_plan_id,
            scene_execution_id, runtime_authorization_id, routing_decision_id,
            provider_execution_id, envelope_id, outbox_job_id, request_hash,
            envelope_hash, routing_decision_hash, authorization_hash,
            scheduling_identity_hash, contract_version, scheduled_by,
            scheduled_at, correlation
          ) VALUES (
            ${crypto.randomUUID()},
            ${PHASE_2A_IDS.orgId},
            ${PHASE_2A_IDS.workspaceId},
            ${PHASE_2A_IDS.campaignId},
            ${PHASE_2A_IDS.storyId},
            ${PHASE_2A_IDS.storyVersionId},
            ${PHASE_2A_IDS.animationPackageId},
            ${planAId},
            ${sceneBId},
            ${authAId},
            ${routingAId},
            ${capturedA2.providerExecution.identity.executionId},
            ${capturedA2.envelope.envelopeId},
            ${capturedA2.outboxJob.jobId},
            ${capturedA2.requestHash},
            ${capturedA2.envelope.envelopeHash},
            ${capturedA2.routingDecision.deterministicIntegrityHash},
            ${capturedA2.runtimeAuthorizedFact.deterministicIntegrityHash},
            'sha256:7777777777777777777777777777777777777777777777777777777777777777',
            '1',
            ${PR32_USER_A},
            NOW(),
            ${tx.json({ ...capturedA2.correlation, sceneExecutionId: sceneBId })}
          )
        `
      )
    );
  }, 60_000);

  it("service-role repository still validates ownership", async () => {
    await expect(
      new RuntimeAuthorizationPersistenceRepository().acceptOrReturn({
        ...issuedFactA,
        ownership: {
          ...issuedFactA.ownership,
          workspaceId: PHASE_2A_WORKSPACE_B_IDS.workspaceId,
        },
      })
    ).rejects.toMatchObject({ code: "OWNERSHIP_INTEGRITY_VIOLATION" });
  }, 60_000);
});
