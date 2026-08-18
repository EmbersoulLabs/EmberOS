import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PHOTO_SCENE_GENERATION_STATUSES,
  USER_SAFE_EXTRACTION_FAILURE_MESSAGE,
  assertPhotoSceneGenerationAccess,
  assertPhotoSceneProductSource,
  clientPollCannotDeclareFailure,
  evaluateExtractionRetry,
  evaluateExtractionReuse,
  evaluateGenerateAgain,
  extractionFingerprintIdentity,
  freezePhotoSceneExtractionInput,
  joinInflightExtraction,
  photoSceneMetadata,
  planPhotoSceneDerivedAsset,
  sanitizePhotoSceneOpsEvent,
  sourceMutationChanged,
  userSafeExtractionMessage,
  PhotoSceneExtractionError,
  STORAGE_PATHS,
} from "@ceo-agent/shared";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "../packages/shared/src/photo-scene-extraction.server";
import {
  DeterministicBackgroundRemovalProvider,
  UnavailableBackgroundRemovalProvider,
  productionCanAccidentallyUseTestAdapter,
  resolveBackgroundRemovalProvider,
  type BackgroundRemovalProvider,
} from "../packages/agents/src/photo-scene/background-removal";
import { executeProductExtraction } from "../packages/agents/src/photo-scene/execute-product-extraction";
import { encodeRgbaPng, validateExtractedPng } from "../packages/agents/src/photo-scene/png";
import { QUEUE_NAMES } from "../packages/queue/src/jobs";
import { hashSourceAssetBytes } from "../apps/worker/src/source-asset-content-hash";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const WS_A = "22222222-2222-4222-8222-222222222222";
const WS_B = "33333333-3333-4333-8333-333333333333";
const CAMP_A = "44444444-4444-4444-8444-444444444444";
const ASSET_A = "66666666-6666-4666-8666-666666666666";
const ASSET_OUT = "88888888-8888-4888-8888-888888888888";
const GEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;

function productAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET_A,
    orgId: ORG_A,
    workspaceId: WS_A,
    campaignId: CAMP_A,
    type: "image" as const,
    mimeType: "image/png",
    storagePath: STORAGE_PATHS.library(WS_A, ASSET_A, "png"),
    contentHash: HASH_A,
    metadata: { photoScene: photoSceneMetadata("product_source") },
    ...overrides,
  };
}

function capsule() {
  return freezePhotoSceneExtractionInput({
    orgId: ORG_A,
    workspaceId: WS_A,
    campaignId: CAMP_A,
    source: productAsset(),
  });
}

function fingerprintFor(hash = HASH_A, workspaceId = WS_A) {
  const frozen = freezePhotoSceneExtractionInput({
    orgId: ORG_A,
    workspaceId,
    campaignId: CAMP_A,
    source: productAsset({ workspaceId, storagePath: STORAGE_PATHS.library(workspaceId, ASSET_A, "png"), contentHash: hash }),
  });
  return fingerprintPhotoSceneExtractionIdentityV1(extractionFingerprintIdentity(frozen));
}

function generation(overrides: Record<string, unknown> = {}) {
  const inputCapsule = capsule();
  return {
    id: GEN_A,
    orgId: ORG_A,
    workspaceId: WS_A,
    campaignId: CAMP_A,
    operation: "product_extraction",
    status: "processing",
    sourceAssetId: ASSET_A,
    sourceContentHash: HASH_A,
    inputCapsule,
    inputFingerprint: fingerprintPhotoSceneExtractionIdentityV1(extractionFingerprintIdentity(inputCapsule)),
    outputAssetId: null,
    attemptCount: 1,
    ...overrides,
  };
}

