import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
const sql = postgres(url, { max: 1 });
try {
  await sql.unsafe(
    await readFile(resolve(process.cwd(), "sql/ai-story-provider-runtime-v1.sql"), "utf8")
  );
} finally {
  await sql.end();
}
