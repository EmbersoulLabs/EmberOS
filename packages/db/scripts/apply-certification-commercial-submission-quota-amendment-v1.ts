import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
const directory = dirname(fileURLToPath(import.meta.url));
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const client = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await client.unsafe(
    readFileSync(
      resolve(directory, "../sql/certification-commercial-submission-quota-amendment-v1.sql"),
      "utf8"
    )
  );
} finally {
  await client.end();
}
console.log("Certification commercial submission quota amendment schema applied.");
