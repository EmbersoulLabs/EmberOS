import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryAssetMatchingResultSchema,
  AiStoryModeResolutionError,
  resolveAiStoryGenerationMode,
} from "@ceo-agent/shared";

const id = (value: number) =>
  `d4000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const createdAt = "2026-09-24T02:00:00.000Z";

type Role =
  | "CHARACTER_AUTHORITY"
  | "PRODUCT_AUTHORITY"
  | "SOURCE_IMAGE_CANDIDATE"
  | "SOURCE_VIDEO_CANDIDATE"
  | "SUPPORTING_REFERENCE"
  | "UNUSED";

function binding(input: {
  role: Role;
  bindingId?: string;
  workspaceId?: string;
  required?: boolean;
}) {
  const bindingId = input.bindingId ?? id(20);
  const workspaceId = input.workspaceId ?? id(2);
  const suffix = bindingId === id(20) ? "a" : "b";
  return {
    bindingId,
    orgId: id(1),
    workspaceId,
    storyId: id(3),
    storyVersionId: id(4),
    assetId: bindingId === id(20) ? id(30) : id(31),
    assetContentHash: hash(suffix),
    analysisSnapshotId: bindingId === id(20) ? id(40) : id(41),
    analysisContentHash: hash(suffix),
    role: input.role,
    required: input.required ?? false,
    reason: "Phase 4 authority fixture",
    trace: ["immutable-analysis-snapshot", `role:${input.role}`],
    status: "ACTIVE" as const,
    createdAt,
  };
}

function matching(input: {
  storyId?: string;
  storyVersionId?: string;
  requirements?: Record<string, boolean>;
  bindings?: ReturnType<typeof binding>[];
  missingRequirements?: string[];
  confirmedNoAssets?: boolean;
  characterDna?: boolean;
  audioIntent?:
    | "NATIVE_DIALOGUE"
    | "NARRATION"
    | "POST_TTS"
    | "SILENT"
    | "SOURCE_AUDIO_PRESERVE"
    | "SOURCE_AUDIO_REPLACE";
} = {}) {
  const storyId = input.storyId ?? id(3);
  const storyVersionId = input.storyVersionId ?? id(4);
  const bindings = input.bindings ?? [];
  const noAssetConfirmation = input.confirmedNoAssets
    ? {
        storyId,
        storyVersionId,
        confirmedBy: id(50),
        confirmedAt: createdAt,
        authorityVersion: "no-asset-confirmation.v1",
      }
    : null;
  return AiStoryAssetMatchingResultSchema.parse({
    contractVersion: "ai-story-asset-matching.v1",
    matchingResultId: id(5),
    orgId: id(1),
    workspaceId: id(2),
    storyId,
    storyVersionId,
    storyVersionNumber: 1,
    requirements: input.requirements ?? {},
    bindings,
    satisfiedRequirements: [],
    missingRequirements: input.missingRequirements ?? [],
    assetRecommendationStatus:
      input.missingRequirements?.length
        ? noAssetConfirmation
          ? "CONFIRMED_NO_ASSETS"
          : "ASSET_RECOMMENDATION_REQUIRED"
        : "SATISFIED",
    recommendedUploadRoles: [],
    audioIntent: input.audioIntent ?? "SILENT",
    characterDnaAuthority: input.characterDna
      ? {
          reusableCharacterId: id(60),
          reusableCharacterVersionId: id(61),
          characterDnaFingerprint: hash("d"),
        }
      : null,
    noAssetConfirmation,
    trace: [
      {
        step: "CERTIFIED_PHASE_3_RESULT",
        outcome: "VALIDATED",
        assetIds: bindings.map((item) => item.assetId),
      },
    ],
    matcherVersion: "story-asset-matcher.v1",
    createdAt,
  });
}

function resolve(input: {
  matchingResult?: ReturnType<typeof matching>;
  assetIntelligenceStatus?: "ANALYZED" | "NO_ASSETS" | "ANALYSIS_FAILED";
  exactSourceFrameRequired?: boolean;
  motionContinuationRequired?: boolean;
  sourceVideoAuthorityRequired?: boolean;
  sourceAuthoritySelection?: {
    imageBindingId?: string | null;
    videoBindingId?: string | null;
  };
} = {}) {
  const matchingResult = input.matchingResult ?? matching();
  return resolveAiStoryGenerationMode({
    plannerSnapshotId: id(6),
    orgId: id(1),
    workspaceId: id(2),
    storyId: matchingResult.storyId,
    storyVersionId: matchingResult.storyVersionId,
    matchingResult,
    assetIntelligenceStatus:
      input.assetIntelligenceStatus ?? "ANALYZED",
    continuityRequirements: {
      exactSourceFrameRequired:
        input.exactSourceFrameRequired ?? false,
      motionContinuationRequired:
        input.motionContinuationRequired ?? false,
      sourceVideoAuthorityRequired:
        input.sourceVideoAuthorityRequired ?? false,
    },
    sourceAuthoritySelection: input.sourceAuthoritySelection,
    resolverVersion: "deterministic-mode-resolver.v1",
    createdAt,
  });
}

describe("deterministic capability and generation-mode resolution", () => {
  it("returns NO_VALID_MODE when no Assets exist without confirmation", () => {
    const result = resolve({ assetIntelligenceStatus: "NO_ASSETS" });
    expect(result.resolutionStatus).toBe("NO_VALID_MODE");
    expect(result.resolvedGenerationMode).toBeNull();
    expect(result.blockingReasons.join(" ")).toContain(
      "CONFIRMED_NO_ASSETS"
    );
  });

  it("resolves T2V after explicit no-Asset confirmation", () => {
    const result = resolve({
      matchingResult: matching({ confirmedNoAssets: true }),
      assetIntelligenceStatus: "NO_ASSETS",
    });
    expect(result.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
  });

  it("allows Character DNA-only T2V with no-Asset confirmation", () => {
    const result = resolve({
      matchingResult: matching({
        confirmedNoAssets: true,
        characterDna: true,
        requirements: { characterIdentityRequired: true },
      }),
      assetIntelligenceStatus: "NO_ASSETS",
    });
    expect(result.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
    expect(result.capabilityRequirements.authority).toContain(
      "NEED_CHARACTER_DNA"
    );
  });

  it("does not force I2V for supporting Product authority", () => {
    const result = resolve({
      matchingResult: matching({
        requirements: { productIdentityRequired: true },
        bindings: [binding({ role: "PRODUCT_AUTHORITY" })],
      }),
    });
    expect(result.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
    expect(result.resolutionTrace[2]?.outcome).toContain(
      "supporting authorities"
    );
  });

  it("resolves I2V only from required exact source-image authority", () => {
    const result = resolve({
      matchingResult: matching({
        bindings: [
          binding({ role: "SOURCE_IMAGE_CANDIDATE", required: true }),
        ],
      }),
    });
    expect(result.resolvedGenerationMode).toBe("IMAGE_TO_VIDEO");
    expect(result.selectedBindingIds).toEqual([id(20)]);
    expect(result.capabilityRequirements.authority).toContain(
      "NEED_EXACT_SOURCE_FRAME"
    );
  });

  it("blocks when exact source image is required but missing", () => {
    const result = resolve({
      matchingResult: matching({ confirmedNoAssets: true }),
      exactSourceFrameRequired: true,
    });
    expect(result.resolutionStatus).toBe("NO_VALID_MODE");
    expect(result.missingAuthorities).toContain("EXACT_SOURCE_FRAME");
  });

  it("ignores an unrelated source video instead of forcing V2V", () => {
    const result = resolve({
      matchingResult: matching({
        confirmedNoAssets: true,
        bindings: [binding({ role: "UNUSED" })],
      }),
    });
    expect(result.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
  });

  it("resolves V2V for motion continuation with bound video authority", () => {
    const result = resolve({
      matchingResult: matching({
        requirements: { sourceMotionRequired: true },
        bindings: [
          binding({ role: "SOURCE_VIDEO_CANDIDATE", required: true }),
        ],
      }),
      motionContinuationRequired: true,
    });
    expect(result.resolvedGenerationMode).toBe("VIDEO_TO_VIDEO");
    expect(result.capabilityRequirements.visual).toContain(
      "NEED_MOTION_CONTINUATION"
    );
  });

  it("blocks motion continuation without source-video authority", () => {
    const result = resolve({
      matchingResult: matching({
        requirements: { sourceMotionRequired: true },
        missingRequirements: ["SOURCE_MOTION"],
      }),
      motionContinuationRequired: true,
    });
    expect(result.resolutionStatus).toBe("NO_VALID_MODE");
    expect(result.missingAuthorities).toContain("SOURCE_VIDEO_AUTHORITY");
  });

  it("allows Character DNA with required source image as I2V", () => {
    const result = resolve({
      matchingResult: matching({
        characterDna: true,
        bindings: [binding({ role: "SOURCE_IMAGE_CANDIDATE" })],
      }),
      exactSourceFrameRequired: true,
    });
    expect(result.resolvedGenerationMode).toBe("IMAGE_TO_VIDEO");
  });

  it("allows Character DNA with required source video as V2V", () => {
    const result = resolve({
      matchingResult: matching({
        characterDna: true,
        bindings: [binding({ role: "SOURCE_VIDEO_CANDIDATE" })],
      }),
      sourceVideoAuthorityRequired: true,
    });
    expect(result.resolvedGenerationMode).toBe("VIDEO_TO_VIDEO");
  });

  it("can resolve the same Asset differently for different Story intent", () => {
    const productAuthority = binding({ role: "PRODUCT_AUTHORITY" });
    const imageAuthority = {
      ...productAuthority,
      role: "SOURCE_IMAGE_CANDIDATE" as const,
    };
    const t2v = resolve({
      matchingResult: matching({ bindings: [productAuthority] }),
    });
    const i2v = resolve({
      matchingResult: matching({ bindings: [imageAuthority] }),
      exactSourceFrameRequired: true,
    });
    expect(productAuthority.assetId).toBe(imageAuthority.assetId);
    expect(productAuthority.analysisSnapshotId).toBe(
      imageAuthority.analysisSnapshotId
    );
    expect([t2v.resolvedGenerationMode, i2v.resolvedGenerationMode]).toEqual([
      "TEXT_TO_VIDEO",
      "IMAGE_TO_VIDEO",
    ]);
  });

  it("has no analyzer, raw-media, or semantic-model call boundary", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/shared/src/ai-story-capability-mode-resolution.ts"
      ),
      "utf8"
    );
    expect(source).not.toContain("AssetAnalysisService");
    expect(source).not.toContain("loadRawBytes");
    expect(source).not.toContain("storageRef");
    expect(source).not.toContain("generateObject");
    expect(source).not.toContain("generateText");
  });

  it("maps audio intent to Provider-neutral capability requirements", () => {
    const result = resolve({
      matchingResult: matching({
        confirmedNoAssets: true,
        audioIntent: "POST_TTS",
      }),
      assetIntelligenceStatus: "NO_ASSETS",
    });
    expect(result.capabilityRequirements.audio).toEqual(["NEED_POST_TTS"]);
    expect(result).not.toHaveProperty("generateAudio");
    expect(result).not.toHaveProperty("blockedCapabilities");
    expect(result).not.toHaveProperty("providerId");
  });

  it("does not allow analyzer failure to enable T2V", () => {
    const result = resolve({
      matchingResult: matching({ confirmedNoAssets: true }),
      assetIntelligenceStatus: "ANALYSIS_FAILED",
    });
    expect(result.resolutionStatus).toBe("NO_VALID_MODE");
    expect(result.blockingReasons.join(" ")).toContain(
      "cannot authorize reference-free execution"
    );
  });

  it("does not let an unrelated optional Asset affect mode", () => {
    const result = resolve({
      matchingResult: matching({
        confirmedNoAssets: true,
        bindings: [binding({ role: "UNUSED", required: false })],
      }),
    });
    expect(result.resolvedGenerationMode).toBe("TEXT_TO_VIDEO");
    expect(result.selectedBindingIds).toEqual([]);
  });

  it("rejects cross-Workspace binding authority", () => {
    const crossWorkspace = matching({
      bindings: [
        binding({ role: "PRODUCT_AUTHORITY", workspaceId: id(99) }),
      ],
    });
    expect(() => resolve({ matchingResult: crossWorkspace })).toThrowError(
      AiStoryModeResolutionError
    );
  });

  it("returns an auditable NO_VALID_MODE for conflicting source authority", () => {
    const result = resolve({
      matchingResult: matching({
        bindings: [
          binding({ role: "SOURCE_IMAGE_CANDIDATE", bindingId: id(20) }),
          binding({ role: "SOURCE_VIDEO_CANDIDATE", bindingId: id(21) }),
        ],
      }),
      exactSourceFrameRequired: true,
      sourceVideoAuthorityRequired: true,
    });
    expect(result.resolutionStatus).toBe("NO_VALID_MODE");
    expect(result.blockingReasons.join(" ")).toContain("conflict");
    expect(result.recommendedNextActions).toContain(
      "Choose one required source execution authority"
    );
  });

  it("pins immutable upstream authority in the mode Snapshot", () => {
    const result = resolve({
      matchingResult: matching({
        bindings: [binding({ role: "SOURCE_IMAGE_CANDIDATE" })],
      }),
      exactSourceFrameRequired: true,
    });
    expect(result).toMatchObject({
      matchingResultId: id(5),
      storyVersionId: id(4),
      bindingAuthorities: [
        {
          bindingId: id(20),
          analysisSnapshotId: id(40),
          contentHash: hash("a"),
        },
      ],
      resolverVersion: "deterministic-mode-resolver.v1",
    });
  });
});
