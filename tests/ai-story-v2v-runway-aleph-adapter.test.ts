import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_STORY_GENERATION_UNIT_CONTRACT_VERSION,
  AI_STORY_RETRY_PROVIDER_MODES,
  AI_STORY_SCENE_EXECUTION_MODES,
  AI_STORY_SCENE_GENERATION_STRATEGIES,
  SceneAttemptInputRevisionFactSchema,
  acceptedV2vResultAsAssemblySource,
} from "@ceo-agent/shared";
import { freezeAiStoryV2vExecutionAuthority } from "@ceo-agent/shared/server";
import {
  RUNWAY_ALEPH_V2V_PROVIDER_CALLS,
  RUNWAY_ALEPH_V2V_PROVIDER_COST_USD,
  RUNWAY_ALEPH_V2V_SUBMITS,
  RunwayAlephV2vAdapterError,
  compileRunwayAlephV2vRequest,
  type RunwayAlephCharacterReference,
  type RunwayAlephSourceVideoDelivery,
} from "../packages/agents/src/ai-story/runway-aleph-v2v-adapter";

const id = (n: number) => `c3000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = `sha256:${"ab".repeat(32)}`;
const identityHash = `sha256:${"cd".repeat(32)}`;
const sourceUri = "https://media.example/motion-plate.mp4";
const anchorUri = "https://media.example/synthetic-anchor.png";
const portraitUri = "https://media.example/source-portrait.jpg";
const continuityUri = "https://media.example/continuity-reference.mp4";

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
      identityFingerprint: identityHash,
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

function delivery(overrides?: Partial<RunwayAlephSourceVideoDelivery>): RunwayAlephSourceVideoDelivery {
  return {
    role: "PROVIDER_SOURCE_VIDEO",
    videoUri: sourceUri,
    assetId: id(1),
    contentHash: hash,
    durationMs: 4000,
    durationSec: 4,
    width: 720,
    height: 1280,
    fps: 24,
    hasAudio: true,
    orgId: id(2),
    workspaceId: id(3),
    campaignId: id(4),
    permissionAuthority: "USER_CONFIRMED_AUTHORIZED_USE",
    ...overrides,
  };
}

function character(overrides?: Partial<RunwayAlephCharacterReference>): RunwayAlephCharacterReference {
  return {
    reusableCharacterId: id(20),
    reusableCharacterVersionId: id(21),
    identityFingerprint: identityHash,
    identityMode: "CHARACTER_DNA",
    characterConsistencyMode: "DNA_PLUS_SYNTHETIC_ANCHOR",
    canonicalAssets: [
      { assetId: id(23), role: "CHARACTER_SOURCE_PORTRAIT" },
      { assetId: id(22), role: "SYNTHETIC_IDENTITY_ANCHOR" },
    ],
    syntheticAnchor: { assetId: id(22), imageUri: anchorUri },
    identityText: "Approved synthetic character appearance.",
    sourcePortrait: { assetId: id(23), imageUri: portraitUri },
    sourcePhotoSentToVideoProvider: false,
    ...overrides,
  };
}

function compileFixture() {
  return compileRunwayAlephV2vRequest({
    authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
    sourceVideo: delivery(),
    character: character(),
    continuityReferences: [{
      role: "STORY_CONTINUITY_REFERENCE",
      videoUri: continuityUri,
      assetId: id(50),
    }],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Runway Aleph 2 VIDEO_TO_VIDEO adapter", () => {
  it("requires exact VIDEO_TO_VIDEO authority and does not degrade to T2V or I2V", () => {
    expect(() => compileRunwayAlephV2vRequest({
      authority: { ...authorityInput(), executionMode: "TEXT_TO_VIDEO" },
      sourceVideo: delivery(),
      character: character(),
    })).toThrow(RunwayAlephV2vAdapterError);
    expect(() => compileRunwayAlephV2vRequest({
      authority: { ...authorityInput(), executionMode: "FIRST_FRAME_IMAGE_TO_VIDEO" },
      sourceVideo: delivery(),
      character: character(),
    })).toThrow(/VIDEO_TO_VIDEO/);
    const compiled = compileFixture();
    expect(compiled.mode).toBe("VIDEO_TO_VIDEO");
    expect(compiled.provider).toBe("runway");
    expect(compiled.model).toBe("aleph2");
    expect(compiled.submitted).toBe(false);
    expect(compiled.body.model).toBe("aleph2");
  });

  it("accepts one source video only", () => {
    expect(compileFixture().sourceVideoCount).toBe(1);
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      sourceVideo: delivery(),
      additionalSourceVideos: [{ videoUri: "https://media.example/second.mp4" }],
      character: character(),
    })).toThrow(expect.objectContaining({ code: "PROVIDER_CAPABILITY_MISMATCH" }));
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      character: character(),
    })).toThrow(/PROVIDER_SOURCE_VIDEO/);
  });

  it("emits PROVIDER_SOURCE_VIDEO and keeps the frozen source facts", () => {
    const compiled = compileFixture();
    expect(compiled.providerSourceRole).toBe("PROVIDER_SOURCE_VIDEO");
    expect(compiled.body.videoUri).toBe(sourceUri);
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      sourceVideo: delivery({ contentHash: `sha256:${"ef".repeat(32)}` }),
      character: character(),
    })).toThrow(expect.objectContaining({ code: "V2V_SOURCE_AUTHORITY_MISMATCH" }));
  });

  it("does not emit STORY_CONTINUITY_REFERENCE on the Provider wire", () => {
    const compiled = compileFixture();
    expect(compiled.continuityReferencesEmitted).toBe(0);
    expect(JSON.stringify(compiled.body)).not.toContain(continuityUri);
    expect(JSON.stringify(compiled.body)).not.toContain("STORY_CONTINUITY_REFERENCE");
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      sourceVideo: delivery({ videoUri: continuityUri }),
      character: character(),
      continuityReferences: [{
        role: "STORY_CONTINUITY_REFERENCE",
        videoUri: continuityUri,
        assetId: id(50),
      }],
    })).toThrow(/continuity video cannot be used/);
  });

  it("never dispatches EXISTING_VIDEO", () => {
    expect(() => compileRunwayAlephV2vRequest({
      authority: { ...authorityInput(), unitType: "EXISTING_VIDEO" },
      sourceVideo: delivery(),
      character: character(),
    })).toThrow(expect.objectContaining({ code: "EXISTING_VIDEO_NON_GENERATIVE" }));
  });

  it("preserves the exact synthetic Character version", () => {
    const compiled = compileFixture();
    expect(compiled.reusableCharacterId).toBe(id(20));
    expect(compiled.reusableCharacterVersionId).toBe(id(21));
    expect(compiled.body.keyframes?.[0]?.uri).toBe(anchorUri);
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      sourceVideo: delivery(),
      character: character({ reusableCharacterVersionId: id(99) }),
    })).toThrow(expect.objectContaining({ code: "SYNTHETIC_CHARACTER_BINDING_MISMATCH" }));
  });

  it("excludes the original source portrait", () => {
    const compiled = compileFixture();
    expect(compiled.sourcePhotoSentToVideoProvider).toBe(false);
    expect(JSON.stringify(compiled)).not.toContain(portraitUri);
    expect(JSON.stringify(compiled.body)).not.toContain("CHARACTER_SOURCE_PORTRAIT");
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput()),
      sourceVideo: delivery(),
      character: character({
        syntheticAnchor: { assetId: id(23), imageUri: portraitUri },
      }),
    })).toThrow(expect.objectContaining({ code: "PROVIDER_CAPABILITY_MISMATCH" }));
  });

  it("respects SOURCE_AUDIO_REMOVED and does not request preserved source audio", () => {
    const compiled = compileFixture();
    expect(compiled.sourceAudioAuthority).toBe("SOURCE_AUDIO_REMOVED");
    expect(compiled.body).not.toHaveProperty("audio");
    expect(compiled.body).not.toHaveProperty("generateAudio");
    expect(compiled.body).not.toHaveProperty("preserveAudio");
    expect(() => compileRunwayAlephV2vRequest({
      authority: { ...authorityInput(), audioAuthority: "SOURCE_AUDIO_PRESERVED" },
      sourceVideo: delivery(),
      character: character(),
    })).toThrow(/preserved source audio/);
  });

  it("keeps output duration equal to the source and fails closed outside Aleph duration", () => {
    const compiled = compileFixture();
    expect(compiled.outputDurationFollowsSource).toBe(true);
    expect(compiled.outputDurationMs).toBe(4000);
    expect(compiled.body).not.toHaveProperty("duration");
    const longSource = source({ durationMs: 45000, durationSec: 45 });
    expect(() => compileRunwayAlephV2vRequest({
      authority: freezeAiStoryV2vExecutionAuthority(authorityInput({
        sourceVideo: longSource,
        outputDurationMs: 45000,
      })),
      sourceVideo: delivery({ durationMs: 45000, durationSec: 45 }),
      character: character(),
    })).toThrow(expect.objectContaining({ code: "PROVIDER_CAPABILITY_MISMATCH" }));
  });

  it("does not add a V2V retry", () => {
    expect(compileFixture().retry).toBe("NOT_CERTIFIED");
    expect(AI_STORY_RETRY_PROVIDER_MODES).toEqual(["REFERENCE_FREE_T2V", "FIRST_FRAME_I2V"]);
    const retry = readFileSync("packages/shared/src/ai-story-differentiated-retry.ts", "utf8");
    const postTerminal = readFileSync("packages/shared/src/ai-story-post-terminal-provider-retry.ts", "utf8");
    const adapter = readFileSync("packages/agents/src/ai-story/runway-aleph-v2v-adapter.ts", "utf8");
    expect(retry).toContain('z.literal("FIRST_FRAME_I2V")');
    expect(retry).not.toContain("VIDEO_TO_VIDEO");
    expect(postTerminal).not.toContain("VIDEO_TO_VIDEO");
    expect(adapter).not.toContain("differentiated-retry");
    expect(adapter).not.toContain("post-terminal-provider-retry");
    expect(SceneAttemptInputRevisionFactSchema.safeParse({
      providerModeRequirement: "VIDEO_TO_VIDEO",
    }).success).toBe(false);
  });

  it("leaves T2V and I2V behavior unchanged", () => {
    expect(AI_STORY_SCENE_EXECUTION_MODES).toEqual(["TEXT_TO_VIDEO", "FIRST_FRAME_IMAGE_TO_VIDEO"]);
    expect(AI_STORY_SCENE_GENERATION_STRATEGIES).toEqual([
      "TEXT_TO_VIDEO",
      "FIRST_FRAME_IMAGE_TO_VIDEO",
      "PRODUCT_GROUNDED_VIDEO",
    ]);
    expect(AI_STORY_GENERATION_UNIT_CONTRACT_VERSION).toBe("ai-story-generation-unit.v1");
    const seedance = readFileSync("packages/agents/src/ai-story/seedance-director-adapter.ts", "utf8");
    expect(seedance).not.toContain("aleph2");
    expect(seedance).not.toContain("VIDEO_TO_VIDEO");
    const domain = readFileSync("packages/shared/src/ai-story-v2v-execution.ts", "utf8");
    expect(domain.toLowerCase()).not.toContain("runway");
    expect(domain.toLowerCase()).not.toContain("aleph");
  });

  it("leaves Assembly V2 compatibility unchanged", () => {
    const frozen = freezeAiStoryV2vExecutionAuthority(authorityInput());
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
    expect(assemblySource).not.toContain("aleph2");
    expect(assemblySource).not.toContain("VIDEO_TO_VIDEO");
  });

  it("makes no external Provider call", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const compiled = compileFixture();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(compiled.providerCalls).toBe(0);
    expect(compiled.providerCostUsd).toBe(0);
    expect(RUNWAY_ALEPH_V2V_PROVIDER_CALLS).toBe(0);
    expect(RUNWAY_ALEPH_V2V_PROVIDER_COST_USD).toBe(0);
    expect(RUNWAY_ALEPH_V2V_SUBMITS).toBe(false);
    const adapter = readFileSync("packages/agents/src/ai-story/runway-aleph-v2v-adapter.ts", "utf8");
    expect(adapter).not.toContain("fetch(");
    expect(adapter).not.toContain("http.request");
    expect(compiled.endpoint).toBe("POST /v1/video_to_video");
    expect(compiled.transformationIntent).toBe("KEEP_SOURCE_MOTION_CHANGE_CHARACTER");
  });
});
