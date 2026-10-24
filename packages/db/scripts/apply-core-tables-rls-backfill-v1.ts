/**
 * Final-fix-v1 P0 — backfill RLS onto tables that predate the RLS convention
 * (ai_stories, ai_story_versions, ai_story_asset_links, ai_story_creative_contexts,
 * ai_story_animation_packages, ai_story_execution_jobs, ai_story_execution_outputs,
 * knowledge_entries) plus the Sprint-3 provider ledger/outbox/dispatch/envelope
 * tables that shipped without RLS. Idempotent (safe to re-run).
 * Usage: pnpm --filter @ceo-agent/db run sql:core-rls-backfill
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();

const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../apps/web/.env.local") });
config({ path: resolve(directory, "../../../.env.local") });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const statements = readFileSync(
  resolve(directory, "../sql/core-tables-rls-backfill-v1.sql"),
  "utf8"
)
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

const client = postgres(databaseUrl, { max: 1, prepare: false });

try {
  for (const statement of statements) await client.unsafe(statement);
  console.log("Core tables RLS backfill applied.");
} finally {
  await client.end();
}
