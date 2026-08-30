/**
 * Apply only EXEC-04 generated Scene review SQL to the production target
 * identified by AI_STORY_RAILWAY_VARS_FILE. Requires explicit allow flags.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  AI_STORY_PROD_MIGRATION_ACK,
  AI_STORY_PRODUCTION_SUPABASE_REF,
  isAiStoryProductionRef,
} from "../packages/shared/src/ai-story-production-ops";
import { parseSupabaseProjectRef } from "../packages/shared/src/photo-scene-production-ops";

function loadDatabaseUrl(): string {
  const file = process.env.AI_STORY_RAILWAY_VARS_FILE?.trim();
  if (!file) throw new Error("AI_STORY_RAILWAY_VARS_FILE is required");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const url = typeof parsed.DATABASE_URL === "string" ? parsed.DATABASE_URL.trim() : "";
  if (!url) throw new Error("DATABASE_URL missing in Railway vars file");
  return url;
}

function parseStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((block) =>
      block
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter(Boolean);
}

async function main() {
  const allow = process.env.AI_STORY_PROD_MIGRATION_ALLOW === "true";
  const ack = process.env.AI_STORY_PROD_MIGRATION_ACK;
  const url = loadDatabaseUrl();
  const ref = parseSupabaseProjectRef(url);
  if (isAiStoryProductionRef(ref) && !(allow && ack === AI_STORY_PROD_MIGRATION_ACK)) {
    throw new Error(
      "REFUSED: production apply requires AI_STORY_PROD_MIGRATION_ALLOW=true and AI_STORY_PROD_MIGRATION_ACK=AI_STORY_SELF_USE_V1"
    );
  }
  if (ref !== AI_STORY_PRODUCTION_SUPABASE_REF) {
    throw new Error("REFUSED: database ref is not the AI Story production target");
  }

  const files = [
    "packages/db/sql/ai-story-generated-scene-review-v1.sql",
    "packages/db/sql/ai-story-generated-scene-review-rls-v1.sql",
  ];
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    for (const relative of files) {
      const statements = parseStatements(readFileSync(resolve(relative), "utf8"));
      for (const statement of statements) {
        await sql.unsafe(statement);
      }
      console.log(`applied ${relative}`);
    }
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.ai_story_generated_scene_reviews') IS NOT NULL AS exists
    `;
    console.log(JSON.stringify({ generatedSceneReviewTable: exists ? "PRESENT" : "ABSENT" }));
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
