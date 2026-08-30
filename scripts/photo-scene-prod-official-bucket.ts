/**
 * Plan or provision the Photo Scene official catalog bucket.
 * Default mode is plan. Apply requires production allow flags.
 * This ticket must not create the production bucket.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import {
  PHOTO_SCENE_OFFICIAL_BUCKET,
  PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
  assertProductionTarget,
  officialBucketAnonymousWriteDenied,
  redactDatabaseTarget,
  type StoragePolicyRow,
} from "../packages/shared/src/photo-scene-production-ops";

config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

async function main() {
  const mode = (process.argv.includes("--apply") ? "apply" : "plan") as "plan" | "apply";
  const url = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const plan = {
    bucket: PHOTO_SCENE_OFFICIAL_BUCKET,
    public: true,
    intendedVisibility: "PUBLIC_READ",
    anonymousWrite: "DENIED",
    anonymousUpdate: "DENIED",
    anonymousDelete: "DENIED",
    serviceRoleWrite: "ALLOWED",
    mode,
  };

  if (mode === "plan") {
    console.log(JSON.stringify({ ...plan, created: false }));
    return;
  }

  if (!url || !supabaseUrl || !serviceRole) {
    throw new Error("DATABASE_URL, SUPABASE URL, and SUPABASE_SERVICE_ROLE_KEY are required for apply");
  }

  assertProductionTarget({
    databaseUrl: url,
    expectedRef: process.env.PHOTO_SCENE_PROD_SUPABASE_REF ?? PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
    allow: process.env.PHOTO_SCENE_PROD_BUCKET_ALLOW === "true",
    ack: process.env.PHOTO_SCENE_PROD_MIGRATION_ACK,
    operation: "bucket",
  });

  const sql = postgres(url, { max: 1, prepare: false });
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
  try {
    const policies = await sql<StoragePolicyRow[]>`
      SELECT policyname, cmd, roles::text[] AS roles, qual, with_check AS "withCheck"
      FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
    `;
    if (!officialBucketAnonymousWriteDenied(policies)) {
      throw new Error("Refusing bucket apply: anonymous write policy detected on storage.objects");
    }
    const { data: existing } = await supabase.storage.getBucket(PHOTO_SCENE_OFFICIAL_BUCKET);
    if (!existing) {
      const { error } = await supabase.storage.createBucket(PHOTO_SCENE_OFFICIAL_BUCKET, {
        public: true,
        fileSizeLimit: 8 * 1024 * 1024,
        allowedMimeTypes: ["image/png"],
      });
      if (error) throw error;
    }
    await sql.unsafe(`
      DROP POLICY IF EXISTS photo_scene_official_public_read ON storage.objects;
      CREATE POLICY photo_scene_official_public_read ON storage.objects
        FOR SELECT
        USING (bucket_id = '${PHOTO_SCENE_OFFICIAL_BUCKET}');
    `);
    console.log(
      JSON.stringify({
        target: redactDatabaseTarget(url),
        bucket: PHOTO_SCENE_OFFICIAL_BUCKET,
        created: !existing,
        anonymousWriteDenied: true,
      })
    );
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
