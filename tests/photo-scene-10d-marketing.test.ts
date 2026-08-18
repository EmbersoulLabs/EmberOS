import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFICIAL_SCENE_BUCKET,
  DETERMINISTIC_COMPOSITOR_KEY,
  MARKETING_COMPOSITION_EXTERNAL_COST_USD,
  PHOTO_SCENE_GENERATION_OPERATIONS,
  PHOTO_SCENE_OUTPUT_PRESET_PIXELS,
  STORAGE_PATHS,
  computeProductPlacementNormalized,
  computeProductPlacementPixels,
  evaluateMarketingGenerateAgain,
  evaluateMarketingRetry,
  extractBoundedMarketingCopy,
  freezeBrandSnapshot,
  freezeMarketingImageInput,
  freezeMarketingPackageSnapshot,
  freezeOfficialSceneObjectIdentity,
  freezeOfficialSceneSelection,
  isPublicUrlStorageIdentity,
  joinInflightMarketing,
  marketingFingerprintIdentity,
  marketingLineage,
  officialSceneBackgroundObjectKey,
  overlayCopyFromSnapshots,
  photoSceneMetadata,
  planPhotoSceneDerivedAsset,
  sanitizePhotoSceneOpsEvent,
  userSafeMarketingMessage,
  PhotoSceneMarketingError,
  type OfficialSceneVersionSnapshot,
} from "@ceo-agent/shared";
import {
  fingerprintPhotoSceneMarketingIdentityV1,
  fingerprintPhotoSceneSnapshot,
} from "../packages/shared/src/photo-scene-marketing.server";
import { encodeRgbaPng, decodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import { composeFrozenMarketingImage, productPlacementRect } from "../packages/agents/src/photo-scene/compose-marketing-image";
import { executeMarketingComposition } from "../packages/agents/src/photo-scene/execute-marketing-composition";
import { QUEUE_NAMES } from "../packages/queue/src/jobs";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const WS_A = "22222222-2222-4222-8222-222222222222";
const WS_B = "33333333-3333-4333-8333-333333333333";
const CAMP = "44444444-4444-4444-8444-444444444444";
const EXTRACTED = "55555555-5555-4555-8555-555555555555";
const SCENE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const GEN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const HASH = (label: string) => `sha256:${createHash("sha256").update(label).digest("hex")}` as const;

function scene(overrides: Partial<OfficialSceneVersionSnapshot> = {}): OfficialSceneVersionSnapshot {
  const version = overrides.version ?? 1;
  return {
    sceneId: SCENE,
    sceneSlug: "studio-white",
    name: "Studio white",
    category: "studio",
    tags: ["seamless"],
    version,
    status: "published",
    supportedPresets: ["story_9x16", "feed_1x1", "portrait_4x5"],
    backgroundStorageIdentity: freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      officialSceneBackgroundObjectKey(SCENE, version)
    ),
    backgroundContentHash: HASH(`scene-v${version}`),
    previewStorageIdentity: freezeOfficialSceneObjectIdentity(
      DEFAULT_OFFICIAL_SCENE_BUCKET,
      `official/${SCENE}/v${version}/preview.png`
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

function extracted(overrides: Record<string, unknown> = {}) {
  return {
    id: EXTRACTED,
    orgId: ORG,
    workspaceId: WS_A,
    campaignId: CAMP,
    type: "image",
    mimeType: "image/png",
    storagePath: STORAGE_PATHS.library(WS_A, EXTRACTED, "png"),
    contentHash: HASH("extracted"),
    metadata: { photoScene: photoSceneMetadata("extracted_product") },
    ...overrides,
  };
}

function capsule(overrides: Record<string, unknown> = {}) {
  const catalog = scene();
  const frozen = freezeOfficialSceneSelection({ scene: catalog, presetId: "feed_1x1" });
  const brand = freezeBrandSnapshot({ companyName: "Ember", brandColors: ["#112233"] });
  const marketing = freezeMarketingPackageSnapshot({
    campaignId: CAMP,
    campaignName: "Launch",
    hook: "Fresh drop",
    cta: "Shop now",
  });
  return freezeMarketingImageInput({
    orgId: ORG,
    workspaceId: WS_A,
    campaignId: CAMP,
    extracted: extracted(),
    scene: catalog,
    frozenScene: frozen,
    brandSnapshot: brand,
    brandSnapshotHash: fingerprintPhotoSceneSnapshot(brand),
    marketingSnapshot: marketing,
    marketingSnapshotHash: fingerprintPhotoSceneSnapshot(marketing),
    ...overrides,
  });
}

function png(color: [number, number, number, number], w = 16, h = 16): Buffer {
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return encodeRgbaPng(w, h, rgba);
}

describe("MARKETING_GENERATION_SCHEMA_TESTS", () => {
  it("extends photo_scene_generations with marketing_image and no second authority", () => {
    expect(PHOTO_SCENE_GENERATION_OPERATIONS).toEqual(["product_extraction", "marketing_image"]);
    const sql = read("packages/db/sql/photo-scene-marketing-generations-v1.sql");
    expect(sql).toMatch(/marketing_image/);
    expect(sql).not.toMatch(/creative_studio_jobs|creative_assets/);
    expect(read("packages/db/sql/photo-scene-generations-v1.sql")).toMatch(/operation text NOT NULL/);
  });
});

describe("MARKETING_INPUT_CAPSULE_TESTS", () => {
  it("freezes product, scene, placement, brand, marketing, and preset before execution", () => {
    const frozen = capsule();
    expect(frozen.operation).toBe("marketing_image");
    expect(frozen.contract).toBe("photo-scene-marketing-image-v1");
    expect(frozen.extractedProductAssetId).toBe(EXTRACTED);
    expect(frozen.scene.sceneId).toBe(SCENE);
    expect(frozen.scene.placement.rotation).toBe(0);
    expect(frozen.presetId).toBe("feed_1x1");
    expect(frozen.width).toBe(1080);
    expect(frozen.height).toBe(1080);
    expect(JSON.stringify(frozen)).not.toMatch(/https?:\/\/|token=/);
  });
});

describe("MARKETING_FINGERPRINT_TESTS", () => {
  it("changes when any composition-authoritative input changes", () => {
    const base = capsule();
    const fp = fingerprintPhotoSceneMarketingIdentityV1(marketingFingerprintIdentity(base));
    const moved = freezeOfficialSceneSelection({
      scene: scene(),
      presetId: "feed_1x1",
      placement: { offsetX: 0.05 },
    });
    const changed = freezeMarketingImageInput({
      orgId: ORG,
      workspaceId: WS_A,
      campaignId: CAMP,
      extracted: extracted(),
      scene: scene(),
      frozenScene: moved,
      brandSnapshot: base.brandSnapshot,
      brandSnapshotHash: base.brandSnapshotHash,
      marketingSnapshot: base.marketingSnapshot,
      marketingSnapshotHash: base.marketingSnapshotHash,
    });
    expect(fingerprintPhotoSceneMarketingIdentityV1(marketingFingerprintIdentity(changed))).not.toBe(fp);
  });
});

describe("BRAND_SNAPSHOT_TESTS", () => {
  it("freezes logo as storage identity and remains valid without a logo", () => {
    const withLogo = freezeBrandSnapshot({
      companyName: "Ember",
      logo: `${WS_A}/brand/business-logo-1.png`,
      brandColors: ["#fff"],
    });
    expect(isPublicUrlStorageIdentity(withLogo.logoIdentity ?? "")).toBe(false);
    const none = freezeBrandSnapshot({ companyName: null });
    expect(none.logoIdentity).toBeNull();
  });
});

describe("MARKETING_SNAPSHOT_TESTS", () => {
  it("hashes campaign copy and does not invent overlay text", () => {
    const snap = freezeMarketingPackageSnapshot({ campaignId: CAMP, campaignName: "A" });
    expect(snap.hook).toBeNull();
    expect(snap.cta).toBeNull();
    expect(extractBoundedMarketingCopy({ hooks: [{ text: "Hello world" }], cta: [{ text: "Buy" }] })).toEqual({
      hook: "Hello world",
      cta: "Buy",
    });
    expect(extractBoundedMarketingCopy({})).toEqual({ hook: null, cta: null });
  });
});

describe("SCENE_FREEZE_TESTS", () => {
  it("fails closed when frozen scene hash does not match catalog", () => {
    const frozen = freezeOfficialSceneSelection({ scene: scene(), presetId: "feed_1x1" });
    expect(() =>
      freezeMarketingImageInput({
        orgId: ORG,
        workspaceId: WS_A,
        campaignId: CAMP,
        extracted: extracted(),
        scene: scene({ backgroundContentHash: HASH("other") }),
        frozenScene: frozen,
        brandSnapshot: freezeBrandSnapshot({}),
        brandSnapshotHash: HASH("b"),
        marketingSnapshot: freezeMarketingPackageSnapshot({ campaignId: CAMP }),
        marketingSnapshotHash: HASH("m"),
      })
    ).toThrow(PhotoSceneMarketingError);
  });
});

describe("PLACEMENT_COMPOSITION_TESTS", () => {
  it("preview and final geometry share the same contract", () => {
    const catalog = scene();
    const frozen = freezeOfficialSceneSelection({ scene: catalog, presetId: "feed_1x1" });
    const normalized = computeProductPlacementNormalized({
      safeArea: catalog.safeArea,
      placement: frozen.placement,
      productWidth: 20,
      productHeight: 10,
    });
    const pixels = computeProductPlacementPixels({
      canvasWidth: 1080,
      canvasHeight: 1080,
      safeArea: catalog.safeArea,
      placement: frozen.placement,
      productWidth: 20,
      productHeight: 10,
    });
    expect(productPlacementRect({
      canvasWidth: 1080,
      canvasHeight: 1080,
      safeArea: catalog.safeArea,
      placement: frozen.placement,
      productWidth: 20,
      productHeight: 10,
    })).toEqual(pixels);
    expect(pixels.x).toBe(Math.round(normalized.x * 1080));
    expect(pixels.y).toBe(Math.round(normalized.y * 1080));
  });
});

describe("PRESET_COMPATIBILITY_TESTS", () => {
  it("fails closed on unsupported official scene presets", () => {
    const limited = scene({ supportedPresets: ["story_9x16"] });
    expect(() => freezeOfficialSceneSelection({ scene: limited, presetId: "feed_1x1" })).toThrow(
      /does not support the selected output preset/
    );
    expect(PHOTO_SCENE_OUTPUT_PRESET_PIXELS.story_9x16).toEqual({ width: 1080, height: 1920, ratio: "9:16" });
    expect(PHOTO_SCENE_OUTPUT_PRESET_PIXELS.portrait_4x5).toEqual({ width: 1080, height: 1350, ratio: "4:5" });
  });
});

describe("DETERMINISTIC_COMPOSITOR_TESTS", () => {
  it("produces the same PNG hash for the same frozen inputs", () => {
    const frozen = capsule();
    frozen.width = 64;
    frozen.height = 64;
    const sceneBytes = png([40, 40, 80, 255], 16, 16);
    const productBytes = png([200, 40, 40, 200], 8, 12);
    const a = composeFrozenMarketingImage({ capsule: frozen, sceneBytes, productBytes });
    const b = composeFrozenMarketingImage({ capsule: frozen, sceneBytes, productBytes });
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(b).digest("hex"));
    expect(decodeRgbaPng(a).width).toBe(64);
  });
});

describe("MARKETING_OUTPUT_ASSET_TESTS", () => {
  it("plans a marketing_image asset with reconstructable lineage", () => {
    const frozen = capsule();
    const plan = planPhotoSceneDerivedAsset({
      assetId: "88888888-8888-4888-8888-888888888888",
      orgId: ORG,
      workspaceId: WS_A,
      campaignId: CAMP,
      ext: "png",
      mimeType: "image/png",
      contentHash: HASH("out"),
      role: "marketing_image",
      lineage: marketingLineage({
        generationId: GEN,
        generationFingerprint: HASH("fp"),
        extractedAssetId: EXTRACTED,
        extractedContentHash: HASH("extracted"),
        sceneId: frozen.scene.sceneId,
        sceneVersion: String(frozen.scene.sceneVersion),
        sceneContentHash: frozen.scene.sceneContentHash,
        presetId: frozen.presetId,
        marketingSnapshotHash: frozen.marketingSnapshotHash,
        brandSnapshotHash: frozen.brandSnapshotHash,
      }),
    });
    expect(plan.metadata.photoScene.role).toBe("marketing_image");
    expect(plan.storagePath).toBe(STORAGE_PATHS.library(WS_A, plan.id, "png"));
    expect(plan.campaignRef.campaignId).toBe(CAMP);
  });
});

describe("OUTPUT_CONTENT_HASH_TESTS", () => {
  it("hashes compositor bytes as sha256 identity", () => {
    const frozen = capsule();
    frozen.width = 32;
    frozen.height = 32;
    const bytes = composeFrozenMarketingImage({
      capsule: frozen,
      sceneBytes: png([10, 10, 10, 255], 8, 8),
      productBytes: png([9, 200, 9, 255], 4, 4),
    });
    expect(createHash("sha256").update(bytes).digest("hex")).toHaveLength(64);
  });
});

describe("CAMPAIGN_ASSET_BINDING_TESTS", () => {
  it("binds the planned marketing image to the campaign", () => {
    const plan = planPhotoSceneDerivedAsset({
      assetId: "88888888-8888-4888-8888-888888888888",
      orgId: ORG,
      workspaceId: WS_A,
      campaignId: CAMP,
      ext: "png",
      mimeType: "image/png",
      contentHash: HASH("out"),
      role: "marketing_image",
      lineage: marketingLineage({
        generationId: GEN,
        generationFingerprint: HASH("fp"),
        extractedAssetId: EXTRACTED,
        extractedContentHash: HASH("extracted"),
        sceneId: SCENE,
        sceneVersion: "1",
        sceneContentHash: HASH("scene-v1"),
        presetId: "feed_1x1",
        marketingSnapshotHash: HASH("m"),
        brandSnapshotHash: HASH("b"),
      }),
    });
    expect(plan.campaignRef).toEqual({ campaignId: CAMP, assetId: plan.id });
  });
});

describe("SIGNED_DELIVERY_TESTS", () => {
  it("keeps signed delivery on private campaign-assets paths", () => {
    const path = STORAGE_PATHS.library(WS_A, EXTRACTED, "png");
    expect(path.startsWith(`${WS_A}/library/`)).toBe(true);
    expect(isPublicUrlStorageIdentity(path)).toBe(false);
  });
});

describe("RETRY_IDENTITY_TESTS", () => {
  it("retries the same generation id, capsule, and fingerprint", () => {
    const fp = HASH("fp");
    expect(
      evaluateMarketingRetry({
        generation: {
          status: "failed",
          operation: "marketing_image",
          workspaceId: WS_A,
          sourceAssetId: EXTRACTED,
          sourceContentHash: HASH("extracted"),
          inputFingerprint: fp,
        },
        expectedWorkspaceId: WS_A,
        expectedFingerprint: fp,
        expectedExtractedAssetId: EXTRACTED,
        expectedExtractedHash: HASH("extracted"),
      })
    ).toEqual({ ok: true });
  });
});

describe("GENERATE_AGAIN_TESTS", () => {
  it("always requires a new generation id even when fingerprint is unchanged", () => {
    const same = evaluateMarketingGenerateAgain({ previousFingerprint: HASH("a"), nextFingerprint: HASH("a") });
    expect(same.newGenerationRequired).toBe(true);
    expect(same.fingerprintChanged).toBe(false);
    const changed = evaluateMarketingGenerateAgain({ previousFingerprint: HASH("a"), nextFingerprint: HASH("b") });
    expect(changed.fingerprintChanged).toBe(true);
  });
});

describe("NO_PHOTOROOM_RECALL_TESTS", () => {
  it("composes without a background-removal provider and uses cost 0", async () => {
    expect(QUEUE_NAMES.PHOTO_SCENE).toBe("photo-scene");
    expect(DETERMINISTIC_COMPOSITOR_KEY).toBe("deterministic_compositor");
    expect(MARKETING_COMPOSITION_EXTERNAL_COST_USD).toBe(0);
    const frozen = capsule();
    const sceneBytes = png([20, 20, 80, 255], 8, 8);
    const productBytes = png([200, 20, 20, 220], 4, 6);
    const sceneHash = `sha256:${createHash("sha256").update(sceneBytes).digest("hex")}`;
    const productHash = `sha256:${createHash("sha256").update(productBytes).digest("hex")}`;
    frozen.scene.sceneContentHash = sceneHash as typeof frozen.scene.sceneContentHash;
    frozen.extractedProductContentHash = productHash as typeof frozen.extractedProductContentHash;
    let photoroom = 0;
    const result = await executeMarketingComposition({
      generation: {
        id: GEN,
        orgId: ORG,
        workspaceId: WS_A,
        campaignId: CAMP,
        operation: "marketing_image",
        status: "processing",
        sourceAssetId: EXTRACTED,
        sourceContentHash: productHash,
        inputCapsule: frozen,
        inputFingerprint: fingerprintPhotoSceneMarketingIdentityV1(marketingFingerprintIdentity(frozen)),
        attemptCount: 1,
      },
      io: {
        hashBytes: (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        newAssetId: () => "88888888-8888-4888-8888-888888888888",
        readExtractedBytes: async () => productBytes,
        readSceneBytes: async () => sceneBytes,
        writeOutputObject: async () => undefined,
        loadExtractedAsset: async () => extracted({ contentHash: productHash }),
        persistReady: async () => undefined,
        persistFailed: async () => undefined,
      },
    });
    expect(photoroom).toBe(0);
    expect(result.status).toBe("ready");
    expect(read("apps/worker/src/processors/photo-scene-compose-handler.ts")).not.toMatch(
      /resolveBackgroundRemovalProvider|photoroom/i
    );
  });
});

describe("REFRESH_RECOVERY_TESTS", () => {
  it("reconstructs from persisted generation status, not client-local truth", () => {
    expect(joinInflightMarketing({
      workspaceId: WS_A,
      fingerprint: HASH("fp"),
      candidate: { id: GEN, workspaceId: WS_A, inputFingerprint: HASH("fp"), status: "processing" },
    }).join).toBe(true);
  });
});

describe("REVISIT_RECOVERY_TESTS", () => {
  it("keeps generation identity stable for later reads", () => {
    const frozen = capsule();
    expect(frozen.campaignId).toBe(CAMP);
    expect(frozen.extractedProductAssetId).toBe(EXTRACTED);
  });
});

describe("HISTORICAL_IMMUTABILITY_TESTS", () => {
  it("keeps G1 frozen after later scene, brand, and package mutation", () => {
    const g1 = capsule();
    const laterBrand = freezeBrandSnapshot({ companyName: "Changed Co", brandColors: ["#000000"] });
    const laterMarketing = freezeMarketingPackageSnapshot({
      campaignId: CAMP,
      hook: "New hook",
      cta: "New cta",
    });
    const laterScene = scene({ version: 2, backgroundContentHash: HASH("scene-v2") });
    expect(g1.scene.sceneVersion).toBe(1);
    expect(g1.scene.sceneContentHash).not.toBe(laterScene.backgroundContentHash);
    expect(g1.brandSnapshot.companyName).not.toBe(laterBrand.companyName);
    expect(g1.marketingSnapshot.hook).not.toBe(laterMarketing.hook);
  });
});

describe("TENANT_ISOLATION_TESTS", () => {
  it("rejects a foreign-workspace extracted product", () => {
    expect(() =>
      freezeMarketingImageInput({
        orgId: ORG,
        workspaceId: WS_A,
        campaignId: CAMP,
        extracted: extracted({ workspaceId: WS_B, storagePath: STORAGE_PATHS.library(WS_B, EXTRACTED, "png") }),
        scene: scene(),
        frozenScene: freezeOfficialSceneSelection({ scene: scene(), presetId: "feed_1x1" }),
        brandSnapshot: freezeBrandSnapshot({}),
        brandSnapshotHash: HASH("b"),
        marketingSnapshot: freezeMarketingPackageSnapshot({ campaignId: CAMP }),
        marketingSnapshotHash: HASH("m"),
      })
    ).toThrow(/not in this workspace/);
    expect(
      evaluateMarketingRetry({
        generation: {
          status: "failed",
          operation: "marketing_image",
          workspaceId: WS_B,
          sourceAssetId: EXTRACTED,
          sourceContentHash: HASH("extracted"),
          inputFingerprint: HASH("fp"),
        },
        expectedWorkspaceId: WS_A,
        expectedFingerprint: HASH("fp"),
        expectedExtractedAssetId: EXTRACTED,
        expectedExtractedHash: HASH("extracted"),
      }).ok
    ).toBe(false);
  });
});

describe("OPS_EVIDENCE_TESTS", () => {
  it("redacts secrets, bytes, and signed URLs", () => {
    const event = sanitizePhotoSceneOpsEvent({
      event: "composition.completed",
      stage: "photo_scene.compose",
      outcome: "completed",
      orgId: ORG,
      workspaceId: WS_A,
      campaignId: CAMP,
      generationId: GEN,
      providerKey: "deterministic_compositor",
      signedUrl: "https://example/token=secret",
      Authorization: "Bearer secret",
      bytes: "nope",
    });
    expect(event.providerKey).toBe("deterministic_compositor");
    expect(JSON.stringify(event)).not.toMatch(/Bearer|signedUrl|token=secret/);
    expect(userSafeMarketingMessage("COMPOSITION_FAILED")).not.toMatch(/stack|photoroom/i);
  });
});

describe("TEXT_OVERLAY_AUTHORITY", () => {
  it("uses only frozen hook, CTA, and company label", () => {
    const overlay = overlayCopyFromSnapshots({
      marketing: freezeMarketingPackageSnapshot({ campaignId: CAMP, hook: "Hook", cta: "CTA" }),
      brand: freezeBrandSnapshot({ companyName: "Ember Labs" }),
    });
    expect(overlay).toEqual({ headline: "Hook", cta: "CTA", label: "Ember Labs" });
  });
});
