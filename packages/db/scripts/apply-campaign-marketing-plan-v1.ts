import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../.env.local") });
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (process.env.EMBEROS_TEST_DB_ENVIRONMENT !== "test") throw new Error("Refusing migration outside an explicitly isolated test database");
const parsed = new URL(url);
if (!["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) && process.env.EMBEROS_TEST_DB_ISOLATED !== "1") throw new Error("Refusing migration: database isolation is unproven");
const migration = readFileSync(resolve(directory, "../sql/campaign-marketing-plan-v1.sql"), "utf8");
const db = postgres(url, { max: 1, prepare: false });
try { await db.unsafe(migration); console.log("Campaign Marketing Plan V1 schema applied to isolated test database."); }
finally { await db.end(); }
