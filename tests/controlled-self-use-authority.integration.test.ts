import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  ControlledSelfUseAuthorityService,
  EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
  BillingAccountRepositoryImpl,
  PlatformAdminRepositoryImpl,
} from "@ceo-agent/db";
import {
  buildBillingAccount,
  buildPlatformAdminAssignment,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl()
  ? describe
  : describe.skip;

describeIntegration("Production Controlled Self-Use authority", () => {
  let sql: Sql;
  const adminUserId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const otherOrgId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  let authorityId = "";

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(
      readFileSync(
        "supabase/migrations/20260926055546_controlled_self_use_authority_v1.sql",
        "utf8"
      )
    );
    await sql`
      insert into organizations (id, name, slug)
      values (${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, 'EmberSoulLabs', ${`embersoul-self-use-${crypto.randomUUID()}`})
      on conflict (id) do nothing
    `;
    await sql`
      insert into organizations (id, name, slug)
      values (${otherOrgId}::uuid, 'Customer', ${`customer-${crypto.randomUUID()}`})
    `;
    await sql`
      insert into workspaces (id, org_id, name, slug)
      values
        (${workspaceId}::uuid, ${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, 'Owner Workspace', ${`owner-${crypto.randomUUID()}`}),
        (${otherWorkspaceId}::uuid, ${otherOrgId}::uuid, 'Customer Workspace', ${`customer-ws-${crypto.randomUUID()}`})
    `;
    const assignment = buildPlatformAdminAssignment({
      userId: adminUserId,
      grantedAt: "2026-09-26T00:00:00.000Z",
      grantedByUserId: null,
      reason: "controlled self-use isolated certification",
      identitySeed: `self-use:${adminUserId}`,
    });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);
    await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
      orgId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      createdAt: "2026-09-26T00:00:30.000Z",
      identitySeed: `self-use-billing:${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}`,
    }));
    const provisioned = await new ControlledSelfUseAuthorityService()
      .provisionEmberSoulLabsAuthority({
        environment: "PRODUCTION",
        organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
        authorizedBy: adminUserId,
        reason: "bounded owner-only Production self-use",
        createdAt: "2026-09-26T00:01:00.000Z",
      });
    authorityId = provisioned.authority.authorityId;
  });

  afterAll(async () => { await sql?.end(); });

  it("is server-only with RLS and no client policy", async () => {
    const rows = await sql<{
      table_name: string;
      rls: boolean;
      anon_any: boolean;
      authenticated_any: boolean;
      policies: number;
    }[]>`
      select c.relname as table_name, c.relrowsecurity as rls,
        has_table_privilege('anon', c.oid, 'select,insert,update,delete') as anon_any,
        has_table_privilege('authenticated', c.oid, 'select,insert,update,delete') as authenticated_any,
        (select count(*)::int from pg_policy p where p.polrelid=c.oid) as policies
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in (
        'controlled_self_use_authorities',
        'controlled_self_use_reservations',
        'controlled_self_use_events'
      ) order by c.relname
    `;
    expect(rows).toHaveLength(3);
    expect(rows.every((item) => item.rls && !item.anon_any && !item.authenticated_any && item.policies === 0)).toBe(true);
  });

  it("fails closed for customer organizations, foreign workspaces, retries, and per-execution overflow", async () => {
    const service = new ControlledSelfUseAuthorityService();
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: otherOrgId,
      workspaceId: otherWorkspaceId,
      capabilityKey: "ai_story.execute",
      providerKey: "seedance",
    })).rejects.toThrow(/restricted to EmberSoulLabs/i);
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId: otherWorkspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
    })).rejects.toThrow(/not eligible/i);
    await expect(service.reserve({
      environment: "PRODUCTION",
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      capabilityKey: "ai_story.execute",
      executionIdentity: `retry-${crypto.randomUUID()}`,
      providerKey: "seedance",
      maximumCostUsd: "0.57",
      retryOrdinal: 1,
      reservedAt: "2026-09-27T01:00:00.000Z",
    })).rejects.toThrow(/retry/i);
    await expect(service.reserve({
      environment: "PRODUCTION",
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      capabilityKey: "ai_story.execute",
      executionIdentity: `over-${crypto.randomUUID()}`,
      providerKey: "seedance",
      maximumCostUsd: "5.01",
      reservedAt: "2026-09-27T01:00:00.000Z",
    })).rejects.toThrow(/ceiling/i);
  });

  it("creates only an execution-bound expiring entitlement and immediately reserved credits", async () => {
    const service = new ControlledSelfUseAuthorityService();
    const executionIdentity = `one-shot-${crypto.randomUUID()}`;
    const first = await service.authorizeOneAiStoryExecution({
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      executionIdentity,
      pricingRuleKey: "ai_story.execute",
      pricingRuleVersion: "1",
      creditAmount: 10,
      authorizedAt: "2026-09-27T00:00:00.000Z",
    });
    const replay = await service.authorizeOneAiStoryExecution({
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      executionIdentity,
      pricingRuleKey: "ai_story.execute",
      pricingRuleVersion: "1",
      creditAmount: 10,
      authorizedAt: "2026-09-27T00:00:00.000Z",
    });
    expect(replay).toEqual(first);
    const [facts] = await sql<{
      workspace_id: string;
      source_reference: string;
      expires_at: Date | null;
      reservation_status: string;
      reservation_amount: number;
    }[]>`
      select entitlement.workspace_id, entitlement.source_reference, entitlement.expires_at,
             reservation.status as reservation_status,
             reservation.amount::int as reservation_amount
      from entitlement_grants entitlement
      join credit_reservations reservation
        on reservation.credit_reservation_id = ${first.creditReservationId}::uuid
      where entitlement.entitlement_grant_id = ${first.entitlementGrantId}::uuid
    `;
    expect(facts?.workspace_id).toBe(workspaceId);
    expect(facts?.source_reference).toContain(executionIdentity);
    expect(facts?.expires_at).not.toBeNull();
    expect(facts?.reservation_status).toBe("ACCEPTED");
    expect(facts?.reservation_amount).toBe(10);
  });

  it("serializes concurrent reservations against the combined USD 10 daily cap", async () => {
    const service = new ControlledSelfUseAuthorityService();
    const day = "2026-09-28T02:00:00.000Z";
    const attempts = await Promise.allSettled(["a", "b", "c"].map((suffix) =>
      service.reserve({
        environment: "PRODUCTION",
        organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
        workspaceId,
        capabilityKey: "ai_story.execute",
        executionIdentity: `daily-${suffix}-${crypto.randomUUID()}`,
        providerKey: "seedance",
        maximumCostUsd: "5.00",
        reservedAt: day,
      })
    ));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(2);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("provides an audited kill switch and rejects immutable event mutation", async () => {
    const service = new ControlledSelfUseAuthorityService();
    await service.setEmberSoulLabsAuthorityStatus({
      authorityId,
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      status: "DISABLED",
      actorUserId: adminUserId,
      occurredAt: "2026-09-29T00:00:00.000Z",
    });
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      capabilityKey: "ai_story.execute",
      providerKey: "seedance",
    })).rejects.toThrow(/not eligible/i);
    await service.setEmberSoulLabsAuthorityStatus({
      authorityId,
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      status: "ACTIVE",
      actorUserId: adminUserId,
      occurredAt: "2026-09-29T00:01:00.000Z",
    });
    await expect(sql`update controlled_self_use_events set evidence='{}'::jsonb where authority_id=${authorityId}::uuid`).rejects.toThrow(/IMMUTABLE/i);
  });
});
