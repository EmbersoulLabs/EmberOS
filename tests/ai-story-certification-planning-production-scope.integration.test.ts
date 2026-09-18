import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "../packages/shared/node_modules/zod";
import type { Sql } from "postgres";
import { closeDb, CertificationCommercialAuthorityService, CertificationPlanningAuthorityService, CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS } from "@ceo-agent/db";
import { createIntegrationSql, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant, PR32_USER_A, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";
import { blockedExternalNetworkAttempts, installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";
import { callJsonModel, callStructuredJsonModel, withCertificationPlanningContext, type CertificationPlanningModelAdapter } from "../packages/agents/src/llm";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("CERTIFICATION_POSTGRES_REQUIRED_IN_CI");
}
const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const migration = readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-certification-planning-production-scope-v1.sql"), "utf8");

describeIntegration("certification planning and Production scope PostgreSQL authority", () => {
  let sql: Sql;
  let restoreNetwork: () => void;
  const ids: Phase2aIdSet = {
    orgId: randomUUID(), workspaceId: randomUUID(), campaignId: randomUUID(), storyId: randomUUID(),
    storyVersionId: randomUUID(), animationPackageId: randomUUID(), assetId: randomUUID(),
  };

  beforeAll(async () => {
    restoreNetwork = installCertificationNetworkIsolation();
    sql = createIntegrationSql();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "planning-budget");
  }, 120_000);
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from certification_planning_claims where planning_authority_id in (select planning_authority_id from certification_planning_authorities where org_id=${ids.orgId}::uuid)`;
    await sql`delete from certification_planning_authorities where org_id=${ids.orgId}::uuid`;
    await cleanupPr32Tenant(sql, ids);
    await sql.end();
    await closeDb();
    restoreNetwork?.();
  }, 120_000);

  type PredecessorVariant = "modeled" | "live" | "missing" | "wrong-definition" | "duplicate" | "conflict" | "wrong-name";
  async function withPredecessorSchema(variant: PredecessorVariant, check: (testSchema: string) => Promise<void>) {
    const testSchema = `cert_planning_upgrade_${randomUUID().replaceAll("-", "")}`;
    const commercialCheck = variant === "missing" ? ""
      : variant === "live" ? "constraint certification_commercial_scopes_environment_check check(environment='STAGING'),"
      : variant === "wrong-name" ? "constraint unexpected_commercial_environment_check check(environment='STAGING'),"
      : variant === "wrong-definition" ? "constraint certification_commercial_scope_environment_check check(environment in ('STAGING','PRODUCTION')) ,"
      : variant === "duplicate" ? "constraint certification_commercial_scope_environment_check check(environment='STAGING'), constraint certification_commercial_scopes_environment_check check(environment='STAGING'),"
      : variant === "conflict" ? "constraint certification_commercial_scope_environment_check check(environment='STAGING'), constraint another_environment_check check(environment is not null),"
      : "constraint certification_commercial_scope_environment_check check(environment='STAGING'),";
    const reconciliationCheck = variant === "live"
      ? "certification_submission_slot_reconciliations_environment_check"
      : "certification_slot_reconciliation_environment_check";
    await sql.unsafe(`
      create schema ${testSchema};
      set search_path to ${testSchema}, public;
      create table certification_commercial_scopes (
        certification_scope_id uuid primary key, environment text not null,
        org_id uuid not null, workspace_id uuid not null, capability_key text not null,
        max_provider_cost_usd numeric(12,2) not null, max_provider_submissions int not null,
        spent_provider_cost_usd numeric(12,2) not null, consumed_provider_submissions int not null,
        constraint certification_commercial_scope_identity_unique unique(environment,org_id,workspace_id,capability_key),
        ${commercialCheck}
        constraint certification_commercial_scope_cost_check check(max_provider_cost_usd > 0)
      );
      create table certification_commercial_reservations (
        certification_reservation_id uuid primary key, certification_scope_id uuid not null references certification_commercial_scopes(certification_scope_id), evidence jsonb not null
      );
      create table certification_submission_slot_reconciliations (
        reconciliation_id uuid primary key, certification_scope_id uuid not null references certification_commercial_scopes(certification_scope_id), environment text not null,
        constraint ${reconciliationCheck} check(environment='STAGING')
      );
      create table ai_story_post_terminal_provider_retry_authorizations (
        authorization_id uuid primary key, environment text not null, evidence jsonb not null,
        constraint ai_story_post_terminal_retry_environment_check check(environment='STAGING')
      );
    `);
    try {
      await sql.unsafe(`set search_path to ${testSchema}, public`);
      await check(testSchema);
    } finally {
      // A deliberately rejected BEGIN-wrapped migration leaves this connection
      // in an aborted transaction until ROLLBACK. A successful COMMIT makes
      // this a harmless no-op before the isolated schema is dropped.
      await sql.unsafe("ROLLBACK");
      await sql.unsafe(`set search_path to public; drop schema ${testSchema} cascade`);
    }
  }

  async function certifyUpgrade(variant: "modeled" | "live") {
    await withPredecessorSchema(variant, async (testSchema) => {
      const oldScope = randomUUID();
      const oldReservation = randomUUID();
      const oldReconciliation = randomUUID();
      const oldRetry = randomUUID();
      await sql`insert into certification_commercial_scopes values (${oldScope}::uuid,'STAGING',${ids.orgId}::uuid,${ids.workspaceId}::uuid,'ai_story.execute',5.00,4,1.07,4)`;
      await sql`insert into certification_commercial_reservations values (${oldReservation}::uuid,${oldScope}::uuid,${sql.json({ historical: true })})`;
      await sql`insert into certification_submission_slot_reconciliations values (${oldReconciliation}::uuid,${oldScope}::uuid,'STAGING')`;
      await sql`insert into ai_story_post_terminal_provider_retry_authorizations values (${oldRetry}::uuid,'STAGING',${sql.json({ historical: true })})`;
      const before = await sql`select * from certification_commercial_scopes where certification_scope_id=${oldScope}::uuid`;
      expect(await sql`select count(*)::int as count from certification_commercial_scopes where environment='PRODUCTION'`).toEqual([{ count: 0 }]);
      await sql.unsafe(migration);
      const after = await sql`select * from certification_commercial_scopes where certification_scope_id=${oldScope}::uuid`;
      expect(after).toEqual(before);
      expect(await sql`select evidence from certification_commercial_reservations where certification_reservation_id=${oldReservation}::uuid`).toEqual([{ evidence: { historical: true } }]);
      expect(await sql`select environment from certification_submission_slot_reconciliations where reconciliation_id=${oldReconciliation}::uuid`).toEqual([{ environment: "STAGING" }]);
      expect(await sql`select environment,evidence from ai_story_post_terminal_provider_retry_authorizations where authorization_id=${oldRetry}::uuid`).toEqual([{ environment: "STAGING", evidence: { historical: true } }]);
      const prodScope = randomUUID();
      await sql`insert into certification_commercial_scopes values (${prodScope}::uuid,'PRODUCTION',${ids.orgId}::uuid,${ids.workspaceId}::uuid,'ai_story.execute',5.00,3,0,0)`;
      expect(await sql`select environment,max_provider_submissions from certification_commercial_scopes order by environment`).toEqual([
        { environment: "PRODUCTION", max_provider_submissions: 3 },
        { environment: "STAGING", max_provider_submissions: 4 },
      ]);
      const tables = await sql`select to_regclass(${`${testSchema}.certification_planning_authorities`})::text as authority, to_regclass(${`${testSchema}.certification_planning_claims`})::text as claims`;
      expect(tables[0]?.authority).toBeTruthy();
      expect(tables[0]?.claims).toBeTruthy();
      const checks = await sql`
        select relation.relname as table_name, constraint_record.conname as constraint_name,
               pg_get_constraintdef(constraint_record.oid) as definition
        from pg_constraint as constraint_record
        join pg_class as relation on relation.oid=constraint_record.conrelid
        join pg_namespace as namespace on namespace.oid=relation.relnamespace
        where namespace.nspname=${testSchema} and constraint_record.contype='c'
          and relation.relname in ('certification_commercial_scopes','certification_submission_slot_reconciliations','ai_story_post_terminal_provider_retry_authorizations')
          and pg_get_constraintdef(constraint_record.oid) like '%environment%'
        order by relation.relname`;
      expect(checks).toHaveLength(3);
      expect(checks.map((row) => row.constraint_name)).toEqual([
        "ai_story_post_terminal_retry_environment_check",
        "certification_commercial_scope_environment_check",
        "certification_slot_reconciliation_environment_check",
      ]);
      expect(checks.every((row) => row.definition.includes("STAGING") && row.definition.includes("PRODUCTION"))).toBe(true);
      const planningCatalog = await sql`
        select relation.relname as table_name, relation.relrowsecurity as rls_enabled
        from pg_class as relation join pg_namespace as namespace on namespace.oid=relation.relnamespace
        where namespace.nspname=${testSchema} and relation.relname in ('certification_planning_authorities','certification_planning_claims')
        order by relation.relname`;
      expect(planningCatalog).toEqual([
        { table_name: "certification_planning_authorities", rls_enabled: true },
        { table_name: "certification_planning_claims", rls_enabled: true },
      ]);
      const indexes = await sql`select indexname from pg_indexes where schemaname=${testSchema} and tablename='certification_planning_claims'`;
      expect(indexes.map((row) => row.indexname)).toEqual(expect.arrayContaining([
        "certification_planning_claims_authority_status_idx",
        "certification_planning_provider_attempt_unique",
        "certification_planning_logical_call_unique",
      ]));
    });
  }

  it("upgrades the modeled predecessor and preserves historical commercial evidence", async () => {
    await certifyUpgrade("modeled");
  }, 120_000);

  it("upgrades the exact live STAGING predecessor names and preserves historical commercial evidence", async () => {
    await certifyUpgrade("live");
  }, 120_000);

  it.each(["missing", "wrong-name", "wrong-definition", "duplicate", "conflict"] as const)(
    "rejects %s environment predecessor divergence without partial schema changes",
    async (variant) => {
      await withPredecessorSchema(variant, async (testSchema) => {
        await expect(sql.unsafe(migration)).rejects.toThrow("CERTIFICATION_ENVIRONMENT_PREDECESSOR_INVALID");
        await sql.unsafe("ROLLBACK");
        expect(await sql`select to_regclass(${`${testSchema}.certification_planning_authorities`}) as authority,
                                to_regclass(${`${testSchema}.certification_planning_claims`}) as claims`).toEqual([
          { authority: null, claims: null },
        ]);
        expect(await sql`select count(*)::int as count from certification_commercial_scopes where environment='PRODUCTION'`).toEqual([{ count: 0 }]);
      });
    },
    120_000,
  );

  it("isolates commercial scopes by explicit environment without changing historical STAGING counters", async () => {
    const service = new CertificationCommercialAuthorityService();
    const at = new Date().toISOString();
    const staging = await service.provisionScope({ environment: "STAGING", orgId: ids.orgId, workspaceId: ids.workspaceId, actorUserId: PR32_USER_A, createdAt: at, maxProviderCostUsd: "5.00", maxProviderSubmissions: 4 });
    const production = await service.provisionScope({ environment: "PRODUCTION", orgId: ids.orgId, workspaceId: ids.workspaceId, actorUserId: PR32_USER_A, createdAt: at, maxProviderCostUsd: "3.00", maxProviderSubmissions: 3 });
    expect(staging.scope.certificationScopeId).not.toBe(production.scope.certificationScopeId);
    expect((await service.getActiveScope("STAGING", ids.orgId, ids.workspaceId))?.certificationScopeId).toBe(staging.scope.certificationScopeId);
    expect((await service.getActiveScope("PRODUCTION", ids.orgId, ids.workspaceId))?.certificationScopeId).toBe(production.scope.certificationScopeId);
    expect((await service.getActiveScope("STAGING", ids.orgId, ids.workspaceId))?.maxProviderSubmissions).toBe(4);
    await expect(service.provisionScope({ environment: "PRODUCTION", orgId: ids.orgId, workspaceId: ids.workspaceId, actorUserId: PR32_USER_A, createdAt: at, maxProviderCostUsd: "4.00", maxProviderSubmissions: 3 })).rejects.toThrow("Conflicting Production");
  }, 120_000);

  it("claims a logical call once, enforces scope and money, and reconciles actual usage", async () => {
    const service = new CertificationPlanningAuthorityService();
    const certificationRunId = randomUUID();
    const at = new Date().toISOString();
    const identity = { environment: "PRODUCTION" as const, certificationRunId, orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId, storyId: ids.storyId, actorUserId: PR32_USER_A };
    const authorized = await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "isolated PostgreSQL certification", authorizedAt: at, maxPlanningCostUsd: "0.05", maxLogicalCalls: 2, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    expect((await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "isolated PostgreSQL certification", authorizedAt: at, maxPlanningCostUsd: "0.05", maxLogicalCalls: 2, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" })).replayed).toBe(true);
    const call = { ...identity, stage: "story_polish" as const, logicalCallIdentity: "story_polish:initial", model: "gpt-4o-mini-2024-07-18" as const, maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS.story_polish, maxRetries: 0, claimedAt: at };
    const outcomes = await Promise.allSettled([service.claim(call), service.claim(call)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const claim = (outcomes.find((outcome) => outcome.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof service.claim>>>).value;
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-env", environment: "STAGING" })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-org", orgId: randomUUID() })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-workspace", workspaceId: randomUUID() })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-campaign", campaignId: randomUUID() })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-retry", maxRetries: 1 })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-output", maxOutputTokens: 0 })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-model", model: "gpt-4o" as never })).rejects.toThrow();
    await expect(service.claim({ ...call, logicalCallIdentity: "wrong-stage", stage: "animation_package" as never })).rejects.toThrow();
    await service.settle({ planningClaimId: claim.planningClaimId, inputTokens: 1000, outputTokens: 500, providerRequestId: "fake-provider-request", completedAt: at });
    const second = await new CertificationPlanningAuthorityService().claim({ ...call, stage: "script_semantic_writer", logicalCallIdentity: "script_semantic_writer:initial", maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS.script_semantic_writer });
    await service.failUnknown({ planningClaimId: second.planningClaimId, completedAt: at });
    const rows = await sql`select spent_planning_cost_usd::text as spent, reserved_planning_cost_usd::text as reserved, consumed_logical_calls as consumed, reserved_logical_calls as active from certification_planning_authorities where planning_authority_id=${authorized.authority.planningAuthorityId}::uuid`;
    expect(rows).toEqual([{ spent: "0.01", reserved: "0.03", consumed: 2, active: 0 }]);
    await expect(service.claim({ ...call, logicalCallIdentity: "story_polish:regenerated" })).rejects.toThrow("allowance exhausted");
    const overBudgetRun = randomUUID();
    await service.provision({ ...identity, certificationRunId: overBudgetRun, authorizedBy: PR32_USER_A, authorizationReason: "isolated over-budget test", authorizedAt: at, maxPlanningCostUsd: "0.02", maxLogicalCalls: 9, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    await expect(service.claim({ ...call, certificationRunId: overBudgetRun, logicalCallIdentity: "story_polish:over-budget" })).rejects.toThrow("Projected planning cost");
  }, 120_000);

  it("represents exactly nine approved logical calls with no animation-package model allowance", async () => {
    const service = new CertificationPlanningAuthorityService();
    const certificationRunId = randomUUID();
    const at = new Date().toISOString();
    const identity = { environment: "STAGING" as const, certificationRunId, orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId, storyId: ids.storyId, actorUserId: PR32_USER_A };
    const stageNames = Object.keys(CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS);
    expect(stageNames).toEqual([
      "story_polish", "creative_context", "director_thinking", "story_beats", "scene_plan", "shot_plan",
      "character_continuity", "world_continuity", "script_semantic_writer",
    ]);
    expect(stageNames).not.toContain("animation_package");
    await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "nine-call isolated budget", authorizedAt: at, maxPlanningCostUsd: "0.30", maxLogicalCalls: 9, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    for (const stage of stageNames) {
      const claim = await new CertificationPlanningAuthorityService().claim({ ...identity, stage: stage as keyof typeof CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS, logicalCallIdentity: `${stage}:initial`, model: "gpt-4o-mini-2024-07-18", maxOutputTokens: CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[stage as keyof typeof CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS], maxRetries: 0, claimedAt: at });
      await service.settle({ planningClaimId: claim.planningClaimId, inputTokens: 1000, outputTokens: 100, completedAt: at });
    }
    const [authority] = await sql`select consumed_logical_calls as consumed,spent_planning_cost_usd::text as spent from certification_planning_authorities where environment='STAGING' and certification_run_id=${certificationRunId}::uuid`;
    expect(authority).toEqual({ consumed: 9, spent: "0.09" });
  }, 120_000);

  it("runs nine real budget claims through an injected fake model boundary and settles usage", async () => {
    const service = new CertificationPlanningAuthorityService();
    const certificationRunId = randomUUID();
    const at = new Date().toISOString();
    const identity = { environment: "STAGING" as const, certificationRunId, orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId, storyId: ids.storyId, actorUserId: PR32_USER_A };
    await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "isolated fake-adapter certification", authorizedAt: at, maxPlanningCostUsd: "0.30", maxLogicalCalls: 9, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    let fakeAdapterCallCount = 0;
    const fakeAdapter: CertificationPlanningModelAdapter = {
      async complete(request, options) {
        fakeAdapterCallCount += 1;
        expect(options?.maxRetries).toBe(0);
        expect(request.max_tokens).toBe(CERTIFICATION_PLANNING_STAGE_OUTPUT_LIMITS[
          fakeAdapterCallCount === 1 ? "story_polish" : stages[fakeAdapterCallCount - 2]!
        ]);
        return {
          id: `fake-certification-${fakeAdapterCallCount}`,
          object: "chat.completion",
          created: 0,
          model: "gpt-4o-mini-2024-07-18",
          choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: '{"ok":true}', refusal: null } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        } as Awaited<ReturnType<CertificationPlanningModelAdapter["complete"]>>;
      },
    };
    const stages = ["creative_context", "director_thinking", "story_beats", "scene_plan", "shot_plan", "character_continuity", "world_continuity", "script_semantic_writer"] as const;
    await withCertificationPlanningContext({ ...identity, logicalCallSuffix: "initial", modelAdapter: fakeAdapter }, async () => {
      const polish = await callStructuredJsonModel({ system: "certification", user: "story", schema: z.object({ ok: z.boolean() }), schemaName: "certification_polish" });
      expect(polish.result).toEqual({ ok: true });
      for (const stage of stages) {
        const result = await callJsonModel<{ ok: boolean }>("certification", "story", "{ok:boolean}", { certificationStage: stage });
        expect(result.result).toEqual({ ok: true });
      }
      await expect(callJsonModel("certification", "story", "{}", { certificationStage: "animation_package" as never })).rejects.toMatchObject({ code: "PLANNING_CALL_CONTRACT_INVALID" });
    });
    expect(fakeAdapterCallCount).toBe(9);
    const [authority] = await sql`select consumed_logical_calls as consumed, reserved_logical_calls as reserved from certification_planning_authorities where environment='STAGING' and certification_run_id=${certificationRunId}::uuid`;
    expect(authority).toEqual({ consumed: 9, reserved: 0 });
    expect(blockedExternalNetworkAttempts()).toHaveLength(0);
  }, 120_000);

  it("rejects budget, quota, stage, model and duplicate calls before invoking the fake adapter", async () => {
    const service = new CertificationPlanningAuthorityService();
    const at = new Date().toISOString();
    const identity = { environment: "STAGING" as const, certificationRunId: randomUUID(), orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId, storyId: ids.storyId, actorUserId: PR32_USER_A };
    let fakeAdapterCallCount = 0;
    const fakeAdapter: CertificationPlanningModelAdapter = {
      async complete() {
        fakeAdapterCallCount += 1;
        return { id: "fake-claim", object: "chat.completion", created: 0, model: "gpt-4o-mini-2024-07-18", choices: [{ index: 0, finish_reason: "stop", logprobs: null, message: { role: "assistant", content: "{}", refusal: null } }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } } as Awaited<ReturnType<CertificationPlanningModelAdapter["complete"]>>;
      },
    };
    await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "isolated quota test", authorizedAt: at, maxPlanningCostUsd: "0.02", maxLogicalCalls: 1, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    await withCertificationPlanningContext({ ...identity, logicalCallSuffix: "initial", modelAdapter: fakeAdapter }, async () => {
      await expect(callJsonModel("system", "user", "{}", { certificationStage: "creative_context" })).rejects.toThrow("Projected planning cost");
      await expect(callJsonModel("system", "user", "{}", { certificationStage: "animation_package" as never })).rejects.toMatchObject({ code: "PLANNING_CALL_CONTRACT_INVALID" });
      await expect(callJsonModel("system", "user", "{}", { certificationStage: "creative_context", model: "gpt-4o" })).rejects.toThrow("PLANNING_MODEL_MISMATCH");
    });
    expect(fakeAdapterCallCount).toBe(0);

    const allowed = { ...identity, certificationRunId: randomUUID() };
    await service.provision({ ...allowed, authorizedBy: PR32_USER_A, authorizationReason: "isolated duplicate test", authorizedAt: at, maxPlanningCostUsd: "0.03", maxLogicalCalls: 1, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    const invoke = () => withCertificationPlanningContext({ ...allowed, logicalCallSuffix: "initial", modelAdapter: fakeAdapter }, () => callJsonModel("system", "user", "{}", { certificationStage: "creative_context" }));
    const outcomes = await Promise.allSettled([invoke(), invoke()]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(fakeAdapterCallCount).toBe(1);
    await expect(invoke()).rejects.toThrow("already claimed");
    expect(fakeAdapterCallCount).toBe(1);
    await withCertificationPlanningContext({ ...allowed, logicalCallSuffix: "regeneration", modelAdapter: fakeAdapter }, async () => {
      await expect(callJsonModel("system", "user", "{}", { certificationStage: "creative_context" })).rejects.toThrow("allowance exhausted");
    });
    expect(fakeAdapterCallCount).toBe(1);
    expect(blockedExternalNetworkAttempts()).toHaveLength(0);
  }, 120_000);

  it("consumes a terminal fake-model failure without fictitious settled spend", async () => {
    const service = new CertificationPlanningAuthorityService();
    const at = new Date().toISOString();
    const identity = { environment: "PRODUCTION" as const, certificationRunId: randomUUID(), orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId, storyId: ids.storyId, actorUserId: PR32_USER_A };
    await service.provision({ ...identity, authorizedBy: PR32_USER_A, authorizationReason: "isolated terminal failure", authorizedAt: at, maxPlanningCostUsd: "0.03", maxLogicalCalls: 1, maxTransportAttempts: 1, model: "gpt-4o-mini-2024-07-18" });
    let fakeAdapterCallCount = 0;
    await withCertificationPlanningContext({ ...identity, logicalCallSuffix: "initial", modelAdapter: {
      async complete() { fakeAdapterCallCount += 1; throw new Error("FAKE_TERMINAL_PROVIDER_FAILURE"); },
    } }, async () => {
      await expect(callJsonModel("system", "user", "{}", { certificationStage: "story_beats" })).rejects.toThrow("FAKE_TERMINAL_PROVIDER_FAILURE");
    });
    expect(fakeAdapterCallCount).toBe(1);
    const [authority] = await sql`select spent_planning_cost_usd::text as spent, reserved_planning_cost_usd::text as reserved, consumed_logical_calls as consumed from certification_planning_authorities where environment='PRODUCTION' and certification_run_id=${identity.certificationRunId}::uuid`;
    expect(authority).toEqual({ spent: "0.00", reserved: "0.03", consumed: 1 });
    expect(blockedExternalNetworkAttempts()).toHaveLength(0);
  }, 120_000);
});
