/**
 * Apply PD-042 Default Publishing Platforms column.
 * Usage: pnpm --filter @ceo-agent/db sql:business-profile-pd042
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

const sqlFile = resolve(__dirname, "../sql/business_profile_pd042.sql");
const sql = readFileSync(sqlFile, "utf8");
const db = postgres(url, { max: 1 });

try {
  await db.unsafe(sql);
  console.log("Business profile PD-042 patch applied (idempotent).");
} finally {
  await db.end();
}
