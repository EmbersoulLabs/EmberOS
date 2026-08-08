/**
 * Apply ai-story-worker-attempt-observation-v1.sql
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  const migration = readFileSync(
    resolve(__dirname, "../sql/ai-story-worker-attempt-observation-v1.sql"),
    "utf8"
  );
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
  await sql.end();
  console.log("Applied ai-story-worker-attempt-observation-v1.sql");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
