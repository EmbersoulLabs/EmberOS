/**
 * Read-only AI Story overlay schema preflight.
 * Does not apply SQL. Logs project identity, not credentials.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  AI_STORY_REQUIRED_TABLES,
  AI_STORY_STRUCTURAL_TABLES,
} from "../packages/shared/src/ai-story-production-ops";
import {
  parseSupabaseProjectRef,
  redactDatabaseTarget,
} from "../packages/shared/src/photo-scene-production-ops";

config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ status: "ENVIRONMENT_NOT_RUN", reason: "DATABASE_URL_missing" }));
    return;
  }

  const tables = [...AI_STORY_REQUIRED_TABLES, ...AI_STORY_STRUCTURAL_TABLES];
  const sql = postgres(url, { max: 1, prepare: false });
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
    console.log(
      JSON.stringify({
        status: missing.length === 0 ? "PRESENT" : "GAPS",
        target: redactDatabaseTarget(url),
        databaseRef: parseSupabaseProjectRef(url),
        mutated: false,
        missing,
        legacyAiStories: legacyCount,
        presentCount: tables.filter((table) => present[table]).length,
        requiredCount: tables.length,
      })
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
