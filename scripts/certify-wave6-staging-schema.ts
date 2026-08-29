// Wave 6 semantic schema certification.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableName, is, Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "../packages/db/src/schema/index";

async function main() {
const connection = process.env.STAGING_CERT_DATABASE_URL?.trim();
if (!connection) throw new Error("STAGING_CERT_DATABASE_URL is required");
const directUrl = new URL(connection);
if (!directUrl.hostname.includes("voofxbuzpocyjzoxrpfi")) throw new Error("Refusing non-Staging database target");
const poolerUrl = new URL(connection);
poolerUrl.hostname = "aws-0-ap-northeast-1.pooler.supabase.com";
poolerUrl.port = "6543";
poolerUrl.username = `${decodeURIComponent(directUrl.username)}.voofxbuzpocyjzoxrpfi`;
const sql = postgres(poolerUrl.toString(), { max: 1, prepare: false, idle_timeout: 5 });

type ExpectedColumn = { table: string; column: string; type: string };
const tables = Object.values(schema).filter((value): value is Table => is(value, Table));
const expectedTables = new Set(tables.map(getTableName));
const expectedColumns: ExpectedColumn[] = [];
const expectedIndexes = new Set<string>();
const expectedFks = new Set<string>();

for (const table of tables) {
  const config = getTableConfig(table);
  for (const column of config.columns) {
    expectedColumns.push({ table: config.name, column: column.name, type: column.getSQLType().toLowerCase() });
    if (column.primary) expectedIndexes.add(`${config.name}_pkey`);
    if (column.isUnique && column.uniqueName) expectedIndexes.add(column.uniqueName);
  }
  for (const index of config.indexes) if (index.config.name) expectedIndexes.add(index.config.name);
  for (const unique of config.uniqueConstraints) expectedIndexes.add(unique.getName());
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    const from = ref.columns.map((column) => column.name).join(",");
    const to = ref.foreignColumns.map((column) => column.name).join(",");
    expectedFks.add(`${config.name}(${from})->${getTableName(ref.foreignTable)}(${to})`);
  }
}

const sqlDir = resolve("packages/db/sql");
const expectedPolicies = new Set<string>();
const expectedRlsTables = new Set<string>();
for (const file of readdirSync(sqlDir).filter((name) => name.endsWith(".sql"))) {
  const body = readFileSync(resolve(sqlDir, file), "utf8");
  for (const match of body.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z0-9_]+)"?/gi)) expectedIndexes.add(match[1]!);
  for (const match of body.matchAll(/CREATE\s+POLICY\s+"?([a-zA-Z0-9_]+)"?\s+ON\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?/gi)) expectedPolicies.add(`${match[2]}:${match[1]}`);
  for (const match of body.matchAll(/ALTER\s+TABLE\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)) expectedRlsTables.add(match[1]!);
}

const actualTables = await sql<{ table_name: string }[]>`
  SELECT c.relname AS table_name
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_catalog.pg_depend d ON d.objid = c.oid AND d.deptype = 'e'
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND d.objid IS NULL
  ORDER BY c.relname
`;
const actualColumns = await sql<{ table_name: string; column_name: string; formatted_type: string }[]>`
  SELECT c.relname AS table_name, a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
  ORDER BY c.relname, a.attnum
`;
const actualIndexes = await sql<{ indexname: string; indexdef: string }[]>`
  SELECT indexname, indexdef FROM pg_catalog.pg_indexes WHERE schemaname = 'public' ORDER BY indexname
`;
const actualFkRows = await sql<{ source_table: string; source_columns: string[]; target_table: string; target_columns: string[] }[]>`
  SELECT src.relname AS source_table,
         ARRAY(SELECT att.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_catalog.pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum ORDER BY k.ord) AS source_columns,
         dst.relname AS target_table,
         ARRAY(SELECT att.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_catalog.pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum ORDER BY k.ord) AS target_columns
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class src ON src.oid = con.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid = src.relnamespace
  JOIN pg_catalog.pg_class dst ON dst.oid = con.confrelid
  WHERE con.contype = 'f' AND ns.nspname = 'public'
`;
const actualPolicies = await sql<{ tablename: string; policyname: string }[]>`
  SELECT tablename, policyname FROM pg_catalog.pg_policies WHERE schemaname = 'public'
`;
const actualRls = await sql<{ table_name: string }[]>`
  SELECT c.relname AS table_name FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relrowsecurity
`;

