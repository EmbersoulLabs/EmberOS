import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertIsolatedTestDatabase, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";
import { installCertificationNetworkIsolation } from "./helpers/certification-network-isolation";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("PRODUCTION_PREDECESSOR_POSTGRES_REQUIRED_IN_CI");
}
const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

type CatalogTable = {
  table: string;
  rls: boolean;
  forceRls: boolean;
  columns: unknown[];
  constraints: unknown[];
  indexes: unknown[];
  policies: unknown[];
  triggers: unknown[];
};
type MigrationEntry = {
  order: number;
  file: string;
  requires: string[];
  provides: string[];
  destructive: boolean;
  replayPolicy: "ONE_SHOT_FAIL_CLOSED" | "IDEMPOTENT";
  completionMarker: string;
};
const predecessor = JSON.parse(read("tests/fixtures/ai-story-production-predecessor-manifest.json")) as {
  sourceProjectRef: string;
  tables: CatalogTable[];
};
const manifest = JSON.parse(read("docs/releases/ai-story-v1-production-migration-manifest.json")) as {
  productionProjectRef: string;
  gapTables: string[];
  entries: MigrationEntry[];
};
const preservedTables = [
  "ai_stories",
  "ai_story_versions",
  "ai_story_animation_packages",
  "ai_story_scene_instruction_snapshots",
  "ai_story_execution_plans",
  "ai_story_scene_executions",
  "ai_story_generated_scene_reviews",
  "provider_executions",
  "provider_attempts",
  "provider_attempt_usage",
  "provider_attempt_costs",
  "provider_execution_envelopes",
  "provider_outbox_jobs",
  "provider_execution_dispatches",
  "provider_execution_finalizations",
  "provider_finalization_costs",
  "provider_finalization_usage",
  "provider_terminal_ledger_records",
] as const;
const productionOnly = [
  "provider_execution_finalizations",
  "provider_finalization_costs",
  "provider_finalization_usage",
  "provider_terminal_ledger_records",
] as const;

// The same pg_catalog projection used for the read-only Production snapshot.
// An isolated predecessor must match before migration; staging Drizzle bootstrap
// is not allowed to masquerade as the live Production predecessor.
const catalogQuery = `
select jsonb_agg(jsonb_build_object(
  'table',c.relname,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select coalesce(jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid,true)) order by k.conname),'[]'::jsonb) from pg_constraint k where k.conrelid=c.oid),
  'indexes',(select coalesce(jsonb_agg(jsonb_build_object('name',i.relname,'definition',pg_get_indexdef(i.oid)) order by i.relname),'[]'::jsonb) from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid=c.oid),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(rolname order by rolname) from pg_roles where oid=any(p.polroles)),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname),'[]'::jsonb) from pg_policy p where p.polrelid=c.oid),
  'triggers',(select coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text) order by t.tgname),'[]'::jsonb) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)
) order by c.relname) as catalog
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and c.relname=any($1::text[])
`;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function snapshot(sql: Sql) {
  const result: Record<string, { count: number; hash: string }> = {};
  for (const name of preservedTables) {
    const rows = await sql.unsafe(`select * from "${name}" order by 1`);
    result[name] = { count: rows.length, hash: digest(rows) };
  }
  return result;
}
async function markerPresent(sql: Sql, marker: string): Promise<boolean> {
  const [kind, qualified] = marker.split(":", 2);
  if (!kind || !qualified) throw new Error(`INVALID_MIGRATION_MARKER:${marker}`);
  const [relation, object] = qualified.split(".");
  if (kind === "table") {
    const rows = await sql`select to_regclass(${`public.${qualified}`}) is not null as present`;
    return rows[0]?.present === true;
  }
  if (kind === "column") {
    const rows = await sql`select exists(select 1 from information_schema.columns where table_schema='public' and table_name=${relation} and column_name=${object}) as present`;
    return rows[0]?.present === true;
  }
  if (kind === "index") {
    const rows = await sql`select indexdef from pg_indexes where schemaname='public' and indexname=${qualified}`;
    if (qualified === "photo_scene_generations_inflight_fingerprint_idx") {
      return rows.length === 1 && String(rows[0]?.indexdef).includes("source_asset_id");
    }
    return rows.length === 1;
  }
  if (kind === "trigger") {
    const rows = await sql`select exists(select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=${relation} and t.tgname=${object}) as present`;
    return rows[0]?.present === true;
  }
  if (kind === "constraint") {
    const rows = await sql`select exists(select 1 from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=${relation} and k.conname=${object}) as present`;
    return rows[0]?.present === true;
  }
  throw new Error(`UNKNOWN_MIGRATION_MARKER:${marker}`);
}
function sqlHasOwnTransaction(source: string): boolean {
  return /^BEGIN\s*;/i.test(source.replace(/^(?:\s|--[^\n]*\n)*/, ""));
}
async function applyEntry(sql: Sql, entry: MigrationEntry): Promise<void> {
  if (await markerPresent(sql, entry.completionMarker)) {
    throw new Error(`PRODUCTION_OVERLAY_ONE_SHOT_ALREADY_APPLIED:${entry.file}`);
  }
  const source = read(entry.file);
  const body = sqlHasOwnTransaction(source) ? source : `BEGIN;\n${source}\nCOMMIT;`;
  try {
    await sql.unsafe(body);
  } catch (error) {
    await sql.unsafe("ROLLBACK");
    throw error;
  }
  if (!(await markerPresent(sql, entry.completionMarker))) {
    throw new Error(`PRODUCTION_OVERLAY_COMPLETION_MARKER_MISSING:${entry.file}`);
  }
}

