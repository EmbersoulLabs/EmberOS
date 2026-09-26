import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl()
  ? describe
  : describe.skip;

describeIntegration("AI Story canonical profile persistence migration", () => {
  let sql: Sql;
  const schemaName = `profile_authority_${process.pid}`;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      CREATE SCHEMA ${schemaName};
      CREATE TABLE ${schemaName}.ai_story_outline_versions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        profile_id text NOT NULL CONSTRAINT ai_story_outline_profile_id_check
          CHECK (profile_id = 'CORE')
      );
      CREATE TABLE ${schemaName}.ai_story_script_versions (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        profile_id text NOT NULL CONSTRAINT ai_story_script_profile_check
          CHECK (profile_id = 'CORE')
      );
      INSERT INTO ${schemaName}.ai_story_outline_versions(profile_id) VALUES ('CORE');
      INSERT INTO ${schemaName}.ai_story_script_versions(profile_id) VALUES ('CORE');
    `);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await sql.end();
  });

  it("widens predecessor checks without mutating existing authority rows", async () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/db/sql/ai-story-outline-profile-authorities-v1.sql"),
      "utf8",
    );
    const migration = source.replaceAll("public.", `${schemaName}.`);

    await sql.unsafe(migration);
    await sql.unsafe(migration);

    const [beforeInsert] = await sql.unsafe<{ outlines: number; scripts: number }[]>(`
      SELECT
        (SELECT count(*)::int FROM ${schemaName}.ai_story_outline_versions) AS outlines,
        (SELECT count(*)::int FROM ${schemaName}.ai_story_script_versions) AS scripts
    `);
    expect(beforeInsert).toEqual({ outlines: 1, scripts: 1 });

    await sql.unsafe(`
      INSERT INTO ${schemaName}.ai_story_outline_versions(profile_id)
      VALUES ('PRODUCT_STORY'), ('COMMERCIAL_STORY');
      INSERT INTO ${schemaName}.ai_story_script_versions(profile_id)
      VALUES ('PRODUCT_STORY'), ('COMMERCIAL_STORY');
    `);

    await expect(
      sql.unsafe(`INSERT INTO ${schemaName}.ai_story_outline_versions(profile_id) VALUES ('UNREGISTERED')`),
    ).rejects.toThrow(/ai_story_outline_profile_id_check/i);
    await expect(
      sql.unsafe(`INSERT INTO ${schemaName}.ai_story_script_versions(profile_id) VALUES ('UNREGISTERED')`),
    ).rejects.toThrow(/ai_story_script_profile_check/i);
  });
});

