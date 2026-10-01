import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import postgres from "postgres";

// Deliberately opt-in, Staging-only. No environment inferred from NODE_ENV.
const urlValue=process.env.DATABASE_URL;
const projectRef=process.env.SUPABASE_PROJECT_REF;
if(process.env.EMBEROS_MIGRATION_ENVIRONMENT!=="STAGING"||!urlValue||!projectRef) throw new Error("EXPLICIT_STAGING_MIGRATION_AUTHORITY_REQUIRED");
const url=new URL(urlValue);
const identity=`${url.username}@${url.hostname}`;
if(projectRef!=="voofxbuzpocyjzoxrpfi"||identity.includes("egkgybrjmzukzmkcrpag")||!identity.includes(projectRef)) throw new Error("PRODUCTION_OR_UNPROVEN_DATABASE_MIGRATION_FORBIDDEN");
const db=postgres(urlValue,{max:1,prepare:false});
try {
  for(const [file,marker] of [
    ["ai-story-manual-local-generation-handoff-v1.sql","ai_story_local_generation_packages"],
    ["ai-story-provider-neutral-generation-result-v1.sql","ai_story_generation_results"],
  ] as const) {
    const [state]=await db`select to_regclass(${`public.${marker}`}) is not null as present`;
    if(state?.present) throw new Error("ONE_SHOT_GENERATION_MIGRATION_ALREADY_APPLIED_REVIEW_REQUIRED");
    await db.unsafe(await readFile(resolve(process.cwd(),"sql",file),"utf8"));
  }
} finally { await db.end(); }
