import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST,
  PHOTO_SCENE_V1_MIGRATION_FILES,
  PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
  PHOTO_SCENE_PREVIEW_SUPABASE_REF,
  assertProductionTarget,
  classifyPhotoSceneSchemaPreflight,
  evaluateOfficialSceneProductionSeed,
  evaluatePhotoroomProductionEnv,
  freezeOfficialSceneObjectIdentity,
  isPhotoSceneV1MigrationFile,
  isPublicUrlStorageIdentity,
  officialBucketAnonymousWriteDenied,
  officialSceneBackgroundObjectKey,
  parseSupabaseProjectRef,
  PhotoSceneOfficialSceneError,
  PhotoSceneProductionGuardError,
  redactDatabaseTarget,
} from "@ceo-agent/shared";
import {
  productionCanAccidentallyUseTestAdapter,
  resolveBackgroundRemovalProvider,
} from "../packages/agents/src/photo-scene/background-removal";
import { officialSceneFixtureObjects } from "../scripts/photo-scene-official-scene-fixtures";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const PROD_URL = `postgresql://postgres.${PHOTO_SCENE_PRODUCTION_SUPABASE_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;
const PREVIEW_URL = `postgresql://postgres.${PHOTO_SCENE_PREVIEW_SUPABASE_REF}:secret@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`;

describe("Photo Scene PROD-02 production migration guard", () => {
  it("keeps preview apply scripts production-gated and allowlists only three SQL files", () => {
    expect(PHOTO_SCENE_V1_MIGRATION_FILES).toEqual([
      "photo-scene-campaign-asset-refs-v1.sql",
      "photo-scene-generations-v1.sql",
      "photo-scene-official-scenes-v1.sql",
    ]);
    expect(isPhotoSceneV1MigrationFile("rls.sql")).toBe(false);
    expect(isPhotoSceneV1MigrationFile("photo-scene-marketing-generations-v1.sql")).toBe(false);
    for (const script of [
      "packages/db/scripts/apply-photo-scene-campaign-asset-refs-v1.ts",
      "packages/db/scripts/apply-photo-scene-generations-v1.ts",
      "packages/db/scripts/apply-photo-scene-official-scenes-v1.ts",
    ]) {
      const source = read(script);
      expect(source).toContain(PHOTO_SCENE_PREVIEW_SUPABASE_REF);
      expect(source).toContain(PHOTO_SCENE_PRODUCTION_SUPABASE_REF);
      expect(source).toMatch(/Refusing migration|Refusing/);
    }
    const productionApply = read("packages/db/scripts/apply-photo-scene-v1-production.ts");
    expect(productionApply).toContain("PHOTO_SCENE_PROD_MIGRATION_ALLOW");
    expect(productionApply).toContain("assertProductionTarget");
    expect(productionApply).not.toMatch(/sql:rls|apply-rls/);
  });

  it("refuses production apply without allow/ack and refuses the wrong database", () => {
    expect(() =>
      assertProductionTarget({
        databaseUrl: PROD_URL,
        allow: false,
        ack: "PHOTO_SCENE_V1",
        operation: "migration",
      })
    ).toThrow(PhotoSceneProductionGuardError);
    expect(() =>
      assertProductionTarget({
        databaseUrl: PROD_URL,
        allow: true,
        ack: "yes",
        operation: "migration",
      })
    ).toThrow(/ACK/);
    expect(() =>
      assertProductionTarget({
        databaseUrl: PREVIEW_URL,
        allow: true,
        ack: "PHOTO_SCENE_V1",
        operation: "migration",
      })
    ).toThrow(/Preview database/);
    expect(
      assertProductionTarget({
        databaseUrl: PROD_URL,
        allow: true,
        ack: "PHOTO_SCENE_V1",
        operation: "migration",
      }).databaseRef
    ).toBe(PHOTO_SCENE_PRODUCTION_SUPABASE_REF);
    expect(redactDatabaseTarget(PROD_URL)).toBe(`supabase:${PHOTO_SCENE_PRODUCTION_SUPABASE_REF}`);
    expect(redactDatabaseTarget(PROD_URL)).not.toMatch(/secret/);
    expect(parseSupabaseProjectRef(PROD_URL)).toBe(PHOTO_SCENE_PRODUCTION_SUPABASE_REF);
  });
});

