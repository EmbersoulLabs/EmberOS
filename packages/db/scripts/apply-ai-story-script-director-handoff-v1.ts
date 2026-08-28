import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const sql = postgres(databaseUrl, { max: 1 });
try {
  const here = dirname(fileURLToPath(import.meta.url));
  await sql.unsafe(readFileSync(resolve(here, "../sql/ai-story-script-director-handoff-v1.sql"), "utf8"));
} finally { await sql.end(); }
