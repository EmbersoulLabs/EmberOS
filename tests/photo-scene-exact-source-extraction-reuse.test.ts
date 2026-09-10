import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STORAGE_PATHS,
  evaluateExtractionReuse,
  evaluateGenerateAgain,
  extractionFingerprintIdentity,
  freezePhotoSceneExtractionInput,
  joinInflightExtraction,
  photoSceneMetadata,
  type PhotoSceneGenerationSnapshot,
} from "@ceo-agent/shared";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "../packages/shared/src/photo-scene-extraction.server";

const ORG = "11000000-0000-4000-8000-000000000001";
const WORKSPACE = "22000000-0000-4000-8000-000000000001";
const CAMPAIGN = "33000000-0000-4000-8000-000000000001";
const SOURCE_A = "44000000-0000-4000-8000-000000000001";
const SOURCE_B = "44000000-0000-4000-8000-000000000002";
const OUTPUT = "55000000-0000-4000-8000-000000000001";
const GENERATION = "66000000-0000-4000-8000-000000000001";
const HASH = `sha256:${"a".repeat(64)}`;
const OUTPUT_HASH = `sha256:${"b".repeat(64)}`;
const FINGERPRINT = `sha256:${"c".repeat(64)}`;

function generation(
  overrides: Partial<PhotoSceneGenerationSnapshot> = {}
): PhotoSceneGenerationSnapshot {
  return {
    id: GENERATION,
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: CAMPAIGN,
    operation: "product_extraction",
    status: "ready",
    sourceAssetId: SOURCE_A,
    sourceContentHash: HASH,
    inputCapsule: {},
    inputFingerprint: FINGERPRINT,
    outputAssetId: OUTPUT,
    attemptCount: 1,
    ...overrides,
  };
}

function outputAsset(lineageOverrides: Record<string, unknown> = {}) {
  return {
    id: OUTPUT,
    orgId: ORG,
    workspaceId: WORKSPACE,
    campaignId: CAMPAIGN,
    type: "image",
    mimeType: "image/png",
    storagePath: STORAGE_PATHS.library(WORKSPACE, OUTPUT, "png"),
    contentHash: OUTPUT_HASH,
    metadata: {
      photoScene: photoSceneMetadata("extracted_product", {
        sourceAssetId: SOURCE_A,
        sourceContentHash: HASH,
        operation: "product_extraction",
        generationId: GENERATION,
        generationFingerprint: FINGERPRINT,
        ...lineageOverrides,
      }),
    },
  };
}

function reuse(overrides: {
  expectedSourceAssetId?: string;
  generation?: PhotoSceneGenerationSnapshot;
  lineage?: Record<string, unknown>;
} = {}) {
  return evaluateExtractionReuse({
    workspaceId: WORKSPACE,
    expectedSourceAssetId: overrides.expectedSourceAssetId ?? SOURCE_A,
    fingerprint: FINGERPRINT,
    sourceContentHash: HASH,
    candidate: {
      generation: overrides.generation ?? generation(),
      outputAsset: outputAsset(overrides.lineage),
    },
  });
}

