import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_STORY_ENTITY_PRESENCE_DETERMINES_GENERATION_MODE,
  AI_STORY_GENERATION_UNIT_CONTRACT_VERSION,
  AI_STORY_GENERATION_UNIT_TYPES,
  AI_STORY_RETRY_PROVIDER_MODES,
  AI_STORY_SCENE_EXECUTION_MODES,
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  AiStoryGenerationUnitSchema,
  AiStorySceneGenerationAuthoritySchema,
  SceneAttemptInputRevisionFactSchema,
} from "@ceo-agent/shared";
import {
  AI_STORY_PROVIDER_NEUTRAL_EXECUTION_MODES,
  AI_STORY_V2V_ADDITIONAL_REFERENCE_VIDEOS,
  AI_STORY_V2V_AUDIO_AUTHORITY,
  AI_STORY_V2V_BIOMETRIC_IDENTITY,
  AI_STORY_V2V_CONTRACT_PRODUCTION_MUTATION,
  AI_STORY_V2V_CONTRACT_PROVIDER_CALLS,
  AI_STORY_V2V_CONTRACT_PROVIDER_COST_USD,
  AI_STORY_V2V_CONTINUITY_REFERENCE_IS_WIRE_SOURCE,
  AI_STORY_V2V_CONTINUITY_ROLE,
  AI_STORY_V2V_EDITORIAL_SOURCE_KIND,
  AI_STORY_V2V_EXISTING_VIDEO_DISPATCHES_PROVIDER,
  AI_STORY_V2V_EXISTING_VIDEO_SEMANTICS,
  AI_STORY_V2V_FACE_RECOGNITION,
  AI_STORY_V2V_NATIVE_DIALOGUE,
  AI_STORY_V2V_PROVIDER_OUTPUT_AUDIO_AUTHORITY,
  AI_STORY_V2V_PROVIDER_SOURCE_ROLE,
  AI_STORY_V2V_RETRY,
  AI_STORY_V2V_SOURCE_PERSON_IDENTITY,
  AI_STORY_V2V_SOURCE_VIDEO_COUNT,
  AiStoryV2vContractError,
  AiStoryV2vCostEstimateInputSchema,
  acceptedV2vResultAsAssemblySource,
  assertOutputDurationFollowsSource,
  bindV2vExecutionToProviderVideoUnit,
  continuityReferenceIsProviderWire,
  resolveExplicitProviderNeutralExecutionMode,
} from "@ceo-agent/shared";
import {
  assertAiStoryV2vExecutionAuthorityImmutable,
  freezeAiStoryV2vExecutionAuthority,
} from "@ceo-agent/shared/server";

const id = (n: number) => `b2000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"ab".repeat(32)}`;
const otherHash = `sha256:${"cd".repeat(32)}`;

function source(overrides?: Record<string, unknown>) {
  return {
    sourceVideoAssetId: id(1),
    sourceVideoContentHash: hash,
    durationMs: 4000,
    durationSec: 4,
    width: 720,
    height: 1280,
    fps: 24,
    hasAudio: true,
    orgId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    sourcePurpose: "MOTION_PLATE" as const,
    sourceVideoCount: 1 as const,
    permissionAuthority: "USER_CONFIRMED_AUTHORIZED_USE" as const,
    permissionStatement: "I confirm I have permission to use this video." as const,
    frozenAt: "2026-09-23T00:00:00.000Z",
    ...overrides,
  };
}

function authorityInput(overrides?: Record<string, unknown>) {
  return {
    contractVersion: "ai-story-v2v-execution.v1" as const,
    executionMode: "VIDEO_TO_VIDEO" as const,
    generationUnitId: id(10),
    unitType: "PROVIDER_VIDEO" as const,
    providerSourceRole: "PROVIDER_SOURCE_VIDEO" as const,
    sourceVideo: source(),
    targetCharacter: {
      targetClass: "SYNTHETIC_REUSABLE_CHARACTER" as const,
      reusableCharacterId: id(20),
      reusableCharacterVersionId: id(21),
      identityFingerprint: otherHash,
    },
    transformationIntent: "KEEP_SOURCE_MOTION_CHANGE_CHARACTER" as const,
    durationRelationship: "OUTPUT_DURATION_FOLLOWS_SOURCE" as const,
    outputDurationMs: 4000,
    audioAuthority: "SOURCE_AUDIO_REMOVED" as const,
    sourceHasAudio: true,
    providerOutputAudioAuthority: "NONE" as const,
    additionalReferenceVideoCount: 0 as const,
    referenceImageSemantics: "NOT_CERTIFIED" as const,
    commercialAuthorizationId: id(30),
    authorizedAt: "2026-09-23T00:00:01.000Z",
    ...overrides,
  };
}