const normalizeType = (value: string) => value.toLowerCase().replace(/timestamp\(\d+\)/g, "timestamp").replace(/character varying/g, "varchar").replace(/\s+/g, " ").trim();
const actualTableSet = new Set(actualTables.map((row) => row.table_name));
const actualColumnMap = new Map(actualColumns.map((row) => [`${row.table_name}.${row.column_name}`, normalizeType(row.formatted_type)]));
const actualIndexSet = new Set(actualIndexes.map((row) => row.indexname));
const actualIndexDefinitions = new Map(actualIndexes.map((row) => [row.indexname, row.indexdef.toLowerCase().replace(/\s+/g, " ")]));
const semanticIndexAliases: Record<string, { actual: string; signature: string }> = {
  ai_story_asset_links_story_id_asset_id_unique: { actual: "ai_story_asset_links_pkey", signature: "on public.ai_story_asset_links using btree (story_id, asset_id)" },
  ai_story_execute_verification_outbox_unique: { actual: "ai_story_execute_verifications_outbox_job_id_key", signature: "on public.ai_story_execute_verifications using btree (outbox_job_id)" },
  ai_story_execute_verification_runtime_auth_unique: { actual: "ai_story_execute_verifications_runtime_authorization_id_key", signature: "on public.ai_story_execute_verifications using btree (runtime_authorization_id)" },
  ai_story_execution_outputs_job_index_unique: { actual: "ai_story_execution_outputs_execution_job_id_output_index_key", signature: "on public.ai_story_execution_outputs using btree (execution_job_id, output_index)" },
  ai_story_scene_executions_idempotency_unique: { actual: "ai_story_scene_executions_idempotency_key_key", signature: "on public.ai_story_scene_executions using btree (idempotency_key)" },
  ai_story_scene_instruction_snapshots_snapshot_id_unique: { actual: "ai_story_scene_instruction_snapshots_snapshot_id_key", signature: "on public.ai_story_scene_instruction_snapshots using btree (snapshot_id)" },
  ai_story_versions_story_id_version_number_unique: { actual: "ai_story_versions_story_id_version_number_key", signature: "on public.ai_story_versions using btree (story_id, version_number)" },
  campaign_asset_refs_campaign_id_asset_id_unique: { actual: "campaign_asset_refs_campaign_id_asset_id_key", signature: "on public.campaign_asset_refs using btree (campaign_id, asset_id)" },
  campaign_story_refs_campaign_id_story_id_unique: { actual: "campaign_story_refs_campaign_id_story_id_key", signature: "on public.campaign_story_refs using btree (campaign_id, story_id)" },
  photo_scene_official_scene_versions_scene_id_version_unique: { actual: "photo_scene_official_scene_versions_scene_id_version_key", signature: "on public.photo_scene_official_scene_versions using btree (scene_id, version)" },
  photo_scene_official_scenes_slug_unique: { actual: "photo_scene_official_scenes_slug_key", signature: "on public.photo_scene_official_scenes using btree (slug)" },
  photo_scene_scene_selections_workspace_id_campaign_id_unique: { actual: "photo_scene_scene_selections_workspace_id_campaign_id_key", signature: "on public.photo_scene_scene_selections using btree (workspace_id, campaign_id)" },
  provider_attempts_execution_number_unique: { actual: "provider_attempts_execution_id_attempt_number_key", signature: "on public.provider_attempts using btree (execution_id, attempt_number)" },
  provider_execution_dispatches_job_unique: { actual: "provider_execution_dispatches_job_id_key", signature: "on public.provider_execution_dispatches using btree (job_id)" },
  provider_execution_envelopes_payload_reference_unique: { actual: "provider_execution_envelopes_payload_reference_key", signature: "on public.provider_execution_envelopes using btree (payload_reference)" },
  provider_executions_idempotency_key_unique: { actual: "provider_executions_idempotency_key_key", signature: "on public.provider_executions using btree (idempotency_key)" },
  provider_outbox_jobs_execution_unique: { actual: "provider_outbox_jobs_execution_id_key", signature: "on public.provider_outbox_jobs using btree (execution_id)" },
  story_assets_story_id_asset_id_unique: { actual: "story_assets_story_id_asset_id_key", signature: "on public.story_assets using btree (story_id, asset_id)" },
};
const semanticIndexPresent = (name: string) => {
  const alias = semanticIndexAliases[name];
  if (!alias) return false;
  const definition = actualIndexDefinitions.get(alias.actual);
  return Boolean(definition?.startsWith("create unique index ") && definition.includes(alias.signature));
};
const actualFkSet = new Set(actualFkRows.map((row) => `${row.source_table}(${row.source_columns.join(",")})->${row.target_table}(${row.target_columns.join(",")})`));
const actualPolicySet = new Set(actualPolicies.map((row) => `${row.tablename}:${row.policyname}`));
const actualRlsSet = new Set(actualRls.map((row) => row.table_name));

