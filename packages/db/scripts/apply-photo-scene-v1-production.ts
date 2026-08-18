/**
 * Operator-controlled Photo Scene V1 production migration apply.
 * Preview-gated apply-photo-scene-*-v1.ts scripts remain and still refuse production.
 * This script never runs a full SQL sweep and never logs credentials.
 */
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
  PHOTO_SCENE_V1_MIGRATION_FILES,
  assertProductionTarget,
  isPhotoSceneV1MigrationFile,
  redactDatabaseTarget,
} from "@ceo-agent/shared";

const directory = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(directory, "../../../apps/worker/.env") });
config({ path: resolve(directory, "../../../.env.local") });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

const requested = (process.env.PHOTO_SCENE_PROD_MIGRATION_FILES ?? PHOTO_SCENE_V1_MIGRATION_FILES.join(","))
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

for (const name of requested) {
  if (!isPhotoSceneV1MigrationFile(name)) {
    throw new Error(`Refusing unknown Photo Scene migration: ${name}`);
  }
}

const requestedSet = new Set(requested);
const ordered = PHOTO_SCENE_V1_MIGRATION_FILES.filter((name) => requestedSet.has(name));

const { databaseRef } = assertProductionTarget({
  databaseUrl: url,
  expectedRef: process.env.PHOTO_SCENE_PROD_SUPABASE_REF ?? PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
  allow: process.env.PHOTO_SCENE_PROD_MIGRATION_ALLOW === "true",
  ack: process.env.PHOTO_SCENE_PROD_MIGRATION_ACK,
  operation: "migration",
});

const db = postgres(url, { max: 1 });
try {
  console.log(
    JSON.stringify({
      target: redactDatabaseTarget(url),
      databaseRef,
      migrations: ordered,
    })
  );
  for (const name of ordered) {
    const sql = readFileSync(resolve(directory, "../sql", name), "utf8");
    await db.unsafe(sql);
    console.log(JSON.stringify({ applied: name }));
  }
} finally {
  await db.end();
}
