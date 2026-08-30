import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUSINESS_BRANDING_BUCKET,
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET,
  PHOTO_SCENE_OUTPUT_PRESETS,
  PHOTO_SCENE_OUTPUT_PRESET_PIXELS,
  STORAGE_PATHS,
  assertHardDeleteProhibited,
  assertPlacementAgainstScene,
  assertPublishedVersionImmutable,
  assertSceneBackgroundBytesBound,
  assertTenantCannotMutateOfficialSceneCatalog,
  currentPublishedPolicySelection,
  freezeOfficialSceneObjectIdentity,
  freezeOfficialSceneSelection,
  isOfficialSceneObjectIdentity,
  isPublicUrlStorageIdentity,
  isSelectableByTenant,
  listSelectableOfficialScenes,
  officialSceneBackgroundObjectKey,
  officialScenePreviewDeliveryUrl,
  officialScenePreviewObjectKey,
  parseOfficialSceneObjectIdentity,
  PhotoSceneOfficialSceneError,
  PhotoScenePlacementV1Schema,
  PhotoSceneSafeAreaV1Schema,
  publishOfficialSceneVersion,
  resolveFrozenOfficialSceneSelection,
  retireOfficialSceneVersion,
  type OfficialSceneVersionSnapshot,
} from "@ceo-agent/shared";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const SCENE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const HASH = (label: string) =>
  `sha256:${createHash("sha256").update(label).digest("hex")}` as const;

function scene(overrides: Partial<OfficialSceneVersionSnapshot> = {}): OfficialSceneVersionSnapshot {
  const version = overrides.version ?? 1;
  const background = freezeOfficialSceneObjectIdentity(
    DEFAULT_OFFICIAL_SCENE_BUCKET,
    officialSceneBackgroundObjectKey(SCENE_A, version)
  );
  return {
    sceneId: SCENE_A,
    sceneSlug: "floral-table",
    name: "Floral table",
    category: "lifestyle",
    tags: ["flowers"],
    version,
    status: "published",
    supportedPresets: ["story_9x16", "portrait_4x5"],
    backgroundStorageIdentity: background,
    backgroundContentHash: HASH(`v${version}`),
    previewStorageIdentity: freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialScenePreviewObjectKey(SCENE_A, version)
    ),
    safeArea: { x: 0.2, y: 0.4, width: 0.6, height: 0.4 },
    productAnchor: "center",
    scaleRange: { min: 0.6, max: 1.4, defaultScale: 1 },
    defaultOffsetX: 0,
    defaultOffsetY: 0,
    defaultShadowPreset: "soft",
    publishedAt: "2026-08-18T00:00:00.000Z",
    retiredAt: null,
    ...overrides,
  };
}

describe("Photo Scene 10C official scene schema", () => {
  it("adds global official scene tables without creative_assets or creative_studio_jobs", () => {
    const sql = read("packages/db/sql/photo-scene-official-scenes-v1.sql");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS photo_scene_official_scenes/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS photo_scene_official_scene_versions/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS photo_scene_scene_selections/);
    expect(sql).toMatch(/UNIQUE INDEX IF NOT EXISTS photo_scene_official_scene_one_published_idx/);
    const catalogSql = sql.split("photo_scene_scene_selections")[0];
    expect(catalogSql).not.toMatch(/org_id|workspace_id/);
    expect(sql).toMatch(/photo_scene_scene_selections[\s\S]*org_id uuid NOT NULL/);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS (creative_assets|creative_studio_jobs)/);
    expect(read("packages/db/src/schema/index.ts")).toMatch(/photoSceneOfficialScenes/);
    expect(read("packages/db/src/schema/index.ts")).not.toMatch(
      /pgTable\(\s*"creative_assets"|pgTable\(\s*"creative_studio_jobs"/
    );
  });
});

