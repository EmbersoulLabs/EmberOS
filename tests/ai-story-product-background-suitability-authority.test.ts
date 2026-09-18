import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PRODUCT_TRANSPARENCY_INSPECTION_POLICY,
  deriveProductBackgroundSuitabilityAuthority,
  inspectProductImageBytes,
  ProductBackgroundSuitabilityAuthorityError,
  verifyProductBackgroundSuitabilityAuthority,
} from "@ceo-agent/shared/server";
import { encodeRgbaPng } from "../packages/agents/src/photo-scene/png";
import { deriveStoryProductBackgroundSuitability } from "../apps/web/src/lib/ai-story-product-background-suitability";

const id = (n: number) =>
  `97000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hashBytes = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function rgbaPng(alphaAt: (x: number, y: number) => number, size = 10): Buffer {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      rgba[offset] = 180;
      rgba[offset + 1] = 80;
      rgba[offset + 2] = 30;
      rgba[offset + 3] = alphaAt(x, y);
    }
  }
  return encodeRgbaPng(size, size, rgba);
}

function source(bytes: Buffer, sourceAssetId = id(10), mimeType = "image/png") {
  return {
    orgId: id(1),
    workspaceId: id(2),
    campaignId: id(3),
    productAuthorityId: sourceAssetId,
    sourceAssetId,
    sourceAssetContentHash: hashBytes(bytes),
    mimeType,
  };
}

function authority(bytes: Buffer, sourceAssetId = id(10), mimeType = "image/png") {
  return deriveProductBackgroundSuitabilityAuthority({
    source: source(bytes, sourceAssetId, mimeType),
    bytes,
  });
}

function jpeg(width = 3, height = 2): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

describe("AI Story Product background suitability authority", () => {
  it("binds the exact canonical Product source and verifies its actual byte hash", () => {
    const bytes = rgbaPng(() => 255);
    const result = authority(bytes);
    expect(result).toMatchObject({
      productAuthorityId: id(10),
      sourceAssetId: id(10),
      sourceAssetContentHash: hashBytes(bytes),
      inspection: { byteHashVerified: true },
    });
  });

  it("fails closed when stored bytes differ from canonical source content identity", () => {
    const canonical = rgbaPng(() => 255);
    const mutated = Buffer.from(canonical);
    mutated[mutated.length - 1] ^= 1;
    expect(() =>
      deriveProductBackgroundSuitabilityAuthority({ source: source(canonical), bytes: mutated })
    ).toThrowError(ProductBackgroundSuitabilityAuthorityError);
  });

  it("gives distinct fingerprints to different exact Asset IDs with identical bytes", () => {
    const bytes = rgbaPng(() => 255);
    const first = authority(bytes, id(10));
    const second = authority(bytes, id(11));
    expect(first.sourceAssetContentHash).toBe(second.sourceAssetContentHash);
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("certifies meaningful image-wide and perimeter transparency", () => {
    const result = authority(
      rgbaPng((x, y) => (x === 0 || y === 0 || x === 9 || y === 9 ? 0 : 255))
    );
    expect(result.outcome).toBe("TRANSPARENT_BACKGROUND_CERTIFIED");
    expect(result.inspection.transparencyState).toBe(
      "CERTIFIED_TRANSPARENT_BACKGROUND"
    );
    expect(result.inspection.transparentPixelRatio).toBe(0.36);
    expect(result.inspection.boundaryTransparentPixelRatio).toBe(1);
  });

  it("does not mistake an opaque alpha channel for transparent background", () => {
    const result = authority(rgbaPng(() => 255));
    expect(result.outcome).toBe("OPAQUE_NOT_ISOLATED");
    expect(result.inspection.transparencyState).toBe("FULLY_OPAQUE");
  });

  it("does not certify a single transparent pixel", () => {
    const result = authority(rgbaPng((x, y) => (x === 0 && y === 0 ? 0 : 255)));
    expect(result.outcome).toBe("OPAQUE_NOT_ISOLATED");
    expect(result.inspection.transparencyState).toBe("INSUFFICIENT_TRANSPARENCY");
    const onePixel = authority(rgbaPng(() => 0, 1));
    expect(onePixel.outcome).toBe("OPAQUE_NOT_ISOLATED");
  });

  it("classifies a valid JPEG only as opaque, never simple or complex", () => {
    const bytes = jpeg();
    const result = authority(bytes, id(10), "image/jpeg");
    expect(result.outcome).toBe("OPAQUE_NOT_ISOLATED");
    expect(JSON.stringify(result)).not.toMatch(/simple|complex/i);
  });

  it("fails unsupported and malformed media closed with bounded outcomes", () => {
    const webp = Buffer.from("RIFF0000WEBP", "ascii");
    expect(authority(webp, id(10), "image/webp").outcome).toBe(
      "INSPECTION_UNSUPPORTED"
    );
    const malformed = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(25),
    ]);
    expect(authority(malformed).outcome).toBe("INSPECTION_FAILED");
  });

  it("enforces source byte resource bounds without decoding", () => {
    const oversized = Buffer.alloc(
      PRODUCT_TRANSPARENCY_INSPECTION_POLICY.maximumSourceBytes + 1
    );
    expect(inspectProductImageBytes(oversized, "image/png")).toMatchObject({
      status: "UNSUPPORTED",
      transparencyState: "UNINSPECTABLE",
      reason: "SOURCE_BYTE_BOUND_EXCEEDED",
    });
  });

  it("is deterministic and excludes filename and metadata heuristics", () => {
    const bytes = rgbaPng(() => 255);
    const canonical = source(bytes);
    const first = deriveProductBackgroundSuitabilityAuthority({
      source: { ...canonical, originalFilename: "transparent-product.png" } as typeof canonical,
      bytes,
    });
    const second = deriveProductBackgroundSuitabilityAuthority({
      source: { ...canonical, metadata: { photoScene: { role: "extracted_product" } } } as typeof canonical,
      bytes,
    });
    expect(first).toEqual(second);
    expect(verifyProductBackgroundSuitabilityAuthority(first)).toBe(true);
    expect(
      verifyProductBackgroundSuitabilityAuthority({
        ...first,
        sourceAssetId: id(11),
      })
    ).toBe(false);
  });

  it("uses the certified Story Product resolver and read-only private bytes", async () => {
    const bytes = rgbaPng(() => 255);
    const storagePath = `${id(2)}/source.png`;
    const limit = vi.fn().mockResolvedValue([
      {
        id: id(10),
        orgId: id(1),
        workspaceId: id(2),
        status: "ready",
        deletedAt: null,
        contentHash: hashBytes(bytes),
        mimeType: "image/png",
        storagePath,
        fileSizeBytes: bytes.length,
      },
    ]);
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit })),
        })),
      })),
    };
    const resolveSources = vi.fn().mockResolvedValue([
      {
        storyId: id(4),
        assetId: id(10),
        usageType: "product_source",
        orgId: id(1),
        workspaceId: id(2),
        campaignId: id(3),
        contentHash: hashBytes(bytes),
        status: "ready",
      },
    ]);
    const readStoredBytes = vi.fn().mockResolvedValue(bytes);
    const result = await deriveStoryProductBackgroundSuitability(
      db as never,
      {
        storyId: id(4),
        orgId: id(1),
        workspaceId: id(2),
        campaignId: id(3),
        productAuthorityId: id(10),
      },
      { resolveSources, readStoredBytes }
    );
    expect(resolveSources).toHaveBeenCalledOnce();
    expect(readStoredBytes).toHaveBeenCalledWith(storagePath);
    expect(result.sourceAssetId).toBe(id(10));
  });

  it("contains no preparation, Provider, Scene-frame, or mutable Asset identity path", () => {
    const sourceText = readFileSync(
      "apps/web/src/lib/ai-story-product-background-suitability.ts",
      "utf8"
    );
    expect(sourceText).toContain("resolveStoryProductSources");
    expect(sourceText).not.toMatch(
      /requestProductExtraction|finalizeStoredSourceAssetIdentity|PreparedSceneFrame|ProviderReadySceneInput|images\.edit|Seedance/i
    );
  });
});
