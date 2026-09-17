import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Deliberately inert unless an operator explicitly authorizes a later rollout.
if (process.env.AI_STORY_CERTIFICATION_SCHEMA_APPLY_AUTHORIZED !== "1") {
  throw new Error("AI_STORY_CERTIFICATION_SCHEMA_APPLY_AUTHORIZATION_REQUIRED");
}
const target = process.env.AI_STORY_CERTIFICATION_SCHEMA_APPLY_TARGET;
if (target !== "STAGING" && target !== "PRODUCTION") {
  throw new Error("AI_STORY_CERTIFICATION_SCHEMA_APPLY_TARGET_REQUIRED");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const directory = dirname(fileURLToPath(import.meta.url));
const client = postgres(databaseUrl, { max: 1, prepare: false });
try {
  await client.unsafe(readFileSync(resolve(directory, "../sql/ai-story-certification-planning-production-scope-v1.sql"), "utf8"));
} finally {
  await client.end();
}
