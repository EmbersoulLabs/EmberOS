/**
 * Apply SPEC-001 v1.1 Business Profile patch.
 * Usage: pnpm --filter @ceo-agent/db sql:business-profile-v1-1
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

const statements = parseStatements(readFileSync(resolve(__dirname, "../sql/business_profile_v1_1.sql"), "utf8"));
const db = postgres(url, { max: 1 });

try {
  for (const statement of statements) {
    await db.unsafe(statement);
    console.log("OK:", statement.slice(0, 70).replace(/\s+/g, " ") + "...");
  }
  console.log("Business profile v1.1 patch applied.");
} finally {
  await db.end();
}
