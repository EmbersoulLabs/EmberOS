/**
 * Apply SPEC-001 v1.1 Business Profile patch (legacy → current).
 * Executes the full SQL file as one script so DO $$ ... $$ blocks stay intact.
 * Idempotent. Fresh installs that used business_profile.sql are a no-op.
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

const sqlFile = resolve(__dirname, "../sql/business_profile_v1_1.sql");
const sql = readFileSync(sqlFile, "utf8");
const db = postgres(url, { max: 1 });

try {
  // Whole-file execute: required for dollar-quoted DO blocks (do not split on ';').
  await db.unsafe(sql);
  console.log("Business profile v1.1 patch applied (idempotent).");
} finally {
  await db.end();
}
