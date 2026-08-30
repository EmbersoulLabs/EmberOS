import { randomUUID } from "node:crypto";
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
  resolve(process.cwd(), "packages/db/sql/ai-story-post-generation-qc-v1.sql"),
  "utf8",
);

function schemaName(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

async function installPredecessor(sql: Sql, schema: string): Promise<void> {
  await sql.unsafe(`CREATE SCHEMA ${schema}`);
  await sql.unsafe(`
    SET search_path TO ${schema}, public;
    CREATE TABLE organizations(id uuid PRIMARY KEY);
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE provider_attempts(attempt_id text PRIMARY KEY);
    CREATE TABLE ai_story_durable_scene_media_attestations(media_attestation_id uuid PRIMARY KEY);
    CREATE TABLE ai_story_scene_executions(id uuid PRIMARY KEY);
    CREATE TABLE workspace_members(workspace_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL);
  `);
}

describeIntegration("AI Story Post-QC migration predecessor-schema authority", () => {
  let sql: Sql;
  const defectiveSchema = schemaName("post_qc_defective");
  const correctedSchema = schemaName("post_qc_corrected");

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${defectiveSchema} CASCADE`);
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${correctedSchema} CASCADE`);
    await sql.end();
  });

  it("exercises the real CREATE TABLE path and detects the current invalid parent FK", async () => {
    await installPredecessor(sql, defectiveSchema);
    const before = await sql<{ table_name: string | null }[]>`
      SELECT to_regclass(${`${defectiveSchema}.ai_story_post_generation_qc_evaluations`})::text AS table_name
    `;
    expect(before[0]?.table_name).toBeNull();

    let errorCode: string | undefined;
    try {
      await sql.unsafe(`SET search_path TO ${defectiveSchema}, public; ${migration}`);
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    expect(errorCode).toBe("42703");

    const after = await sql<{ table_name: string | null }[]>`
      SELECT to_regclass(${`${defectiveSchema}.ai_story_post_generation_qc_evaluations`})::text AS table_name
    `;
    expect(after[0]?.table_name).toBeNull();
  });

  it("proves the isolated predecessor can accept the bounded canonical target correction", async () => {
    await installPredecessor(sql, correctedSchema);
    const corrected = migration.replace(
      "REFERENCES ai_story_scene_executions(scene_execution_id)",
      "REFERENCES ai_story_scene_executions(id)",
    );
    expect(corrected).not.toBe(migration);
    await sql.unsafe(`SET search_path TO ${correctedSchema}, public; ${corrected}`);

    const foreignKeys = await sql<{ child_column: string; parent_column: string }[]>`
      SELECT child.attname AS child_column, parent.attname AS parent_column
      FROM pg_constraint constraint_row
      JOIN pg_class child_table ON child_table.oid = constraint_row.conrelid
      JOIN pg_namespace child_schema ON child_schema.oid = child_table.relnamespace
      JOIN pg_class parent_table ON parent_table.oid = constraint_row.confrelid
      JOIN pg_attribute child ON child.attrelid = child_table.oid AND child.attnum = constraint_row.conkey[1]
      JOIN pg_attribute parent ON parent.attrelid = parent_table.oid AND parent.attnum = constraint_row.confkey[1]
      WHERE constraint_row.contype = 'f'
        AND child_schema.nspname = ${correctedSchema}
        AND child_table.relname = 'ai_story_post_generation_qc_evaluations'
        AND parent_table.relname = 'ai_story_scene_executions'
    `;
    expect(foreignKeys).toEqual([{ child_column: "scene_execution_id", parent_column: "id" }]);
  });
});