describeIntegration("AI Story bounded overlay from actual Production predecessor", () => {
  let admin: Sql;
  let sql: Sql;
  let databaseName: string;
  let before: Awaited<ReturnType<typeof snapshot>>;
  let restoreNetwork: () => void;

  beforeAll(async () => {
    restoreNetwork = installCertificationNetworkIsolation();
    const urlValue = getIntegrationDbUrl();
    if (!urlValue) throw new Error("PRODUCTION_PREDECESSOR_POSTGRES_REQUIRED");
    assertIsolatedTestDatabase(urlValue);
    const url = new URL(urlValue);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      throw new Error("PRODUCTION_PREDECESSOR_LOCAL_POSTGRES_REQUIRED");
    }
    databaseName = `emberos_overlay_${randomUUID().replaceAll("-", "")}_test`;
    admin = postgres(urlValue, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    sql = postgres(url.toString(), { max: 1, prepare: false });
    await sql.unsafe(read("tests/fixtures/ai-story-production-predecessor-schema.sql"));
    await sql.unsafe(read("tests/fixtures/ai-story-production-predecessor-preservation-seed.sql"));
    before = await snapshot(sql);
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    if (admin && databaseName) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    }
    await admin?.end();
    restoreNetwork?.();
  }, 120_000);

  it("matches the checked-in live Production catalog and preserves seeded predecessor evidence", async () => {
    expect(predecessor.sourceProjectRef).toBe("egkgybrjmzukzmkcrpag");
    expect(manifest.productionProjectRef).toBe(predecessor.sourceProjectRef);
    const actual = await sql.unsafe(catalogQuery, [predecessor.tables.map((table) => table.table)]);
    expect(actual[0]?.catalog).toEqual(predecessor.tables);
    expect(predecessor.tables).toHaveLength(58);
    expect(before.ai_stories.count).toBe(1);
    expect(before.ai_story_generated_scene_reviews.count).toBe(1);
    for (const name of productionOnly) expect(before[name].count).toBe(1);
  });

  it("topologically upgrades all 30 gaps with no destructive or hidden data authority", async () => {
    expect(manifest.entries).toHaveLength(24);
    expect(manifest.gapTables).toHaveLength(30);
    const known = new Set(predecessor.tables.map((table) => `table:${table.table}`));
    for (const [index, entry] of manifest.entries.entries()) {
      expect(entry.order).toBe(index + 1);
      expect(entry.destructive).toBe(false);
      expect(entry.replayPolicy).toBe("ONE_SHOT_FAIL_CLOSED");
      for (const requirement of entry.requires) expect(known.has(requirement), `${entry.file} requires ${requirement}`).toBe(true);
      await applyEntry(sql, entry);
      for (const provision of entry.provides) known.add(provision);
    }
    const rows = await sql`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`;
    const actualNames = new Set(rows.map((row) => row.relname));
    for (const name of manifest.gapTables) expect(actualNames.has(name), name).toBe(true);
    for (const table of predecessor.tables) expect(actualNames.has(table.table), table.table).toBe(true);
    expect(await snapshot(sql)).toEqual(before);
    for (const name of ["certification_commercial_scopes", "certification_planning_authorities", "certification_planning_claims", "certification_commercial_reservations", "certification_submission_slot_reconciliations", "ai_story_post_terminal_provider_retry_authorizations"]) {
      const count = await sql.unsafe(`select count(*)::int as count from "${name}"`);
      expect(count[0]?.count, name).toBe(0);
    }
  }, 120_000);

  it("retains the four Production-only Provider finalization contracts and validates new authority constraints", async () => {
    const actual = await sql.unsafe(catalogQuery, [productionOnly]);
    expect(actual[0]?.catalog).toEqual(predecessor.tables.filter((table) => productionOnly.includes(table.table as (typeof productionOnly)[number])));
    const checks = await sql`select c.relname as table_name,c.relrowsecurity as rls_enabled,count(k.oid) filter(where k.contype='p')::int as primary_keys from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_constraint k on k.conrelid=c.oid where n.nspname='public' and c.relname=any(${manifest.gapTables}) group by c.relname,c.relrowsecurity`;
    expect(checks).toHaveLength(30);
    expect(checks.every((row) => row.primary_keys === 1)).toBe(true);
    const planning = await sql`select indexname from pg_indexes where schemaname='public' and tablename='certification_planning_claims'`;
    expect(planning.some((row) => String(row.indexname).includes("logical"))).toBe(true);
    const environment = await sql`select c.relname as table_name,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relname in ('certification_commercial_scopes','certification_submission_slot_reconciliations','ai_story_post_terminal_provider_retry_authorizations') and k.contype='c' and pg_get_constraintdef(k.oid) like '%environment%'`;
    expect(environment).toHaveLength(3);
    expect(environment.every((row) => String(row.definition).includes("STAGING") && String(row.definition).includes("PRODUCTION"))).toBe(true);
  });

  it("rejects every one-shot replay before SQL and leaves historical evidence unchanged", async () => {
    const beforeReplay = await snapshot(sql);
    for (const entry of manifest.entries) expect(await markerPresent(sql, entry.completionMarker), entry.file).toBe(true);
    for (const entry of manifest.entries) {
      await expect(applyEntry(sql, entry)).rejects.toThrow("PRODUCTION_OVERLAY_ONE_SHOT_ALREADY_APPLIED");
    }
    expect(await snapshot(sql)).toEqual(beforeReplay);
  });
});
