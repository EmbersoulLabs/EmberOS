import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const TARGET_USER_ID = "77777777-7777-4777-8777-777777777777";
const OCCURRED_AT = "2026-08-28T00:00:00.000Z";
const RECOVERY_ROLE = "emberos_staging_platform_admin_recovery";
const RECOVERY_PASSWORD = "wave6-ephemeral-ci-only";

vi.setConfig({ testTimeout: 120_000 });

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

type RecoveryRoleOptions = {
  bypassRls?: boolean;
  schemaUsage?: boolean;
  authUsersSelect?: boolean;
  auditInsert?: boolean;
  grantUpdate?: boolean;
  revocationInsert?: boolean;
};

describeIntegration("Wave 6 least-privilege recovery operator fidelity", () => {
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
    await sql.unsafe("alter table auth.users enable row level security");
    await sql.unsafe("alter table platform_admin_grants enable row level security");
    await sql.unsafe("alter table platform_admin_revocations enable row level security");
    await sql.unsafe("alter table admin_audit_events enable row level security");
    await cleanupOperatorFixture();
  });

  afterAll(async () => {
    await dropRecoveryRole();
    await cleanupOperatorFixture();
    if (authUsersCreated) await sql.unsafe("drop table auth.users");
    await sql.end({ timeout: 1 });
  });

  async function dropRecoveryRole() {
    await sql.unsafe(`do $cleanup$ begin
      if exists (select 1 from pg_roles where rolname = '${RECOVERY_ROLE}') then
        revoke all privileges on table auth.users from ${RECOVERY_ROLE};
        revoke all privileges on table platform_admin_grants from ${RECOVERY_ROLE};
        revoke all privileges on table platform_admin_revocations from ${RECOVERY_ROLE};
        revoke all privileges on table admin_audit_events from ${RECOVERY_ROLE};
        revoke usage on schema auth, public from ${RECOVERY_ROLE};
        revoke connect on database emberos_test from ${RECOVERY_ROLE};
        drop role ${RECOVERY_ROLE};
      end if;
    end $cleanup$;`);
  }

  async function cleanupOperatorFixture() {
    await dropRecoveryRole();
    await sql`
      delete from admin_audit_events
      where action = 'WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY'
         or platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid
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

  async function seedOperatorDeadlock() {
    await cleanupOperatorFixture();
    const orphanWithoutHash = {
      contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
      platformAdminAssignmentId: WAVE6_ORPHAN_GRANT,
      userId: WAVE6_ORPHAN_USER,
      platformRole: "PLATFORM_SUPER_ADMIN" as const,
      status: "ACTIVE" as const,
      grantedAt: OCCURRED_AT,
      grantedByUserId: null,
      reason: "operator fidelity orphan fixture",
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
  }

  async function createRecoveryRole(options: RecoveryRoleOptions = {}) {
    const enabled = {
      bypassRls: true,
      schemaUsage: true,
      authUsersSelect: true,
      auditInsert: true,
      grantUpdate: true,
      revocationInsert: true,
      ...options,
    };
    await sql.unsafe(`create role ${RECOVERY_ROLE}
      login password '${RECOVERY_PASSWORD}'
      nosuperuser nocreatedb nocreaterole noreplication
      ${enabled.bypassRls ? "bypassrls" : "nobypassrls"}`);
    await sql.unsafe(`grant connect on database emberos_test to ${RECOVERY_ROLE}`);
    if (enabled.schemaUsage) {
      await sql.unsafe(`grant usage on schema public, auth to ${RECOVERY_ROLE}`);
    } else {
      await sql.unsafe(`grant usage on schema public to ${RECOVERY_ROLE}`);
    }
    if (enabled.authUsersSelect) {
      await sql.unsafe(`grant select on auth.users to ${RECOVERY_ROLE}`);
    }
    await sql.unsafe(`grant select, insert${enabled.grantUpdate ? ", update" : ""}
      on platform_admin_grants to ${RECOVERY_ROLE}`);
    await sql.unsafe(`grant select${enabled.revocationInsert ? ", insert" : ""}
      on platform_admin_revocations to ${RECOVERY_ROLE}`);
    await sql.unsafe(`grant select${enabled.auditInsert ? ", insert" : ""}
      on admin_audit_events to ${RECOVERY_ROLE}`);
  }

  function roleDatabaseUrl(): string {
    const value = getIntegrationDbUrl();
    if (!value) throw new Error("integration database URL missing");
    const url = new URL(value);
    url.username = RECOVERY_ROLE;
    url.password = RECOVERY_PASSWORD;
    return url.toString();
  }

  function runRealOperator() {
    const result = spawnSync(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        resolve(process.cwd(), "scripts/wave6-staging-platform-admin-recovery-02.ts"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          DATABASE_URL: "",
          STAGING_PLATFORM_ADMIN_RECOVERY_DATABASE_URL: roleDatabaseUrl(),
          EMBEROS_TEST_DB_ENVIRONMENT: "test",
          RUN_DB_INTEGRATION_TESTS: "1",
          WAVE6_RECOVERY_ALLOW_EPHEMERAL: "1",
        },
      }
    );
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  function parseSafeError(stderr: string) {
    const line = stderr.split(/\r?\n/).find((item) => item.startsWith("{"));
    if (!line) throw new Error("structured operator error missing");
    return JSON.parse(line) as {
      kind: string;
      stage: string;
      errorClass: string;
      databaseSqlState?: string;
      transactionBeginReached: boolean;
      firstSqlStage: string | null;
      firstSafeSqlFailureClass: string;
    };
  }

  it("executes the real operator as the exact non-superuser BYPASSRLS role", async () => {
    await seedOperatorDeadlock();
    await createRecoveryRole();
    try {
      const [role] = await sql<{
        rolsuper: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolbypassrls: boolean;
      }[]>`select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
          from pg_roles where rolname = ${RECOVERY_ROLE}`;
      expect(role).toEqual({
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: true,
      });
      const grants = await sql<{ table_schema: string; table_name: string; privilege_type: string }[]>`
        select table_schema, table_name, privilege_type
        from information_schema.role_table_grants
        where grantee = ${RECOVERY_ROLE}
        order by table_schema, table_name, privilege_type
      `;
      expect(grants).toEqual([
        { table_schema: "auth", table_name: "users", privilege_type: "SELECT" },
        { table_schema: "public", table_name: "admin_audit_events", privilege_type: "INSERT" },
        { table_schema: "public", table_name: "admin_audit_events", privilege_type: "SELECT" },
        { table_schema: "public", table_name: "platform_admin_grants", privilege_type: "INSERT" },
        { table_schema: "public", table_name: "platform_admin_grants", privilege_type: "SELECT" },
        { table_schema: "public", table_name: "platform_admin_grants", privilege_type: "UPDATE" },
        { table_schema: "public", table_name: "platform_admin_revocations", privilege_type: "INSERT" },
        { table_schema: "public", table_name: "platform_admin_revocations", privilege_type: "SELECT" },
      ]);
      const [scope] = await sql<{
        database_connect: boolean;
        public_usage: boolean;
        auth_usage: boolean;
        unrelated_write: boolean;
      }[]>`select
        has_database_privilege(${RECOVERY_ROLE}, current_database(), 'CONNECT') database_connect,
        has_schema_privilege(${RECOVERY_ROLE}, 'public', 'USAGE') public_usage,
        has_schema_privilege(${RECOVERY_ROLE}, 'auth', 'USAGE') auth_usage,
        exists (
          select 1 from information_schema.role_table_grants
          where grantee = ${RECOVERY_ROLE}
            and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
            and (table_schema, table_name) not in (
              ('public', 'platform_admin_grants'),
              ('public', 'platform_admin_revocations'),
              ('public', 'admin_audit_events')
            )
        ) unrelated_write`;
      expect(scope).toEqual({
        database_connect: true,
        public_usage: true,
        auth_usage: true,
        unrelated_write: false,
      });

      const result = runRealOperator();
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        recovered: true,
        orphanGrantStatus: "REVOKED",
        targetGrantStatus: "ACTIVE",
        activeOrphanCount: 0,
        activePlatformSuperAdminCount: 1,
        resolver: "ACTIVE_GRANT",
      });
      const [facts] = await sql<{
        orphan_status: string;
        active_count: number;
        revocation_count: number;
        accepted_audit_count: number;
        succeeded_audit_count: number;
      }[]>`select
        (select status from platform_admin_grants
          where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid) orphan_status,
        (select count(*)::int from platform_admin_grants
          where status='ACTIVE' and platform_role='PLATFORM_SUPER_ADMIN') active_count,
        (select count(*)::int from platform_admin_revocations
          where platform_admin_assignment_id=${WAVE6_ORPHAN_GRANT}::uuid) revocation_count,
        (select count(*)::int from admin_audit_events
          where action='WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY'
            and event_type='COMMAND_ACCEPTED') accepted_audit_count,
        (select count(*)::int from admin_audit_events
          where action='WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY'
            and event_type='COMMAND_SUCCEEDED') succeeded_audit_count`;
      expect(facts).toEqual({
        orphan_status: "REVOKED",
        active_count: 1,
        revocation_count: 1,
        accepted_audit_count: 1,
        succeeded_audit_count: 1,
      });
    } finally {
      await cleanupOperatorFixture();
    }
  });

  it.each([
    ["schema USAGE", { schemaUsage: false }, "TARGET_USER_LOOKUP"],
    ["auth.users SELECT", { authUsersSelect: false }, "TARGET_USER_LOOKUP"],
    ["admin audit INSERT", { auditInsert: false }, "AUDIT_ACCEPTED_WRITE"],
    ["grant UPDATE", { grantUpdate: false }, "ORPHAN_GRANT_LOCK"],
    ["revocation INSERT", { revocationInsert: false }, "REVOCATION_WRITE"],
    ["BYPASSRLS", { bypassRls: false }, "TARGET_USER_LOOKUP"],
  ] as const)("returns a safe structured error without %s", async (_name, options, stage) => {
    await seedOperatorDeadlock();
    await createRecoveryRole(options);
    try {
      const result = runRealOperator();
      expect(result.status).toBe(1);
      const safe = parseSafeError(result.stderr);
      expect(safe.kind).toBe("WAVE6_RECOVERY_OPERATOR_ERROR");
      expect(safe.stage).toBe(stage);
      expect(safe.transactionBeginReached).toBe(true);
      expect(safe.firstSqlStage).toBe(stage);
      expect(safe.firstSafeSqlFailureClass).toMatch(
        /DATABASE_PERMISSION_DENIED|TARGET_(?:AUTH_)?USER_|ORPHAN_/i
      );
      expect(result.stderr).not.toContain(RECOVERY_PASSWORD);
      expect(result.stderr).not.toContain("postgresql://");

      const [facts] = await sql<{
        orphan_status: string;
        target_count: number;
        audit_count: number;
      }[]>`select
        (select status from platform_admin_grants
          where platform_admin_assignment_id=${WAVE6_ORPHAN_GRANT}::uuid) orphan_status,
        (select count(*)::int from platform_admin_grants
          where user_id=${TARGET_USER_ID}::uuid) target_count,
        (select count(*)::int from admin_audit_events
          where action='WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY') audit_count`;
      expect(facts).toEqual({ orphan_status: "ACTIVE", target_count: 0, audit_count: 0 });
    } finally {
      await cleanupOperatorFixture();
    }
  });
});
