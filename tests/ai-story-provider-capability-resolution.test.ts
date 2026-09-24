import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AiStoryModeResolutionSnapshotSchema,
  type AiStoryModeResolutionSnapshot,
} from "@ceo-agent/shared";
import {
  ProviderCapabilityResolutionError,
  assertProviderCompileIntentConsistency,
  buildCertifiedSeedanceProviderEntry,
  compileSeedanceProviderIntentDryRun,
  resolveAiStoryProvider,
} from "@ceo-agent/agents";

const id = (value: number) =>
  `e5000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
const hash = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}`;
const createdAt = "2026-09-24T03:00:00.000Z";

type Mode = "TEXT_TO_VIDEO" | "IMAGE_TO_VIDEO" | "VIDEO_TO_VIDEO";
type Audio =
  | "NEED_NATIVE_DIALOGUE"
  | "NEED_NARRATION"
  | "NEED_POST_TTS"
  | "NEED_SOURCE_AUDIO_PRESERVE"
  | "NEED_SOURCE_AUDIO_REPLACE"
  | "NEED_SILENT_OUTPUT";

function planner(input: {
  mode?: Mode;
  audio?: Audio;
  characterDna?: boolean;
  supportingProduct?: boolean;
} = {}): AiStoryModeResolutionSnapshot {
  const mode = input.mode ?? "TEXT_TO_VIDEO";
  const sourceBinding =
    mode === "IMAGE_TO_VIDEO"
      ? {
          bindingId: id(20),
          assetId: id(21),
          analysisSnapshotId: id(22),
          contentHash: hash("a"),
          role: "SOURCE_IMAGE_CANDIDATE" as const,
          required: true,
        }
      : mode === "VIDEO_TO_VIDEO"
        ? {
            bindingId: id(20),
            assetId: id(21),
            analysisSnapshotId: id(22),
            contentHash: hash("a"),
            role: "SOURCE_VIDEO_CANDIDATE" as const,
            required: true,
          }
        : null;
  const productBinding = input.supportingProduct
    ? {
        bindingId: id(30),
        assetId: id(31),
        analysisSnapshotId: id(32),
        contentHash: hash("b"),
        role: "PRODUCT_AUTHORITY" as const,
        required: false,
      }
    : null;
  const visual =
    mode === "TEXT_TO_VIDEO"
      ? (["NEED_TEXT_GENERATION"] as const)
      : mode === "IMAGE_TO_VIDEO"
        ? (["NEED_SOURCE_IMAGE"] as const)
        : (["NEED_SOURCE_VIDEO", "NEED_MOTION_CONTINUATION"] as const);
  const authority =
    mode === "IMAGE_TO_VIDEO"
      ? (["NEED_EXACT_SOURCE_FRAME"] as const)
      : mode === "VIDEO_TO_VIDEO"
        ? (["NEED_SOURCE_VIDEO_AUTHORITY"] as const)
        : [];
  return AiStoryModeResolutionSnapshotSchema.parse({
    contractVersion: "ai-story-mode-resolution.v1",
    plannerSnapshotId: id(1),
    orgId: id(2),
    workspaceId: id(3),
    storyId: id(4),
    storyVersionId: id(5),
    matchingResultId: id(6),
    matchingContractVersion: "ai-story-asset-matching.v1",
    bindingAuthorities: [sourceBinding, productBinding].filter(Boolean),
    characterDnaAuthority: input.characterDna
      ? {
          reusableCharacterId: id(40),
          reusableCharacterVersionId: id(41),
          characterDnaFingerprint: hash("d"),
        }
      : null,
    noAssetConfirmation: null,
    assetIntelligenceStatus: "ANALYZED",
    continuityRequirements: {
      exactSourceFrameRequired: mode === "IMAGE_TO_VIDEO",
      motionContinuationRequired: mode === "VIDEO_TO_VIDEO",
      sourceVideoAuthorityRequired: mode === "VIDEO_TO_VIDEO",
    },
    audioIntent:
      input.audio === "NEED_NATIVE_DIALOGUE"
        ? "NATIVE_DIALOGUE"
        : input.audio === "NEED_POST_TTS"
          ? "POST_TTS"
          : input.audio === "NEED_NARRATION"
            ? "NARRATION"
            : input.audio === "NEED_SOURCE_AUDIO_PRESERVE"
              ? "SOURCE_AUDIO_PRESERVE"
              : input.audio === "NEED_SOURCE_AUDIO_REPLACE"
                ? "SOURCE_AUDIO_REPLACE"
                : "SILENT",
    capabilityRequirements: {
      visual,
      audio: [input.audio ?? "NEED_SILENT_OUTPUT"],
      authority: [
        ...authority,
        ...(input.characterDna ? (["NEED_CHARACTER_DNA"] as const) : []),
        ...(input.supportingProduct
          ? (["NEED_PRODUCT_AUTHORITY"] as const)
          : []),
      ],
    },
    resolutionStatus: "RESOLVED",
    resolvedGenerationMode: mode,
    selectedBindingIds: sourceBinding ? [sourceBinding.bindingId] : [],
    blockingReasons: [],
    missingAuthorities: [],
    recommendedNextActions: [],
    resolutionTrace: [
      {
        step: "RESOLVE_GENERATION_MODE",
        outcome: mode,
        bindingIds: sourceBinding ? [sourceBinding.bindingId] : [],
      },
    ],
    resolverVersion: "deterministic-mode-resolver.v1",
    createdAt,
  });
}

