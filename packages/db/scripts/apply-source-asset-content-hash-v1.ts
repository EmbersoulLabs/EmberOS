/** Apply VS-RC-01A.2C Source Asset content identity. Refuses production. */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const expectedRef = "voofxbuzpocyjzoxrpfi";
const forbiddenRef = "egkgybrjmzukzmkcrpag";
const databaseRef =
  url.match(/postgres\.([a-z0-9]+)/i)?.[1] ?? url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1];
if (!databaseRef || databaseRef === forbiddenRef || databaseRef !== expectedRef) {
  throw new Error("Refusing migration: database is not the authorized Preview project");
}

const sql = readFileSync(resolve(directory, "../sql/source-asset-content-hash-v1.sql"), "utf8");
const db = postgres(url, { max: 1 });
try {
  await db.unsafe(sql);
  console.log("Source Asset content hash schema applied.");
} finally {
  await db.end();
}
