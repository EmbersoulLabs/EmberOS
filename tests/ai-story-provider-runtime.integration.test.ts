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

describeIntegration("AI Story compiled request runtime PostgreSQL authority", () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-provider-runtime-v1.sql"), "utf8"));
  }, 30_000);

  afterAll(async () => { if (sql) await sql.end(); });

  it("installs additive durable authority with RLS and immutable compilation evidence", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
      where relname in ('ai_story_compiled_provider_requests','ai_story_provider_attempt_compiled_bindings')
      order by relname
    `;
    expect(rows).toEqual([
      { relname: "ai_story_compiled_provider_requests", relrowsecurity: true },
      { relname: "ai_story_provider_attempt_compiled_bindings", relrowsecurity: true },
    ]);
    const triggers = await sql<{ tgname: string }[]>`
      select tgname from pg_trigger
      where tgrelid='ai_story_compiled_provider_requests'::regclass and not tgisinternal
    `;
    expect(triggers.map((row) => row.tgname)).toContain("ai_story_compiled_request_immutable_v1");
  });

  it("keeps immutable input and operational Attempt state in separate tables", async () => {
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      select table_name,column_name from information_schema.columns
      where table_name in ('ai_story_compiled_provider_requests','ai_story_provider_attempt_compiled_bindings')
        and column_name in ('compiled_request','binding','provider_task_id','request_fingerprint')
      order by table_name,column_name
    `;
    expect(columns).toEqual([
      { table_name: "ai_story_compiled_provider_requests", column_name: "compiled_request" },
      { table_name: "ai_story_compiled_provider_requests", column_name: "request_fingerprint" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "binding" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "provider_task_id" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "request_fingerprint" },
    ]);
  });
});