describe("Photo Scene 10C global ownership", () => {
  it("keeps official scene objects off tenant and branding buckets", () => {
    const key = officialSceneBackgroundObjectKey(SCENE_A, 1);
    const identity = freezeOfficialSceneObjectIdentity(DEFAULT_OFFICIAL_SCENE_BUCKET, key);
    expect(DEFAULT_OFFICIAL_SCENE_BUCKET).toBe("photo-scene-official");
    expect(DEFAULT_OFFICIAL_SCENE_BUCKET).not.toBe(DEFAULT_VIDEO_STUDIO_STORAGE_BUCKET);
    expect(DEFAULT_OFFICIAL_SCENE_BUCKET).not.toBe(DEFAULT_BUSINESS_BRANDING_BUCKET);
    expect(identity).toBe(`official-scene-object:photo-scene-official:${key}`);
    expect(isOfficialSceneObjectIdentity(identity)).toBe(true);
    expect(parseOfficialSceneObjectIdentity(identity)).toEqual({
      bucket: "photo-scene-official",
      objectKey: key,
    });
    expect(key).not.toContain("/library/");
    expect(STORAGE_PATHS.library("ws", "asset", "png")).not.toContain("official/");
  });

  it("refuses public URLs and tenant library paths as scene identity", () => {
    expect(() =>
      freezeOfficialSceneObjectIdentity("photo-scene-official", "https://cdn.example/scene.png")
    ).toThrow(PhotoSceneOfficialSceneError);
    expect(() =>
      freezeOfficialSceneObjectIdentity("photo-scene-official", "ws/library/asset.png")
    ).toThrow(/tenant campaign-assets/);
    expect(isPublicUrlStorageIdentity("https://example.com/x")).toBe(true);
    expect(
      officialScenePreviewDeliveryUrl(
        "https://example.supabase.co",
        freezeOfficialSceneObjectIdentity(
          DEFAULT_OFFICIAL_SCENE_BUCKET,
          officialScenePreviewObjectKey(SCENE_A, 1)
        )
      )
    ).toContain("/object/public/photo-scene-official/");
  });
});

describe("Photo Scene 10C versioning and immutability", () => {
  it("freezes v1 through a later v2 publish and retirement", () => {
    const v1 = scene({ version: 1, backgroundContentHash: HASH("H1") });
    const frozen = freezeOfficialSceneSelection({ scene: v1, presetId: "story_9x16" });
    let catalog = publishOfficialSceneVersion([], v1);
    const v2 = scene({
      version: 2,
      backgroundContentHash: HASH("H2"),
      backgroundStorageIdentity: freezeOfficialSceneObjectIdentity(
        DEFAULT_OFFICIAL_SCENE_BUCKET,
        officialSceneBackgroundObjectKey(SCENE_A, 2)
      ),
      previewStorageIdentity: freezeOfficialSceneObjectIdentity(
        DEFAULT_OFFICIAL_SCENE_BUCKET,
        officialScenePreviewObjectKey(SCENE_A, 2)
      ),
    });
    catalog = publishOfficialSceneVersion(catalog, v2);
    expect(catalog.find((row) => row.version === 1)?.status).toBe("retired");
    expect(catalog.find((row) => row.version === 2)?.status).toBe("published");
    const resolved = resolveFrozenOfficialSceneSelection(frozen, catalog);
    expect(resolved.version).toBe(1);
    expect(resolved.backgroundContentHash).toBe(HASH("H1"));
    expect(resolved.backgroundContentHash).not.toBe(HASH("H2"));
    catalog = retireOfficialSceneVersion(catalog, SCENE_A, 1);
    const still = resolveFrozenOfficialSceneSelection(frozen, catalog);
    expect(still.version).toBe(1);
    expect(still.status).toBe("retired");
    expect(currentPublishedPolicySelection(catalog, SCENE_A)?.version).toBe(2);
    expect(listSelectableOfficialScenes(catalog).map((row) => row.version)).toEqual([2]);
  });

  it("rejects mutating a published version's background identity or hash", () => {
    const published = scene();
    expect(() =>
      assertPublishedVersionImmutable(published, { backgroundContentHash: HASH("mutated") })
    ).toThrow(/cannot change visual authority/);
    expect(() =>
      assertPublishedVersionImmutable(published, {
        backgroundStorageIdentity: freezeOfficialSceneObjectIdentity(
          DEFAULT_OFFICIAL_SCENE_BUCKET,
          officialSceneBackgroundObjectKey(SCENE_A, 99)
        ),
      })
    ).toThrow(PhotoSceneOfficialSceneError);
    expect(() => assertHardDeleteProhibited("published")).toThrow(/cannot be deleted/);
    expect(() => assertHardDeleteProhibited("retired")).toThrow(/cannot be deleted/);
    expect(() => assertHardDeleteProhibited("draft")).not.toThrow();
  });
});

describe("Photo Scene 10C content hash and status", () => {
  it("binds scene version bytes and hides unpublished scenes from selection", () => {
    const bytes = encodeRgbaPng(8, 8, Buffer.alloc(8 * 8 * 4, 40));
    const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const published = scene({ backgroundContentHash: hash as `sha256:${string}` });
    assertSceneBackgroundBytesBound(published, hash);
    expect(() => assertSceneBackgroundBytesBound(published, HASH("other"))).toThrow(/does not match/);
    const draft = scene({ status: "draft", version: 3 });
    expect(isSelectableByTenant(draft.status)).toBe(false);
    expect(() => freezeOfficialSceneSelection({ scene: draft, presetId: "feed_1x1" })).toThrow(
      /Only published/
    );
    expect(listSelectableOfficialScenes([published, draft])).toHaveLength(1);
  });
});

