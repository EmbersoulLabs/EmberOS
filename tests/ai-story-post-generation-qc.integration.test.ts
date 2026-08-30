import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { RUN_DB_INTEGRATION, createIntegrationSql, getIntegrationDbUrl } from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("AI Story Post-Generation QC PostgreSQL authority", () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-post-generation-qc-v1.sql"), "utf8"));
  }, 30_000);
  afterAll(async () => { if (sql) await sql.end(); });

  it("installs additive RLS and immutable evidence authority", async () => {
    const [table] = await sql<{ relrowsecurity: boolean }[]>`select relrowsecurity from pg_class where relname='ai_story_post_generation_qc_evaluations'`;
    expect(table?.relrowsecurity).toBe(true);
    const triggers = await sql<{ tgname: string }[]>`select tgname from pg_trigger where tgrelid='ai_story_post_generation_qc_evaluations'::regclass and not tgisinternal`;
    expect(triggers.map((row) => row.tgname)).toContain("ai_story_post_qc_immutable_v1");
  });

  it("persists lineage, structured input/evaluation and aggregate separately", async () => {
    const columns = await sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name='ai_story_post_generation_qc_evaluations' and column_name in ('provider_attempt_id','media_asset_id','input_package','evaluation','aggregate_status','evaluation_fingerprint') order by column_name`;
    expect(columns.map((row) => row.column_name)).toEqual(["aggregate_status", "evaluation", "evaluation_fingerprint", "input_package", "media_asset_id", "provider_attempt_id"]);
  });
});
