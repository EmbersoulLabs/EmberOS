import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

refuseProductionAiStoryApply();
if ((process.env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() !== "staging") {
  throw new Error("STAGING_ENVIRONMENT_REQUIRED");
}
if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE !== "certification_no_dispatch") {
  throw new Error("CERTIFICATION_NO_DISPATCH_MUST_REMAIN_ACTIVE");
}
const directory = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const sql = postgres(url, { max: 1, prepare: false });
  const migration = readFileSync(
    resolve(directory, "../sql/certification-commercial-effective-quota-v1.sql"),
    "utf8"
  );
  await sql.unsafe(migration);
  await sql.end();
  console.log("Applied certification-commercial-effective-quota-v1.sql");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
