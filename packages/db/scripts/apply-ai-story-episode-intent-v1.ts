/** Apply the additive Episode intent column. Production apply is refused. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
const here = dirname(fileURLToPath(import.meta.url));
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
if (url.includes("egkgybrjmzukzmkcrpag")) throw new Error("PRODUCTION_DB_REFUSED");
const db = postgres(url, { max: 1 });
try {
  await db.unsafe(readFileSync(resolve(here, "../sql/ai-story-episode-intent-v1.sql"), "utf8"));
  console.log("AI Story Episode intent column applied.");
} finally {
  await db.end();
}
