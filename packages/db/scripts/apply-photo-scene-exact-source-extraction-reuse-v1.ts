/** Apply Photo Scene exact-source extraction reuse indexes. Refuses Production/R4. */
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
const authorizedStagingRef = "voofxbuzpocyjzoxrpfi";
const productionRef = "egkgybrjmzukzmkcrpag";
const parsedUrl = new URL(url);
const databaseRef =
  url.match(/postgres\.([a-z0-9]+)/i)?.[1] ??
  url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1] ??
  parsedUrl.username.split(".")[1];
if (!databaseRef || databaseRef === productionRef || databaseRef !== authorizedStagingRef) {
  throw new Error("Refusing migration: database is not the authorized STAGING project");
}

const migration = readFileSync(
  resolve(directory, "../sql/photo-scene-exact-source-extraction-reuse-v1.sql"),
  "utf8"
);
const db = postgres(url, { max: 1 });
try {
  await db.unsafe(migration);
  console.log("Photo Scene exact-source extraction reuse indexes applied.");
} finally {
  await db.end();
}
