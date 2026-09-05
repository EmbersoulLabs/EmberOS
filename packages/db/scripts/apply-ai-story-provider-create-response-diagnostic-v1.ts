/**
 * Apply ai-story-provider-create-response-diagnostic-v1.sql
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();

const directory = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  const migration = readFileSync(
    resolve(
      directory,
      "../sql/ai-story-provider-create-response-diagnostic-v1.sql"
    ),
    "utf8"
  );
  for (const statement of migration
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)) {
    await sql.unsafe(statement);
  }
  await sql.end();
  console.log("Applied ai-story-provider-create-response-diagnostic-v1.sql");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
