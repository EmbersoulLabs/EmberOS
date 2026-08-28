import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required");
const sql=postgres(databaseUrl,{max:1});
try { await sql.unsafe(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),"../sql/ai-story-director-plan-v1.sql"),"utf8")); }
finally { await sql.end(); }
