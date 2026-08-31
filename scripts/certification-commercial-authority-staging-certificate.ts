import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
  throw new Error("STAGING_ENVIRONMENT_REQUIRED");
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
const mode = (process.argv[2] ?? "PREDECESSOR").toUpperCase();
if (mode !== "PREDECESSOR" && mode !== "RESULT") throw new Error("INVALID_CERTIFICATE_MODE");

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "packages/db/releases/certification-commercial-authority-v1-staging.json"), "utf8"));
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  return JSON.stringify(value);
};
const certificate = (body: Record<string, unknown>) => ({
  ...body,
  certificate: `sha256:${createHash("sha256").update(stable(body)).digest("hex")}`,
});

const sql = postgres(url, { max: 1, prepare: false });
try {
  const required = manifest.predecessor.requiredTables as string[];
  const absent = manifest.predecessor.requiredAbsentTables as string[];
  if (mode === "PREDECESSOR") {
    const tables = await sql<{ name: string; oid: string | null }[]>`
      SELECT name, to_regclass('public.' || name)::text AS oid
      FROM unnest(${[...required, ...absent]}::text[]) AS name ORDER BY name
    `;
    const org = await sql<{ present: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM organizations WHERE id='93f3e971-248e-470a-a2b2-1ea7bf33a9c7') AS present
    `;
    const workspace = await sql<{ present: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM workspaces WHERE id='3af079b8-e3c3-4eaa-a81b-f03405a2cfc0' AND org_id='93f3e971-248e-470a-a2b2-1ea7bf33a9c7') AS present
    `;
    const byName = new Map(tables.map((row) => [row.name, row.oid]));
    const pass = required.every((name) => byName.get(name)) && absent.every((name) => !byName.get(name)) && org[0]?.present && workspace[0]?.present;
    if (!pass) throw new Error("STAGING_PREDECESSOR_DIVERGENT");
    console.log(JSON.stringify(certificate({ kind: "CERTIFICATION_COMMERCIAL_PREDECESSOR", manifestId: manifest.manifestId, requiredPresent: required, requiredAbsent: absent, targetOrganizationPresent: true, targetWorkspacePresent: true })));
  } else {
    const expected = manifest.result.tables as string[];
    const columns = await sql`
      SELECT table_name,column_name,data_type,is_nullable,column_default
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name=ANY(${expected})
      ORDER BY table_name,ordinal_position
    `;
    const constraints = await sql`
      SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(${expected}) ORDER BY c.relname,con.conname
    `;
    const indexes = await sql`
      SELECT tablename,indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename=ANY(${expected}) ORDER BY tablename,indexname
    `;
    const security = await sql`
      SELECT c.relname AS table_name,c.relrowsecurity,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('policy',p.policyname,'command',p.cmd) ORDER BY p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname),'[]'::jsonb) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(${expected}) ORDER BY c.relname
    `;
    if (new Set((columns as Array<{ table_name: string }>).map((row) => row.table_name)).size !== expected.length) throw new Error("STAGING_RESULT_CATALOG_DIVERGENT");
    console.log(JSON.stringify(certificate({ kind: "CERTIFICATION_COMMERCIAL_RESULT_CATALOG", manifestId: manifest.manifestId, tables: expected, columns, constraints, indexes, security })));
  }
} finally {
  await sql.end();
}
