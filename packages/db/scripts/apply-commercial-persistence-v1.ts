/**
 * Apply Sprint 4 Phase B3 Commercial Persistence SQL + RLS.
 *
 * Usage:
 *   pnpm --filter @ceo-agent/db exec tsx scripts/apply-commercial-persistence-v1.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL required");
  const sql = postgres(url, { max: 1 });
  try {
    for (const relative of [
      "../sql/commercial-persistence-v1.sql",
      "../sql/commercial-persistence-rls-v1.sql",
    ]) {
      const body = readFileSync(resolve(__dirname, relative), "utf8");
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
