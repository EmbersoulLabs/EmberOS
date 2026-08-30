import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import * as schema from "../packages/db/src/schema/index";
import { getTableConfig } from "drizzle-orm/pg-core";

type Mode = "predecessor" | "apply" | "post";
type Manifest = {
  manifestVersion: number;
  manifestId: string;
  authorityModel: string;
  databaseAuthorityRevision: string;
  target: { environment: string; railwayProjectId: string; railwayEnvironmentId: string };
  orderedMigrations: Array<{ order: number; id: string; path: string; sha256: string }>;
  predecessor: {
    requiredParentTable: string;
    requiredParentPrimaryKey: string;
    requiredAbsentTable: string;
    fixtureCampaignId: string;
    fixtureStoryId: string;
  };
  result: { table: string; sceneExecutionForeignKeyTarget: string };
};

const originalAuthorityTables = [
  "ai_story_canonical_scene_versions", "ai_story_canonical_scenes", "ai_story_cast_promotions",
  "ai_story_character_versions", "ai_story_characters", "ai_story_compiled_provider_requests",
  "ai_story_director_plan_versions", "ai_story_location_promotions", "ai_story_location_versions",
  "ai_story_locations", "ai_story_motion_plan_versions", "ai_story_outline_versions",
  "ai_story_post_generation_qc_evaluations", "ai_story_pre_generation_qc_evaluations",
  "ai_story_provider_attempt_compiled_bindings", "ai_story_script_director_handoffs",
  "ai_story_script_versions", "ai_story_supporting_character_versions", "ai_story_supporting_characters",
] as const;

const manifestPath = resolve("packages/db/releases/ai-story-post-generation-qc-v1-staging.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
const migration = manifest.orderedMigrations[0];
if (!migration || manifest.orderedMigrations.length !== 1 || migration.order !== 11) throw new Error("ORDERED_MANIFEST_INVALID");
const migrationSql = readFileSync(resolve(migration.path), "utf8").replace(/\r\n/g, "\n");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function certificate(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value, certificate: `sha256:${sha256(stable(value))}` };
}

function assertEnvironment(): void {
  if (process.env.EMBEROS_DB_TARGET_ENVIRONMENT !== manifest.target.environment) throw new Error("STAGING_TARGET_ACK_REQUIRED");
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== manifest.target.environment) throw new Error("RAILWAY_STAGING_ENVIRONMENT_REQUIRED");
  if (process.env.RAILWAY_PROJECT_ID !== manifest.target.railwayProjectId) throw new Error("RAILWAY_PROJECT_ID_MISMATCH");
  if (process.env.RAILWAY_ENVIRONMENT_ID !== manifest.target.railwayEnvironmentId) throw new Error("RAILWAY_ENVIRONMENT_ID_MISMATCH");
  if (sha256(migrationSql) !== migration.sha256) throw new Error("SQL_ARTIFACT_HASH_MISMATCH");
}

async function databaseIdentity(sql: Sql): Promise<Record<string, unknown>> {
  const [row] = await sql<{ database_name: string; server_version: string }[]>`
    SELECT current_database() AS database_name, current_setting('server_version') AS server_version
  `;
  return {
    environment: manifest.target.environment,
    databaseIdentity: `sha256:${sha256(`${manifest.target.railwayProjectId}:${manifest.target.railwayEnvironmentId}:${row?.database_name}`)}`,
    serverVersion: row?.server_version,
  };
}

async function tablePresence(sql: Sql, names: readonly string[]): Promise<Record<string, boolean>> {
  const rows = await sql<{ name: string; present: boolean }[]>`
    SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
    FROM unnest(${sql.array([...names])}::text[]) AS name
  `;
  return Object.fromEntries(rows.map((row) => [row.name, row.present]));
}

