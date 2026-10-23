import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  isRlsEnabled,
  seedRlsFixture,
  withAuthenticatedUser,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

const migration = readFileSync(
  resolve(process.cwd(), "packages/db/sql/core-tables-rls-backfill-v1.sql"),
  "utf8"
);

const TARGET_TABLES = [
  "ai_stories",
  "ai_story_versions",
  "ai_story_asset_links",
  "ai_story_creative_contexts",
  "ai_story_animation_packages",
  "ai_story_execution_jobs",
  "ai_story_execution_outputs",
  "knowledge_entries",
  "provider_executions",
  "provider_attempts",
  "provider_attempt_usage",
  "provider_attempt_costs",
  "provider_outbox_jobs",
  "provider_execution_envelopes",
  "provider_execution_dispatches",
] as const;

describeIntegration("Core tables RLS backfill (final-fix-v1 P0)", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  const storyA = randomUUID();
  const storyB = randomUUID();
  const execA = `exec-${randomUUID()}`;
  const execB = `exec-${randomUUID()}`;
  const attemptA = `attempt-${randomUUID()}`;
  const attemptB = `attempt-${randomUUID()}`;
  const globalKnowledgeId = randomUUID();

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);

    await sql.unsafe(`
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);

    await sql.unsafe(migration);
    // Idempotency: re-applying must not error or duplicate policies.
    await sql.unsafe(migration);

    // Mirrors Supabase's real default grants: every public-schema table is
    // exposed to anon/authenticated by default (RLS is the only restriction),
    // so the test fixture grants SELECT the same way production already does —
    // including on `workspaces`, which these policies' org_id cross-check reads.
    await sql.unsafe(`
      GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT ON workspaces TO authenticated;
      GRANT SELECT ON ai_stories, ai_story_versions, ai_story_asset_links,
        ai_story_creative_contexts, ai_story_animation_packages,
        ai_story_execution_jobs, ai_story_execution_outputs, knowledge_entries,
        provider_executions, provider_attempts, provider_attempt_usage,
        provider_attempt_costs, provider_outbox_jobs,
        provider_execution_envelopes, provider_execution_dispatches
        TO authenticated;
    `);

    await sql`
      INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea, status)
      VALUES
        (${storyA}, ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId}, 'Story A', 'idea A', 'draft'),
        (${storyB}, ${fixture.orgId}, ${fixture.workspaceBId}, ${fixture.campaignBId}, 'Story B', 'idea B', 'draft')
    `;
    await sql`
      INSERT INTO provider_executions (
        execution_id, contract_version, org_id, workspace_id, pipeline_run_id, capability_id,
        capability_version, idempotency_key, deterministic_fingerprint, request_hash,
        output_schema_id, output_schema_version, status, execution_metadata
      ) VALUES
        (${execA}, 'v1', ${fixture.orgId}, ${fixture.workspaceAId}, 'run-a', 'cap', 'v1', ${"idem-" + execA}, 'fp-a', 'rh-a', 'schema', 'v1', 'PENDING', '{}'),
        (${execB}, 'v1', ${fixture.orgId}, ${fixture.workspaceBId}, 'run-b', 'cap', 'v1', ${"idem-" + execB}, 'fp-b', 'rh-b', 'schema', 'v1', 'PENDING', '{}')
    `;
    await sql`
      INSERT INTO provider_attempts (
        attempt_id, execution_id, contract_version, attempt_number, provider_id, provider_version, model_version, request_hash, status
      ) VALUES
        (${attemptA}, ${execA}, 'v1', 0, 'openai', 'v1', 'gpt', 'rh-a', 'PENDING'),
        (${attemptB}, ${execB}, 'v1', 0, 'openai', 'v1', 'gpt', 'rh-b', 'PENDING')
    `;
    await sql`INSERT INTO provider_attempt_costs (attempt_id, cost) VALUES (${attemptA}, '{"usd":"1.00"}'), (${attemptB}, '{"usd":"2.00"}')`;
    await sql`
      INSERT INTO knowledge_entries (id, org_id, workspace_id, industry, category, content)
      VALUES (${globalKnowledgeId}, NULL, NULL, 'retail', 'hook', '{}')
    `;
  }, 60_000);

  afterAll(async () => {
    if (sql) {
      await sql`DELETE FROM provider_attempt_costs WHERE attempt_id IN (${attemptA}, ${attemptB})`;
      await sql`DELETE FROM provider_attempts WHERE attempt_id IN (${attemptA}, ${attemptB})`;
      await sql`DELETE FROM provider_executions WHERE execution_id IN (${execA}, ${execB})`;
      await sql`DELETE FROM ai_stories WHERE id IN (${storyA}, ${storyB})`;
      await sql`DELETE FROM knowledge_entries WHERE id = ${globalKnowledgeId}`;
      await cleanupRlsFixture(sql, fixture);
      await sql.end();
    }
  });

  it("enables RLS on every table in the backfill", async () => {
    for (const table of TARGET_TABLES) {
      expect(await isRlsEnabled(sql, table), `${table} should have RLS enabled`).toBe(true);
    }
  });

  it("direct workspace_id column (ai_stories): workspace members see only their own rows", async () => {
    const asA = await withAuthenticatedUser(sql, fixture.userAId, (tx) =>
      tx<{ id: string }[]>`select id from ai_stories where id in (${storyA}::uuid, ${storyB}::uuid)`
    );
    expect(asA.map((r) => r.id)).toEqual([storyA]);

    const asB = await withAuthenticatedUser(sql, fixture.userBId, (tx) =>
      tx<{ id: string }[]>`select id from ai_stories where id in (${storyA}::uuid, ${storyB}::uuid)`
    );
    expect(asB.map((r) => r.id)).toEqual([storyB]);

    const asStranger = await withAuthenticatedUser(sql, randomUUID(), (tx) =>
      tx<{ id: string }[]>`select id from ai_stories where id in (${storyA}::uuid, ${storyB}::uuid)`
    );
    expect(asStranger).toEqual([]);
  });

  it("direct workspace_id column (provider_executions): workspace members see only their own rows", async () => {
    const asA = await withAuthenticatedUser(sql, fixture.userAId, (tx) =>
      tx<{ execution_id: string }[]>`select execution_id from provider_executions where execution_id in (${execA}, ${execB})`
    );
    expect(asA.map((r) => r.execution_id)).toEqual([execA]);
  });

  it("1-hop EXISTS join (provider_attempts -> provider_executions): isolation holds through the join", async () => {
    const asA = await withAuthenticatedUser(sql, fixture.userAId, (tx) =>
      tx<{ attempt_id: string }[]>`select attempt_id from provider_attempts where attempt_id in (${attemptA}, ${attemptB})`
    );
    expect(asA.map((r) => r.attempt_id)).toEqual([attemptA]);
  });

  it("2-hop EXISTS join (provider_attempt_costs -> provider_attempts -> provider_executions): the exact gap this backfill closes", async () => {
    const asA = await withAuthenticatedUser(sql, fixture.userAId, (tx) =>
      tx<{ attempt_id: string }[]>`select attempt_id from provider_attempt_costs where attempt_id in (${attemptA}, ${attemptB})`
    );
    expect(asA.map((r) => r.attempt_id)).toEqual([attemptA]);

    const asB = await withAuthenticatedUser(sql, fixture.userBId, (tx) =>
      tx<{ attempt_id: string }[]>`select attempt_id from provider_attempt_costs where attempt_id in (${attemptA}, ${attemptB})`
    );
    expect(asB.map((r) => r.attempt_id)).toEqual([attemptB]);
  });

  it("nullable workspace_id (knowledge_entries): global rows stay visible to every authenticated workspace member", async () => {
    const asA = await withAuthenticatedUser(sql, fixture.userAId, (tx) =>
      tx<{ id: string }[]>`select id from knowledge_entries where id = ${globalKnowledgeId}::uuid`
    );
    expect(asA.map((r) => r.id)).toEqual([globalKnowledgeId]);
  });
});
