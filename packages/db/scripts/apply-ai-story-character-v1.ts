/** Apply additive Campaign Character authority schema. */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../apps/worker/.env") });
config({ path: resolve(here, "../../../.env.local") });
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const db = postgres(url, { max: 1 });
try {
  await db.unsafe(readFileSync(resolve(here, "../sql/ai-story-character-v1.sql"), "utf8"));
  console.log("AI Story Campaign Character authority schema applied.");
} finally {
  await db.end();
}
