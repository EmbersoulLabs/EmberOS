import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import { provisionFirstOrganizationForUser } from "../apps/web/src/lib/organization-provisioning";
import {
  PlatformAdminRepositoryImpl,
  requireOrganizationMembership,
  requireWorkspaceRole,
} from "@ceo-agent/db";
import { buildPlatformAdminAssignment } from "@ceo-agent/shared/server";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const TABLES = [
  "platform_admin_grants",
  "platform_admin_revocations",
  "admin_audit_events",
  "organizations",
  "organization_members",
] as const;

describeIntegration("Platform Admin Control Plane server-only security", () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(readFileSync("packages/db/sql/platform-admin-control-plane-security-v1.sql", "utf8"));
  });
  afterAll(async () => { await sql?.end(); });

  it("enables RLS, removes client grants and creates no permissive policy", async () => {
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
      where n.nspname='public' and c.relname in ${sql(TABLES)}
      order by c.relname
    `;
    expect(rows).toHaveLength(TABLES.length);
    expect(rows.every((row) => row.rls && !row.anon_any && !row.authenticated_any && row.policies === 0)).toBe(true);
  });

  it("denies direct client reads while preserving trusted server access", async () => {
    for (const role of ["anon", "authenticated"]) {
      for (const table of TABLES) {
        await expect(sql.begin(async (tx) => {
          await tx.unsafe(`set local role = '${role}'`);
          await tx.unsafe(`select * from public.${table} limit 1`);
        })).rejects.toThrow(/permission denied/i);
      }
    }
    const serverRows = await sql`select count(*)::int as count from public.platform_admin_grants`;
    expect(Number(serverRows[0]?.count ?? -1)).toBeGreaterThanOrEqual(0);
  });

  it("provisions same-named first Organizations without collision or tenant crossover", async () => {
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const createdA = await provisionFirstOrganizationForUser({
      userId: userA,
      name: "EmberSoul Labs",
      requestedSlug: "embersoullabs",
    });
    const createdB = await provisionFirstOrganizationForUser({
      userId: userB,
      name: "EmberSoul Labs",
      requestedSlug: "embersoullabs",
    });

    expect(createdA.created).toBe(true);
    expect(createdB.created).toBe(true);
    expect(createdA.organization.id).not.toBe(createdB.organization.id);
    expect(createdA.organization.slug).not.toBe(createdB.organization.slug);

    const memberships = await sql<{ user_id: string; org_id: string }[]>`
      select user_id::text, org_id::text
      from organization_members
      where user_id in (${userA}::uuid, ${userB}::uuid)
      order by user_id
    `;
    expect(memberships).toHaveLength(2);
    expect(memberships.find((row) => row.user_id === userA)?.org_id).toBe(createdA.organization.id);
    expect(memberships.find((row) => row.user_id === userB)?.org_id).toBe(createdB.organization.id);

    await sql`delete from organization_members where user_id in (${userA}::uuid, ${userB}::uuid)`;
    await sql`delete from organizations where id in (${createdA.organization.id}::uuid, ${createdB.organization.id}::uuid)`;
  });

  it("grants all-Organization/Workspace admin context without creating tenant membership", async () => {
    const adminUserId = crypto.randomUUID();
    const normalUserId = crypto.randomUUID();
    const orgId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const suffix = crypto.randomUUID().slice(0, 8);
    const assignment = buildPlatformAdminAssignment({
      userId: adminUserId,
      grantedAt: "2026-09-26T00:00:00.000Z",
      grantedByUserId: null,
      reason: "isolated control-plane authority certification",
      identitySeed: `control-plane:${adminUserId}`,
    });

    await sql`insert into organizations (id, name, slug) values (${orgId}, 'Control Plane Test', ${`control-plane-${suffix}`})`;
    await sql`insert into workspaces (id, org_id, name, slug) values (${workspaceId}, ${orgId}, 'Workspace', ${`workspace-${suffix}`})`;
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);

    const orgAuthority = await requireOrganizationMembership(orgId, adminUserId, "owner");
    const workspaceAuthority = await requireWorkspaceRole(workspaceId, adminUserId, "admin");
    expect(orgAuthority.role).toBe("owner");
    expect(workspaceAuthority.role).toBe("admin");
    expect(workspaceAuthority.id).toBe(assignment.platformAdminAssignmentId);

    const tenantMemberships = await sql<{ count: number }[]>`
      select (
        (select count(*) from organization_members where user_id=${adminUserId}::uuid) +
        (select count(*) from workspace_members where user_id=${adminUserId}::uuid)
      )::int as count
    `;
    expect(tenantMemberships[0]?.count).toBe(0);
    await expect(requireOrganizationMembership(orgId, normalUserId)).rejects.toThrow(/not a member/i);
    await expect(requireWorkspaceRole(workspaceId, normalUserId, "client_viewer")).rejects.toThrow(/not a member/i);

    await sql`delete from platform_admin_grants where platform_admin_assignment_id=${assignment.platformAdminAssignmentId}::uuid`;
    await sql`delete from workspaces where id=${workspaceId}::uuid`;
    await sql`delete from organizations where id=${orgId}::uuid`;
  });
});
