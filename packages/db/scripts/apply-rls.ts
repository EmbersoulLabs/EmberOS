/**
 * Apply multi-tenant RLS policies (idempotent — safe to re-run).
 * Usage: pnpm db:rls
 *
 * Business Profile (SPEC-001): SELECT/INSERT/UPDATE/DELETE with WITH CHECK
 * so rows cannot be inserted or moved into an unauthorized tenant.
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

type PolicySpec = {
  table: string;
  name: string;
  /** SELECT | INSERT | UPDATE | DELETE | ALL */
  command: "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "ALL";
  using?: string;
  withCheck?: string;
};

const MEMBER_WORKSPACE = "workspace_id IN (SELECT user_workspace_ids())";
const MEMBER_WORKSPACE_AND_ORG =
  "workspace_id IN (SELECT user_workspace_ids()) AND org_id = (SELECT org_id FROM workspaces WHERE id = workspace_id)";

const POLICIES: PolicySpec[] = [
  {
    table: "workspaces",
    name: "workspace_select",
    command: "SELECT",
    using: "id IN (SELECT user_workspace_ids())",
  },
  {
    table: "workspace_members",
    name: "workspace_members_select",
    command: "SELECT",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "campaigns",
    name: "campaigns_all",
    command: "ALL",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "assets",
    name: "assets_all",
    command: "ALL",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "tasks",
    name: "tasks_all",
    command: "ALL",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "creatives",
    name: "creatives_all",
    command: "ALL",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  {
    table: "reviews",
    name: "reviews_all",
    command: "ALL",
    using: "workspace_id IN (SELECT user_workspace_ids())",
  },
  // SPEC-001 Business Profile — CS-3
  {
    table: "business_profiles",
    name: "business_profiles_select",
    command: "SELECT",
    using: MEMBER_WORKSPACE,
  },
  {
    table: "business_profiles",
    name: "business_profiles_insert",
    command: "INSERT",
    withCheck: MEMBER_WORKSPACE_AND_ORG,
  },
  {
    table: "business_profiles",
    name: "business_profiles_update",
    command: "UPDATE",
    using: MEMBER_WORKSPACE,
    withCheck: MEMBER_WORKSPACE_AND_ORG,
  },
  {
    table: "business_profiles",
    name: "business_profiles_delete",
    command: "DELETE",
    using: MEMBER_WORKSPACE,
  },
];

/** Legacy policy name from earlier WIP — drop if present so re-runs stay clean. */
const LEGACY_POLICY_DROPS: { table: string; name: string }[] = [
  { table: "business_profiles", name: "business_profiles_all" },
];

const RLS_TABLES = [
  "workspaces",
  "workspace_members",
  "campaigns",
  "assets",
  "tasks",
  "creatives",
  "reviews",
  "business_profiles",
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

function createPolicySql(policy: PolicySpec): string {
  const parts = [`CREATE POLICY ${policy.name} ON ${policy.table} FOR ${policy.command}`];
  if (policy.using) parts.push(`USING (${policy.using})`);
  if (policy.withCheck) parts.push(`WITH CHECK (${policy.withCheck})`);
  return parts.join(" ");
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

  for (const { table, name } of LEGACY_POLICY_DROPS) {
    await db.unsafe(`DROP POLICY IF EXISTS ${name} ON ${table}`);
  }

  console.log("[rls] Applying policies...");
  for (const policy of POLICIES) {
    await db.unsafe(`DROP POLICY IF EXISTS ${policy.name} ON ${policy.table}`);
    await db.unsafe(createPolicySql(policy));
    console.log(`  OK: ${policy.name} on ${policy.table}`);
  }

  console.log("\n[rls] RLS policies applied successfully.");
} catch (err) {
  console.error("[rls] Migration failed:", err);
  process.exit(1);
} finally {
  await db.end();
}
