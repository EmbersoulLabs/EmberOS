/**
 * Seed deterministic Photo Scene 10C official scene fixtures.
 * Locally generated PNGs only. No paid image APIs. Refuses production DB.
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import { resolve } from "node:path";
import postgres from "postgres";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import {
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  freezeOfficialSceneObjectIdentity,
  officialSceneBackgroundObjectKey,
  officialScenePreviewObjectKey,
} from "../packages/shared/src/photo-scene-official-scene";

config({ path: resolve(".env.local") });

const url = process.env.DATABASE_URL;
if (!url) {
  console.log(JSON.stringify({ status: "ENVIRONMENT_NOT_RUN", reason: "DATABASE_URL_missing" }));
  process.exit(0);
}
const expectedRef = "voofxbuzpocyjzoxrpfi";
const forbiddenRef = "egkgybrjmzukzmkcrpag";
const databaseRef =
  url.match(/postgres\.([a-z0-9]+)/i)?.[1] ?? url.match(/([a-z0-9]+)\.supabase\.co/i)?.[1];
if (!databaseRef || databaseRef === forbiddenRef || databaseRef !== expectedRef) {
  throw new Error("Refusing seed: database is not the authorized Preview project");
}

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixturePng(kind: string): Buffer {
  const width = 32;
  const height = kind === "story" ? 56 : kind === "portrait" ? 40 : 32;
  const rgba = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = kind === "floral" ? 180 : kind === "studio" ? 245 : kind === "marble" ? 210 : 40;
      rgba[i + 1] = kind === "floral" ? 60 : kind === "studio" ? 245 : kind === "marble" ? 210 : 40;
      rgba[i + 2] = kind === "floral" ? 90 : kind === "studio" ? 250 : kind === "marble" ? 220 : 80;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

const SCENES = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
    slug: "floral-table",
    name: "Floral table",
    category: "lifestyle",
    tags: ["flowers", "table"],
    kind: "floral",
    presets: ["story_9x16", "portrait_4x5"],
    status: "published",
    version: 1,
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
    slug: "studio-white",
    name: "Studio white",
    category: "studio",
    tags: ["seamless"],
    kind: "studio",
    presets: ["feed_1x1"],
    status: "published",
    version: 1,
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000003",
    slug: "marble-counter",
    name: "Marble counter",
    category: "kitchen",
    tags: ["marble"],
    kind: "marble",
    presets: ["story_9x16", "feed_1x1", "portrait_4x5"],
    status: "published",
    version: 1,
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000004",
    slug: "draft-hidden",
    name: "Draft hidden",
    category: "internal",
    tags: ["draft"],
    kind: "draft",
    presets: ["feed_1x1"],
    status: "draft",
    version: 1,
  },
] as const;

const sql = postgres(url, { max: 1, prepare: false, ssl: "require" });
try {
  for (const scene of SCENES) {
    const bytes = fixturePng(scene.kind);
    const hash = hashBytes(bytes);
    const background = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialSceneBackgroundObjectKey(scene.id, scene.version)
    );
    const preview = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialScenePreviewObjectKey(scene.id, scene.version)
    );
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
        ${background}, ${hash}, ${preview},
        ${sql.json({ x: 0.18, y: 0.42, width: 0.64, height: 0.38 })},
        ${"center"}, ${"0.6"}, ${"1.4"}, ${"1"}, ${"0"}, ${"0"}, ${"soft"},
        ${scene.status === "published" ? new Date() : null}
      )
      ON CONFLICT (scene_id, version) DO NOTHING
    `;
  }
  console.log(JSON.stringify({ status: "SEEDED", scenes: SCENES.length, paidAiApiCalls: 0 }));
} finally {
  await sql.end({ timeout: 2 });
}
