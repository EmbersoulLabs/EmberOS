/**
 * Read-only production preflight for AI Story Self-Use V1.
 * Reads Railway variables from AI_STORY_RAILWAY_VARS_FILE. Never prints secrets or URLs.
 */
import { readFileSync, unlinkSync } from "node:fs";
import postgres from "postgres";
import {
  AI_STORY_PRODUCTION_SUPABASE_REF,
  AI_STORY_REQUIRED_TABLES,
  AI_STORY_STRUCTURAL_TABLES,
} from "../packages/shared/src/ai-story-production-ops";
import {
  parseSupabaseProjectRef,
  redactDatabaseTarget,
} from "../packages/shared/src/photo-scene-production-ops";

const KEYS = [
  "AI_PROVIDER_SEEDANCE_ENABLED",
  "AI_PROVIDER_SEEDANCE_API_KEY",
  "AI_PROVIDER_SEEDANCE_BASE_URL",
  "AI_PROVIDER_SEEDANCE_DEFAULT_MODEL",
  "AI_PROVIDER_MINIMAX_ENABLED",
  "AI_PROVIDER_MINIMAX_API_KEY",
  "AI_PROVIDER_MINIMAX_BASE_URL",
  "AI_PROVIDER_MINIMAX_DEFAULT_MODEL",
  "AI_DEFAULT_VIDEO_PROVIDER",
  "AI_PROVIDER_TIMEOUT_MS",
  "AI_PROVIDER_MAX_RETRIES",
  "SEEDANCE_API_KEY",
  "MINIMAX_API_KEY",
  "OPENAI_API_KEY",
  "AI_PROVIDER_OPENAI_API_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "FFMPEG_PATH",
] as const;

function loadRailwayVars(): Record<string, string> {
  const file = process.env.AI_STORY_RAILWAY_VARS_FILE?.trim();
  if (!file) throw new Error("AI_STORY_RAILWAY_VARS_FILE is required");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function presence(vars: Record<string, string>, key: string): "PRESENT" | "ABSENT" {
  return vars[key]?.trim() ? "PRESENT" : "ABSENT";
}

async function main() {
  const vars = loadRailwayVars();
  const keyPresence: Record<string, "PRESENT" | "ABSENT"> = {};
  for (const key of KEYS) keyPresence[key] = presence(vars, key);

  const defaultVideo = vars.AI_DEFAULT_VIDEO_PROVIDER?.trim() || "unset";
  const seedanceEnabled = vars.AI_PROVIDER_SEEDANCE_ENABLED?.trim() || "unset";
  const minimaxEnabled = vars.AI_PROVIDER_MINIMAX_ENABLED?.trim() || "unset";
  const seedanceModel = vars.AI_PROVIDER_SEEDANCE_DEFAULT_MODEL?.trim() || "unset";
  const minimaxModel = vars.AI_PROVIDER_MINIMAX_DEFAULT_MODEL?.trim() || "unset";
  const timeoutMs = vars.AI_PROVIDER_TIMEOUT_MS?.trim() || "unset";
  const storageBucket = vars.SUPABASE_STORAGE_BUCKET?.trim() || "unset";

  const databaseUrl = vars.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.log(
      JSON.stringify({
        status: "DATABASE_URL_ABSENT",
        keyPresence,
        defaultVideo,
        seedanceEnabled,
        minimaxEnabled,
      })
    );
    return;
  }

  const tables = [...AI_STORY_REQUIRED_TABLES, ...AI_STORY_STRUCTURAL_TABLES];
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const present: Record<string, boolean> = {};
    const missing: string[] = [];
    for (const table of tables) {
      const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT to_regclass(${"public." + table}) IS NOT NULL AS exists
      `;
      present[table] = exists;
      if (!exists) missing.push(table);
    }

    let legacyCount: number | null = null;
    if (present.ai_stories) {
      const [{ count }] = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM ai_stories
      `;
      legacyCount = Number(count);
    }

    const reviewCols = present.ai_story_generated_scene_reviews
      ? await sql<{ column_name: string }[]>`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ai_story_generated_scene_reviews'
          ORDER BY ordinal_position
        `
      : [];

    const approvedUnique = present.ai_story_generated_scene_reviews
      ? await sql<{ indexname: string }[]>`
          SELECT indexname
          FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'ai_story_generated_scene_reviews'
            AND indexname = 'ai_story_generated_scene_reviews_approved_scene_unique'
        `
      : [];

    const rls = present.ai_story_generated_scene_reviews
      ? await sql<{ relrowsecurity: boolean }[]>`
          SELECT relrowsecurity
          FROM pg_class
          WHERE relname = 'ai_story_generated_scene_reviews'
        `
      : [];

    console.log(
      JSON.stringify({
        status: missing.length === 0 ? "PRESENT" : "GAPS",
        target: redactDatabaseTarget(databaseUrl),
        databaseRef: parseSupabaseProjectRef(databaseUrl),
        expectedProductionRef: AI_STORY_PRODUCTION_SUPABASE_REF,
        productionRefMatch:
          parseSupabaseProjectRef(databaseUrl) === AI_STORY_PRODUCTION_SUPABASE_REF,
        mutated: false,
        missing,
        legacyAiStories: legacyCount,
        presentCount: tables.filter((table) => present[table]).length,
        requiredCount: tables.length,
        generatedSceneReview: {
          table: present.ai_story_generated_scene_reviews ? "PRESENT" : "ABSENT",
          columns: reviewCols.map((row) => row.column_name),
          approvedUniqueIndex: approvedUnique.length > 0 ? "PRESENT" : "ABSENT",
          rls: rls[0]?.relrowsecurity ? "ENABLED" : "DISABLED_OR_ABSENT",
        },
        storageBucket,
        keyPresence,
        defaultVideo,
        seedanceEnabled,
        minimaxEnabled,
        seedanceModel,
        minimaxModel,
        timeoutMs,
      })
    );
  } finally {
    await sql.end({ timeout: 2 });
    const file = process.env.AI_STORY_RAILWAY_VARS_FILE?.trim();
    if (file && process.env.AI_STORY_RAILWAY_VARS_UNLINK === "true") {
      try {
        unlinkSync(file);
      } catch {
        // ignore
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