describe("Photo Scene 10C preset compatibility", () => {
  it("filters incompatible output presets", () => {
    const floral = scene({ supportedPresets: ["story_9x16", "portrait_4x5"] });
    const studio = scene({
      sceneId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      sceneSlug: "studio-white",
      category: "studio",
      supportedPresets: ["feed_1x1"],
    });
    expect(PHOTO_SCENE_OUTPUT_PRESETS).toEqual(["story_9x16", "feed_1x1", "portrait_4x5"]);
    expect(PHOTO_SCENE_OUTPUT_PRESET_PIXELS.story_9x16).toEqual({
      width: 1080,
      height: 1920,
      ratio: "9:16",
    });
    expect(listSelectableOfficialScenes([floral, studio], { presetId: "feed_1x1" }).map((row) => row.sceneSlug)).toEqual([
      "studio-white",
    ]);
    expect(() => freezeOfficialSceneSelection({ scene: floral, presetId: "feed_1x1" })).toThrow(
      /does not support/
    );
  });
});

describe("Photo Scene 10C placement contract", () => {
  it("accepts bounded placement and fails closed outside the safe area", () => {
    const floral = scene();
    const ok = assertPlacementAgainstScene(
      floral,
      {
        anchor: "center",
        offsetX: 0.05,
        offsetY: -0.02,
        scale: 1.1,
        rotation: 0,
        zIndex: 1,
        shadowPreset: "grounded",
      },
      "story_9x16"
    );
    expect(ok.rotation).toBe(0);
    expect(PhotoSceneSafeAreaV1Schema.parse(floral.safeArea).width).toBeGreaterThan(0);
    expect(() =>
      PhotoScenePlacementV1Schema.parse({ ...ok, rotation: 15 })
    ).toThrow();
    expect(() =>
      assertPlacementAgainstScene(floral, { ...ok, offsetX: 0.9 }, "story_9x16")
    ).toThrow(/inside the safe area/);
    expect(() =>
      assertPlacementAgainstScene(floral, { ...ok, scale: 9 }, "story_9x16")
    ).toThrow(/Scale is outside/);
    expect(() =>
      assertPlacementAgainstScene(floral, { ...ok, anchor: "top" }, "story_9x16")
    ).toThrow(/Anchor must match/);
  });
});

describe("Photo Scene 10C frozen scene selection", () => {
  it("serializes deterministic identity without URLs or secrets", () => {
    const frozen = freezeOfficialSceneSelection({
      scene: scene(),
      presetId: "portrait_4x5",
      placement: { offsetX: 0, offsetY: 0, scale: 1, shadowPreset: "none" },
    });
    expect(frozen.contract).toBe("photo-scene-frozen-scene-v1");
    expect(frozen.sceneVersion).toBe(1);
    expect(JSON.stringify(frozen)).not.toMatch(/https?:\/\//);
    expect(JSON.stringify(frozen)).not.toMatch(/token=/);
    expect(JSON.stringify(frozen)).not.toMatch(/Authorization/);
    expect(frozen).not.toHaveProperty("previewUrl");
    expect(frozen).not.toHaveProperty("name");
  });
});

describe("Photo Scene 10C tenant mutation denial", () => {
  it("denies tenant catalog writes in domain and SQL policies", () => {
    expect(() => assertTenantCannotMutateOfficialSceneCatalog()).toThrow(
      /cannot be created or edited by tenants/
    );
    const sql = read("packages/db/sql/photo-scene-official-scenes-v1.sql");
    expect(sql).toMatch(/photo_scene_official_scenes_select/);
    expect(sql).not.toMatch(/photo_scene_official_scenes_insert|photo_scene_official_scenes_all/);
    expect(sql).toMatch(/status IN \('published', 'retired'\)/);
    expect(read("apps/web/src/app/api/photo-scene/official-scenes/route.ts")).toMatch(
      /refuseTenantCatalogWrite/
    );
  });
});

describe("Photo Scene 10C UI and contamination bounds", () => {
  it("does not create a marketing image or call paid providers", () => {
    const panel = read("apps/web/src/components/photo-scene/PhotoSceneOfficialLibraryPanel.tsx");
    expect(panel).toMatch(/Placement preview only/);
    expect(panel).toMatch(/Marketing image not generated/);
    expect(panel).not.toMatch(/photoroom|openai|flux|replicate|fal\.ai|seedance/i);
    expect(read("apps/web/src/lib/photo-scene-official-scenes.ts")).toMatch(/marketingImageCreated: false/);
    expect(read("packages/agents/src/photo-scene/background-removal.ts")).toMatch(/photoroom/);
  });
});
