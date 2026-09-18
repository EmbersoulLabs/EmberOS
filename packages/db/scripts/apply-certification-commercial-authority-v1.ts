import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
  throw new Error("STAGING_ENVIRONMENT_REQUIRED");
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
const sql = postgres(url, { max: 1 });
try {
  const body = readFileSync(resolve(process.cwd(), "sql/certification-commercial-authority-v1.sql"), "utf8");
  await sql.unsafe(body);
  console.log("applied certification-commercial-authority-v1.sql to STAGING");
} finally {
  await sql.end();
}