function hashBytes(bytes: Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("Photo Scene 10B identity", () => {
  it("freezes source asset id, hash, storage path, and fingerprint without a public URL", () => {
    const frozen = capsule();
    expect(frozen.sourceAssetId).toBe(ASSET_A);
    expect(frozen.sourceContentHash).toBe(HASH_A);
    expect(frozen.storagePath).toBe(STORAGE_PATHS.library(WS_A, ASSET_A, "png"));
    expect(frozen.storagePath).not.toMatch(/^https?:\/\//);
    const fp = fingerprintPhotoSceneExtractionIdentityV1(extractionFingerprintIdentity(frozen));
    expect(fp).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(extractionFingerprintIdentity(frozen)).not.toHaveProperty("providerKey");
  });

  it("keeps retry on the same generation identity and frozen input", () => {
    const gen = generation({ status: "failed", attemptCount: 1 });
    const decision = evaluateExtractionRetry({
      generation: gen,
      expectedWorkspaceId: WS_A,
      expectedFingerprint: gen.inputFingerprint,
      expectedSourceAssetId: ASSET_A,
      expectedSourceContentHash: HASH_A,
    });
    expect(decision).toEqual({ ok: true });
    expect(evaluateGenerateAgain({ previousFingerprint: gen.inputFingerprint, nextFingerprint: gen.inputFingerprint })).toEqual({
      newGenerationRequired: false,
    });
  });
});

describe("Photo Scene 10B reuse", () => {
  it("reuses a ready extraction with valid extracted_product output", () => {
    const fp = fingerprintFor();
    const output = planPhotoSceneDerivedAsset({
      assetId: ASSET_OUT,
      orgId: ORG_A,
      workspaceId: WS_A,
      campaignId: CAMP_A,
      ext: "png",
      mimeType: "image/png",
      contentHash: HASH_B,
      role: "extracted_product",
      lineage: {
        sourceAssetId: ASSET_A,
        sourceContentHash: HASH_A,
        operation: "product_extraction",
        generationId: GEN_A,
      },
    });
    expect(
      evaluateExtractionReuse({
        workspaceId: WS_A,
        fingerprint: fp,
        sourceContentHash: HASH_A,
        candidate: {
          generation: generation({
            status: "ready",
            inputFingerprint: fp,
            outputAssetId: ASSET_OUT,
          }),
          outputAsset: output,
        },
      })
    ).toEqual({ reuse: true, generationId: GEN_A });
  });

  it("denies reuse for different hash, failed generation, missing output, and foreign workspace", () => {
    const fp = fingerprintFor();
    const ready = generation({ status: "ready", inputFingerprint: fp, outputAssetId: ASSET_OUT });
    expect(
      evaluateExtractionReuse({
        workspaceId: WS_A,
        fingerprint: fingerprintFor(HASH_B),
        sourceContentHash: HASH_B,
        candidate: { generation: ready, outputAsset: productAsset({ id: ASSET_OUT, contentHash: HASH_B }) },
      }).reuse
    ).toBe(false);
    expect(
      evaluateExtractionReuse({
        workspaceId: WS_A,
        fingerprint: fp,
        sourceContentHash: HASH_A,
        candidate: { generation: generation({ status: "failed", inputFingerprint: fp }), outputAsset: productAsset({ id: ASSET_OUT }) },
      })
    ).toEqual({ reuse: false, reason: "FAILED" });
    expect(
      evaluateExtractionReuse({
        workspaceId: WS_A,
        fingerprint: fp,
        sourceContentHash: HASH_A,
        candidate: { generation: generation({ status: "ready", inputFingerprint: fp, outputAssetId: ASSET_OUT }), outputAsset: null },
      })
    ).toEqual({ reuse: false, reason: "MISSING_OUTPUT" });
    expect(
      evaluateExtractionReuse({
        workspaceId: WS_A,
        fingerprint: fp,
        sourceContentHash: HASH_A,
        candidate: { generation: generation({ workspaceId: WS_B, inputFingerprint: fp, status: "ready" }), outputAsset: productAsset() },
      })
    ).toEqual({ reuse: false, reason: "FOREIGN_WORKSPACE" });
  });

  it("does not reuse when the same asset id mutates to a new contentHash", () => {
    expect(sourceMutationChanged(HASH_A, HASH_B)).toBe(true);
    const previous = fingerprintFor(HASH_A);
    const next = fingerprintFor(HASH_B);
    expect(evaluateGenerateAgain({ previousFingerprint: previous, nextFingerprint: next }).newGenerationRequired).toBe(true);
  });
});

describe("Photo Scene 10B retry", () => {
  it("rejects retry that would mutate frozen input", () => {
    const gen = generation({ status: "failed" });
    expect(
      evaluateExtractionRetry({
        generation: gen,
        expectedWorkspaceId: WS_A,
        expectedFingerprint: gen.inputFingerprint,
        expectedSourceAssetId: ASSET_A,
        expectedSourceContentHash: HASH_B,
      })
    ).toEqual({ ok: false, reason: "FROZEN_INPUT_CHANGED" });
  });
});

describe("Photo Scene 10B output", () => {
  it("validates transparent PNG and persists extracted_product lineage through the engine", async () => {
    const provider = new DeterministicBackgroundRemovalProvider();
    const sample = await provider.removeBackground({
      bytes: Buffer.from("source"),
      mimeType: "image/png",
      sourceAssetId: ASSET_A,
      workspaceId: WS_A,
    });
    expect(validateExtractedPng(sample.bytes).hasAlpha).toBe(true);

    const sourceBytes = Buffer.from("product-source-bytes");
    const sourceHash = hashBytes(sourceBytes);
    const gen = generation({
      sourceContentHash: sourceHash,
      inputCapsule: { ...capsule(), sourceContentHash: sourceHash },
      inputFingerprint: fingerprintFor(sourceHash),
    });
    let persisted: { storagePath?: string; role?: string; lineage?: Record<string, unknown>; contentHash?: string } = {};
    const result = await executeProductExtraction({
      generation: gen,
      io: {
        provider,
        hashBytes,
        newAssetId: () => ASSET_OUT,
        readSourceBytes: async () => sourceBytes,
        writeOutputObject: async (storagePath) => {
          persisted.storagePath = storagePath;
        },
        loadSourceAsset: async () => productAsset({ contentHash: sourceHash }),
        persistReady: async (ready) => {
          persisted = {
            storagePath: ready.outputAsset.storagePath,
            role: ready.outputAsset.metadata.photoScene.role,
            lineage: ready.outputAsset.metadata.photoScene.lineage as Record<string, unknown>,
            contentHash: ready.outputAsset.contentHash,
          };
        },
        persistFailed: async () => {
          throw new Error("should not fail");
        },
      },
    });
    expect(result.status).toBe("ready");
    expect(persisted.role).toBe("extracted_product");
    expect(persisted.storagePath).toBe(STORAGE_PATHS.library(WS_A, ASSET_OUT, "png"));
    expect(persisted.lineage?.sourceAssetId).toBe(ASSET_A);
    expect(persisted.lineage?.sourceContentHash).toBe(sourceHash);
    expect(persisted.lineage?.generationId).toBe(GEN_A);
    expect(persisted.lineage?.operation).toBe("product_extraction");
    expect(persisted.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe("Photo Scene 10B failure", () => {
  it("persists failed generation for provider and invalid output without using raw provider text as UX", async () => {
    const sourceBytes = Buffer.from("product-source-bytes");
    const sourceHash = hashBytes(sourceBytes);
    const gen = generation({
      sourceContentHash: sourceHash,
      inputCapsule: { ...capsule(), sourceContentHash: sourceHash },
    });

    const unavailable = await executeProductExtraction({
      generation: gen,
      io: {
        provider: new UnavailableBackgroundRemovalProvider(),
        hashBytes,
        readSourceBytes: async () => sourceBytes,
        writeOutputObject: async () => undefined,
        loadSourceAsset: async () => productAsset({ contentHash: sourceHash }),
        persistReady: async () => undefined,
        persistFailed: async (failed) => {
          expect(failed.errorCode).toBe("PROVIDER_UNAVAILABLE");
          expect(failed.boundedError).toBe(USER_SAFE_EXTRACTION_FAILURE_MESSAGE);
        },
      },
    });
    expect(unavailable).toEqual({ status: "failed", errorCode: "PROVIDER_UNAVAILABLE" });

    const jpegProvider: BackgroundRemovalProvider = {
      key: "bad",
      async removeBackground() {
        return {
          bytes: Buffer.from("not-a-png"),
          mimeType: "image/png",
          width: 1,
          height: 1,
          costUsd: 0.12,
          providerKey: "bad",
        };
      },
    };
    const invalid = await executeProductExtraction({
      generation: gen,
      io: {
        provider: jpegProvider,
        hashBytes,
        readSourceBytes: async () => sourceBytes,
        writeOutputObject: async () => undefined,
        loadSourceAsset: async () => productAsset({ contentHash: sourceHash }),
        persistReady: async () => {
          throw new Error("must not become READY");
        },
        persistFailed: async (failed) => {
          expect(failed.errorCode).toBe("INVALID_PROVIDER_OUTPUT");
          expect(failed.boundedError).not.toMatch(/not-a-png|stack|signedUrl/i);
        },
      },
    });
    expect(invalid.status).toBe("failed");
    expect(clientPollCannotDeclareFailure()).toBe(false);
    expect(userSafeExtractionMessage("PROVIDER_REJECTED")).toBe(USER_SAFE_EXTRACTION_FAILURE_MESSAGE);
  });

  it("does not mark READY when storage write fails", async () => {
    const sourceBytes = Buffer.from("product-source-bytes");
    const sourceHash = hashBytes(sourceBytes);
    const result = await executeProductExtraction({
      generation: generation({
        sourceContentHash: sourceHash,
        inputCapsule: { ...capsule(), sourceContentHash: sourceHash },
      }),
      io: {
        provider: new DeterministicBackgroundRemovalProvider(),
        hashBytes,
        readSourceBytes: async () => sourceBytes,
        writeOutputObject: async () => {
          throw new Error("Upload failed: disk");
        },
        loadSourceAsset: async () => productAsset({ contentHash: sourceHash }),
        persistReady: async () => {
          throw new Error("must not persist READY");
        },
        persistFailed: async (failed) => {
          expect(failed.errorCode).toBe("STORAGE_WRITE_FAILED");
        },
      },
    });
    expect(result.status).toBe("failed");
  });
});

describe("Photo Scene 10B isolation", () => {
  it("denies create/read/retry/output across workspaces", () => {
    expect(() =>
      assertPhotoSceneProductSource({
        asset: productAsset({ workspaceId: WS_B, storagePath: STORAGE_PATHS.library(WS_B, ASSET_A, "png") }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(/authorized workspace/);
    expect(() =>
      assertPhotoSceneGenerationAccess({
        generation: generation({ orgId: ORG_B, workspaceId: WS_B }),
        expectedOrgId: ORG_A,
        expectedWorkspaceId: WS_A,
      })
    ).toThrow(PhotoSceneExtractionError);
    expect(
      evaluateExtractionRetry({
        generation: generation({ workspaceId: WS_B, status: "failed" }),
        expectedWorkspaceId: WS_A,
        expectedFingerprint: generation().inputFingerprint,
        expectedSourceAssetId: ASSET_A,
        expectedSourceContentHash: HASH_A,
      })
    ).toEqual({ ok: false, reason: "FOREIGN_WORKSPACE" });
    expect(
      joinInflightExtraction({
        workspaceId: WS_A,
        fingerprint: generation().inputFingerprint,
        candidate: generation({ workspaceId: WS_B, status: "queued" }),
      })
    ).toEqual({ join: false });
  });
});

describe("Photo Scene 10B ops", () => {
  it("persists cost when the provider reports it and redacts secrets from ops events", async () => {
    const sourceBytes = Buffer.from("product-source-bytes");
    const sourceHash = hashBytes(sourceBytes);
    const priced: BackgroundRemovalProvider = {
      key: "priced-test",
      async removeBackground() {
        const inner = new DeterministicBackgroundRemovalProvider();
        const out = await inner.removeBackground({
          bytes: sourceBytes,
          mimeType: "image/png",
          sourceAssetId: ASSET_A,
          workspaceId: WS_A,
        });
        return { ...out, costUsd: 0.042, providerKey: "priced-test" };
      },
    };
    let costUsd: string | null = null;
    await executeProductExtraction({
      generation: generation({
        sourceContentHash: sourceHash,
        inputCapsule: { ...capsule(), sourceContentHash: sourceHash },
      }),
      io: {
        provider: priced,
        hashBytes,
        newAssetId: () => ASSET_OUT,
        readSourceBytes: async () => sourceBytes,
        writeOutputObject: async () => undefined,
        loadSourceAsset: async () => productAsset({ contentHash: sourceHash }),
        persistReady: async (ready) => {
          costUsd = ready.costUsd;
        },
        persistFailed: async () => undefined,
      },
    });
    expect(costUsd).toBe("0.042");

    const event = sanitizePhotoSceneOpsEvent({
      event: "extraction.failed",
      stage: "photo_scene.extract",
      outcome: "failed",
      orgId: ORG_A,
      workspaceId: WS_A,
      campaignId: CAMP_A,
      generationId: GEN_A,
      signedUrl: "https://secret.example/file",
      Authorization: "Bearer secret",
      bytes: Buffer.from("nope"),
      message: "Authorization=secret https://example.com/x",
    });
    expect(event).not.toHaveProperty("signedUrl");
    expect(event).not.toHaveProperty("Authorization");
    expect(event).not.toHaveProperty("bytes");
    expect(event.message).not.toMatch(/secret|https:\/\//);
    expect(event.kind).toBe("photo_scene.ops");
    const photoroomOps = sanitizePhotoSceneOpsEvent({
      event: "extraction.completed",
      stage: "photo_scene.extract",
      outcome: "completed",
      orgId: ORG_A,
      workspaceId: WS_A,
      campaignId: CAMP_A,
      generationId: GEN_A,
      sourceAssetId: ASSET_A,
      outputAssetId: ASSET_OUT,
      attempt: 1,
      providerKey: "photoroom",
      durationMs: 350,
    });
    expect(photoroomOps.providerKey).toBe("photoroom");
    expect(JSON.stringify(photoroomOps)).not.toMatch(/x-api-key|Authorization|signedUrl/i);
  });
});

describe("Photo Scene 10B provider and queue bounds", () => {
  it("keeps the deterministic adapter out of production defaults", () => {
    expect(resolveBackgroundRemovalProvider({ NODE_ENV: "production" }).key).toBe("none");
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
    expect(
      resolveBackgroundRemovalProvider({
        NODE_ENV: "test",
        PHOTO_SCENE_BACKGROUND_REMOVAL_PROVIDER: "deterministic",
        PHOTO_SCENE_ALLOW_DETERMINISTIC_PROVIDER: "true",
      }).key
    ).toBe("deterministic");
  });

  it("uses a dedicated photo-scene queue rather than Video Studio renderer jobs", () => {
    expect(QUEUE_NAMES.PHOTO_SCENE).toBe("photo-scene");
    expect(QUEUE_NAMES.PHOTO_SCENE).not.toBe(QUEUE_NAMES.RENDER);
    expect(QUEUE_NAMES.PHOTO_SCENE).not.toBe(QUEUE_NAMES.AGENT);
    expect(read("packages/queue/src/jobs.ts")).toMatch(/photo_scene\.extract/);
    expect(read("packages/db/sql/photo-scene-generations-v1.sql")).toMatch(
      /CREATE TABLE IF NOT EXISTS photo_scene_generations/
    );
    expect(read("packages/db/sql/photo-scene-generations-v1.sql")).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(read("packages/db/src/schema/index.ts")).toMatch(/pgTable\(\s*"photo_scene_generations"/);
    expect(read("packages/db/src/schema/index.ts")).not.toMatch(/creative_studio_jobs|creative_assets/);
    expect(PHOTO_SCENE_GENERATION_STATUSES).toEqual(["queued", "processing", "ready", "failed"]);
  });

  it("does not import Video Studio renderer, AI Story, AUTH-01, or Publishing into extraction contracts", () => {
    const extraction = read("packages/shared/src/photo-scene-extraction.ts");
    expect(extraction).not.toMatch(/editing-director|source-rhythm|ai-story|AUTH-01|publishJobs|ffmpeg/);
    expect(read("packages/agents/src/photo-scene/execute-product-extraction.ts")).not.toMatch(
      /ffmpeg|ai-story|AUTH-01/
    );
  });
});

describe("Photo Scene 10B PNG helper", () => {
  it("rejects PNG without alpha", () => {
    const rgba = Buffer.alloc(4, 255);
    rgba[3] = 255;
    const png = encodeRgbaPng(1, 1, rgba);
    expect(validateExtractedPng(png).hasAlpha).toBe(true);
    const opaqueIndexed = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0,
    ]);
    expect(() => validateExtractedPng(opaqueIndexed)).toThrow(PhotoSceneExtractionError);
  });

  it("hashes output bytes with the existing SHA-256 primitive", () => {
    expect(hashSourceAssetBytes(Buffer.from("abc"))).toBe(
      "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});
