/**
 * Production-only operator apply for the bounded Outline/Script profile-check
 * convergence. Refuses every database except the canonical Production project.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

config({ path: resolve(process.cwd(), "apps/worker/.env") });
config({ path: resolve(process.cwd(), ".env.local") });

async function main() {
  const PRODUCTION_REF = "egkgybrjmzukzmkcrpag";
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const parsedUrl = new URL(url);
  const databaseRef =
    url.match(/postgres\.([a-z0-9]+)/i)?.[1] ??
    url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1] ??
    parsedUrl.username.split(".")[1];
  if (databaseRef !== PRODUCTION_REF) {
    throw new Error("PRODUCTION_DATABASE_IDENTITY_MISMATCH");
  }

  const db = postgres(url, { max: 1, prepare: false });
  try {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "packages/db/sql/ai-story-outline-profile-authorities-v1.sql",
      ),
      "utf8",
    );
    const [before] = await db<{ outlines: number; scripts: number }[]>`
      select
        (select count(*)::int from public.ai_story_outline_versions) as outlines,
        (select count(*)::int from public.ai_story_script_versions) as scripts
    `;
    await db.begin(async (tx) => tx.unsafe(migration));
    const [after] = await db<{ outlines: number; scripts: number }[]>`
      select
        (select count(*)::int from public.ai_story_outline_versions) as outlines,
        (select count(*)::int from public.ai_story_script_versions) as scripts
    `;
    if (!before || !after || before.outlines !== after.outlines || before.scripts !== after.scripts) {
      throw new Error("PROFILE_CHECK_MIGRATION_MUTATED_AUTHORITY_ROWS");
    }
    console.log(JSON.stringify({ databaseRef, before, after, dataMutation: 0 }));
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