async function certifyPredecessor(sql: Sql): Promise<Record<string, unknown>> {
  const requiredBefore = originalAuthorityTables.filter((name) => name !== manifest.predecessor.requiredAbsentTable);
  const presence = await tablePresence(sql, [...requiredBefore, manifest.predecessor.requiredAbsentTable,
    "organizations", "workspaces", "provider_attempts", "ai_story_durable_scene_media_attestations",
    "ai_story_scene_executions", "workspace_members"]);
  const missing = requiredBefore.filter((name) => !presence[name]);
  const finalTableAbsent = presence[manifest.predecessor.requiredAbsentTable] === false;
  const [parentKey] = await sql<{ primary_key: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      JOIN pg_namespace n ON n.oid=t.relnamespace
      JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(c.conkey)
      WHERE n.nspname='public' AND t.relname=${manifest.predecessor.requiredParentTable}
        AND c.contype='p' AND a.attname=${manifest.predecessor.requiredParentPrimaryKey}
    ) AS primary_key
  `;
  const [partial] = await sql<{ functions: number; indexes: number; policies: number; triggers: number }[]>`
    SELECT
      (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='enforce_ai_story_post_qc_immutable_v1') AS functions,
      (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relkind='i' AND c.relname LIKE 'ai_story_post_qc_%') AS indexes,
      (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND tablename=${manifest.predecessor.requiredAbsentTable}) AS policies,
      (SELECT count(*)::int FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname=${manifest.predecessor.requiredAbsentTable} AND NOT tr.tgisinternal) AS triggers
  `;
  const [fixture] = await sql<{ campaign: boolean; story: boolean }[]>`
    SELECT EXISTS(SELECT 1 FROM campaigns WHERE id=${manifest.predecessor.fixtureCampaignId}::uuid) AS campaign,
      EXISTS(SELECT 1 FROM ai_stories WHERE id=${manifest.predecessor.fixtureStoryId}::uuid) AS story
  `;
  const partialCount = Number(partial?.functions ?? 0) + Number(partial?.indexes ?? 0)
    + Number(partial?.policies ?? 0) + Number(partial?.triggers ?? 0);
  const pass = missing.length === 0 && finalTableAbsent && parentKey?.primary_key === true && partialCount === 0
    && fixture?.campaign === true && fixture?.story === true;
  const result = certificate({ kind: "AI_STORY_POST_QC_PREDECESSOR", manifestId: manifest.manifestId,
    migrationOrder: migration.order, sqlArtifactHash: `sha256:${migration.sha256}`,
    missingRequiredTables: missing, finalTableAbsent, canonicalParentPrimaryKey: parentKey?.primary_key === true,
    partialPostQcObjects: partialCount, campaignRetained: fixture?.campaign === true,
    storyRetained: fixture?.story === true, pass });
  if (!pass) throw new Error(`STAGING_PREDECESSOR_DIVERGENT:${stable(result)}`);
  return result;
}

function expectedProtectedTables(): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (!(key === "aiStories" || key.startsWith("aiStory"))) continue;
    try {
      const config = getTableConfig(value as never);
      if (config.name === "ai_stories" || config.name.startsWith("ai_story_")) names.push(config.name);
    } catch { /* Non-table exports with the same prefix are ignored. */ }
  }
  return [...new Set(names)].sort();
}

async function certifyPost(sql: Sql): Promise<Record<string, unknown>> {
  const allExpected = expectedProtectedTables();
  const actualRows = await sql<{ name: string }[]>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname='public' AND (tablename='ai_stories' OR tablename LIKE 'ai_story_%') ORDER BY tablename
  `;
  const actual = actualRows.map((row) => row.name);
  const missingTables = allExpected.filter((name) => !actual.includes(name));
  const extraTables = actual.filter((name) => !allExpected.includes(name));
  const originalPresence = await tablePresence(sql, originalAuthorityTables);
  const originalParity = originalAuthorityTables.every((name) => originalPresence[name]);
  const columns = await sql<{ column_name: string; data_type: string; column_default: string | null; is_nullable: string }[]>`
    SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${manifest.result.table} ORDER BY ordinal_position
  `;
  const expectedColumns = ["post_qc_evaluation_id", "post_qc_input_id", "evaluation_version", "org_id", "workspace_id",
    "provider_attempt_id", "media_asset_id", "scene_execution_id", "aggregate_status", "evaluation_fingerprint",
    "input_package", "evaluation", "evaluated_at", "created_at"];
  const columnsPass = columns.map((row) => row.column_name).join(",") === expectedColumns.join(",");
  const [primaryKey] = await sql<{ columns: string[] }[]>`
    SELECT array_agg(a.attname ORDER BY key_column.ordinality)::text[] AS columns
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key_column.attnum
    WHERE n.nspname='public' AND t.relname=${manifest.result.table} AND c.contype='p' GROUP BY c.oid
  `;
  const foreignKeys = await sql<{ child_column: string; parent_table: string; parent_column: string }[]>`
    SELECT child.attname AS child_column, parent_table.relname AS parent_table, parent.attname AS parent_column
    FROM pg_constraint c JOIN pg_class child_table ON child_table.oid=c.conrelid
    JOIN pg_namespace child_schema ON child_schema.oid=child_table.relnamespace
    JOIN pg_class parent_table ON parent_table.oid=c.confrelid
    JOIN pg_attribute child ON child.attrelid=child_table.oid AND child.attnum=c.conkey[1]
    JOIN pg_attribute parent ON parent.attrelid=parent_table.oid AND parent.attnum=c.confkey[1]
    WHERE c.contype='f' AND child_schema.nspname='public' AND child_table.relname=${manifest.result.table}
    ORDER BY child.attname
  `;
  const expectedForeignKeys = ["media_asset_id:ai_story_durable_scene_media_attestations.media_attestation_id",
    "org_id:organizations.id", "provider_attempt_id:provider_attempts.attempt_id",
    "scene_execution_id:ai_story_scene_executions.id", "workspace_id:workspaces.id"];
  const actualForeignKeys = foreignKeys.map((row) => `${row.child_column}:${row.parent_table}.${row.parent_column}`).sort();
  const foreignKeysPass = actualForeignKeys.join(",") === expectedForeignKeys.join(",");
  const constraints = await sql<{ name: string; type: string; definition: string }[]>`
    SELECT c.conname AS name, c.contype::text AS type, pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=${manifest.result.table} ORDER BY c.conname
  `;
  const indexes = await sql<{ name: string }[]>`
    SELECT indexname AS name FROM pg_indexes WHERE schemaname='public' AND tablename=${manifest.result.table} ORDER BY indexname
  `;
  const [rls] = await sql<{ enabled: boolean }[]>`
    SELECT c.relrowsecurity AS enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=${manifest.result.table}
  `;
  const policies = await sql<{ policyname: string }[]>`
    SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=${manifest.result.table} ORDER BY policyname
  `;
  const [trigger] = await sql<{ trigger_name: string; function_name: string; definition: string }[]>`
    SELECT tr.tgname AS trigger_name, p.proname AS function_name, pg_get_triggerdef(tr.oid) AS definition
    FROM pg_trigger tr JOIN pg_class t ON t.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_proc p ON p.oid=tr.tgfoid
    WHERE n.nspname='public' AND t.relname=${manifest.result.table} AND NOT tr.tgisinternal
  `;
  const [immutableFunction] = await sql<{ definition: string }[]>`
    SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='enforce_ai_story_post_qc_immutable_v1'
  `;
  const [publicPrivileges] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name=${manifest.result.table} AND grantee='PUBLIC'
      AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  `;
  const expectedIndexes = ["ai_story_post_generation_qc_evaluations_pkey", "ai_story_post_qc_attempt_idx",
    "ai_story_post_qc_fingerprint_unique", "ai_story_post_qc_input_version_unique",
    "ai_story_post_qc_media_idx", "ai_story_post_qc_workspace_idx"];
  const indexPass = expectedIndexes.every((name) => indexes.some((row) => row.name === name));
  const checksPass = constraints.filter((row) => row.type === "c").length === 3;
  const uniquePass = constraints.filter((row) => row.type === "u").length === 2;
  const immutablePass = trigger?.trigger_name === "ai_story_post_qc_immutable_v1"
    && trigger.function_name === "enforce_ai_story_post_qc_immutable_v1"
    && /BEFORE UPDATE OR DELETE/.test(trigger.definition) && /immutable/.test(immutableFunction?.definition ?? "");
  const policyPass = policies.map((row) => row.policyname).join(",") === "ai_story_post_qc_insert,ai_story_post_qc_select";
  const pass = missingTables.length === 0 && extraTables.length === 0 && originalParity && columnsPass
    && primaryKey?.columns?.join(",") === "post_qc_evaluation_id" && foreignKeysPass && checksPass && uniquePass
    && indexPass && rls?.enabled === true && policyPass && immutablePass && Number(publicPrivileges?.count ?? 0) === 0;
  const result = certificate({ kind: "AI_STORY_V1_POST_APPLICATION_CATALOG", manifestId: manifest.manifestId,
    authorityModel: manifest.authorityModel, sqlArtifactHash: `sha256:${migration.sha256}`,
    protectedTableCount: allExpected.length, missingProtectedTables: missingTables, extraProtectedTables: extraTables,
    originalTableParity: originalParity,
    postQc: { columns: columnsPass, typesAndDefaults: columns.length === expectedColumns.length && columns.every((c) => c.data_type.length > 0),
      primaryKey: primaryKey?.columns?.join(",") === "post_qc_evaluation_id", foreignKeys: foreignKeysPass,
      constraints: checksPass && uniquePass, indexes: indexPass, rls: rls?.enabled === true, policies: policyPass,
      grants: Number(publicPrivileges?.count ?? 0) === 0, immutability: immutablePass,
      sceneExecutionForeignKeyTarget: actualForeignKeys.includes("scene_execution_id:ai_story_scene_executions.id") }, pass });
  if (!pass) throw new Error(`POST_APPLICATION_CATALOG_DIVERGENT:${stable(result)}`);
  return result;
}

async function main(): Promise<void> {
  const mode = process.argv[2] as Mode | undefined;
  if (!mode || !["predecessor", "apply", "post"].includes(mode)) throw new Error("MODE_REQUIRED");
  assertEnvironment();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_REQUIRED");
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const identity = await databaseIdentity(sql);
    if (mode === "predecessor") {
      console.log(JSON.stringify({ identity, predecessor: await certifyPredecessor(sql) }));
      return;
    }
    if (mode === "post") {
      console.log(JSON.stringify({ identity, catalog: await certifyPost(sql) }));
      return;
    }
    const predecessor = await certifyPredecessor(sql);
    const catalog = await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
      return certifyPost(tx);
    });
    console.log(JSON.stringify({ identity, manifestId: manifest.manifestId, predecessor, catalog, transaction: "COMMITTED" }));
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