describe("Photo Scene exact-source extraction reuse authority", () => {
  it("does not redefine the certified V1 fingerprint", () => {
    const capsuleFor = (assetId: string) =>
      freezePhotoSceneExtractionInput({
        orgId: ORG,
        workspaceId: WORKSPACE,
        campaignId: CAMPAIGN,
        source: {
          id: assetId,
          orgId: ORG,
          workspaceId: WORKSPACE,
          campaignId: CAMPAIGN,
          type: "image",
          mimeType: "image/png",
          storagePath: STORAGE_PATHS.library(WORKSPACE, assetId, "png"),
          contentHash: HASH,
        },
      });
    const identityA = extractionFingerprintIdentity(capsuleFor(SOURCE_A));
    const identityB = extractionFingerprintIdentity(capsuleFor(SOURCE_B));
    expect(identityA).not.toHaveProperty("sourceAssetId");
    expect(identityA).toEqual(identityB);
    expect(fingerprintPhotoSceneExtractionIdentityV1(identityA)).toBe(
      fingerprintPhotoSceneExtractionIdentityV1(identityB)
    );
  });

  it("reuses historical V1 READY output only for the same exact source and lineage", () => {
    expect(reuse()).toEqual({ reuse: true, generationId: GENERATION });
  });

  it("denies a different Asset with the same hash and legacy V1 fingerprint", () => {
    expect(reuse({ expectedSourceAssetId: SOURCE_B })).toEqual({
      reuse: false,
      reason: "SOURCE_ASSET_MISMATCH",
    });
  });

  it("requires exact output source and hash lineage", () => {
    expect(reuse({ lineage: { sourceAssetId: SOURCE_B } })).toEqual({
      reuse: false,
      reason: "SOURCE_ASSET_MISMATCH",
    });
    expect(
      reuse({ lineage: { sourceContentHash: `sha256:${"d".repeat(64)}` } })
    ).toEqual({ reuse: false, reason: "HASH_MISMATCH" });
  });

  it("requires output lineage to bind the selected generation and fingerprint", () => {
    expect(
      reuse({ lineage: { generationId: "66000000-0000-4000-8000-000000000002" } })
    ).toEqual({ reuse: false, reason: "LINEAGE_MISMATCH" });
    expect(
      reuse({ lineage: { generationFingerprint: `sha256:${"d".repeat(64)}` } })
    ).toEqual({ reuse: false, reason: "LINEAGE_MISMATCH" });
  });

  it("joins only exact-source inflight work", () => {
    const candidate = generation({ status: "processing", outputAssetId: null });
    expect(
      joinInflightExtraction({
        workspaceId: WORKSPACE,
        expectedSourceAssetId: SOURCE_A,
        expectedSourceContentHash: HASH,
        fingerprint: FINGERPRINT,
        candidate,
      })
    ).toEqual({ join: true, generationId: GENERATION, status: "processing" });
    expect(
      joinInflightExtraction({
        workspaceId: WORKSPACE,
        expectedSourceAssetId: SOURCE_B,
        expectedSourceContentHash: HASH,
        fingerprint: FINGERPRINT,
        candidate,
      })
    ).toEqual({ join: false });
  });

  it("requires a new generation when source authority changes despite equal fingerprints", () => {
    expect(
      evaluateGenerateAgain({
        previousSourceAssetId: SOURCE_A,
        previousFingerprint: FINGERPRINT,
        nextSourceAssetId: SOURCE_B,
        nextFingerprint: FINGERPRINT,
      })
    ).toEqual({ newGenerationRequired: true });
    expect(
      evaluateGenerateAgain({
        previousSourceAssetId: SOURCE_A,
        previousFingerprint: FINGERPRINT,
        nextSourceAssetId: SOURCE_A,
        nextFingerprint: FINGERPRINT,
      })
    ).toEqual({ newGenerationRequired: false });
  });

  it("binds READY and inflight DB selectors to exact sourceAssetId", () => {
    const queries = readFileSync(
      "packages/db/src/queries/photo-scene-generations.ts",
      "utf8"
    );
    const exactSourcePredicates = queries.match(
      /eq\(schema\.photoSceneGenerations\.sourceAssetId, input\.sourceAssetId\)/g
    );
    expect(exactSourcePredicates).toHaveLength(3);
  });

  it("aligns fresh schema and ordered migration without rewriting history", () => {
    const desired = readFileSync("packages/db/src/schema/index.ts", "utf8");
    const migration = readFileSync(
      "packages/db/sql/photo-scene-exact-source-extraction-reuse-v1.sql",
      "utf8"
    );
    expect(desired).toMatch(
      /photo_scene_generations_inflight_fingerprint_idx[\s\S]*sourceAssetId[\s\S]*inputFingerprint/
    );
    expect(migration).toMatch(
      /workspace_id,\s*operation,\s*source_asset_id,\s*input_fingerprint/i
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\b/i);
  });

  it("requires full reuse evaluation in READY insert-race recovery", () => {
    const runtime = readFileSync("apps/web/src/lib/photo-scene-extraction.ts", "utf8");
    const raceSection = runtime.slice(runtime.indexOf("} catch (err)"));
    expect(raceSection).toContain("sourceAssetId: capsule.sourceAssetId");
    expect(raceSection).toContain("const authorized = await certifyAndAuthorizeReadyReuse");
    expect(
      raceSection.indexOf("const authorized = await certifyAndAuthorizeReadyReuse")
    ).toBeLessThan(
      raceSection.indexOf("reused: true")
    );
    const certification = runtime.slice(
      runtime.indexOf("async function certifyAndAuthorizeReadyReuse"),
      runtime.indexOf("export async function requestProductExtraction")
    );
    expect(certification.indexOf("evaluateExtractionReuse")).toBeLessThan(
      certification.indexOf("authorizeCertifiedReusableDerivativeForCampaign")
    );
  });

  it("keeps Product authority on the original source Asset", () => {
    const source = readFileSync(
      "packages/agents/src/photo-scene/execute-product-extraction.ts",
      "utf8"
    );
    expect(source).toContain("role: \"extracted_product\"");
    expect(source).toContain("sourceAssetId: generation.sourceAssetId");
    expect(source).not.toMatch(/productAuthorityId\s*:/);
  });
});
