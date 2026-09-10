import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  PHOTO_SCENE_EXTRACTION_CONTRACT,
  PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_POLICY,
  photoSceneMetadata,
  type SourceAssetContentHash,
} from "@ceo-agent/shared";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "@ceo-agent/shared/photo-scene-extraction.server";
import {
  AiStoryExactProductDerivativeAuthorityError,
  resolveExactStoryProductDerivative,
} from "../apps/web/src/lib/ai-story-exact-product-derivative";

const id = (n: number) =>
  `98000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (letter: string) => `sha256:${letter.repeat(64)}` as SourceAssetContentHash;

const scope = {
  storyId: id(1),
  orgId: id(2),
  workspaceId: id(3),
  campaignId: id(4),
  productAuthorityId: id(10),
};

function source(assetId = id(10), contentHash = hash("a"), usageType = "product_source") {
  return {
    storyId: scope.storyId,
    assetId,
    usageType,
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    campaignId: scope.campaignId,
    contentHash,
    status: "ready",
  };
}

function fingerprint(contentHash = hash("a")) {
  return fingerprintPhotoSceneExtractionIdentityV1({
    version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
    contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
    operation: "product_extraction",
    policy: PHOTO_SCENE_EXTRACTION_POLICY,
    workspaceId: scope.workspaceId,
    sourceContentHash: contentHash,
  });
}

function generation(overrides: Record<string, unknown> = {}) {
  return {
    id: id(20),
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    campaignId: scope.campaignId,
    operation: "product_extraction",
    status: "ready",
    sourceAssetId: id(10),
    sourceContentHash: hash("a"),
    inputCapsule: {},
    inputFingerprint: fingerprint(),
    outputAssetId: id(30),
    providerKey: "photoroom",
    attemptCount: 1,
    errorCode: null,
    boundedError: null,
    costUsd: null,
    createdBy: id(40),
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:01:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:01:00.000Z"),
    ...overrides,
  };
}

function outputAsset(overrides: Record<string, unknown> = {}) {
  const currentGeneration = generation();
  return {
    id: id(30),
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    campaignId: scope.campaignId,
    type: "image",
    storagePath: `${scope.workspaceId}/library/${id(30)}.png`,
    displayName: null,
    originalFilename: null,
    status: "ready",
    source: "system_generated",
    uploadedBy: null,
    mimeType: "image/png",
    durationSec: null,
    width: 100,
    height: 100,
    fileSizeBytes: 100,
    contentHash: hash("b"),
    metadata: {
      photoScene: photoSceneMetadata("extracted_product", {
        operation: "product_extraction",
        sourceAssetId: id(10),
        sourceContentHash: hash("a"),
        generationId: currentGeneration.id,
        generationFingerprint: currentGeneration.inputFingerprint,
      }),
    },
    createdAt: new Date("2026-01-01T00:01:00.000Z"),
    updatedAt: new Date("2026-01-01T00:01:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

async function resolve(options: {
  sources?: ReturnType<typeof source>[];
  candidate?: ReturnType<typeof generation> | null;
  asset?: ReturnType<typeof outputAsset> | null;
  campaignAuthorized?: boolean;
} = {}) {
  const resolveSources = vi.fn().mockResolvedValue(options.sources ?? [source()]);
  const findReady = vi.fn().mockResolvedValue(
    options.candidate === undefined ? generation() : options.candidate
  );
  const loadOutput = vi.fn().mockResolvedValue({
    asset: options.asset === undefined ? outputAsset() : options.asset,
    currentCampaignAuthorized: options.campaignAuthorized ?? true,
  });
  const result = await resolveExactStoryProductDerivative(
    {} as never,
    scope,
    { resolveSources, findReady, loadOutput } as never
  );
  return { result, resolveSources, findReady, loadOutput };
}

describe("AI Story read-only exact Product derivative resolution", () => {
  it("finds an exact READY derivative with certified output lineage", async () => {
    const { result, findReady } = await resolve();
    expect(result).toEqual({
      contractVersion: "ai-story-exact-product-derivative-resolution.v1",
      status: "FOUND",
      productAuthorityId: id(10),
      sourceAssetId: id(10),
      sourceAssetContentHash: hash("a"),
      derivative: {
        assetId: id(30),
        contentHash: hash("b"),
        generationId: id(20),
        generationFingerprint: fingerprint(),
        operation: "product_extraction",
      },
    });
    expect(findReady).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspaceId: scope.workspaceId,
        sourceAssetId: id(10),
        fingerprint: fingerprint(),
      })
    );
  });

  it("returns NOT_FOUND without loading output when no READY extraction exists", async () => {
    const { result, loadOutput } = await resolve({ candidate: null });
    expect(result).toMatchObject({ status: "NOT_FOUND", reason: "NO_READY_EXTRACTION" });
    expect(loadOutput).not.toHaveBeenCalled();
  });

  it("denies another Asset with the same hash and legacy V1 fingerprint", async () => {
    const result = await resolveExactStoryProductDerivative(
      {} as never,
      { ...scope, productAuthorityId: id(11) },
      {
        resolveSources: vi.fn().mockResolvedValue([source(id(11))]),
        findReady: vi.fn().mockResolvedValue(generation()),
        loadOutput: vi.fn().mockResolvedValue({ asset: outputAsset(), currentCampaignAuthorized: true }),
      } as never
    );
    expect(result).toMatchObject({ status: "NOT_FOUND", reason: "CANDIDATE_NOT_REUSABLE" });
  });

  it("denies an old hash for the same source Asset", async () => {
    const stale = generation({ sourceContentHash: hash("c"), inputFingerprint: fingerprint(hash("c")) });
    const { result } = await resolve({ candidate: stale });
    expect(result).toMatchObject({ status: "NOT_FOUND", reason: "CANDIDATE_NOT_REUSABLE" });
  });

  it.each([
    ["source Asset", { sourceAssetId: id(11) }],
    ["source hash", { sourceContentHash: hash("c") }],
    ["generation ID", { generationId: id(21) }],
    ["generation fingerprint", { generationFingerprint: hash("d") }],
  ])("denies output lineage mismatch for %s", async (_label, lineageOverride) => {
    const base = outputAsset();
    const metadata = base.metadata as { photoScene: ReturnType<typeof photoSceneMetadata> };
    const { result } = await resolve({
      asset: outputAsset({
        metadata: {
          photoScene: photoSceneMetadata("extracted_product", {
            ...metadata.photoScene.lineage,
            ...lineageOverride,
          }),
        },
      }),
    });
    expect(result).toMatchObject({ status: "NOT_FOUND", reason: "CANDIDATE_NOT_REUSABLE" });
  });

  it("requires the extracted_product role and canonical derivative hash", async () => {
    const wrongRole = await resolve({
      asset: outputAsset({ metadata: { photoScene: photoSceneMetadata("marketing_image") } }),
    });
    expect(wrongRole.result).toMatchObject({ status: "NOT_FOUND", reason: "CANDIDATE_NOT_REUSABLE" });
    const badHash = await resolve({ asset: outputAsset({ contentHash: null }) });
    expect(badHash.result).toMatchObject({ status: "NOT_FOUND", reason: "CANDIDATE_NOT_REUSABLE" });
  });

  it.each([
    ["foreign org", { orgId: id(99) }, true],
    ["foreign workspace", { workspaceId: id(99) }, true],
    ["deleted", { deletedAt: new Date("2026-01-02T00:00:00.000Z") }, true],
    ["unready", { status: "processing" }, true],
    ["missing Campaign authorization", {}, false],
  ])("returns OUTPUT_UNAVAILABLE for %s output", async (_label, overrides, campaignAuthorized) => {
    const { result } = await resolve({
      asset: outputAsset(overrides),
      campaignAuthorized,
    });
    expect(result).toMatchObject({ status: "NOT_FOUND", reason: "OUTPUT_UNAVAILABLE" });
  });

  it("converges from OUTPUT_UNAVAILABLE to FOUND only after explicit Campaign authorization", async () => {
    let currentCampaignAuthorized = false;
    const dependencies = {
      resolveSources: vi.fn().mockResolvedValue([source()]),
      findReady: vi.fn().mockResolvedValue(generation()),
      loadOutput: vi.fn().mockImplementation(async () => ({
        asset: outputAsset(),
        currentCampaignAuthorized,
      })),
    } as never;
    const before = await resolveExactStoryProductDerivative({} as never, scope, dependencies);
    expect(before).toMatchObject({ status: "NOT_FOUND", reason: "OUTPUT_UNAVAILABLE" });

    currentCampaignAuthorized = true;
    const after = await resolveExactStoryProductDerivative({} as never, scope, dependencies);
    expect(after).toMatchObject({
      status: "FOUND",
      productAuthorityId: id(10),
      sourceAssetId: id(10),
      sourceAssetContentHash: hash("a"),
      derivative: {
        assetId: id(30),
        generationId: id(20),
        generationFingerprint: fingerprint(),
      },
    });
  });

  it("fails closed when exact current Story product_source authority is absent", async () => {
    await expect(resolve({ sources: [] })).rejects.toThrowError(
      AiStoryExactProductDerivativeAuthorityError
    );
    await expect(resolve({ sources: [source(id(10), hash("a"), "reference")] })).rejects.toThrowError(
      AiStoryExactProductDerivativeAuthorityError
    );
  });

  it("does not use latest Campaign extraction and is deterministic", async () => {
    const first = await resolve();
    const second = await resolve();
    expect(first.result).toEqual(second.result);
    const sourceText = readFileSync(
      "apps/web/src/lib/ai-story-exact-product-derivative.ts",
      "utf8"
    );
    expect(sourceText).not.toContain("latestCampaignPhotoSceneExtraction");
  });

  it("contains only SELECT resolution and no extraction, queue, mutation, or selection path", () => {
    const sourceText = readFileSync(
      "apps/web/src/lib/ai-story-exact-product-derivative.ts",
      "utf8"
    );
    expect(sourceText).not.toMatch(
      /requestProductExtraction|retryProductExtraction|finalizeStoredSourceAssetIdentity|enqueuePhotoSceneExtract|ProductVisualMaterialAuthority/
    );
    expect(sourceText).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
    expect(sourceText).not.toMatch(/PreparedSceneFrame|ProviderReadySceneInput|FIRST_FRAME_IMAGE_TO_VIDEO/);
  });
});
