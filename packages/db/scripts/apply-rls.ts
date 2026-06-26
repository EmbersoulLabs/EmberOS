/**
 * Apply multi-tenant RLS policies (idempotent — safe to re-run).
 * Usage: pnpm db:rls
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

config({ path: resolve(__dirname, "../../../apps/worker/.env") });
config({ path: resolve(__dirname, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (check .env.local or apps/worker/.env)");
  process.exit(1);
}

const POLICIES: { table: string; name: string; using: string }[] = [
  {
    table: "workspaces",
    name: "workspace_select",
    using: "id IN (SELECT user_workspace_ids())",
  },
  {
    table: "workspace_members",
    name: "workspace_members_select",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "campaigns",
    name: "campaigns_all",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "assets",
    name: "assets_all",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "tasks",
    name: "tasks_all",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "creatives",
    name: "creatives_all",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "reviews",
    name: "reviews_all",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
];

const RLS_TABLES = [
  "workspaces",
  "workspace_members",
  "campaigns",
  "assets",
  "tasks",
  "creatives",
  "reviews",
];

function parseStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s) => s.length > 0);
}

const functionSql = parseStatements(
  readFileSync(resolve(__dirname, "../sql/rls.sql"), "utf8")
).find((s) => s.includes("user_workspace_ids"));

const db = postgres(url, { max: 1 });

try {
  console.log("[rls] Enabling row level security...");
  for (const table of RLS_TABLES) {
    await db.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    console.log(`  OK: ${table}`);
  }

  if (functionSql) {
    await db.unsafe(functionSql);
    console.log("[rls] OK: user_workspace_ids()");
  }

  console.log("[rls] Applying policies...");
  for (const { table, name, using } of POLICIES) {
    await db.unsafe(`DROP POLICY IF EXISTS ${name} ON ${table}`);
    const forAll = table !== "workspaces" && table !== "workspace_members";
    const cmd = forAll
      ? `CREATE POLICY ${name} ON ${table} FOR ALL USING (${using})`
      : `CREATE POLICY ${name} ON ${table} FOR SELECT USING (${using})`;
    await db.unsafe(cmd);
    console.log(`  OK: ${name} on ${table}`);
  }

  console.log("\n[rls] RLS policies applied successfully.");
} catch (err) {
  console.error("[rls] Migration failed:", err);
  process.exit(1);
} finally {
  await db.end();
}