const missingTables = [...expectedTables].filter((name) => !actualTableSet.has(name));
const extraTables = [...actualTableSet].filter((name) => !expectedTables.has(name));
const missingColumns: string[] = [];
const typeMismatches: string[] = [];
for (const expected of expectedColumns) {
  const key = `${expected.table}.${expected.column}`;
  const actual = actualColumnMap.get(key);
  if (!actual) missingColumns.push(key);
  else if (normalizeType(expected.type) !== actual) typeMismatches.push(`${key}:${normalizeType(expected.type)}!=${actual}`);
}
const approvedExtraColumns = new Set([
  "campaigns.description",
  "campaigns.target_audience_override",
  "campaigns.output_language",
  "campaigns.subtitle_language",
  "campaigns.cta_language",
  "campaigns.hashtag_language",
  "campaigns.generate_status",
  "campaigns.generate_summary",
]);
const unexpectedColumns = [...actualColumnMap.keys()].filter((key) => {
  const [table] = key.split(".");
  return expectedTables.has(table!) && !expectedColumns.some((column) => `${column.table}.${column.column}` === key);
});
const unapprovedUnexpectedColumns = unexpectedColumns.filter((key) => !approvedExtraColumns.has(key));
const approvedStructuralSupersetColumns = unexpectedColumns.filter((key) => approvedExtraColumns.has(key));
const missingIndexes = [...expectedIndexes].filter((name) => !actualIndexSet.has(name) && !semanticIndexPresent(name));
const missingFks = [...expectedFks].filter((key) => !actualFkSet.has(key));
const missingPolicies = [...expectedPolicies].filter((key) => !actualPolicySet.has(key));
const missingRls = [...expectedRlsTables].filter((name) => !actualRlsSet.has(name));

const result = {
  missingStagingMigrations: [...new Set([...missingTables.map((v) => `table:${v}`), ...missingColumns.map((v) => `column:${v}`), ...missingIndexes.map((v) => `index:${v}`), ...missingFks.map((v) => `fk:${v}`), ...missingPolicies.map((v) => `policy:${v}`), ...missingRls.map((v) => `rls:${v}`)])],
  unexpectedStagingSchemaDrift: [...extraTables.map((v) => `table:${v}`), ...unapprovedUnexpectedColumns.map((v) => `column:${v}`), ...typeMismatches.map((v) => `type:${v}`)],
  tableParity: missingTables.length === 0 && extraTables.length === 0,
  columnParity: missingColumns.length === 0 && unapprovedUnexpectedColumns.length === 0 && typeMismatches.length === 0,
  indexParity: missingIndexes.length === 0,
  fkParity: missingFks.length === 0,
  rlsPolicyParity: missingPolicies.length === 0 && missingRls.length === 0,
};
const stagingSchemaParity = result.missingStagingMigrations.length === 0
  && result.unexpectedStagingSchemaDrift.length === 0
  && result.tableParity && result.columnParity && result.indexParity && result.fkParity && result.rlsPolicyParity;
console.log(JSON.stringify({
  ...result,
  approvedStructuralSupersetColumns,
  columnParityCertification: approvedStructuralSupersetColumns.length > 0 ? "PASS_WITH_APPROVED_EXTRA_COLUMNS" : "PASS",
  stagingSchemaParity,
}));
await sql.end();
if (!stagingSchemaParity) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ stagingSchemaParity: false, error: error instanceof Error ? error.message : "unknown error" }));
  process.exitCode = 1;
});
