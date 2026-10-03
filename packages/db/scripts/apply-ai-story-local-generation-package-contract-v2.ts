import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

// Deliberately opt-in, Staging-only. No environment inferred from NODE_ENV.
const urlValue = process.env.DATABASE_URL;
const projectRef = process.env.SUPABASE_PROJECT_REF;
if (process.env.EMBEROS_MIGRATION_ENVIRONMENT !== "STAGING" || !urlValue || !projectRef) {
  throw new Error("EXPLICIT_STAGING_MIGRATION_AUTHORITY_REQUIRED");
}
const url = new URL(urlValue);
const identity = `${url.username}@${url.hostname}`;
if (projectRef !== "voofxbuzpocyjzoxrpfi" || identity.includes("egkgybrjmzukzmkcrpag") || !identity.includes(projectRef)) {
  throw new Error("PRODUCTION_OR_UNPROVEN_DATABASE_MIGRATION_FORBIDDEN");
}
const db = postgres(urlValue, { max: 1, prepare: false });
try {
  const [table] = await db`select to_regclass('public.ai_story_local_generation_packages') is not null as present`;
  if (!table?.present) throw new Error("LOCAL_GENERATION_PACKAGE_TABLE_REQUIRED");
  await db.unsafe(await readFile(resolve(process.cwd(), "sql", "ai-story-local-generation-package-contract-v2.sql"), "utf8"));
  const [check] = await db`
    select pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = 'public.ai_story_local_generation_packages'::regclass
      and conname = 'ai_story_local_generation_package_contract_version_check'
  `;
  const definition = String(check?.definition ?? "");
  if (!definition.includes("local-generation-package.v1") || !definition.includes("local-generation-package.v2")) {
    throw new Error("LOCAL_GENERATION_PACKAGE_CONTRACT_V2_NOT_PROVEN");
  }
} finally {
  await db.end();
}