function registry(configured = true) {
  return buildCertifiedSeedanceProviderEntry({ configured });
}

function providerResolution(
  plan: AiStoryModeResolutionSnapshot,
  entries = [registry()]
) {
  return resolveAiStoryProvider({
    providerResolutionId: id(7),
    plannerSnapshot: plan,
    registry: entries,
    executionSettings: {
      durationSec: 8,
      aspectRatio: "9:16",
      resolution: "480p",
      watermark: false,
    },
    resolvedAt: createdAt,
  });
}

function sourceAuthority(workspaceId = id(3)) {
  return {
    orgId: id(2),
    workspaceId,
    bindingId: id(20),
    assetId: id(21),
    analysisSnapshotId: id(22),
    contentHash: hash("a"),
    mediaType: "image/png",
    authorizedForProviderTransport: true as const,
  };
}

function compile(
  plan: AiStoryModeResolutionSnapshot,
  options: {
    sourceAuthorities?: ReturnType<typeof sourceAuthority>[];
    nativeDialogue?: boolean;
  } = {}
) {
  const entry = registry();
  return compileSeedanceProviderIntentDryRun({
    compileIntentId: id(8),
    plannerSnapshot: plan,
    providerResolution: providerResolution(plan, [entry]),
    registryEntry: entry,
    sourceAuthorities: options.sourceAuthorities,
    nativeDialogueAuthority: options.nativeDialogue
      ? {
          dialogueAuthorityId: id(50),
          storyId: id(4),
          storyVersionId: id(5),
          exactText: "These flowers look lovely today.",
        }
      : null,
    compiledAt: createdAt,
  });
}

