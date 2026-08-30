/**
 * Apply Sprint 4 Phase A durable scene media attestation SQL + RLS.
 *
 * Usage:
 *   pnpm --filter @ceo-agent/db exec tsx scripts/apply-ai-story-durable-scene-media-v1.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();

const directory = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });
  try {
    for (const relative of [
      "../sql/ai-story-durable-scene-media-v1.sql",
      "../sql/ai-story-durable-scene-media-rls-v1.sql",
    ]) {
      const body = readFileSync(resolve(directory, relative), "utf8");
      await sql.unsafe(body);
      console.log(`applied ${relative}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
