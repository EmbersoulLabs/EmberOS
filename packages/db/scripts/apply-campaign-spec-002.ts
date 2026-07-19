/**
 * Apply SPEC-002 campaign schema extensions via raw SQL.
 * Usage: pnpm --filter @ceo-agent/db sql:campaign-spec-002
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
  console.error("DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}

const sqlFile = resolve(__dirname, "../sql/campaign_spec_002.sql");
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

const statements = parseStatements(readFileSync(sqlFile, "utf8"));
const db = postgres(url, { max: 1 });

try {
  for (const statement of statements) {
    await db.unsafe(statement);
    console.log("OK:", statement.slice(0, 60).replace(/\s+/g, " ") + "...");
  }
  console.log("SPEC-002 campaign schema applied.");
} finally {
  await db.end();
}
