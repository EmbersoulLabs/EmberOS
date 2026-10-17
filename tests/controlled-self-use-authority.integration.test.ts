import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  ControlledSelfUseAuthorityService,
  AiStoryOutlineAuthorityService,
  getDb,
  hasAiStoryActorScope,
  hasInternalSuperadminWorkspaceScope,
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
  const secondInternalOrgId = crypto.randomUUID();
  const secondInternalWorkspaceId = crypto.randomUUID();
  const legacyInternalOrgId = crypto.randomUUID();
  const legacyInternalWorkspaceId = crypto.randomUUID();
  let authorityId = "";

  beforeAll(async () => {
    sql = createIntegrationSql();
    const [base] = await sql<{ present: boolean }[]>`select to_regclass('public.controlled_self_use_authorities') is not null as present`;
    if (!base?.present) await sql.unsafe(readFileSync("supabase/migrations/20260926055546_controlled_self_use_authority_v1.sql", "utf8"));
    const [legacyScope] = await sql<{ present: boolean }[]>`select to_regclass('public.controlled_self_use_workspace_scopes') is not null as present`;
    if (!legacyScope?.present) await sql.unsafe(readFileSync("supabase/migrations/20261016033243_superadmin_internal_self_use_workspace_scope.sql", "utf8"));
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
      insert into organizations (id, name, slug)
      values (${secondInternalOrgId}::uuid, 'Second Internal Company', ${`internal-2-${crypto.randomUUID()}`})
    `;
    await sql`
      insert into organizations (id, name, slug)
      values (${legacyInternalOrgId}::uuid, 'Legacy Internal Company', ${`legacy-internal-${crypto.randomUUID()}`})
    `;
    await sql`
      insert into workspaces (id, org_id, name, slug)
      values
        (${workspaceId}::uuid, ${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, 'Owner Workspace', ${`owner-${crypto.randomUUID()}`}),
        (${otherWorkspaceId}::uuid, ${otherOrgId}::uuid, 'Customer Workspace', ${`customer-ws-${crypto.randomUUID()}`}),
        (${secondInternalWorkspaceId}::uuid, ${secondInternalOrgId}::uuid, 'Second Internal Workspace', ${`internal-ws-2-${crypto.randomUUID()}`}),
        (${legacyInternalWorkspaceId}::uuid, ${legacyInternalOrgId}::uuid, 'Legacy Internal Workspace', ${`legacy-internal-ws-${crypto.randomUUID()}`})
    `;
    const assignment = buildPlatformAdminAssignment({
      userId: adminUserId,
      grantedAt: "2026-09-26T00:00:00.000Z",
      grantedByUserId: null,
      reason: "controlled self-use isolated certification",
      identitySeed: `self-use:${adminUserId}`,
    });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);
    await sql`
      insert into organization_members (org_id, user_id, role)
      values
        (${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, ${adminUserId}::uuid, 'owner'),
        (${secondInternalOrgId}::uuid, ${adminUserId}::uuid, 'owner')
    `;
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
    await new ControlledSelfUseAuthorityService().authorizeInternalWorkspace({
      authorityId,
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId,
      authorizedBy: adminUserId,
      reason: "explicit owner workspace scope",
      createdAt: "2026-09-26T00:01:01.000Z",
    });
    const legacyAuthority = await new ControlledSelfUseAuthorityService().provisionInternalSelfUseAuthority({
      environment: "PRODUCTION",
      organizationId: legacyInternalOrgId,
      authorizedBy: adminUserId,
      reason: "pre-account explicit internal authority",
      createdAt: "2026-09-26T00:01:02.000Z",
    });
    await new ControlledSelfUseAuthorityService().authorizeInternalWorkspace({
      authorityId: legacyAuthority.authority.authorityId,
      organizationId: legacyInternalOrgId,
      workspaceId: legacyInternalWorkspaceId,
      authorizedBy: adminUserId,
      reason: "pre-account explicit internal scope",
      createdAt: "2026-09-26T00:01:03.000Z",
    });
    const [globalScope] = await sql<{ present: boolean }[]>`select to_regclass('public.controlled_self_use_organization_scopes') is not null as present`;
    if (!globalScope?.present) await sql.unsafe(readFileSync("supabase/migrations/20261016160034_global_superadmin_entitlement_v1.sql", "utf8"));
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
        'controlled_self_use_events',
        'controlled_self_use_organization_scopes'
      ) order by c.relname
    `;
    expect(rows).toHaveLength(4);
    expect(rows.every((item) => item.rls && !item.anon_any && !item.authenticated_any && item.policies === 0)).toBe(true);
  });

  it("fails closed for customer organizations, foreign workspaces and retries without imposing an internal USD ceiling", async () => {
    const service = new ControlledSelfUseAuthorityService();
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: otherOrgId,
      workspaceId: otherWorkspaceId,
      capabilityKey: "ai_story.execute",
      providerKey: "seedance",
      actorUserId: adminUserId,
    })).rejects.toThrow(/not eligible/i);
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
      workspaceId: otherWorkspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
      actorUserId: adminUserId,
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
      actorUserId: adminUserId,
      reservedAt: "2026-09-27T01:00:00.000Z",
    })).resolves.toMatchObject({ reservation: { reservedCostUsd: "5.01" } });
  });

  it("inherits one account authority across owned Companies and all their Workspaces", async () => {
    const service = new ControlledSelfUseAuthorityService();
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: secondInternalOrgId,
      workspaceId: secondInternalWorkspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
      actorUserId: adminUserId,
    })).resolves.toMatchObject({ authorityId, scopeKind: "ACCOUNT", accountUserId: adminUserId });
    const newWorkspaceId = crypto.randomUUID();
    await sql`insert into workspaces (id, org_id, name, slug) values
      (${newWorkspaceId}::uuid, ${secondInternalOrgId}::uuid, 'Inherited Workspace', ${`inherited-${crypto.randomUUID()}`})`;
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: secondInternalOrgId,
      workspaceId: newWorkspaceId,
      capabilityKey: "campaign.generate",
      providerKey: "openai",
      actorUserId: adminUserId,
    })).resolves.toMatchObject({ authorityId });
  });

  it("projects account authority into canonical Outline scope without crossing into customer Companies", async () => {
    const internalCampaignId = crypto.randomUUID();
    const internalStoryId = crypto.randomUUID();
    const internalVersionId = crypto.randomUUID();
    const customerCampaignId = crypto.randomUUID();
    const customerStoryId = crypto.randomUUID();
    const customerVersionId = crypto.randomUUID();
    await sql`insert into campaigns (id,org_id,workspace_id,name) values
      (${internalCampaignId}::uuid,${secondInternalOrgId}::uuid,${secondInternalWorkspaceId}::uuid,'Internal Outline'),
      (${customerCampaignId}::uuid,${otherOrgId}::uuid,${otherWorkspaceId}::uuid,'Customer Outline')`;
    await sql`insert into ai_stories (id,org_id,workspace_id,campaign_id,title,original_idea,status) values
      (${internalStoryId}::uuid,${secondInternalOrgId}::uuid,${secondInternalWorkspaceId}::uuid,${internalCampaignId}::uuid,'Internal','Idea','planning'),
      (${customerStoryId}::uuid,${otherOrgId}::uuid,${otherWorkspaceId}::uuid,${customerCampaignId}::uuid,'Customer','Idea','planning')`;
    await sql`insert into ai_story_versions (id,story_id,version_number,structured_content,frozen_at) values
      (${internalVersionId}::uuid,${internalStoryId}::uuid,1,'{}'::jsonb,now()),
      (${customerVersionId}::uuid,${customerStoryId}::uuid,1,'{}'::jsonb,now())`;
    const outlines = new AiStoryOutlineAuthorityService();
    await expect(outlines.history({
      orgId: secondInternalOrgId,
      workspaceId: secondInternalWorkspaceId,
      campaignId: internalCampaignId,
      storyId: internalStoryId,
      storyVersionId: internalVersionId,
      actorUserId: adminUserId,
    })).resolves.toEqual([]);
    await expect(outlines.history({
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
      campaignId: customerCampaignId,
      storyId: customerStoryId,
      storyVersionId: customerVersionId,
      actorUserId: adminUserId,
    })).rejects.toThrow("Outline authority scope does not resolve");
  });

  it("resolves the shared AI Story actor scope for reads, mutations, new Workspaces, and revocation", async () => {
    const db = getDb();
    const newWorkspaceId = crypto.randomUUID();
    await sql`insert into workspaces (id,org_id,name,slug) values
      (${newWorkspaceId}::uuid,${secondInternalOrgId}::uuid,'Authority Matrix',${`authority-${crypto.randomUUID()}`})`;
    const internalScope = {
      orgId: secondInternalOrgId,
      workspaceId: newWorkspaceId,
      actorUserId: adminUserId,
    };
    await expect(hasAiStoryActorScope(db, internalScope, false)).resolves.toBe(true);
    await expect(hasAiStoryActorScope(db, internalScope, true)).resolves.toBe(true);
    await expect(hasInternalSuperadminWorkspaceScope(db, {
      workspaceId: newWorkspaceId,
      actorUserId: adminUserId,
    })).resolves.toBe(true);
    await expect(hasAiStoryActorScope(db, {
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
      actorUserId: adminUserId,
    }, true)).resolves.toBe(false);

    const memberUserId = crypto.randomUUID();
    await sql`insert into workspace_members (org_id,workspace_id,user_id,role) values
      (${otherOrgId}::uuid,${otherWorkspaceId}::uuid,${memberUserId}::uuid,'operator')`;
    await expect(hasAiStoryActorScope(db, {
      orgId: otherOrgId,
      workspaceId: otherWorkspaceId,
      actorUserId: memberUserId,
    }, true, "CHARACTER")).resolves.toBe(true);

    await sql`update platform_admin_grants set status='REVOKED' where user_id=${adminUserId}::uuid`;
    await expect(hasAiStoryActorScope(db, internalScope, true)).resolves.toBe(false);
    await sql`update platform_admin_grants set status='ACTIVE' where user_id=${adminUserId}::uuid`;
  });

  it("converges an existing explicit internal Workspace scope without treating platform access as ownership", async () => {
    const service = new ControlledSelfUseAuthorityService();
    await expect(service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: legacyInternalOrgId,
      workspaceId: legacyInternalWorkspaceId,
      capabilityKey: "ai_story.plan",
      providerKey: "openai",
      actorUserId: adminUserId,
    })).resolves.toMatchObject({ authorityId, scopeKind: "ACCOUNT" });
    const [scope] = await sql<{ source: string }[]>`
      select source from controlled_self_use_organization_scopes
      where authority_id=${authorityId}::uuid and organization_id=${legacyInternalOrgId}::uuid
    `;
    expect(scope?.source).toBe("LEGACY_WORKSPACE_AUTHORITY");
  });

  it("auto-inherits a newly owned internal Company and fails closed on Superadmin revocation", async () => {
    const orgId = crypto.randomUUID();
    const inheritedWorkspaceId = crypto.randomUUID();
    await sql`insert into organizations (id,name,slug) values
      (${orgId}::uuid,'New Internal Company',${`new-internal-${crypto.randomUUID()}`})`;
    await sql`insert into organization_members (org_id,user_id,role) values
      (${orgId}::uuid,${adminUserId}::uuid,'owner')`;
    await sql`insert into workspaces (id,org_id,name,slug) values
      (${inheritedWorkspaceId}::uuid,${orgId}::uuid,'Automatically Inherited',${`auto-${crypto.randomUUID()}`})`;
    const service = new ControlledSelfUseAuthorityService();
    const input = {
      environment: "PRODUCTION" as const,
      organizationId: orgId,
      workspaceId: inheritedWorkspaceId,
      capabilityKey: "ai_story.plan" as const,
      providerKey: "openai" as const,
      actorUserId: adminUserId,
    };
    await expect(service.assertWorkspaceEligible(input)).resolves.toMatchObject({ authorityId });
    await sql`update platform_admin_grants set status='REVOKED' where user_id=${adminUserId}::uuid`;
    await expect(service.assertWorkspaceEligible(input)).rejects.toThrow(/not eligible/i);
    await sql`update platform_admin_grants set status='ACTIVE' where user_id=${adminUserId}::uuid`;
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

  it("keeps concurrent account usage idempotent and metered without an EmberOS daily cap", async () => {
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
        actorUserId: adminUserId,
        reservedAt: day,
      })
    ));
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(3);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(0);
    const metered = await service.reserve({
      environment: "PRODUCTION",
      organizationId: secondInternalOrgId,
      workspaceId: secondInternalWorkspaceId,
      capabilityKey: "ai_story.plan",
      executionIdentity: `actual-cost-${crypto.randomUUID()}`,
      providerKey: "openai",
      maximumCostUsd: "0.10",
      actorUserId: adminUserId,
      reservedAt: day,
    });
    const settled = await service.settle(
      metered.reservation.reservationId,
      "0.25",
      "2026-09-28T02:01:00.000Z",
      "provider-request-test"
    );
    expect(settled.settledCostUsd).toBe("0.25");
    expect(settled.workspaceId).toBe(secondInternalWorkspaceId);
  });

  it("releases unused terminal pre-provider planning reservations once", async () => {
    const service = new ControlledSelfUseAuthorityService();
    const campaignId = crypto.randomUUID();
    const failedStoryId = crypto.randomUUID();
    const liveStoryId = crypto.randomUUID();
    const failedVersionId = crypto.randomUUID();
    const liveVersionId = crypto.randomUUID();
    const occurredAt = "2026-10-20T00:00:00.000Z";
    await sql`
      insert into campaigns (id, org_id, workspace_id, name)
      values (${campaignId}::uuid, ${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, ${workspaceId}::uuid, 'Reconciliation')
    `;
    await sql`
      insert into ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea, status)
      values
        (${failedStoryId}::uuid, ${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, ${workspaceId}::uuid, ${campaignId}::uuid, 'Failed plan', 'Idea', 'failed'),
        (${liveStoryId}::uuid, ${EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID}::uuid, ${workspaceId}::uuid, ${campaignId}::uuid, 'Live plan', 'Idea', 'planning')
    `;
    await sql`
      insert into ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
      values
        (${failedVersionId}::uuid, ${failedStoryId}::uuid, 1, '{}'::jsonb, now()),
        (${liveVersionId}::uuid, ${liveStoryId}::uuid, 1, '{}'::jsonb, now())
    `;
    const reserve = (executionIdentity: string, capabilityKey: "ai_story.plan" | "ai_story.execute", providerKey: "openai" | "seedance") =>
      service.reserve({
        environment: "PRODUCTION",
        organizationId: EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID,
        workspaceId,
        capabilityKey,
        executionIdentity,
        providerKey,
        maximumCostUsd: "0.50",
        retryOrdinal: 0,
        actorUserId: adminUserId,
        reservedAt: occurredAt,
      });
    const failed = await reserve(`ai-story-plan-stage:${failedVersionId}:scene_plan:${crypto.randomUUID()}`, "ai_story.plan", "openai");
    const live = await reserve(`ai-story-plan-stage:${liveVersionId}:shot_plan:${crypto.randomUUID()}`, "ai_story.plan", "openai");
    const billed = await reserve(`ai-story-plan-stage:${failedVersionId}:shot_plan:${crypto.randomUUID()}`, "ai_story.plan", "openai");
    const video = await reserve(`video-${crypto.randomUUID()}`, "ai_story.execute", "seedance");
    await service.markSubmitted(failed.reservation.reservationId, occurredAt);
    await service.markSubmitted(live.reservation.reservationId, occurredAt);
    await service.markSubmitted(billed.reservation.reservationId, occurredAt, "chatcmpl-billed");
    await service.markSubmitted(video.reservation.reservationId, occurredAt);

    const first = await service.reconcileUnusedTerminalPreProviderReservations({ occurredAt });
    expect(first.releasedReservationIds).toEqual([failed.reservation.reservationId]);
    expect(first.releasedUsd).toBe("0.50");
    const replay = await service.reconcileUnusedTerminalPreProviderReservations({ occurredAt });
    expect(replay.releasedReservationIds).toEqual([]);
    expect(replay.releasedUsd).toBe("0.00");
    expect((await service.getReservationById(live.reservation.reservationId))?.status).toBe("SUBMITTED");
    expect((await service.getReservationById(billed.reservation.reservationId))?.status).toBe("SUBMITTED");
    expect((await service.getReservationById(video.reservation.reservationId))?.status).toBe("SUBMITTED");
    const events = await sql<{ event_type: string }[]>`
      select event_type from controlled_self_use_events
      where reservation_id = ${failed.reservation.reservationId}::uuid
      order by occurred_at, event_type
    `;
    expect(events.map((event) => event.event_type).sort()).toEqual(["RELEASED", "RESERVED", "SUBMITTED"]);

    const terminal = await service.reconcileUnusedTerminalPreProviderReservations({
      occurredAt,
      reservationId: live.reservation.reservationId,
      executionTerminal: true,
    });
    expect(terminal.releasedReservationIds).toEqual([live.reservation.reservationId]);
    const terminalReplay = await service.reconcileUnusedTerminalPreProviderReservations({
      occurredAt,
      reservationId: live.reservation.reservationId,
      executionTerminal: true,
    });
    expect(terminalReplay.releasedReservationIds).toEqual([]);
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
