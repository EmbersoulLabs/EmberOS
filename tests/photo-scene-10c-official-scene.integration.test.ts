import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  freezeOfficialSceneObjectIdentity,
  freezeOfficialSceneSelection,
  officialSceneBackgroundObjectKey,
  officialScenePreviewObjectKey,
  resolveFrozenOfficialSceneSelection,
} from "@ceo-agent/shared";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import { isRlsEnabled, withAuthenticatedUser } from "./helpers/db-integration";

const RUN = process.env.RUN_DB_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);

function hashBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe.skipIf(!RUN)("Photo Scene 10C official scene DB integration", () => {
  let sql: ReturnType<typeof postgres>;
  const sceneId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const hash1 = hashBytes(encodeRgbaPng(8, 8, Buffer.alloc(256, 10)));
  const hash2 = hashBytes(encodeRgbaPng(8, 8, Buffer.alloc(256, 200)));

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: "require" });
    await sql.unsafe(
      readFileSync(resolve(process.cwd(), "packages/db/sql/photo-scene-official-scenes-v1.sql"), "utf8")
    );
    await sql`
      INSERT INTO organizations (id, name, slug)
      VALUES (${orgId}, ${"10C Scene Cert"}, ${`ps10c-${sceneId.slice(0, 8)}`})
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES (${workspaceId}, ${orgId}, ${"Cert"}, ${`ps10c-ws-${sceneId.slice(0, 8)}`})
    `;
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES (${orgId}, ${workspaceId}, ${userId}, ${"admin"})
    `;
    const identity1 = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialSceneBackgroundObjectKey(sceneId, 1)
    );
    const preview1 = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialScenePreviewObjectKey(sceneId, 1)
    );
    await sql`
      INSERT INTO photo_scene_official_scenes (id, slug, name, category)
      VALUES (${sceneId}, ${`floral-${sceneId.slice(0, 8)}`}, ${"Floral table"}, ${"lifestyle"})
    `;
    await sql`
      INSERT INTO photo_scene_official_scene_versions (
        scene_id, version, status, supported_presets, background_storage_identity, background_content_hash,
        preview_storage_identity, safe_area, product_anchor, scale_min, scale_max, default_scale, published_at
      ) VALUES (
        ${sceneId}, 1, ${"published"}, ${sql.array(["story_9x16"])}, ${identity1}, ${hash1}, ${preview1},
        ${sql.json({ x: 0.2, y: 0.4, width: 0.6, height: 0.4 })}, ${"center"}, ${"0.6"}, ${"1.4"}, ${"1"}, now()
      )
    `;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM photo_scene_official_scene_versions WHERE scene_id = ${sceneId}`;
    await sql`DELETE FROM photo_scene_official_scenes WHERE id = ${sceneId}`;
    await sql`DELETE FROM workspace_members WHERE org_id = ${orgId}`;
    await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end({ timeout: 2 });
  }, 30_000);

  it("enforces global catalog RLS and frozen v1 through v2 publish", async () => {
    expect(await isRlsEnabled(sql, "photo_scene_official_scenes")).toBe(true);
    expect(await isRlsEnabled(sql, "photo_scene_official_scene_versions")).toBe(true);
    expect(await isRlsEnabled(sql, "photo_scene_scene_selections")).toBe(true);

    let tenantInsertDenied = false;
    try {
      await withAuthenticatedUser(sql, userId, async (tx) => {
        await tx`
          INSERT INTO photo_scene_official_scenes (slug, name, category)
          VALUES (${"tenant-fake"}, ${"Fake"}, ${"x"})
        `;
      });
    } catch (error) {
      tenantInsertDenied = /row-level security|permission denied/i.test(String(error));
    }
    expect(tenantInsertDenied).toBe(true);

    const v1rows = await sql<{
      version: number;
      status: string;
      background_content_hash: string;
      background_storage_identity: string;
    }[]>`
      SELECT version, status, background_content_hash, background_storage_identity
      FROM photo_scene_official_scene_versions WHERE scene_id = ${sceneId} AND version = 1
    `;
    const frozen = freezeOfficialSceneSelection({
      scene: {
        sceneId,
        sceneSlug: "floral-table",
        name: "Floral table",
        category: "lifestyle",
        tags: [],
        version: 1,
        status: "published",
        supportedPresets: ["story_9x16"],
        backgroundStorageIdentity: v1rows[0]!.background_storage_identity,
        backgroundContentHash: v1rows[0]!.background_content_hash as `sha256:${string}`,
        previewStorageIdentity: freezeOfficialSceneObjectIdentity(
          DEFAULT_OFFICIAL_SCENE_BUCKET,
          officialScenePreviewObjectKey(sceneId, 1)
        ),
        safeArea: { x: 0.2, y: 0.4, width: 0.6, height: 0.4 },
        productAnchor: "center",
        scaleRange: { min: 0.6, max: 1.4, defaultScale: 1 },
        defaultOffsetX: 0,
        defaultOffsetY: 0,
        defaultShadowPreset: "soft",
      },
      presetId: "story_9x16",
    });

    await sql`
      UPDATE photo_scene_official_scene_versions
      SET status = ${"retired"}, retired_at = now()
      WHERE scene_id = ${sceneId} AND version = 1
    `;
    const identity2 = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialSceneBackgroundObjectKey(sceneId, 2)
    );
    const preview2 = freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialScenePreviewObjectKey(sceneId, 2)
    );
    await sql`
      INSERT INTO photo_scene_official_scene_versions (
        scene_id, version, status, supported_presets, background_storage_identity, background_content_hash,
        preview_storage_identity, safe_area, product_anchor, scale_min, scale_max, default_scale, published_at
      ) VALUES (
        ${sceneId}, 2, ${"published"}, ${sql.array(["story_9x16"])}, ${identity2}, ${hash2}, ${preview2},
        ${sql.json({ x: 0.2, y: 0.4, width: 0.6, height: 0.4 })}, ${"center"}, ${"0.6"}, ${"1.4"}, ${"1"}, now()
      )
    `;

    const catalog = await sql<{
      version: number;
      status: string;
      background_content_hash: string;
      background_storage_identity: string;
    }[]>`
      SELECT version, status, background_content_hash, background_storage_identity
      FROM photo_scene_official_scene_versions WHERE scene_id = ${sceneId}
    `;
    const snapshots = catalog.map((row) => ({
      sceneId,
      sceneSlug: "floral-table",
      name: "Floral table",
      category: "lifestyle",
      tags: [],
      version: row.version,
      status: row.status as "published" | "retired",
      supportedPresets: ["story_9x16" as const],
      backgroundStorageIdentity: row.background_storage_identity,
      backgroundContentHash: row.background_content_hash as `sha256:${string}`,
      previewStorageIdentity: freezeOfficialSceneObjectIdentity(
        DEFAULT_OFFICIAL_SCENE_BUCKET,
        officialScenePreviewObjectKey(sceneId, row.version)
      ),
      safeArea: { x: 0.2, y: 0.4, width: 0.6, height: 0.4 },
      productAnchor: "center" as const,
      scaleRange: { min: 0.6, max: 1.4, defaultScale: 1 },
      defaultOffsetX: 0,
      defaultOffsetY: 0,
      defaultShadowPreset: "soft" as const,
    }));
    const resolved = resolveFrozenOfficialSceneSelection(frozen, snapshots);
    expect(resolved.version).toBe(1);
    expect(resolved.backgroundContentHash).toBe(hash1);
    expect(resolved.status).toBe("retired");
    expect(catalog.find((row) => row.version === 2)?.background_content_hash).toBe(hash2);
  });
});
