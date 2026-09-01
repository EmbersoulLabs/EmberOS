/**
 * Sprint 3 PR 3.2 — Scene Scheduling integration tests.
 * Live DB only; skips unless RUN_DB_INTEGRATION_TESTS=1.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  PHASE1_EXECUTION_LOCKED,
  isSceneSchedulingBundleComplete,
} from "@ceo-agent/shared";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import {
  RuntimeAuthorizationPersistenceRepository,
  SceneSchedulingRepository,
  closeDb,
  type ScheduleAcceptedBundleInput,
} from "@ceo-agent/db";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { PHASE_2A_IDS } from "./helpers/ai-story-phase-2a";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
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

async function insertRoutingDecision(
  sql: Sql,
  input: ScheduleAcceptedBundleInput
): Promise<void> {
  const decision = input.routingDecision;
  await sql`
    INSERT INTO ai_story_scene_routing_decisions (
      routing_decision_id, org_id, workspace_id, campaign_id, story_id,
      story_version_id, animation_package_id, execution_plan_id,
      scene_execution_id, runtime_authorization_id, capability_id,
      capability_version, selected_provider_id, selected_adapter_version,
      router_version, registry_snapshot_hash, capability_snapshot, policy_snapshot,
      candidate_summary, decided_at, deterministic_integrity_hash,
      automatic_fallback_enabled, contract_version, decision
    ) VALUES (
      ${decision.routingDecisionId},
      ${decision.ownership.orgId},
      ${decision.ownership.workspaceId},
      ${decision.ownership.campaignId},
      ${decision.ownership.storyId},
      ${decision.ownership.storyVersionId},
      ${decision.ownership.animationPackageId},
      ${decision.executionPlanId},
      ${decision.sceneExecutionId},
      ${decision.runtimeAuthorizationId},
      ${decision.capabilityId},
      ${decision.capabilityVersion},
      ${decision.selectedProviderId},
      ${decision.selectedAdapterVersion},
      ${decision.routerVersion},
      ${decision.registrySnapshotHash},
      ${sql.json(decision.capabilitySnapshot)},
      ${sql.json(decision.policySnapshot)},
      ${sql.json(decision.candidateSummary)},
      ${decision.decidedAt},
      ${decision.deterministicIntegrityHash},
      ${decision.automaticFallbackEnabled},
      ${decision.contractVersion},
      ${sql.json(decision)}
    )
  `;
}

describeIntegration("Sprint 3 PR 3.2 scene scheduling integration", () => {
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
      "../packages/db/sql/ai-story-scene-scheduling-v1.sql",
      "../packages/db/sql/ai-story-scene-routing-router-version-v1.sql",
      "../packages/db/sql/ai-story-scene-scheduling-rls-v1.sql",
      "../packages/db/sql/ai-story-staged-release-v1.sql",
      "../packages/db/sql/commercial-persistence-v1.sql",
      "../packages/db/sql/credits-settlement-v1.sql",
      "../packages/db/sql/commercial-authorization-v1.sql",
    ]) {
      await applySqlFile(sql, relative);
    }
    await cleanupPr32Tenant(sql);
    await seedPr32Tenant(sql);
  }, 120_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("applies scene scheduling schema with uniqueness constraints", async () => {
    for (const table of SCHEDULING_TABLES) {
      const rows = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${table}
        ) AS exists
      `;
      expect(rows[0]?.exists).toBe(true);
    }

    const constraints = await sql<{ conname: string }[]>`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = ANY(${SCHEDULING_TABLES as unknown as string[]})
        AND c.contype = 'u'
      ORDER BY c.conname
    `;
    const names = constraints.map((row) => row.conname);
    expect(names).toContain("ai_story_runtime_auth_plan_unique");
    expect(names).toContain("ai_story_runtime_auth_hash_unique");
    expect(names).toContain("ai_story_scene_routing_scene_unique");
    expect(names).toContain("ai_story_scene_routing_hash_unique");
    expect(names).toContain("ai_story_scene_scheduling_scene_unique");
    expect(names).toContain("ai_story_scene_scheduling_provider_unique");
    expect(names).toContain("ai_story_scene_scheduling_outbox_unique");
    expect(names).toContain("ai_story_scene_scheduling_identity_unique");
  });

  it("exposes RLS policies for the three scheduling tables", async () => {
    const policies = await sql<{ tablename: string; policyname: string; cmd: string }[]>`
      SELECT tablename, policyname, cmd
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = ANY(${SCHEDULING_TABLES as unknown as string[]})
      ORDER BY tablename, policyname
    `;
    const byTable = Object.fromEntries(
      SCHEDULING_TABLES.map((table) => [
        table,
        policies.filter((row) => row.tablename === table),
      ])
    ) as Record<(typeof SCHEDULING_TABLES)[number], typeof policies>;

    expect(byTable.ai_story_runtime_authorized_facts.length).toBeGreaterThanOrEqual(2);
    expect(byTable.ai_story_scene_routing_decisions.length).toBeGreaterThanOrEqual(2);
    expect(byTable.ai_story_scene_scheduling_correlations.length).toBeGreaterThanOrEqual(2);
    expect(policies.every((row) => row.cmd === "SELECT" || row.cmd === "INSERT")).toBe(
      true
    );
    expect(policies.some((row) => row.cmd === "UPDATE" || row.cmd === "DELETE")).toBe(
      false
    );
  });

  it("persists auth, routing, provider execution, envelope, outbox, and correlation", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "persist-six",
    });
    const sceneExecutionId = prepared.sceneExecutionIds[0]!;
    const router = new FixedSeedanceRouter();
    const bundle = await new SceneSchedulingCoordinator({
      router,
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });

    expect(router.routeCount).toBe(1);
    expect(bundle.replayed).toBe(false);
    expect(bundle.executionAllowed).toBe(false);
    expect(bundle.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(bundle.automaticFallbackEnabled).toBe(false);
    expect(bundle.routingDecision.selectedProviderId).toBe("seedance");
    expect(bundle.correlation.commercialAuthorizationId).toBe(
      prepared.commercialAuthorizationId
    );

    const counts = await sql<{
      auth_count: number;
      routing_count: number;
      provider_count: number;
      envelope_count: number;
      outbox_count: number;
      correlation_count: number;
    }[]>`
      SELECT
        (SELECT count(*)::int FROM ai_story_runtime_authorized_facts
          WHERE runtime_authorization_id = ${bundle.runtimeAuthorization.runtimeAuthorizationId}) AS auth_count,
        (SELECT count(*)::int FROM ai_story_scene_routing_decisions
          WHERE scene_execution_id = ${sceneExecutionId}) AS routing_count,
        (SELECT count(*)::int FROM provider_executions
          WHERE execution_id = ${bundle.providerExecutionId}) AS provider_count,
        (SELECT count(*)::int FROM provider_execution_envelopes
          WHERE envelope_id = ${bundle.envelopeId}) AS envelope_count,
        (SELECT count(*)::int FROM provider_outbox_jobs
          WHERE job_id = ${bundle.outboxJobId}) AS outbox_count,
        (SELECT count(*)::int FROM ai_story_scene_scheduling_correlations
          WHERE scene_execution_id = ${sceneExecutionId}) AS correlation_count
    `;
    expect(counts[0]).toEqual({
      auth_count: 1,
      routing_count: 1,
      provider_count: 1,
      envelope_count: 1,
      outbox_count: 1,
      correlation_count: 1,
    });
    expect(
      isSceneSchedulingBundleComplete({
        hasRuntimeAuthorization: counts[0]!.auth_count === 1,
        hasRoutingDecision: counts[0]!.routing_count === 1,
        hasProviderExecution: counts[0]!.provider_count === 1,
        hasEnvelope: counts[0]!.envelope_count === 1,
        hasOutboxJob: counts[0]!.outbox_count === 1,
        hasCorrelation: counts[0]!.correlation_count === 1,
      })
    ).toBe(true);

    const replayed =
      await new SceneSchedulingRepository().getAcceptedBundleBySceneExecutionId(
        sceneExecutionId
      );
    expect(replayed?.replayed).toBe(true);
    expect(replayed?.providerExecutionId).toBe(bundle.providerExecutionId);
    expect(replayed?.correlation.commercialAuthorizationId).toBe(
      prepared.commercialAuthorizationId
    );
  }, 120_000);

  it("equivalent schedule replay converges without rerouting", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "replay",
    });
    const router = new FixedSeedanceRouter();
    const coordinator = new SceneSchedulingCoordinator({ router });
    const request = {
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    };

    const first = await coordinator.scheduleAuthorizedScene(request);
    const second = await coordinator.scheduleAuthorizedScene(request);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.providerExecutionId).toBe(first.providerExecutionId);
    expect(second.envelopeId).toBe(first.envelopeId);
    expect(second.outboxJobId).toBe(first.outboxJobId);
    expect(router.routeCount).toBe(1);
  }, 120_000);

  it("parallel identical schedules converge to one accepted bundle", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "parallel",
    });
    const sceneExecutionId = prepared.sceneExecutionIds[0]!;
    const router = new FixedSeedanceRouter();
    const coordinator = new SceneSchedulingCoordinator({ router });

    const bundles = await Promise.all(
      Array.from({ length: 5 }, () =>
        coordinator.scheduleAuthorizedScene({
          executionPlanId: prepared.executionPlanId,
          sceneExecutionId,
          runtimeAuthorizationId:
            prepared.acceptedAuthorization.runtimeAuthorizationId,
          commercialAuthorizationId: prepared.commercialAuthorizationId,
          actorUserId: PR32_USER_A,
        })
      )
    );
    expect(new Set(bundles.map((bundle) => bundle.providerExecutionId)).size).toBe(1);
    expect(new Set(bundles.map((bundle) => bundle.envelopeId)).size).toBe(1);
    expect(new Set(bundles.map((bundle) => bundle.outboxJobId)).size).toBe(1);

    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM ai_story_scene_scheduling_correlations
      WHERE scene_execution_id = ${sceneExecutionId}
    `;
    expect(rows[0]?.count).toBe(1);
  }, 120_000);

  it("conflicting persisted routing decision fails closed", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "routing-conflict",
    });
    const sceneExecutionId = prepared.sceneExecutionIds[0]!;
    const captured = await captureScheduleAcceptedBundleInput({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      router: new FixedSeedanceRouter({
        registrySnapshotHash:
          "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      }),
    });
    await insertRoutingDecision(sql, captured);

    await expect(
      new SceneSchedulingCoordinator({
        router: new FixedSeedanceRouter({
          registrySnapshotHash:
            "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        }),
      }).scheduleAuthorizedScene({
        executionPlanId: prepared.executionPlanId,
        sceneExecutionId,
        runtimeAuthorizationId:
          prepared.acceptedAuthorization.runtimeAuthorizationId,
        commercialAuthorizationId: prepared.commercialAuthorizationId,
        actorUserId: PR32_USER_A,
      })
    ).rejects.toMatchObject({ code: "ROUTING_DECISION_CONFLICT" });
  }, 120_000);

  it("requires persisted runtime authorization", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "missing-auth",
      persistAuthorization: false,
    });

    await expect(
      new SceneSchedulingCoordinator({
        router: new FixedSeedanceRouter(),
      }).scheduleAuthorizedScene({
        executionPlanId: prepared.executionPlanId,
        sceneExecutionId: prepared.sceneExecutionIds[0]!,
        runtimeAuthorizationId:
          prepared.issuedAuthorization.runtimeAuthorizationId,
        commercialAuthorizationId: prepared.commercialAuthorizationId,
        actorUserId: PR32_USER_A,
      })
    ).rejects.toMatchObject({ code: "RUNTIME_AUTHORIZATION_REQUIRED" });
  }, 120_000);

  it("converges equivalent RuntimeAuthorizedFact and rejects hash conflict", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "auth-converge",
    });
    const authRepo = new RuntimeAuthorizationPersistenceRepository();
    const first = prepared.acceptedAuthorization;

    const replay = await authRepo.acceptOrReturn(first);
    expect(replay.converged).toBe(true);
    expect(replay.fact.runtimeAuthorizationId).toBe(first.runtimeAuthorizationId);
    expect(replay.fact.deterministicIntegrityHash).toBe(
      first.deterministicIntegrityHash
    );

    const rows = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM ai_story_runtime_authorized_facts
      WHERE execution_plan_id = ${prepared.executionPlanId}
    `;
    expect(rows[0]?.count).toBe(1);

    await expect(
      authRepo.acceptOrReturn({
        ...first,
        deterministicIntegrityHash:
          "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      })
    ).rejects.toMatchObject({ code: "RUNTIME_AUTHORIZATION_CONFLICT" });
  }, 120_000);

  it("keeps execution locked with fallback disabled", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "locked-flags",
    });
    const bundle = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId:
        prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });

    expect(bundle.executionAllowed).toBe(false);
    expect(bundle.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(bundle.automaticFallbackEnabled).toBe(false);
    expect(bundle.routingDecision.automaticFallbackEnabled).toBe(false);
    expect(PHASE_2A_IDS.workspaceId).toBeTruthy();
  }, 120_000);
});
