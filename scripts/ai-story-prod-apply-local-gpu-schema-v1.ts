/**
 * Apply the LOCAL_GPU schema chain to the AI Story production database.
 * Each file is one transaction. The first failure stops the chain.
 * Requires AI_STORY_PROD_MIGRATION_ALLOW and AI_STORY_PROD_MIGRATION_ACK.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  AI_STORY_PROD_MIGRATION_ACK,
  AI_STORY_PRODUCTION_SUPABASE_REF,
  isAiStoryProductionRef,
} from "../packages/shared/src/ai-story-production-ops";
import { parseSupabaseProjectRef } from "../packages/shared/src/photo-scene-production-ops";

const FILES = [
  "packages/db/sql/ai-story-manual-local-generation-handoff-v1.sql",
  "packages/db/sql/ai-story-provider-neutral-generation-result-v1.sql",
  "packages/db/sql/ai-story-local-generation-package-contract-v2.sql",
  "packages/db/sql/ai-story-sequential-manual-local-package-v3.sql",
  "packages/db/sql/ai-story-local-gpu-execution-mode-v1.sql",
] as const;

function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.AI_STORY_RAILWAY_VARS_FILE?.trim();
  if (!file) throw new Error("DATABASE_URL or AI_STORY_RAILWAY_VARS_FILE is required");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const url = typeof parsed.DATABASE_URL === "string" ? parsed.DATABASE_URL.trim() : "";
  if (!url) throw new Error("DATABASE_URL missing in Railway vars file");
  return url;
}

async function main() {
  const allow = process.env.AI_STORY_PROD_MIGRATION_ALLOW === "true";
  const ack = process.env.AI_STORY_PROD_MIGRATION_ACK;
  const url = databaseUrl();
  const ref = parseSupabaseProjectRef(url);
  if (!isAiStoryProductionRef(ref) || ref !== AI_STORY_PRODUCTION_SUPABASE_REF) {
    throw new Error("REFUSED: database ref is not the AI Story production target");
  }
  if (!(allow && ack === AI_STORY_PROD_MIGRATION_ACK)) {
    throw new Error(
      "REFUSED: production apply requires AI_STORY_PROD_MIGRATION_ALLOW=true and AI_STORY_PROD_MIGRATION_ACK=AI_STORY_SELF_USE_V1",
    );
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const [release] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('public.ai_story_scene_release_states') IS NOT NULL AS present
    `;
    const [packages] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('public.ai_story_local_generation_packages') IS NOT NULL AS present
    `;
    const [results] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('public.ai_story_generation_results') IS NOT NULL AS present
    `;
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ai_story_scene_release_states'
        AND column_name IN ('org_id', 'execution_mode')
    `;
    if (!release?.present || packages?.present || results?.present || columns.length > 0) {
      throw new Error("PRODUCTION_PREFLIGHT_SCHEMA_DIFFERS_FROM_AUDIT");
    }

    const [unjoined] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM ai_story_scene_release_states release
      WHERE NOT EXISTS (
        SELECT 1 FROM ai_story_scene_executions scene
        WHERE scene.id = release.scene_execution_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM ai_story_runtime_authorized_facts runtime_fact
        WHERE runtime_fact.runtime_authorization_id = release.runtime_authorization_id
      )
      OR NOT EXISTS (
        SELECT 1 FROM workspaces workspace
        WHERE workspace.id = release.workspace_id
      )
    `;
    if ((unjoined?.count ?? 0) > 0) {
      throw new Error(`SEQUENTIAL_LOCAL_V3_RELEASE_JOIN_INCOMPLETE:${unjoined?.count}`);
    }

    const classified = await sql<{ classification: string; count: number }[]>`
      WITH plan_lineage AS (
        SELECT
          release.execution_plan_id,
          bool_or(EXISTS (
            SELECT 1
            FROM ai_story_scene_scheduling_correlations correlation
            WHERE correlation.execution_plan_id = release.execution_plan_id
              AND correlation.runtime_authorization_id = release.runtime_authorization_id
              AND correlation.workspace_id = release.workspace_id
          )) AS provider_plan_proven,
          false AS manual_plan_proven,
          bool_and(release.created_at < timestamptz '2026-10-01T03:44:36Z') AS predates_manual_local_code,
          bool_and(
            scene.execution_plan_id = release.execution_plan_id
            AND scene.workspace_id = release.workspace_id
            AND scene.scene_order + 1 = release.scene_order
            AND runtime_fact.execution_plan_id = release.execution_plan_id
            AND runtime_fact.workspace_id = release.workspace_id
            AND runtime_fact.runtime_authorization_id = release.runtime_authorization_id
            AND runtime_fact.ordered_scene_execution_ids
              ->> (release.scene_order - 1) = release.scene_execution_id::text
          ) AS canonical_runtime_ledger,
          count(*) = max(jsonb_array_length(runtime_fact.ordered_scene_execution_ids)) AS complete_runtime_ledger,
          bool_or(
            release.scene_order = 1
            AND release.release_state = 'RELEASED'
            AND release.released_by = runtime_fact.authorized_by
            AND release.released_at IS NOT NULL
          ) AS canonical_initial_actor
        FROM ai_story_scene_release_states release
        JOIN ai_story_scene_executions scene ON scene.id = release.scene_execution_id
        JOIN ai_story_runtime_authorized_facts runtime_fact
          ON runtime_fact.runtime_authorization_id = release.runtime_authorization_id
        GROUP BY release.execution_plan_id
      )
      SELECT
        CASE
          WHEN lineage.manual_plan_proven THEN 'MANUAL_LOCAL_PROVEN'
          WHEN lineage.provider_plan_proven
            OR (
              lineage.predates_manual_local_code
              AND lineage.canonical_runtime_ledger
              AND lineage.complete_runtime_ledger
              AND lineage.canonical_initial_actor
            )
            THEN 'REMOTE_PROVIDER_PROVEN'
          ELSE 'UNKNOWN'
        END AS classification,
        count(*)::int AS count
      FROM ai_story_scene_release_states release
      JOIN plan_lineage lineage ON lineage.execution_plan_id = release.execution_plan_id
      GROUP BY 1
    `;
    const unknown = classified.find((row) => row.classification === "UNKNOWN")?.count ?? 0;
    if (unknown > 0) {
      throw new Error(`SEQUENTIAL_LOCAL_V3_UNCLASSIFIABLE_RELEASE_ROWS:${unknown}`);
    }
    console.log(JSON.stringify({
      PRODUCTION_PREFLIGHT_BEFORE_APPLY: "PASS",
      releaseClassifications: classified,
    }));

    for (const relative of FILES) {
      try {
        await sql.unsafe(readFileSync(resolve(relative), "utf8"));
      } catch (error) {
        console.error(JSON.stringify({
          FAILED_MIGRATION: relative,
          DATABASE_ERROR: error instanceof Error ? error.message : String(error),
          TRANSACTION_ROLLED_BACK: true,
        }));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify({ applied: relative }));
    }
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