describe("Provider Capability Registry and deterministic resolution", () => {
  it("compiles T2V silent output without native audio", () => {
    const intent = compile(planner());
    expect(intent.generationMode).toBe("TEXT_TO_VIDEO");
    expect(intent.generateAudio).toBe(false);
    expect(intent.blockedCapabilities).toContain("AUDIO");
  });

  it("compiles T2V native dialogue with AUDIO enabled", () => {
    const intent = compile(
      planner({ audio: "NEED_NATIVE_DIALOGUE" }),
      { nativeDialogue: true }
    );
    expect(intent.generateAudio).toBe(true);
    expect(intent.blockedCapabilities).not.toContain("AUDIO");
    expect(intent.requestFacts.mappingVersion).toBe(
      "seedance-director-adapter.v2-native-av"
    );
  });

  it("maps POST_TTS to video-only generation", () => {
    const intent = compile(planner({ audio: "NEED_POST_TTS" }));
    expect(intent.audioBehavior).toBe("POST_TTS");
    expect(intent.generateAudio).toBe(false);
    expect(intent.blockedCapabilities).toContain("AUDIO");
  });

  it("preserves exact I2V source authority", () => {
    const intent = compile(planner({ mode: "IMAGE_TO_VIDEO" }), {
      sourceAuthorities: [sourceAuthority()],
    });
    expect(intent.providerGenerationMode).toBe(
      "FIRST_FRAME_IMAGE_TO_VIDEO"
    );
    expect(intent.referenceMappings).toEqual([
      {
        bindingId: id(20),
        assetId: id(21),
        analysisSnapshotId: id(22),
        contentHash: hash("a"),
        mediaType: "image/png",
        wireRole: "first_frame",
      },
    ]);
  });

  it("rejects V2V because EmberOS Seedance has no certified transport", () => {
    const result = providerResolution(planner({ mode: "VIDEO_TO_VIDEO" }));
    expect(result.status).toBe("NO_COMPATIBLE_PROVIDER");
    expect(result.rejectedCandidates[0]).toMatchObject({
      code: "MODE_UNSUPPORTED",
    });
    expect(result.unresolvedCapabilities).toContain("VIDEO_TO_VIDEO");
  });

  it("returns NO_COMPATIBLE_PROVIDER for unsupported capability", () => {
    const plan = planner();
    const incompatible = AiStoryModeResolutionSnapshotSchema.parse({
      ...plan,
      capabilityRequirements: {
        ...plan.capabilityRequirements,
        visual: [
          ...plan.capabilityRequirements.visual,
          "NEED_SOURCE_VIDEO",
        ],
      },
    });
    const result = providerResolution(incompatible);
    expect(result.status).toBe("NO_COMPATIBLE_PROVIDER");
    expect(result.unresolvedCapabilities).toContain("NEED_SOURCE_VIDEO");
  });

  it("rejects unsupported source-audio preserve without dropping it", () => {
    const result = providerResolution(
      planner({ audio: "NEED_SOURCE_AUDIO_PRESERVE" })
    );
    expect(result.status).toBe("NO_COMPATIBLE_PROVIDER");
    expect(result.unresolvedCapabilities).toContain(
      "NEED_SOURCE_AUDIO_PRESERVE"
    );
  });

  it("does not mutate T2V because of an optional Product image", () => {
    const plan = planner({ supportingProduct: true });
    const intent = compile(plan);
    expect(intent.generationMode).toBe("TEXT_TO_VIDEO");
    expect(intent.referenceMappings).toHaveLength(0);
    expect(intent.supportingAuthorityBindingIds).toContain(id(30));
  });

  it("preserves Character DNA without altering mode", () => {
    const intent = compile(planner({ characterDna: true }));
    expect(intent.generationMode).toBe("TEXT_TO_VIDEO");
    expect(intent.characterDnaAuthority).toEqual({
      reusableCharacterId: id(40),
      reusableCharacterVersionId: id(41),
      characterDnaFingerprint: hash("d"),
    });
    expect(intent.sourcePhotoSentToVideoProvider).toBe(false);
  });

  it("contains no LLM, raw-media analysis, or Provider call boundary", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "packages/agents/src/ai-story/provider-capability-resolution.ts"
      ),
      "utf8"
    );
    expect(source).not.toContain("generateText");
    expect(source).not.toContain("generateObject");
    expect(source).not.toContain("AssetAnalysisService");
    expect(source).not.toContain("loadRawBytes");
    expect(source).not.toContain("submit");
  });

  it("rejects cross-Workspace source substitution", () => {
    const plan = planner({ mode: "IMAGE_TO_VIDEO" });
    expect(() =>
      compile(plan, {
        sourceAuthorities: [sourceAuthority(id(99))],
      })
    ).toThrowError(ProviderCapabilityResolutionError);
  });

  it("rejects native dialogue with AUDIO blocked", () => {
    const valid = compile(
      planner({ audio: "NEED_NATIVE_DIALOGUE" }),
      { nativeDialogue: true }
    );
    expect(() =>
      assertProviderCompileIntentConsistency({
        ...valid,
        blockedCapabilities: [...valid.blockedCapabilities, "AUDIO"],
      })
    ).toThrow(/AUDIO blocked/);
  });

  it("rejects native dialogue with generateAudio=false", () => {
    const valid = compile(
      planner({ audio: "NEED_NATIVE_DIALOGUE" }),
      { nativeDialogue: true }
    );
    expect(() =>
      assertProviderCompileIntentConsistency({
        ...valid,
        generateAudio: false,
      })
    ).toThrow(/Native dialogue requires/);
  });

  it("rejects silent output with generated audio enabled", () => {
    const valid = compile(planner());
    expect(() =>
      assertProviderCompileIntentConsistency({
        ...valid,
        generateAudio: true,
        blockedCapabilities: valid.blockedCapabilities.filter(
          (capability) => capability !== "AUDIO"
        ),
      })
    ).toThrow(/Silent output/);
  });

  it("returns typed unavailability without probing the Provider", () => {
    const result = providerResolution(planner(), [registry(false)]);
    expect(result.status).toBe("PROVIDER_UNAVAILABLE");
    expect(result.rejectedCandidates[0]?.code).toBe(
      "PROVIDER_UNAVAILABLE"
    );
  });

  it("certifies the Episode B Character DNA native-dialogue class", () => {
    const plan = planner({
      characterDna: true,
      audio: "NEED_NATIVE_DIALOGUE",
    });
    const resolution = providerResolution(plan);
    const intent = compile(plan, { nativeDialogue: true });
    expect(resolution).toMatchObject({
      status: "SELECTED",
      selectedProviderId: "seedance",
    });
    expect(intent).toMatchObject({
      generationMode: "TEXT_TO_VIDEO",
      sourcePhotoSentToVideoProvider: false,
      syntheticAnchorSentToProvider: false,
      generateAudio: true,
      providerCallCount: 0,
    });
    expect(intent.referenceMappings).toHaveLength(0);
    expect(intent.blockedCapabilities).not.toContain("AUDIO");
    expect(intent.characterDnaAuthority?.characterDnaFingerprint).toBe(
      hash("d")
    );
  });
});
