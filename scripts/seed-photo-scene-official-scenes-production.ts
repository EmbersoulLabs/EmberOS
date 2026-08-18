/**
 * Production official-scene seed with object upload and immutability guards.
 * Paid image APIs: 0. Preview seed script remains preview-gated and separate.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { evaluateOfficialSceneProductionSeed } from "../packages/shared/src/photo-scene-official-scene";
import {
  PHOTO_SCENE_OFFICIAL_BUCKET,
  PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
  PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST,
  assertProductionTarget,
  redactDatabaseTarget,
} from "../packages/shared/src/photo-scene-production-ops";
import { hashBytes, officialSceneFixtureObjects } from "./photo-scene-official-scene-fixtures";

config({ path: resolve(".env.local") });
config({ path: resolve("apps/worker/.env") });

async function main() {
  const url = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !supabaseUrl || !serviceRole) {
    throw new Error("DATABASE_URL, SUPABASE URL, and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  assertProductionTarget({
    databaseUrl: url,
    expectedRef: process.env.PHOTO_SCENE_PROD_SUPABASE_REF ?? PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
    allow: process.env.PHOTO_SCENE_PROD_SEED_ALLOW === "true",
    ack: process.env.PHOTO_SCENE_PROD_MIGRATION_ACK,
    operation: "seed",
  });

  const sql = postgres(url, { max: 1, prepare: false });
  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });

  async function putAndVerify(objectKey: string, bytes: Buffer): Promise<void> {
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_SCENE_OFFICIAL_BUCKET)
      .upload(objectKey, bytes, { contentType: "image/png", upsert: false });
    if (uploadError && !/already exists|Duplicate/i.test(uploadError.message)) {
      throw uploadError;
    }
    const { data, error } = await supabase.storage.from(PHOTO_SCENE_OFFICIAL_BUCKET).download(objectKey);
    if (error || !data) throw error ?? new Error(`Missing official scene object ${objectKey}`);
    const readback = Buffer.from(await data.arrayBuffer());
    if (hashBytes(readback) !== hashBytes(bytes)) {
      throw new Error(`Official scene object hash mismatch for ${objectKey}`);
    }
  }

  try {
    const results: Array<{ slug: string; action: string }> = [];
    for (const scene of PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST) {
      const objects = officialSceneFixtureObjects(scene);
      const existing = await sql<
        {
          background_content_hash: string;
          background_storage_identity: string;
          preview_storage_identity: string;
        }[]
      >`
        SELECT background_content_hash, background_storage_identity, preview_storage_identity
        FROM photo_scene_official_scene_versions
        WHERE scene_id = ${scene.id} AND version = ${scene.version}
        LIMIT 1
      `;
      const decision = evaluateOfficialSceneProductionSeed({
        existing: existing[0]
          ? {
              sceneId: scene.id,
              version: scene.version,
              backgroundContentHash: existing[0].background_content_hash,
              backgroundStorageIdentity: existing[0].background_storage_identity,
              previewStorageIdentity: existing[0].preview_storage_identity,
            }
          : null,
        nextHash: objects.hash,
        nextBackgroundIdentity: objects.backgroundIdentity,
        nextPreviewIdentity: objects.previewIdentity,
      });
      if (decision.action === "insert") {
        await putAndVerify(objects.backgroundKey, objects.bytes);
        await putAndVerify(objects.previewKey, objects.bytes);
        await sql`
          INSERT INTO photo_scene_official_scenes (id, slug, name, category, tags)
          VALUES (${scene.id}, ${scene.slug}, ${scene.name}, ${scene.category}, ${sql.array(scene.tags as unknown as string[])})
          ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, tags = EXCLUDED.tags
        `;
        await sql`
          INSERT INTO photo_scene_official_scene_versions (
            scene_id, version, status, supported_presets, background_storage_identity, background_content_hash,
            preview_storage_identity, safe_area, product_anchor, scale_min, scale_max, default_scale,
            default_offset_x, default_offset_y, default_shadow_preset, published_at
          )
          VALUES (
            ${scene.id}, ${scene.version}, ${scene.status}, ${sql.array(scene.presets as unknown as string[])},
            ${objects.backgroundIdentity}, ${objects.hash}, ${objects.previewIdentity},
            ${sql.json({ x: 0.18, y: 0.42, width: 0.64, height: 0.38 })},
            ${"center"}, ${"0.6"}, ${"1.4"}, ${"1"}, ${"0"}, ${"0"}, ${"soft"},
            ${scene.status === "published" ? new Date() : null}
          )
        `;
      }
      results.push({ slug: scene.slug, action: decision.action });
    }
    console.log(
      JSON.stringify({
        target: redactDatabaseTarget(url),
        status: "SEEDED",
        paidAiApiCalls: 0,
        scenes: results,
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
