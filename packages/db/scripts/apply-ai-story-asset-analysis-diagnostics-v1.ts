import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const here = dirname(fileURLToPath(import.meta.url));
const sqlText = await readFile(
  resolve(here, "../sql/ai-story-asset-analysis-diagnostics-v1.sql"),
  "utf8"
);
const sql = postgres(databaseUrl, { max: 1 });
try {
  await sql.unsafe(sqlText);
} finally {
  await sql.end();
}