describe("Photo Scene PROD-02 schema preflight classification", () => {
  it("reports ABSENT, COMPATIBLE, and CONFLICT without mutating", () => {
    const absent = classifyPhotoSceneSchemaPreflight({
      databaseRef: PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
      present: {},
      compatible: {},
    });
    expect(absent.overall).toBe("ABSENT");
    expect(absent.tables.campaign_asset_refs).toBe("ABSENT");
    const compatible = classifyPhotoSceneSchemaPreflight({
      databaseRef: PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
      present: {
        campaign_asset_refs: true,
        photo_scene_generations: true,
        photo_scene_official_scenes: true,
        photo_scene_official_scene_versions: true,
        photo_scene_scene_selections: true,
      },
      compatible: {
        campaign_asset_refs: true,
        photo_scene_generations: true,
        photo_scene_official_scenes: true,
        photo_scene_official_scene_versions: true,
        photo_scene_scene_selections: true,
      },
    });
    expect(compatible.overall).toBe("COMPATIBLE");
    const conflict = classifyPhotoSceneSchemaPreflight({
      databaseRef: PHOTO_SCENE_PRODUCTION_SUPABASE_REF,
      present: { campaign_asset_refs: true },
      compatible: { campaign_asset_refs: false },
    });
    expect(conflict.overall).toBe("CONFLICT");
    expect(read("scripts/photo-scene-prod-schema-preflight.ts")).toContain("mutated: false");
  });
});

describe("Photo Scene PROD-02 official scene seed", () => {
  it("documents the 10C fixture manifest and canonical object identity", () => {
    expect(PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST.map((scene) => scene.slug)).toEqual([
      "floral-table",
      "studio-white",
      "marble-counter",
      "draft-hidden",
    ]);
    const floral = officialSceneFixtureObjects(PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[0]);
    expect(floral.backgroundIdentity).toBe(
      `official-scene-object:photo-scene-official:${officialSceneBackgroundObjectKey(
        PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[0].id,
        1
      )}`
    );
    expect(isPublicUrlStorageIdentity(floral.backgroundIdentity)).toBe(false);
    expect(freezeOfficialSceneObjectIdentity(DEFAULT_OFFICIAL_SCENE_BUCKET, floral.backgroundKey)).toBe(
      floral.backgroundIdentity
    );
  });

  it("no-ops the same hash and fails closed on a different hash", () => {
    const floral = officialSceneFixtureObjects(PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[0]);
    expect(
      evaluateOfficialSceneProductionSeed({
        existing: null,
        nextHash: floral.hash,
        nextBackgroundIdentity: floral.backgroundIdentity,
        nextPreviewIdentity: floral.previewIdentity,
      }).action
    ).toBe("insert");
    expect(
      evaluateOfficialSceneProductionSeed({
        existing: {
          sceneId: PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[0].id,
          version: 1,
          backgroundContentHash: floral.hash,
          backgroundStorageIdentity: floral.backgroundIdentity,
          previewStorageIdentity: floral.previewIdentity,
        },
        nextHash: floral.hash,
        nextBackgroundIdentity: floral.backgroundIdentity,
        nextPreviewIdentity: floral.previewIdentity,
      }).action
    ).toBe("verified_noop");
    expect(() =>
      evaluateOfficialSceneProductionSeed({
        existing: {
          sceneId: PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[0].id,
          version: 1,
          backgroundContentHash: floral.hash,
          backgroundStorageIdentity: floral.backgroundIdentity,
          previewStorageIdentity: floral.previewIdentity,
        },
        nextHash: `sha256:${"b".repeat(64)}`,
        nextBackgroundIdentity: floral.backgroundIdentity,
        nextPreviewIdentity: floral.previewIdentity,
      })
    ).toThrow(PhotoSceneOfficialSceneError);
    const seed = read("scripts/seed-photo-scene-official-scenes-production.ts");
    expect(seed).toContain("upload");
    expect(seed).toContain("download");
    expect(seed).not.toMatch(/photoroom|openai|flux/i);
  });
});

