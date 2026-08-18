import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractionFingerprintIdentity,
  freezePhotoSceneExtractionInput,
  photoSceneMetadata,
  STORAGE_PATHS,
  USER_SAFE_EXTRACTION_FAILURE_MESSAGE,
  userSafeExtractionMessage,
} from "@ceo-agent/shared";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "../packages/shared/src/photo-scene-extraction.server";
import {
  productionCanAccidentallyUseTestAdapter,
  resolveBackgroundRemovalProvider,
} from "../packages/agents/src/photo-scene/background-removal";
import { encodeRgbaPng, validateExtractedPng } from "../packages/agents/src/photo-scene/png";
import { executeProductExtraction } from "../packages/agents/src/photo-scene/execute-product-extraction";
import {
  PhotoroomBackgroundRemovalProvider,
  type PhotoroomFetch,
} from "../packages/agents/src/photo-scene/providers/photoroom";
import {
  PHOTOROOM_DEFAULT_COST_USD,
  PHOTO_SCENE_PROVIDER_TIMEOUT_MS_DEFAULT,
  mapPhotoroomHttpStatus,
  photoroomConfiguredCostUsd,
} from "../packages/agents/src/photo-scene/providers/photoroom-config";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const WS_A = "22222222-2222-4222-8222-222222222222";
const CAMP_A = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "66666666-6666-4666-8666-666666666666";
const ASSET_OUT = "88888888-8888-4888-8888-888888888888";
const GEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function productPng(kind: string): Buffer {
  const width = 32;
  const height = 32;
  const rgba = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inSubject =
        kind === "stem" ? x === 16 && y > 6 : x > 8 && x < 24 && y > 6 && y < 26;
      rgba[i] = kind === "dark" ? 240 : 40;
      rgba[i + 1] = kind === "flower" ? 160 : 90;
      rgba[i + 2] = kind === "glass" ? 200 : 40;
      rgba[i + 3] = inSubject ? 255 : 0;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}

const CERT_FIXTURES = [
  "simple-solid",
  "white-bg",
  "dark-bg",
  "flower-stem",
  "glass",
  "irregular-edge",
  "low-contrast",
  "phone-photo",
] as const;

function pngResponse(bytes: Buffer, status = 200): Awaited<ReturnType<PhotoroomFetch>> {
  return {
    status,
    headers: { get: () => "image/png" },
    arrayBuffer: async () => {
      const copy = Uint8Array.from(bytes);
      return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
    },
  };
}

