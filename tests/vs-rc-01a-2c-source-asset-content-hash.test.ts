import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SourceAssetContentHashSchema,
  isCanonicalSourceContentHash,
} from "@ceo-agent/shared";
import { hashSourceAssetFile } from "../apps/worker/src/source-asset-content-hash";
import { canSafelyFinalizeLegacySourceAsset } from "../apps/web/src/lib/source-asset-content-hash";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    orgId: "22222222-2222-4222-8222-222222222222",
    workspaceId: "33333333-3333-4333-8333-333333333333",
    campaignId: null,
    type: "image",
    displayName: "source.png",
    originalFilename: "source.png",
    storagePath: "workspace/library/source.png",
    contentHash: null,
    mimeType: "image/png",
    durationSec: null,
    width: null,
    height: null,
    fileSizeBytes: 3,
    status: "ready",
    source: "campaign_upload",
    uploadedBy: null,
    metadata: {},
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  } as Parameters<typeof canSafelyFinalizeLegacySourceAsset>[0];
}

describe("VS-RC-01A.2C Source Asset content identity", () => {
  it("accepts only canonical lowercase SHA-256 values and permits legacy NULL", () => {
    const hash = `sha256:${"a".repeat(64)}`;
    expect(SourceAssetContentHashSchema.parse(hash)).toBe(hash);
    expect(isCanonicalSourceContentHash(hash)).toBe(true);
    expect(isCanonicalSourceContentHash(null)).toBe(false);
    expect(SourceAssetContentHashSchema.safeParse(`sha256:${"A".repeat(64)}`).success).toBe(false);
    expect(SourceAssetContentHashSchema.safeParse("source.png").success).toBe(false);
  });

  it("streams actual bytes into the canonical digest", async () => {
    const directory = await mkdtemp(join(tmpdir(), "source-asset-hash-"));
    try {
      const first = join(directory, "first.bin");
      const second = join(directory, "second.bin");
      await writeFile(first, "abc");
      await writeFile(second, "abd");
      expect(await hashSourceAssetFile(first)).toBe(
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
      );
      expect(await hashSourceAssetFile(second)).not.toBe(await hashSourceAssetFile(first));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails legacy Campaign videos closed until terminal probe evidence exists", () => {
    expect(
      canSafelyFinalizeLegacySourceAsset(
        asset({ type: "video", mimeType: "video/mp4", durationSec: null })
      )
    ).toBe(false);
    expect(
      canSafelyFinalizeLegacySourceAsset(
        asset({ type: "video", mimeType: "video/mp4", durationSec: "30", metadata: {} })
      )
    ).toBe(false);
    expect(
      canSafelyFinalizeLegacySourceAsset(
        asset({
          type: "video",
          mimeType: "video/mp4",
          durationSec: "30",
          metadata: { codec: "h264" },
        })
      )
    ).toBe(true);
  });

  it("allows current library finalization but rejects deleted or rejected Assets", () => {
    expect(canSafelyFinalizeLegacySourceAsset(asset({ source: "library_upload" }))).toBe(true);
    expect(canSafelyFinalizeLegacySourceAsset(asset({ deletedAt: new Date() }))).toBe(false);
    expect(canSafelyFinalizeLegacySourceAsset(asset({ metadata: { rejected: true } }))).toBe(false);
  });

  it("keeps authoritative hashing server-side and prevents client declaration", () => {
    const shared = source("packages/shared/src/source-asset-content-hash.ts");
    const upload = source("apps/web/src/app/api/campaigns/[id]/assets/upload-url/route.ts");
    const confirm = source("apps/web/src/app/api/campaigns/[id]/assets/[assetId]/confirm/route.ts");
    expect(shared).not.toMatch(/node:crypto|from ["']crypto["']|node:fs/);
    expect(upload).not.toContain("contentHash");
    expect(confirm).not.toMatch(/body[^\n]*contentHash|contentHash[^\n]*body/);
  });

  it("invalidates before same-path compression and hashes the retained output", () => {
    const worker = source("apps/worker/src/processors/index.ts");
    const invalidate = worker.indexOf("contentHash: null");
    const compress = worker.indexOf("compressSourceVideo(localPath");
    const hash = worker.indexOf("hashSourceAssetFile(compressedPath)");
    const overwrite = worker.indexOf("uploadStorageFile(storagePath, compressedPath");
    const persist = worker.indexOf("contentHash: finalContentHash");
    expect(invalidate).toBeGreaterThan(-1);
    expect(invalidate).toBeLessThan(compress);
    expect(compress).toBeLessThan(hash);
    expect(hash).toBeLessThan(overwrite);
    expect(overwrite).toBeLessThan(persist);
  });

  it("does not introduce immutable paths or cross-module execution dependencies", () => {
    const files = [
      "packages/shared/src/source-asset-content-hash.ts",
      "apps/worker/src/source-asset-content-hash.ts",
      "apps/web/src/lib/source-asset-content-hash.ts",
    ].map(source).join("\n");
    expect(files).not.toMatch(/ai-story|creative-studio|content-addressed|immutable object/i);
    expect(files).not.toMatch(/VideoStudioProject|VideoStudioStatus/);
  });
});
