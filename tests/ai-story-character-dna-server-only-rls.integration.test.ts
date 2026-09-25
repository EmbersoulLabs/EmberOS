import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const migration = readFileSync(
  resolve(process.cwd(), "packages/db/sql/ai-story-character-dna-analysis-jobs-server-only-rls-v1.sql"),
  "utf8"
);

async function expectRoleDenied(sql: Sql, role: "anon" | "authenticated", statement: string) {
  await expect(sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    await tx.unsafe(statement);
  })).rejects.toThrow(/permission denied/i);
}

describeIntegration("Character DNA analysis jobs server-only RLS", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      ALTER ROLE service_role BYPASSRLS;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL PRIVILEGES ON TABLE public.ai_story_character_dna_analysis_jobs TO anon, authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_story_character_dna_analysis_jobs TO service_role;
    `);
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end();
  });

  it("applies idempotently without mutating predecessor rows", async () => {
    const before = await sql<{ count: number; fingerprint: string }[]>`
      select count(*)::int count,
        md5(coalesce(sum(hashtextextended(to_jsonb(t)::text, 0)::numeric)::text, '0')) fingerprint
      from public.ai_story_character_dna_analysis_jobs t
    `;
    await sql.unsafe(migration);
    await sql.unsafe(migration);
    const after = await sql<{ count: number; fingerprint: string }[]>`
      select count(*)::int count,
        md5(coalesce(sum(hashtextextended(to_jsonb(t)::text, 0)::numeric)::text, '0')) fingerprint
      from public.ai_story_character_dna_analysis_jobs t
    `;
    expect(after).toEqual(before);
  });

  it("enables RLS, leaves no client policy, and removes every client privilege", async () => {
    const [security] = await sql<{
      rls: boolean;
      force_rls: boolean;
      policy_count: number;
      anon_privileges: string[];
      authenticated_privileges: string[];
    }[]>`
      select c.relrowsecurity rls,
        c.relforcerowsecurity force_rls,
        (select count(*)::int from pg_policies p where p.schemaname='public' and p.tablename=c.relname) policy_count,
        array(select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=c.relname and grantee='anon' order by privilege_type) anon_privileges,
        array(select privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=c.relname and grantee='authenticated' order by privilege_type) authenticated_privileges
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='ai_story_character_dna_analysis_jobs'
    `;
    expect(security).toEqual({
      rls: true,
      force_rls: false,
      policy_count: 0,
      anon_privileges: [],
      authenticated_privileges: [],
    });
  });

  it("denies SELECT, INSERT, UPDATE, and DELETE to anon and authenticated", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expectRoleDenied(sql, role, "select * from public.ai_story_character_dna_analysis_jobs limit 1");
      await expectRoleDenied(sql, role, "insert into public.ai_story_character_dna_analysis_jobs default values");
      await expectRoleDenied(sql, role, "update public.ai_story_character_dna_analysis_jobs set status=status");
      await expectRoleDenied(sql, role, "delete from public.ai_story_character_dna_analysis_jobs");
    }
  });

  it("preserves the existing trusted server role lifecycle access", async () => {
    const privileges = await sql<{ privilege_type: string }[]>`
      select privilege_type from information_schema.role_table_grants
      where table_schema='public' and table_name='ai_story_character_dna_analysis_jobs'
        and grantee='service_role'
      order by privilege_type
    `;
    expect(privileges.map((row) => row.privilege_type)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role service_role");
      await tx`select job_id from public.ai_story_character_dna_analysis_jobs limit 1`;
      await tx`update public.ai_story_character_dna_analysis_jobs set status=status where false`;
    });
  });
});