describe("Photo Scene provider adapter", () => {
  it("maps Photoroom multipart request and preserves PNG alpha plus configured cost", async () => {
    const cutout = productPng("simple-solid");
    let captured: { url?: string; apiKey?: string; body?: Buffer } = {};
    const fetchImpl: PhotoroomFetch = async (url, init) => {
      captured = {
        url,
        apiKey: init.headers["x-api-key"],
        body: init.body,
      };
      expect(JSON.stringify(init.headers)).not.toMatch(/secret/i);
      expect(init.headers["x-api-key"]).toBe("test-photoroom-key");
      return pngResponse(cutout);
    };
    const provider = new PhotoroomBackgroundRemovalProvider({
      apiKey: "test-photoroom-key",
      costUsd: 0.02,
      fetchImpl,
    });
    const source = Buffer.from("jpeg-bytes");
    const result = await provider.removeBackground({
      bytes: source,
      mimeType: "image/jpeg",
      sourceAssetId: ASSET_A,
      workspaceId: WS_A,
    });
    expect(captured.url).toBe("https://sdk.photoroom.com/v1/segment");
    expect(captured.apiKey).toBe("test-photoroom-key");
    expect(captured.body?.includes(source)).toBe(true);
    expect(captured.body?.toString("utf8")).toMatch(/name="format"/);
    expect(captured.body?.toString("utf8")).toMatch(/rgba/);
    expect(validateExtractedPng(result.bytes).hasAlpha).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.costUsd).toBe(PHOTOROOM_DEFAULT_COST_USD);
    expect(result.providerKey).toBe("photoroom");
  });

  it("maps provider HTTP and timeout errors without raw vendor bodies", async () => {
    expect(mapPhotoroomHttpStatus(400)).toBe("PROVIDER_REJECTED");
    expect(mapPhotoroomHttpStatus(401)).toBe("PROVIDER_REJECTED");
    expect(mapPhotoroomHttpStatus(402)).toBe("PROVIDER_UNAVAILABLE");
    expect(mapPhotoroomHttpStatus(429)).toBe("PROVIDER_UNAVAILABLE");
    expect(mapPhotoroomHttpStatus(500)).toBe("PROVIDER_UNAVAILABLE");
    const rejected = new PhotoroomBackgroundRemovalProvider({
      apiKey: "k",
      fetchImpl: async () => ({
        status: 400,
        headers: { get: () => "application/json" },
        arrayBuffer: async () => Buffer.from(JSON.stringify({ detail: "vendor-secret-trace" })),
      }),
    });
    await expect(
      rejected.removeBackground({
        bytes: Buffer.from("x"),
        mimeType: "image/png",
        sourceAssetId: ASSET_A,
        workspaceId: WS_A,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_REJECTED", message: expect.not.stringMatching(/vendor-secret/) });

    const timedOut = new PhotoroomBackgroundRemovalProvider({
      apiKey: "k",
      timeoutMs: 20,
      fetchImpl: async (_url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    });
    await expect(
      timedOut.removeBackground({
        bytes: Buffer.from("x"),
        mimeType: "image/png",
        sourceAssetId: ASSET_A,
        workspaceId: WS_A,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", message: /timed out/ });
    expect(PHOTO_SCENE_PROVIDER_TIMEOUT_MS_DEFAULT).toBe(30_000);
    expect(userSafeExtractionMessage("PROVIDER_REJECTED")).toBe(USER_SAFE_EXTRACTION_FAILURE_MESSAGE);

    const jpegMasquerade = new PhotoroomBackgroundRemovalProvider({
      apiKey: "k",
      fetchImpl: async () => ({
        status: 200,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
      }),
    });
    await expect(
      jpegMasquerade.removeBackground({
        bytes: Buffer.from("x"),
        mimeType: "image/png",
        sourceAssetId: ASSET_A,
        workspaceId: WS_A,
      })
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_OUTPUT" });
  });
});

describe("Photo Scene provider identity", () => {
  it("does not include provider in the extraction fingerprint", () => {
    const frozen = freezePhotoSceneExtractionInput({
      orgId: ORG_A,
      workspaceId: WS_A,
      campaignId: CAMP_A,
      source: {
        id: ASSET_A,
        orgId: ORG_A,
        workspaceId: WS_A,
        type: "image",
        mimeType: "image/png",
        storagePath: STORAGE_PATHS.library(WS_A, ASSET_A, "png"),
        contentHash: `sha256:${"a".repeat(64)}`,
        metadata: { photoScene: photoSceneMetadata("product_source") },
      },
    });
    const identity = extractionFingerprintIdentity(frozen);
    expect(identity).not.toHaveProperty("provider");
    expect(identity).not.toHaveProperty("providerKey");
    expect(JSON.stringify(identity)).not.toMatch(/photoroom|remove\.bg|fal/i);
    const a = fingerprintPhotoSceneExtractionIdentityV1(identity);
    const b = fingerprintPhotoSceneExtractionIdentityV1(identity);
    expect(a).toBe(b);
  });
});

describe("Photo Scene provider reuse and isolation", () => {
  it("does not call the provider again for an already READY generation", async () => {
    let calls = 0;
    const provider = new PhotoroomBackgroundRemovalProvider({
      apiKey: "k",
      fetchImpl: async () => {
        calls += 1;
        return pngResponse(productPng("simple-solid"));
      },
    });
    const result = await executeProductExtraction({
      generation: {
        id: GEN_A,
        orgId: ORG_A,
        workspaceId: WS_A,
        campaignId: CAMP_A,
        operation: "product_extraction",
        status: "ready",
        sourceAssetId: ASSET_A,
        sourceContentHash: `sha256:${"a".repeat(64)}`,
        inputCapsule: freezePhotoSceneExtractionInput({
          orgId: ORG_A,
          workspaceId: WS_A,
          campaignId: CAMP_A,
          source: {
            id: ASSET_A,
            orgId: ORG_A,
            workspaceId: WS_A,
            type: "image",
            mimeType: "image/png",
            storagePath: STORAGE_PATHS.library(WS_A, ASSET_A, "png"),
            contentHash: `sha256:${"a".repeat(64)}`,
            metadata: { photoScene: photoSceneMetadata("product_source") },
          },
        }),
        inputFingerprint: `sha256:${"c".repeat(64)}`,
        outputAssetId: ASSET_OUT,
        attemptCount: 1,
      },
      io: {
        provider,
        hashBytes: (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        readSourceBytes: async () => Buffer.from("unused"),
        writeOutputObject: async () => undefined,
        loadSourceAsset: async () => null,
        persistReady: async () => undefined,
        persistFailed: async () => undefined,
      },
    });
    expect(result.status).toBe("ready");
    expect(calls).toBe(0);
  });
});

describe("Photo Scene provider failure and test-adapter isolation", () => {
  it("fails closed when Photoroom is selected without a key", () => {
    expect(
      resolveBackgroundRemovalProvider({
        NODE_ENV: "production",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "photoroom",
      }).key
    ).toBe("none");
    expect(
      resolveBackgroundRemovalProvider({
        NODE_ENV: "production",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "photoroom",
        PHOTOROOM_API_KEY: "live-key",
      }).key
    ).toBe("photoroom");
    expect(
      productionCanAccidentallyUseTestAdapter({
        NODE_ENV: "production",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "photoroom",
        PHOTOROOM_API_KEY: "live-key",
        PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "true",
      })
    ).toBe(false);
    expect(photoroomConfiguredCostUsd({})).toBe(0.02);
  });

  it("lets the deterministic adapter fail on demand without calling Photoroom", async () => {
    process.env.PHOTO_SCENE_DETERMINISTIC_FAIL = "true";
    try {
      const provider = resolveBackgroundRemovalProvider({
        NODE_ENV: "test",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "deterministic",
        PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "true",
      });
      expect(provider.key).toBe("deterministic");
      await expect(
        provider.removeBackground({
          bytes: Buffer.from("x"),
          mimeType: "image/png",
          sourceAssetId: ASSET_A,
          workspaceId: WS_A,
        })
      ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    } finally {
      delete process.env.PHOTO_SCENE_DETERMINISTIC_FAIL;
    }
  });

  it("certification fixtures cover the required product categories as PNG with alpha", () => {
    expect(CERT_FIXTURES).toHaveLength(8);
    for (const kind of CERT_FIXTURES) {
      expect(validateExtractedPng(productPng(kind)).hasAlpha).toBe(true);
    }
  });
});
