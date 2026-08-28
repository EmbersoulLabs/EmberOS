import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  closeDb,
  recoverWave6OrphanedPlatformAdminGrant,
  WAVE6_ORPHAN_GRANT,
  WAVE6_ORPHAN_USER,
  WAVE6_RECOVERY_TICKET,
  WAVE6_STAGING_PROJECT,
  WAVE6_TARGET_EMAIL,
} from "@ceo-agent/db";
import {
  PLATFORM_ADMIN_CONTRACT_VERSION,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

vi.setConfig({ testTimeout: 30_000 });

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const TARGET_USER_ID = "77777777-7777-4777-8777-777777777777";
const OCCURRED_AT = "2026-08-28T00:00:00.000Z";

describeIntegration("Wave 6 Platform Admin orphan recovery", () => {
  let sql: Sql;
  let authUsersCreated = false;

  beforeAll(async () => {
    sql = createIntegrationSql();
    const [authTable] = await sql<{ exists: boolean }[]>`
      select to_regclass('auth.users') is not null as exists
    `;
    if (!authTable?.exists) {
      await sql.unsafe("create schema if not exists auth");
      await sql.unsafe(`create table auth.users (
        id uuid primary key,
        email text not null unique,
        email_confirmed_at timestamptz null,
        banned_until timestamptz null
      )`);
      authUsersCreated = true;
    }
    await sql.unsafe(
      readFileSync(resolve(process.cwd(), "packages/db/sql/platform-admin-v1.sql"), "utf8")
    );
    await cleanup();

    const orphanWithoutHash = {
      contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
      platformAdminAssignmentId: WAVE6_ORPHAN_GRANT,
      userId: WAVE6_ORPHAN_USER,
      platformRole: "PLATFORM_SUPER_ADMIN" as const,
      status: "ACTIVE" as const,
      grantedAt: OCCURRED_AT,
      grantedByUserId: null,
      reason: "integration orphan fixture",
    };
    const orphan = {
      ...orphanWithoutHash,
      integrityHash: sha256CanonicalIntegrityHash(orphanWithoutHash),
    };
    await sql`
      insert into auth.users (id, email, email_confirmed_at, banned_until)
      values (${TARGET_USER_ID}::uuid, ${WAVE6_TARGET_EMAIL}, ${OCCURRED_AT}::timestamptz, null)
    `;
    await sql`
      insert into platform_admin_grants (
        platform_admin_assignment_id, user_id, platform_role, status,
        granted_at, granted_by_user_id, reason, integrity_hash,
        contract_version, assignment
      ) values (
        ${WAVE6_ORPHAN_GRANT}::uuid, ${WAVE6_ORPHAN_USER}::uuid,
        'PLATFORM_SUPER_ADMIN', 'ACTIVE', ${OCCURRED_AT}::timestamptz,
        null, ${orphan.reason}, ${orphan.integrityHash},
        ${PLATFORM_ADMIN_CONTRACT_VERSION}, ${sql.json(orphan)}
      )
    `;
    await closeDb();
  });

  afterAll(async () => {
    await closeDb();
    await cleanup();
    if (authUsersCreated) {
      await sql.unsafe("drop table auth.users");
    }
    await sql.end({ timeout: 1 });
  });

  async function cleanup() {
    await sql`
      delete from admin_audit_events
      where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid
         or target_id = ${WAVE6_ORPHAN_GRANT}
         or target_id in (
           select platform_admin_assignment_id::text
           from platform_admin_grants where user_id = ${TARGET_USER_ID}::uuid
         )
    `;
    await sql`
      delete from platform_admin_revocations
      where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid
    `;
    await sql`
      delete from platform_admin_grants
      where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid
         or user_id = ${TARGET_USER_ID}::uuid
    `;
    await sql`delete from auth.users where id = ${TARGET_USER_ID}::uuid`;
  }

  function input() {
    return {
      environment: "STAGING",
      projectId: WAVE6_STAGING_PROJECT,
      ticketId: WAVE6_RECOVERY_TICKET,
      orphanGrantId: WAVE6_ORPHAN_GRANT,
      orphanUserId: WAVE6_ORPHAN_USER,
      targetEmail: WAVE6_TARGET_EMAIL,
      reason: "integration recovery",
      occurredAt: OCCURRED_AT,
    };
  }

  it("atomically reconciles, audits, and converges concurrent replay", async () => {
    const [first, second] = await Promise.all([
      recoverWave6OrphanedPlatformAdminGrant(input()),
      recoverWave6OrphanedPlatformAdminGrant(input()),
    ]);

    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.activeOrphanCount).toBe(0);
    expect(first.activePlatformSuperAdminCount).toBe(1);

    const [facts] = await sql<{
      orphan_status: string;
      active_count: number;
      revocation_count: number;
      audit_count: number;
    }[]>`
      select
        (select status from platform_admin_grants
          where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid) as orphan_status,
        (select count(*)::int from platform_admin_grants
          where status = 'ACTIVE' and platform_role = 'PLATFORM_SUPER_ADMIN') as active_count,
        (select count(*)::int from platform_admin_revocations
          where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid) as revocation_count,
        (select count(*)::int from admin_audit_events
          where action = 'WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY') as audit_count
    `;
    expect(facts).toEqual({
      orphan_status: "REVOKED",
      active_count: 1,
      revocation_count: 1,
      audit_count: 2,
    });
  });
});
