import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../apps/web/.env.local") });
config({ path: resolve(directory, "../../../.env.local") });
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const client = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await client.unsafe(readFileSync(resolve(directory, "../sql/ai-story-differentiated-retry-v1.sql"), "utf8"));
} finally {
  await client.end();
}
console.log("AI Story differentiated retry schema applied.");
