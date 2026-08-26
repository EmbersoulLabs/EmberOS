import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const databaseRef =
  url.match(/postgres\.([a-z0-9]+)/i)?.[1] ??
  url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1];
const authorizedTarget = process.env.CREATE_CAMPAIGN_WAVE3_MIGRATION_TARGET;
if (!databaseRef || !authorizedTarget || databaseRef !== authorizedTarget) {
  throw new Error(
    "Refusing Create Campaign Wave 3 migration: CREATE_CAMPAIGN_WAVE3_MIGRATION_TARGET must match DATABASE_URL"
  );
}

const migration = readFileSync(
  resolve(directory, "../sql/create-campaign-wave3-v1.sql"),
  "utf8"
);
const db = postgres(url, { max: 1 });
try {
  await db.begin(async (tx) => {
    await tx.unsafe(migration);
  });
  console.log(`Create Campaign Wave 3 schema applied to ${databaseRef}.`);
} finally {
  await db.end();
}