describe("AI Story V2V contract freeze", () => {
  it("requires an explicit VIDEO_TO_VIDEO mode and ignores source-media presence", () => {
    expect(AI_STORY_ENTITY_PRESENCE_DETERMINES_GENERATION_MODE).toBe(false);
    expect(AI_STORY_PROVIDER_NEUTRAL_EXECUTION_MODES).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "VIDEO_TO_VIDEO",
    ]);
    expect(() => resolveExplicitProviderNeutralExecutionMode({ sourceVideoPresent: true })).toThrow(
      AiStoryV2vContractError,
    );
    expect(resolveExplicitProviderNeutralExecutionMode({
      explicitMode: "TEXT_TO_VIDEO",
      sourceVideoPresent: true,
    })).toBe("TEXT_TO_VIDEO");
    expect(resolveExplicitProviderNeutralExecutionMode({ explicitMode: "VIDEO_TO_VIDEO" })).toBe(
      "VIDEO_TO_VIDEO",
    );
  });

  it("freezes exactly one source video, including fps and audio presence", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(frozen.sourceVideo.sourceVideoCount).toBe(AI_STORY_V2V_SOURCE_VIDEO_COUNT);
    expect(frozen.sourceVideo.sourceVideoContentHash).toBe(hash);
    expect(frozen.sourceVideo.durationMs).toBe(4000);
    expect(frozen.sourceVideo.width).toBe(720);
    expect(frozen.sourceVideo.height).toBe(1280);
    expect(frozen.sourceVideo.fps).toBe(24);
    expect(frozen.sourceVideo.hasAudio).toBe(true);
    expect(frozen.fingerprint.startsWith("sha256:")).toBe(true);
    expect(freezeAiStoryV2vExecutionAuthority(authorityInput()).fingerprint).toBe(frozen.fingerprint);
    expect(() => freezeAiStoryV2vExecutionAuthority(authorityInput({
      sourceVideo: source({ sourceVideoCount: 2 }),
    }))).toThrow();
  });

  it("keeps PROVIDER_SOURCE_VIDEO distinct from continuity lineage", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(frozen.providerSourceRole).toBe(AI_STORY_V2V_PROVIDER_SOURCE_ROLE);
    expect(AI_STORY_V2V_CONTINUITY_ROLE).toBe("STORY_CONTINUITY_REFERENCE");
    expect(AI_STORY_V2V_CONTINUITY_REFERENCE_IS_WIRE_SOURCE).toBe(false);
    expect(continuityReferenceIsProviderWire("PROVIDER_SOURCE_VIDEO")).toBe(true);
    expect(continuityReferenceIsProviderWire("STORY_CONTINUITY_REFERENCE")).toBe(false);
    expect(AI_STORY_V2V_ADDITIONAL_REFERENCE_VIDEOS).toBe("NOT_CERTIFIED");
  });

  it("binds V2V only to PROVIDER_VIDEO and leaves EXISTING_VIDEO non-generative", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(AI_STORY_GENERATION_UNIT_TYPES).toContain("EXISTING_VIDEO");
    expect(AI_STORY_V2V_EXISTING_VIDEO_SEMANTICS).toBe("NON_GENERATIVE_EXISTING_MEDIA");
    expect(AI_STORY_V2V_EXISTING_VIDEO_DISPATCHES_PROVIDER).toBe(false);
    const bound = bindV2vExecutionToProviderVideoUnit(
      { unitType: "PROVIDER_VIDEO", generationUnitId: id(10) },
      frozen,
    );
    expect(bound.v2vExecutionFingerprint).toBe(frozen.fingerprint);
    expect(() => bindV2vExecutionToProviderVideoUnit(
      { unitType: "EXISTING_VIDEO", generationUnitId: id(10) },
      frozen,
    )).toThrow(/EXISTING_VIDEO/);
    const inner = (AiStoryGenerationUnitSchema._def as {
      schema: { shape: { v2vExecutionFingerprint: { isOptional: () => boolean } } };
    }).schema;
    expect(inner.shape.v2vExecutionFingerprint.isOptional()).toBe(true);
  });

  it("freezes a synthetic reusable Character version separately from the source plate", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(frozen.targetCharacter.targetClass).toBe("SYNTHETIC_REUSABLE_CHARACTER");
    expect(frozen.targetCharacter.reusableCharacterVersionId).toBe(id(21));
    expect(frozen.targetCharacter.identityFingerprint).toBe(otherHash);
    expect(AI_STORY_V2V_SOURCE_PERSON_IDENTITY).toBe("NOT_RECORDED");
    expect(AI_STORY_V2V_BIOMETRIC_IDENTITY).toBe("NONE");
    expect(AI_STORY_V2V_FACE_RECOGNITION).toBe("NONE");
    expect("sourcePersonId" in frozen.sourceVideo).toBe(false);
    expect(() => freezeAiStoryV2vExecutionAuthority(authorityInput({
      targetCharacter: {
        targetClass: "SYNTHETIC_REUSABLE_CHARACTER",
        reusableCharacterId: id(1),
        reusableCharacterVersionId: id(21),
        identityFingerprint: otherHash,
      },
    }))).toThrow(/separate/);
  });

  it("removes source audio from output authority and follows source duration", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(frozen.audioAuthority).toBe(AI_STORY_V2V_AUDIO_AUTHORITY);
    expect(frozen.sourceHasAudio).toBe(true);
    expect(frozen.providerOutputAudioAuthority).toBe(AI_STORY_V2V_PROVIDER_OUTPUT_AUDIO_AUTHORITY);
    expect(AI_STORY_V2V_NATIVE_DIALOGUE).toBe("NOT_CERTIFIED");
    expect(assertOutputDurationFollowsSource(4000, 4000)).toBe(4000);
    expect(() => assertOutputDurationFollowsSource(4000, 3000)).toThrow(/derived source/);
    expect(() => freezeAiStoryV2vExecutionAuthority(authorityInput({ outputDurationMs: 3000 }))).toThrow();
  });

  it("leaves first-frame retry contracts unchanged and does not certify V2V retry", () => {
    expect(AI_STORY_V2V_RETRY).toBe("NOT_CERTIFIED");
    expect(AI_STORY_RETRY_PROVIDER_MODES).toEqual(["REFERENCE_FREE_T2V", "FIRST_FRAME_I2V"]);
    const retry = readFileSync("packages/shared/src/ai-story-differentiated-retry.ts", "utf8");
    const postTerminal = readFileSync("packages/shared/src/ai-story-post-terminal-provider-retry.ts", "utf8");
    expect(retry).toContain('z.literal("FIRST_FRAME_I2V")');
    expect(retry).not.toContain("VIDEO_TO_VIDEO");
    expect(postTerminal).not.toContain("VIDEO_TO_VIDEO");
    expect(SceneAttemptInputRevisionFactSchema.safeParse({
      providerModeRequirement: "VIDEO_TO_VIDEO",
    }).success).toBe(false);
  });

  it("keeps prior T2V and I2V contracts valid and the domain free of vendor fields", () => {
    expect(AI_STORY_SCENE_EXECUTION_MODES).toEqual(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]);
    expect(AI_STORY_SCENE_GENERATION_STRATEGIES).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(AI_STORY_GENERATION_UNIT_CONTRACT_VERSION).toBe("ai-story-generation-unit.v1");
    expect(AiStorySceneGenerationAuthoritySchema.safeParse({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
      referenceAssetIds: [],
      firstFrameAssetId: null,
      productVisualIdentityRequirement: "NONE",
    }).success).toBe(true);
    const domain = readFileSync("packages/shared/src/ai-story-v2v-execution.ts", "utf8");
    const server = readFileSync("packages/shared/src/ai-story-v2v-execution.server.ts", "utf8");
    for (const token of ["runway", "aleph", "seedance", "gemini", "veo", "fetch("]) {
      expect(domain.toLowerCase()).not.toContain(token);
      expect(server.toLowerCase()).not.toContain(token);
    }
    expect(AiStoryV2vCostEstimateInputSchema.safeParse({
      providerId: "provider",
      modelId: "model",
      sourceDurationMs: 4000,
      outputDurationMs: 4000,
      resolution: "720p",
      referenceCount: 0,
      alephModel: "aleph2",
    }).success).toBe(false);
  });

  it("accepts a V2V result as ordinary generated media for editorial and assembly", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    expect(AI_STORY_V2V_EDITORIAL_SOURCE_KIND).toBe("GENERATED_VIDEO");
    const assembly = acceptedV2vResultAsAssemblySource({
      sourceResultId: id(40),
      generationUnitId: frozen.generationUnitId,
      directorShotId: id(41),
      sourceUri: "https://media.example/result.mp4",
      contentHash: hash,
      durationMs: frozen.outputDurationMs,
      width: frozen.sourceVideo.width,
      height: frozen.sourceVideo.height,
      frameRate: frozen.sourceVideo.fps,
    });
    expect(assembly.acceptanceStatus).toBe("ACCEPTED");
    expect(assembly.nativeAvMode).toBe("VIDEO_ONLY");
    expect(assembly.hasAudio).toBe(false);
    const assemblySource = readFileSync("packages/shared/src/ai-story-assembly-v2.ts", "utf8");
    const nativeDialogue = readFileSync("packages/shared/src/ai-story-native-dialogue.ts", "utf8");
    expect(assemblySource).not.toContain("VIDEO_TO_VIDEO");
    expect(nativeDialogue).not.toContain("VIDEO_TO_VIDEO");
  });

  it("is immutable after commercial authorization and performs no Provider or production work", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
    assertAiStoryV2vExecutionAuthorityImmutable(frozen, frozen);
    const changed = freezeAiStoryV2vExecutionAuthority(authorityInput({
      sourceVideo: source({ fps: 30 }),
    }));
    expect(() => assertAiStoryV2vExecutionAuthorityImmutable(frozen, changed)).toThrow(
      /immutable/,
    );
    expect(AI_STORY_V2V_CONTRACT_PROVIDER_CALLS).toBe(0);
    expect(AI_STORY_V2V_CONTRACT_PROVIDER_COST_USD).toBe(0);
    expect(AI_STORY_V2V_CONTRACT_PRODUCTION_MUTATION).toBe(0);
  });
});
