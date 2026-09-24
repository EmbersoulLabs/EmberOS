import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryAssetMatchingError,
  matchAnalyzedAssetsToStory,
} from "@ceo-agent/shared";

const id = (value: number) =>
  `c3000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const createdAt = "2026-09-24T01:00:00.000Z";

function analyzedAsset(input: {
  assetId?: string;
  workspaceId?: string;
  fileKind?: "IMAGE" | "VIDEO";
  product?: boolean;
  character?: boolean;
  sourceMotion?: boolean;
} = {}) {
  const assetId = input.assetId ?? id(10);
  const workspaceId = input.workspaceId ?? id(2);
  const fixtureOffset =
    assetId === id(10) ? 0 : assetId === id(11) ? 1 : 2;
  const contentHash = hash(["a", "b", "f"][fixtureOffset]!);
  const fileKind = input.fileKind ?? "IMAGE";
  return {
    registry: {
      assetId,
      orgId: id(1),
      workspaceId,
      contentHash,
      mimeType: fileKind === "IMAGE" ? "image/png" : "video/mp4",
      fileKind,
      storageRef: `${workspaceId}/library/${assetId}`,
      createdAt,
    },
    snapshot: {
      snapshotId: id(20 + fixtureOffset),
      orgId: id(1),
      workspaceId,
      sourceAssetId: assetId,
      analyzedContentHash: contentHash,
      analyzerVersion: "asset-vision.v1",
      schemaVersion: "asset-analysis.v1",
      analysis: {
        fileKind,
        usable: true,
        rejectionReasons: [],
        affordances: {
          visualReference: true,
          firstFrame: fileKind === "IMAGE",
          sourceMotion:
            input.sourceMotion ?? fileKind === "VIDEO",
          sourceAudio: fileKind === "VIDEO",
          productGrounding: input.product ?? true,
          characterGrounding: input.character ?? false,
        },
        facts: { subject: "flower bouquet" },
      },
      analysisFingerprint: hash(["c", "d", "9"][fixtureOffset]!),
      createdAt,
    },
  };
}

function match(input: {
  storyId?: string;
  storyVersionId?: string;
  requirements?: Record<string, boolean>;
  assets?: ReturnType<typeof analyzedAsset>[];
  intent?:
    | "PRODUCT_IDENTITY"
    | "CHARACTER_IDENTITY"
    | "OPENING_COMPOSITION"
    | "SOURCE_MOTION"
    | "UNRELATED";
  characterDna?: boolean;
  confirmedNoAssets?: boolean;
} = {}) {
  const storyId = input.storyId ?? id(30);
  const storyVersionId = input.storyVersionId ?? id(31);
  const assets = input.assets ?? [analyzedAsset()];
  return matchAnalyzedAssetsToStory({
    matchingResultId: id(40),
    orgId: id(1),
    workspaceId: id(2),
    storyId,
    storyVersionId,
    storyVersionNumber: 1,
    requirements: input.requirements ?? {},
    assets,
    semanticDecisions: assets.map((asset) => ({
      assetId: asset.registry.assetId,
      analysisSnapshotId: asset.snapshot.snapshotId,
      intent: input.intent ?? "PRODUCT_IDENTITY",
      required: true,
      reason: "Typed fixture semantic decision",
      source: "STORY_SEMANTIC_MATCHER" as const,
    })),
    bindingIdByAssetId: Object.fromEntries(
      assets.map((asset, index) => [asset.registry.assetId, id(50 + index)])
    ),
    characterDnaAuthority: input.characterDna
      ? {
          reusableCharacterId: id(60),
          reusableCharacterVersionId: id(61),
          characterDnaFingerprint: hash("e"),
        }
      : null,
    noAssetConfirmation: input.confirmedNoAssets
      ? {
          storyId,
          storyVersionId,
          confirmedBy: id(62),
          confirmedAt: createdAt,
          authorityVersion: "no-asset-confirmation.v1",
        }
      : null,
    matcherVersion: "story-asset-matcher.v1",
    createdAt,
  });
}

describe("Story Asset Matching", () => {
  it("pins existing Snapshot and exact Asset content hash", () => {
    const result = match({
      requirements: { productIdentityRequired: true },
    });
    expect(result.bindings[0]).toMatchObject({
      assetId: id(10),
      analysisSnapshotId: id(20),
      assetContentHash: hash("a"),
      analysisContentHash: hash("a"),
      storyVersionId: id(31),
    });
  });

  it("has no analyzer or raw-media dependency", () => {
    const matcherSource = readFileSync(
      join(
        process.cwd(),
        "packages/shared/src/ai-story-asset-matching.ts"
      ),
      "utf8"
    );
    expect(matcherSource).not.toContain("AssetAnalysisService");
    expect(matcherSource).not.toContain("loadRawBytes");
    expect(matcherSource).not.toContain("storageRef)");
  });

  it("binds the same bouquet Snapshot differently for three Stories", () => {
    const analyzerCalls = 0;
    const product = match({
      storyId: id(30),
      storyVersionId: id(31),
      intent: "PRODUCT_IDENTITY",
    });
    const opening = match({
      storyId: id(32),
      storyVersionId: id(33),
      intent: "OPENING_COMPOSITION",
    });
    const unrelated = match({
      storyId: id(34),
      storyVersionId: id(35),
      intent: "UNRELATED",
    });
    expect(product.bindings[0]?.role).toBe("PRODUCT_AUTHORITY");
    expect(opening.bindings[0]?.role).toBe("SOURCE_IMAGE_CANDIDATE");
    expect(unrelated.bindings[0]?.role).toBe("UNUSED");
    expect(
      new Set(
        [product, opening, unrelated].map(
          (result) => result.bindings[0]?.analysisSnapshotId
        )
      )
    ).toEqual(new Set([id(20)]));
    expect(analyzerCalls).toBe(0);
  });

  it("surfaces missing required Product authority", () => {
    const result = match({
      assets: [],
      requirements: { productIdentityRequired: true },
    });
    expect(result.missingRequirements).toContain("PRODUCT_IDENTITY");
    expect(result.recommendedUploadRoles).toContain("PRODUCT_PHOTO");
  });

  it("surfaces missing Character authority", () => {
    const result = match({
      assets: [],
      requirements: { characterIdentityRequired: true },
    });
    expect(result.missingRequirements).toContain("CHARACTER_IDENTITY");
    expect(result.recommendedUploadRoles).toContain(
      "PROTAGONIST_REFERENCE_PHOTO"
    );
  });

  it("treats Character DNA as identity authority without selecting T2V", () => {
    const result = match({
      assets: [],
      requirements: { characterIdentityRequired: true },
      characterDna: true,
    });
    expect(result.satisfiedRequirements).toContain("CHARACTER_IDENTITY");
    expect(result).not.toHaveProperty("generationMode");
    expect(result).not.toHaveProperty("providerId");
  });

  it("does not turn an image candidate into I2V authority", () => {
    const result = match({ intent: "OPENING_COMPOSITION" });
    expect(result.bindings[0]?.role).toBe("SOURCE_IMAGE_CANDIDATE");
    expect(result).not.toHaveProperty("resolvedGenerationMode");
  });

  it("does not turn a source video candidate into V2V authority", () => {
    const video = analyzedAsset({
      fileKind: "VIDEO",
      sourceMotion: true,
    });
    const result = match({
      assets: [video],
      intent: "SOURCE_MOTION",
      requirements: { sourceMotionRequired: true },
    });
    expect(result.bindings[0]?.role).toBe("SOURCE_VIDEO_CANDIDATE");
    expect(result).not.toHaveProperty("resolvedGenerationMode");
  });

  it("requires Asset recommendations when no usable Assets exist", () => {
    const result = match({
      assets: [],
      requirements: { environmentFidelityRequired: true },
    });
    expect(result.assetRecommendationStatus).toBe(
      "ASSET_RECOMMENDATION_REQUIRED"
    );
    expect(result.recommendedUploadRoles).toContain(
      "ENVIRONMENT_REFERENCE"
    );
  });

  it("keeps confirmed-no-assets authority separate from mode selection", () => {
    const result = match({
      assets: [],
      requirements: { productIdentityRequired: true },
      confirmedNoAssets: true,
    });
    expect(result.assetRecommendationStatus).toBe("CONFIRMED_NO_ASSETS");
    expect(result.noAssetConfirmation?.storyVersionId).toBe(id(31));
    expect(result.missingRequirements).toContain("PRODUCT_IDENTITY");
    expect(result).not.toHaveProperty("generationMode");
  });

  it("rejects cross-Workspace Asset intelligence", () => {
    expect(() =>
      match({ assets: [analyzedAsset({ workspaceId: id(99) })] })
    ).toThrowError(AiStoryAssetMatchingError);
  });

  it("rejects semantic decisions pinned to a different Snapshot", () => {
    const fixture = analyzedAsset();
    expect(() =>
      matchAnalyzedAssetsToStory({
        matchingResultId: id(40),
        orgId: id(1),
        workspaceId: id(2),
        storyId: id(30),
        storyVersionId: id(31),
        storyVersionNumber: 1,
        requirements: {},
        assets: [fixture],
        semanticDecisions: [
          {
            assetId: fixture.registry.assetId,
            analysisSnapshotId: id(99),
            intent: "PRODUCT_IDENTITY",
            required: true,
            reason: "Invalid Snapshot fixture",
            source: "STORY_SEMANTIC_MATCHER",
          },
        ],
        bindingIdByAssetId: { [fixture.registry.assetId]: id(50) },
        matcherVersion: "story-asset-matcher.v1",
        createdAt,
      })
    ).toThrow(/authoritative analysis Snapshot/);
  });

  it("produces audio intent without Provider audio flags", () => {
    const result = match({
      requirements: { nativeDialogueDesired: true },
    });
    expect(result.audioIntent).toBe("NATIVE_DIALOGUE");
    expect(result).not.toHaveProperty("generateAudio");
    expect(result).not.toHaveProperty("blockedCapabilities");
  });

  it("can represent DNA, character, product, and video authorities together", () => {
    const character = analyzedAsset({
      assetId: id(11),
      product: false,
      character: true,
    });
    const product = analyzedAsset({ assetId: id(10), product: true });
    const video = analyzedAsset({
      assetId: id(12),
      fileKind: "VIDEO",
      sourceMotion: true,
    });
    const decisions = [
      {
        assetId: character.registry.assetId,
        analysisSnapshotId: character.snapshot.snapshotId,
        intent: "CHARACTER_IDENTITY" as const,
        required: false,
        reason: "Character photo",
        source: "HUMAN_SELECTION" as const,
      },
      {
        assetId: product.registry.assetId,
        analysisSnapshotId: product.snapshot.snapshotId,
        intent: "PRODUCT_IDENTITY" as const,
        required: true,
        reason: "Product authority",
        source: "HUMAN_SELECTION" as const,
      },
      {
        assetId: video.registry.assetId,
        analysisSnapshotId: video.snapshot.snapshotId,
        intent: "SOURCE_MOTION" as const,
        required: false,
        reason: "Motion candidate",
        source: "HUMAN_SELECTION" as const,
      },
    ];
    const result = matchAnalyzedAssetsToStory({
      matchingResultId: id(40),
      orgId: id(1),
      workspaceId: id(2),
      storyId: id(30),
      storyVersionId: id(31),
      storyVersionNumber: 1,
      requirements: {
        characterIdentityRequired: true,
        productIdentityRequired: true,
        sourceMotionRequired: true,
      },
      assets: [character, product, video],
      semanticDecisions: decisions,
      bindingIdByAssetId: {
        [character.registry.assetId]: id(50),
        [product.registry.assetId]: id(51),
        [video.registry.assetId]: id(52),
      },
      characterDnaAuthority: {
        reusableCharacterId: id(60),
        reusableCharacterVersionId: id(61),
        characterDnaFingerprint: hash("e"),
      },
      matcherVersion: "story-asset-matcher.v1",
      createdAt,
    });
    expect(result.bindings.map((binding) => binding.role)).toEqual([
      "CHARACTER_AUTHORITY",
      "PRODUCT_AUTHORITY",
      "SOURCE_VIDEO_CANDIDATE",
    ]);
    expect(result).not.toHaveProperty("generationMode");
  });
});
