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
const db = postgres(url, { max: 1, prepare: false });
try {
  await db.unsafe(readFileSync(
    resolve(here, "../../../supabase/migrations/20260926055546_controlled_self_use_authority_v1.sql"),
    "utf8"
  ));
  console.log("Controlled Self-Use authority applied.");
} finally {
  await db.end();
}
