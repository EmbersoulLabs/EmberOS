/** Apply additive Character Virtualizer real-Provider call constraint repair. Refuses production mutation. */
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
  await db.unsafe(
    readFileSync(resolve(here, "../sql/ai-story-character-virtualizer-real-provider-calls-01.sql"), "utf8")
  );
  console.log("AI Story Character Virtualizer real Provider call constraint repair applied.");
} finally {
  await db.end();
}