describe("Photo Scene PROD-02 bucket and Photoroom env", () => {
  it("denies anonymous writes to photo-scene-official", () => {
    expect(
      officialBucketAnonymousWriteDenied([
        {
          policyname: "public read",
          cmd: "SELECT",
          roles: ["anon", "authenticated"],
          qual: "bucket_id = 'photo-scene-official'",
          withCheck: null,
        },
      ])
    ).toBe(true);
    expect(
      officialBucketAnonymousWriteDenied([
        {
          policyname: "anon write",
          cmd: "INSERT",
          roles: ["anon"],
          qual: "bucket_id = 'photo-scene-official'",
          withCheck: "true",
        },
      ])
    ).toBe(false);
    const bucketTool = read("scripts/photo-scene-prod-official-bucket.ts");
    expect(bucketTool).toContain('process.argv.includes("--apply") ? "apply" : "plan"');
    expect(bucketTool).toContain("PHOTO_SCENE_PROD_BUCKET_ALLOW");
  });

  it("classifies Photoroom production env without printing secrets", () => {
    const missing = evaluatePhotoroomProductionEnv({});
    expect(missing.status).toBe("MISSING");
    const ready = evaluatePhotoroomProductionEnv({
      PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "photoroom",
      PHOTOROOM_API_KEY: "super-secret-live-key",
      PHOTO_SCENE_PHOTOROOM_COST_USD: "0.02",
      PHOTO_SCENE_PROVIDER_TIMEOUT_MS: "30000",
      PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "false",
    });
    expect(ready.status).toBe("READY");
    expect(JSON.stringify(ready)).not.toContain("super-secret-live-key");
    const preflight = read("scripts/photo-scene-prod-photoroom-env-preflight.ts");
    expect(preflight).toContain("secretsPrinted: false");
    expect(preflight).not.toMatch(/console\.log\(.*PHOTOROOM_API_KEY/);
  });

  it("cannot select the deterministic provider in production", () => {
    expect(
      resolveBackgroundRemovalProvider({
        NODE_ENV: "production",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "deterministic",
        PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "true",
      }).key
    ).toBe("none");
    expect(
      productionCanAccidentallyUseTestAdapter({
        NODE_ENV: "production",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "deterministic",
        PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "true",
      })
    ).toBe(false);
  });
});

describe("Photo Scene PROD-02 bounded runtime and forbidden scope", () => {
  it("does not change Video Studio renderer or signing authority", () => {
    expect(read("apps/worker/src/processors/photo-scene-extract-handler.ts")).not.toMatch(/ffmpeg/i);
    expect(read("apps/worker/src/processors/photo-scene-compose-handler.ts")).not.toMatch(/ffmpeg/i);
    expect(read("apps/web/src/lib/asset-signed-delivery.ts")).toContain("isPhotoSceneTenantStoragePath");
    expect(read("apps/web/src/lib/asset-signed-delivery.ts")).not.toContain("signCreativeDownload");
    expect(read("apps/web/src/lib/video-artifact-delivery.ts")).toContain("resolveExpectedVideoArtifactKey");
    expect(read("apps/worker/src/processors/index.ts")).toContain("QUEUE_NAMES.PHOTO_SCENE");
    expect(read("apps/worker/src/processors/index.ts")).toContain("photo_scene.extract");
  });

  it("keeps Photo Scene enqueue off Video Studio campaign run", () => {
    const run = read("apps/web/src/app/api/campaigns/[id]/run/route.ts");
    expect(run).not.toMatch(/photo_scene|photoSceneQueue|enqueuePhotoScene/);
    const extract = read("apps/web/src/lib/photo-scene-extraction.ts");
    expect(extract).toContain("enqueuePhotoSceneExtract");
  });

  it("scans the overlay for forbidden products", () => {
    const files = [
      "apps/web/src/lib/photo-scene-extraction.ts",
      "apps/web/src/lib/photo-scene-marketing.ts",
      "apps/worker/src/processors/photo-scene-extract-handler.ts",
      "apps/worker/src/processors/photo-scene-compose-handler.ts",
      "packages/agents/src/photo-scene/execute-marketing-composition.ts",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).not.toMatch(/creative_studio_jobs|AUTH-01|quota|billing|flux|openai.*image|ai-story/i);
    }
    expect(read("packages/db/src/schema/index.ts")).not.toMatch(
      /pgTable\(\s*"creative_assets"|pgTable\(\s*"creative_studio_jobs"/
    );
  });
});

describe("Photo Scene PROD-02 fixture bytes", () => {
  it("creates deterministic PNG hashes without paid APIs", () => {
    const a = officialSceneFixtureObjects(PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[1]);
    const b = officialSceneFixtureObjects(PHOTO_SCENE_V1_OFFICIAL_SCENE_MANIFEST[1]);
    expect(a.hash).toBe(b.hash);
    expect(a.hash.startsWith("sha256:")).toBe(true);
    expect(createHash("sha256").update(a.bytes).digest("hex")).toBe(a.hash.slice(7));
  });
});
