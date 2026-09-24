import { describe, expect, it } from "vitest";
import {
  AiStoryAssetBindingSchema,
  resolveAiStoryAssetAwareExecutionPlan,
} from "@ceo-agent/shared";

const id = (value: number) =>
  `a1000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const createdAt = "2026-09-24T00:00:00.000Z";

function baseInput() {
  return {
    plannerSnapshotId: id(1),
    orgId: id(2),
    workspaceId: id(3),
    storyId: id(4),
    storyVersionId: id(5),
    requirements: {},
    audioIntent: "NONE" as const,
    bindings: [],
    plannerVersion: "asset-aware-planner.v1",
    createdAt,
  };
}

function analyzedImageBinding() {
  const contentHash = hash("a");
  return {
    binding: {
      bindingId: id(10),
      orgId: id(2),
      workspaceId: id(3),
      storyId: id(4),
      storyVersionId: id(5),
      assetId: id(11),
      assetContentHash: contentHash,
      analysisSnapshotId: id(12),
      analysisContentHash: contentHash,
      role: "PRODUCT_GROUNDING" as const,
      required: true,
      reason: "Product grounding fixture",
      trace: ["fixture"],
      status: "ACTIVE" as const,
      createdAt,
    },
    snapshot: {
      snapshotId: id(12),
      orgId: id(2),
      workspaceId: id(3),
      // A duplicate Asset row may reuse analysis from the canonical same-byte Asset.
      sourceAssetId: id(13),
      analyzedContentHash: contentHash,
      analyzerVersion: "asset-vision.v1",
      schemaVersion: "asset-analysis.v1",
      analysis: {
        fileKind: "IMAGE" as const,
        usable: true,
        rejectionReasons: [],
        affordances: {
          visualReference: true,
          firstFrame: true,
          sourceMotion: false,
          sourceAudio: false,
          productGrounding: true,
          characterGrounding: false,
        },
        facts: { subject: "product" },
      },
      analysisFingerprint: hash("b"),
      createdAt,
    },
  };
}

describe("asset-aware execution planner foundation", () => {
  it("requires explicit no-Asset confirmation before reference-free T2V", () => {
    const pending = resolveAiStoryAssetAwareExecutionPlan(baseInput());
    expect(pending.assetDecisionStatus).toBe(
      "AWAITING_NO_ASSET_CONFIRMATION"
    );
    expect(pending.resolvedGenerationMode).toBeNull();

    const resolved = resolveAiStoryAssetAwareExecutionPlan({
      ...baseInput(),
      audioIntent: "NATIVE_DIALOGUE",
      noAssetConfirmation: {
        storyId: id(4),
        storyVersionId: id(5),
        confirmedBy: id(20),
        confirmedAt: createdAt,
        authorityVersion: "no-asset-confirmation.v1",
      },
    });
    expect(resolved.assetDecisionStatus).toBe("RESOLVED");
    expect(resolved.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
    expect(resolved.providerCapabilityRequirements).toMatchObject({
      textToVideo: true,
      nativeAudio: true,
      nativeDialogue: true,
    });
  });

  it("reuses same-content analysis and derives first-frame I2V", () => {
    const resolved = resolveAiStoryAssetAwareExecutionPlan({
      ...baseInput(),
      requirements: {
        needsProductGrounding: true,
        allowsReferenceFree: false,
      },
      bindings: [analyzedImageBinding()],
    });
    expect(resolved.assetDecisionStatus).toBe("RESOLVED");
    expect(resolved.resolvedGenerationMode).toBe(
      "FIRST_FRAME_IMAGE_TO_VIDEO"
    );
    expect(resolved.selectedBindingIds).toEqual([id(10)]);
    expect(resolved.providerCapabilityRequirements.firstFrameImageToVideo).toBe(
      true
    );
  });

  it("suggests the missing upload instead of silently falling back to T2V", () => {
    const resolved = resolveAiStoryAssetAwareExecutionPlan({
      ...baseInput(),
      requirements: {
        needsSourceMotion: true,
        allowsReferenceFree: true,
      },
      noAssetConfirmation: {
        storyId: id(4),
        storyVersionId: id(5),
        confirmedBy: id(20),
        confirmedAt: createdAt,
        authorityVersion: "no-asset-confirmation.v1",
      },
    });
    expect(resolved.assetDecisionStatus).toBe("NEEDS_RECOMMENDED_UPLOADS");
    expect(resolved.resolvedGenerationMode).toBeNull();
    expect(resolved.recommendedUploadRoles).toEqual([
      "SOURCE_VIDEO_CANDIDATE",
    ]);
  });

  it("rejects a Story binding whose Asset bytes differ from its analysis", () => {
    const fixture = analyzedImageBinding().binding;
    expect(() =>
      AiStoryAssetBindingSchema.parse({
        ...fixture,
        analysisContentHash: hash("c"),
      })
    ).toThrow(/exact Asset content hash/);
  });
});
