import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inspectAiStoryAudioQcMediaFacts } from "../packages/agents/src/ai-story/audio-qc-media-facts";
import {
  AiStoryPostGenerationQcService,
  FakeAiStoryVisualEvidenceProvider,
  InMemoryAiStoryPostGenerationQcRepository,
} from "../packages/agents/src/ai-story/post-generation-qc-service";
import {
  AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
  AI_STORY_POST_QC_POLICY_VERSION,
  AiStoryPostGenerationQcEvaluationSchema,
  type AiStoryAudioQcEvidence,
  type AiStoryAudioQcExpectation,
  type AiStoryPostQcRequirement,
} from "@ceo-agent/shared";
import {
  compileAiStoryAudioQcExpectation,
  evaluateAiStoryAudioQc,
  type AudioQcExpectationBuildInput,
} from "@ceo-agent/shared/server";

const id = (n: number) => `91000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hash = (seed: string) => `sha256:${Buffer.from(seed).toString("hex").padEnd(64, "0").slice(0, 64)}`;
const NOW = "2026-10-06T00:00:00.000Z";

const scope = {
  orgId: id(1),
  workspaceId: id(2),
  storyId: id(3),
  storyVersionId: id(4),
  sceneExecutionId: id(5),
};

function expectation(overrides: Partial<AudioQcExpectationBuildInput> = {}): AiStoryAudioQcExpectation {
  return compileAiStoryAudioQcExpectation({
    applicability: "REQUIRED",
    expectationKind: "SILENT_OUTPUT",
    ...scope,
    speakerRole: "NONE",
    ...overrides,
  });
}

function facts(overrides: Partial<AiStoryAudioQcEvidence["mediaFacts"]> = {}): AiStoryAudioQcEvidence["mediaFacts"] {
  return {
    hasVideoStream: true,
    hasAudioStream: false,
    videoDurationMs: 5000,
    audioDurationMs: null,
    audioCodec: null,
    sampleRate: null,
    channelCount: null,
    decodable: true,
    mediaContentHash: hash("m"),
    ...overrides,
  };
}

function evidence(overrides: Partial<AiStoryAudioQcEvidence> = {}): AiStoryAudioQcEvidence {
  return {
    ...scope,
    mediaAssetId: id(9),
    generationResultId: id(10),
    providerAttemptId: null,
    mediaFacts: facts(),
    nativeDurationToleranceMs: null,
    executedDialogueAuthorityId: null,
    executedDialogueFingerprint: null,
    durableVoiceDna: null,
    semanticInstructionFingerprint: null,
    ttsRequest: null,
    ttsResult: null,
    finalMix: null,
    detachedTtsUsed: false,
    humanReview: null,
    ...overrides,
  };
}

function voicePins(characterId = id(20)) {
  return {
    speakerRole: "CHARACTER" as const,
    speakerReusableCharacterId: characterId,
    voiceDnaId: id(21),
    voiceDnaFingerprint: hash("v"),
    voiceConsistencyMode: "DESCRIPTIVE_VOICE_DNA" as const,
    reusableCharacterId: characterId,
    reusableCharacterVersionId: id(22),
    episodeVoiceDnaId: id(21),
    episodeVoiceDnaFingerprint: hash("v"),
    dialogueAuthorityId: id(23),
    dialogueFingerprint: hash("d"),
    dialogueVoiceDnaId: id(21),
    dialogueVoiceDnaFingerprint: hash("v"),
    semanticInstructionFingerprint: hash("s"),
  };
}

function durable(characterId = id(20), overrides: Partial<NonNullable<AiStoryAudioQcEvidence["durableVoiceDna"]>> = {}) {
  return {
    voiceDnaId: id(21),
    voiceDnaFingerprint: hash("v"),
    orgId: scope.orgId,
    workspaceId: scope.workspaceId,
    reusableCharacterId: characterId,
    reusableCharacterVersionId: id(22),
    consistencyMode: "DESCRIPTIVE_VOICE_DNA" as const,
    voiceCapabilityId: null,
    referenceAudioAssetId: null,
    referenceAudioContentHash: null,
    ...overrides,
  };
}

function nativeFacts(audioMs = 5000, videoMs = 5000) {
  return facts({
    hasAudioStream: true,
    audioDurationMs: audioMs,
    videoDurationMs: videoMs,
    audioCodec: "aac",
    sampleRate: 48000,
    channelCount: 2,
  });
}

function run(kindExpectation: AiStoryAudioQcExpectation, kindEvidence: AiStoryAudioQcEvidence) {
  return evaluateAiStoryAudioQc({
    expectation: kindExpectation,
    evidence: kindEvidence,
    evaluatedAt: NOW,
  });
}

const mixPolicy = {
  speechTargetDb: -3,
  musicTargetDb: -18,
  ambienceTargetDb: -28,
  sfxTargetDb: -12,
  duckingRequiredWhenSpeechAndMusic: true,
  peakCeilingDbfs: -1,
  loudnessTargetLufs: -14,
  truePeakTargetDbtp: -1.5,
  channelLayout: "stereo" as const,
  sampleRate: 48000 as const,
};

describe("Audio QC V1", () => {
  it("repeats the same fingerprint for the same expectation and evidence", () => {
    const first = run(expectation(), evidence());
    const second = run(expectation(), evidence());
    expect(first.qcFingerprint).toBe(second.qcFingerprint);
    expect(first.audioQcResultId).toBe(second.audioQcResultId);
    expect(first.contractVersion).toBe("ai-story-audio-qc-result.v1");
    expect(first.expectationKind).toBe("SILENT_OUTPUT");
  });

  it("passes silent output when the final media has no audio stream", () => {
    const result = run(expectation(), evidence());
    expect(result.overallResult).toBe("PASS");
    expect(result.blockingFindings).toEqual([]);
    expect(result.humanReviewRequirements).toEqual([]);
    expect(result.evaluatedDimensions.find((item) => item.dimension === "TECHNICAL_AUDIO_STREAM")?.result).toBe("PASS");
  });

  it("fails silent output when an audio stream is present", () => {
    const result = run(expectation(), evidence({ mediaFacts: nativeFacts() }));
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("UNEXPECTED_AUDIO_STREAM");
  });

  it("fails native dialogue when the audio stream is missing", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({ executedDialogueAuthorityId: id(23), executedDialogueFingerprint: hash("d"), durableVoiceDna: durable(), semanticInstructionFingerprint: hash("s") })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("EXPECTED_DIALOGUE_AUDIO_MISSING");
  });

  it("passes native technical duration when streams are compatible", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({
        mediaFacts: nativeFacts(5100, 5000),
        nativeDurationToleranceMs: 250,
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.evaluatedDimensions.find((item) => item.dimension === "NATIVE_AV_DURATION")?.result).toBe("PASS");
    expect(result.evaluatedDimensions.find((item) => item.dimension === "TECHNICAL_AUDIO_STREAM")?.result).toBe("PASS");
    expect(result.overallResult).toBe("HUMAN_REVIEW_REQUIRED");
    expect(result.humanReviewRequirements).toContain("LIP_SYNC");
    expect(result.humanReviewRequirements).toContain("DIALOGUE_NATURALNESS");
  });

  it("fails when native audiovisual duration exceeds the existing tolerance", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({
        mediaFacts: nativeFacts(5400, 5000),
        nativeDurationToleranceMs: 250,
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("NATIVE_AV_DURATION_MISMATCH");
  });

  it("passes Voice DNA lineage only when episode, dialogue, and durable authority match", () => {
    const matched = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({
        mediaFacts: nativeFacts(),
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(matched.evaluatedDimensions.find((item) => item.dimension === "VOICE_DNA_LINEAGE")?.result).toBe("PASS");
    const mismatched = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins(), episodeVoiceDnaFingerprint: hash("z") }),
      evidence({
        mediaFacts: nativeFacts(),
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(mismatched.overallResult).toBe("FAIL");
    expect(mismatched.blockingFindings.map((item) => item.code)).toContain("VOICE_DNA_LINEAGE_MISMATCH");
  });

  it("fails when a supporting speaker uses another character Voice DNA", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins(id(20)), speakerReusableCharacterId: id(30) }),
      evidence({
        mediaFacts: nativeFacts(),
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(id(20)),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("SPEAKER_VOICE_AUTHORITY_MISMATCH");
  });

  it("passes descriptive semantic lineage without certifying exact acoustic identity", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({
        mediaFacts: nativeFacts(),
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.evaluatedDimensions.find((item) => item.dimension === "SEMANTIC_VOICE_AUTHORITY_LINEAGE")?.result).toBe("PASS");
    expect(result.evaluatedDimensions.find((item) => item.dimension === "EXACT_ACOUSTIC_IDENTITY")?.result).toBe("HUMAN_REVIEW_REQUIRED");
    expect(result.evaluatedDimensions.some((item) => item.dimension === "EXACT_ACOUSTIC_IDENTITY" && item.result === "PASS")).toBe(false);
    expect(result.humanReviewRequirements).toContain("VOICE_SEMANTIC_CONTINUITY");
    expect(result.overallResult).toBe("HUMAN_REVIEW_REQUIRED");
  });

  it("passes capability TTS lineage when the request, result, and Voice DNA capability match", () => {
    const pins = {
      ...voicePins(),
      voiceConsistencyMode: "CAPABILITY_VOICE_BINDING" as const,
      voiceCapabilityId: id(40),
      speechSegmentId: id(41),
    };
    const result = run(
      expectation({ expectationKind: "TTS_SPEECH", ...pins }),
      evidence({
        durableVoiceDna: durable(id(20), { consistencyMode: "CAPABILITY_VOICE_BINDING", voiceCapabilityId: id(40) }),
        semanticInstructionFingerprint: hash("s"),
        ttsRequest: { fingerprint: hash("t"), voiceCapabilityId: id(40), speechSegmentId: id(41), speakerAuthorityId: id(20) },
        ttsResult: { requestFingerprint: hash("t"), voiceCapabilityId: id(40), speechSegmentId: id(41), contentHash: hash("a"), durationMs: 1800, audioAssetId: id(42) },
      })
    );
    expect(result.evaluatedDimensions.find((item) => item.dimension === "CAPABILITY_TTS_LINEAGE")?.result).toBe("PASS");
    expect(result.overallResult).toBe("PASS");
    expect(result.providerAttemptId).toBeNull();
    expect(result.generationResultId).toBe(id(10));
  });

  it("fails when TTS uses a different voice capability", () => {
    const pins = {
      ...voicePins(),
      voiceConsistencyMode: "CAPABILITY_VOICE_BINDING" as const,
      voiceCapabilityId: id(40),
      speechSegmentId: id(41),
    };
    const result = run(
      expectation({ expectationKind: "TTS_SPEECH", ...pins }),
      evidence({
        durableVoiceDna: durable(id(20), { consistencyMode: "CAPABILITY_VOICE_BINDING", voiceCapabilityId: id(40) }),
        semanticInstructionFingerprint: hash("s"),
        ttsRequest: { fingerprint: hash("t"), voiceCapabilityId: id(49), speechSegmentId: id(41), speakerAuthorityId: id(20) },
        ttsResult: { requestFingerprint: hash("t"), voiceCapabilityId: id(49), speechSegmentId: id(41), contentHash: hash("a"), durationMs: 1800, audioAssetId: id(42) },
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("CAPABILITY_TTS_LINEAGE_MISMATCH");
  });

  it("fails closed when reference-audio identity is not supported by execution", () => {
    const result = run(
      expectation({
        expectationKind: "TTS_SPEECH",
        ...voicePins(),
        voiceConsistencyMode: "REFERENCE_AUDIO_IDENTITY",
        referenceAudioAssetId: id(50),
        referenceAudioContentHash: hash("r"),
        referenceAudioExecutionSupported: false,
      }),
      evidence({
        durableVoiceDna: durable(id(20), {
          consistencyMode: "REFERENCE_AUDIO_IDENTITY",
          referenceAudioAssetId: id(50),
          referenceAudioContentHash: hash("r"),
        }),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("REFERENCE_AUDIO_EXECUTION_UNSUPPORTED");
    expect(result.evaluatedDimensions.some((item) => item.dimension === "EXACT_ACOUSTIC_IDENTITY" && item.result === "PASS")).toBe(false);
  });

  it("fails when required TTS result media is absent", () => {
    const result = run(
      expectation({
        expectationKind: "TTS_SPEECH",
        ...voicePins(),
        voiceConsistencyMode: "CAPABILITY_VOICE_BINDING",
        voiceCapabilityId: id(40),
        speechSegmentId: id(41),
      }),
      evidence({
        durableVoiceDna: durable(id(20), { consistencyMode: "CAPABILITY_VOICE_BINDING", voiceCapabilityId: id(40) }),
        semanticInstructionFingerprint: hash("s"),
        ttsRequest: { fingerprint: hash("t"), voiceCapabilityId: id(40), speechSegmentId: id(41), speakerAuthorityId: id(20) },
        ttsResult: null,
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("EXPECTED_TTS_RESULT_MISSING");
  });

  it("fails when visible native dialogue is replaced by detached TTS", () => {
    const result = run(
      expectation({ expectationKind: "NATIVE_CHARACTER_DIALOGUE", ...voicePins() }),
      evidence({
        mediaFacts: nativeFacts(),
        detachedTtsUsed: true,
        executedDialogueAuthorityId: id(23),
        executedDialogueFingerprint: hash("d"),
        durableVoiceDna: durable(),
        semanticInstructionFingerprint: hash("s"),
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("DETACHED_TTS_SUBSTITUTION");
  });

  it("passes a final mix that matches the frozen policy and fails loudness outside tolerance", () => {
    const mixExpectation = expectation({
      expectationKind: "FINAL_AUDIO_MIX",
      audioPlanId: id(60),
      audioPlanFingerprint: hash("p"),
      audioMixFingerprint: hash("x"),
      mixPolicy,
      speechTrackCount: 1,
    });
    const mix = {
      audioPlanId: id(60),
      audioMixFingerprint: hash("x"),
      finalContentHash: hash("m"),
      durationMs: 8000,
      sampleRate: 48000,
      channelCount: 2,
      measuredIntegratedLufs: -14.4,
      measuredTruePeakDbfs: -1.5,
      speechSegmentCount: 1,
      musicTrackCount: 0,
      ambienceTrackCount: 0,
      sfxTrackCount: 0,
      jCutCount: 0,
      lCutCount: 0,
    };
    const passed = run(mixExpectation, evidence({
      mediaFacts: facts({ hasAudioStream: true, audioDurationMs: 8000, audioCodec: "aac", sampleRate: 48000, channelCount: 2 }),
      finalMix: mix,
    }));
    expect(passed.evaluatedDimensions.find((item) => item.dimension === "LOUDNESS")?.result).toBe("PASS");
    expect(passed.evaluatedDimensions.find((item) => item.dimension === "TRUE_PEAK")?.result).toBe("PASS");
    expect(passed.evaluatedDimensions.find((item) => item.dimension === "FINAL_MIX_AUTHORITY")?.result).toBe("PASS");
    expect(passed.overallResult).toBe("PASS");
    const loud = run(mixExpectation, evidence({
      mediaFacts: facts({ hasAudioStream: true, audioDurationMs: 8000, audioCodec: "aac", sampleRate: 48000, channelCount: 2 }),
      finalMix: { ...mix, measuredIntegratedLufs: -20 },
    }));
    expect(loud.overallResult).toBe("FAIL");
    expect(loud.blockingFindings.map((item) => item.code)).toContain("LOUDNESS_OUT_OF_POLICY");
    const peak = run(mixExpectation, evidence({
      mediaFacts: facts({ hasAudioStream: true, audioDurationMs: 8000, audioCodec: "aac", sampleRate: 48000, channelCount: 2 }),
      finalMix: { ...mix, measuredTruePeakDbfs: -0.5 },
    }));
    expect(peak.overallResult).toBe("FAIL");
    expect(peak.blockingFindings.map((item) => item.code)).toContain("TRUE_PEAK_OUT_OF_POLICY");
  });

  it("fails a final mix that is missing a required ducking rule", () => {
    const result = run(
      expectation({
        expectationKind: "FINAL_AUDIO_MIX",
        audioPlanId: id(60),
        audioPlanFingerprint: hash("p"),
        audioMixFingerprint: hash("x"),
        mixPolicy,
        speechTrackCount: 1,
        musicTrackCount: 1,
        duckingRuleCount: 0,
      }),
      evidence({
        mediaFacts: facts({ hasAudioStream: true, audioDurationMs: 8000, audioCodec: "aac", sampleRate: 48000, channelCount: 2 }),
        finalMix: {
          audioPlanId: id(60),
          audioMixFingerprint: hash("x"),
          finalContentHash: hash("m"),
          durationMs: 8000,
          sampleRate: 48000,
          channelCount: 2,
          measuredIntegratedLufs: -14,
          measuredTruePeakDbfs: -1.5,
          speechSegmentCount: 1,
          musicTrackCount: 1,
          ambienceTrackCount: 0,
          sfxTrackCount: 0,
          jCutCount: 0,
          lCutCount: 0,
        },
      })
    );
    expect(result.overallResult).toBe("FAIL");
    expect(result.blockingFindings.map((item) => item.code)).toContain("DUCKING_AUTHORITY_MISSING");
  });

  it("accepts a manual local generation result without a provider attempt", () => {
    const result = run(expectation(), evidence({ providerAttemptId: null, generationResultId: id(10) }));
    expect(result.providerAttemptId).toBeNull();
    expect(result.generationResultId).toBe(id(10));
    expect(result.overallResult).toBe("PASS");
  });

  it("keeps historical post-generation evaluations readable and does not mutate upstream authority", async () => {
    const repository = new InMemoryAiStoryPostGenerationQcRepository();
    const service = new AiStoryPostGenerationQcService({
      repository,
      evidenceProvider: new FakeAiStoryVisualEvidenceProvider([]),
      now: () => NOW,
    });
    const requirement: AiStoryPostQcRequirement = {
      requirementId: "scene-purpose",
      dimension: "SCENE_FIDELITY",
      summary: "The generated media communicates the required Scene purpose.",
      required: true,
      waiverPolicy: "WAIVABLE_BY_HUMAN",
      sourceOwner: "SCENE",
      visuallyObservable: true,
    };
    const historicalInput = {
      postQcInputId: id(70),
      contractVersion: AI_STORY_POST_GENERATION_QC_CONTRACT_VERSION,
      policyVersion: AI_STORY_POST_QC_POLICY_VERSION,
      orgId: id(1),
      workspaceId: id(2),
      campaignId: id(71),
      storyId: id(3),
      storyVersionId: id(4),
      planningLineageSource: "LEGACY_COMPILED_V1",
      scriptVersionId: null,
      handoffId: null,
      sceneExecutionId: id(5),
      sceneId: "scene-1",
      sceneVersion: 1,
      sceneFingerprint: hash("a"),
      sceneExecutionFingerprint: hash("b"),
      providerAttemptId: "attempt-1",
      generationMode: "TEXT_TO_VIDEO",
      privateMediaAssetId: id(9),
      privateMediaContentHash: hash("c"),
      compiledRequestId: id(72),
      compiledRequestFingerprint: hash("d"),
      semanticPlanFingerprint: hash("e"),
      preGenerationQcEvaluationId: id(73),
      preGenerationQcFingerprint: hash("f"),
      handoffFingerprint: null,
      directorFingerprint: hash("2"),
      motionFingerprint: hash("3"),
      shotRecipeFingerprint: null,
      castSnapshotFingerprint: hash("5"),
      locationSnapshotFingerprint: hash("6"),
      productSnapshotFingerprint: hash("7"),
      entryState: ["A holds Product"],
      scriptActions: ["A gives Product to B"],
      requiredExitState: ["B holds Product"],
      mustKeep: ["canonical Product shape"],
      mustAvoid: ["unwanted text"],
      newAudienceInformation: ["Product benefit"],
      requiredEvidence: ["Product usage"],
      requirements: [requirement],
      providerMetadata: {},
      media: { durableObjectReference: `${id(2)}/ai-story/result.mp4`, mediaType: "video/mp4", byteSize: 4096, durationMs: 5000, width: 1280, height: 720, readable: true, decodable: true },
      createdAt: NOW,
    };
    const historical = await service.evaluate(historicalInput);
    expect(historical.evaluation.audioQcResult).toBeUndefined();
    const stored = JSON.parse(JSON.stringify(historical.evaluation)) as Record<string, unknown>;
    delete stored.audioQcResult;
    expect(AiStoryPostGenerationQcEvaluationSchema.parse(stored).postQcEvaluationId).toBe(historical.evaluation.postQcEvaluationId);

    const frozenExpectation = expectation();
    const frozenEvidence = evidence();
    const beforeExpectation = JSON.stringify(frozenExpectation);
    const beforeEvidence = JSON.stringify(frozenEvidence);
    const audio = run(frozenExpectation, frozenEvidence);
    expect(JSON.stringify(frozenExpectation)).toBe(beforeExpectation);
    expect(JSON.stringify(frozenEvidence)).toBe(beforeEvidence);
    const withAudio = await service.evaluate({
      ...historicalInput,
      postQcInputId: id(74),
      providerAttemptId: "attempt-2",
    }, 1, null, { expectation: frozenExpectation, evidence: frozenEvidence });
    expect(withAudio.evaluation.audioQcResult?.audioQcResultId).toBe(audio.audioQcResultId);
    expect(withAudio.evaluation.autoRetryAuthorized).toBe(false);
    expect(JSON.stringify(frozenExpectation)).toBe(beforeExpectation);
  });

  it("returns not applicable only when authority says audio QC is not required", () => {
    const result = run(expectation({ applicability: "NOT_REQUIRED" }), evidence({ mediaFacts: nativeFacts() }));
    expect(result.overallResult).toBe("NOT_APPLICABLE");
    expect(result.blockingFindings).toEqual([]);
  });
});

function ffmpegAvailable(): boolean {
  try {
    execFileSync(process.env.FFMPEG_PATH ?? "ffmpeg", ["-version"], { stdio: "ignore", windowsHide: true });
    execFileSync(process.env.FFPROBE_PATH ?? "ffprobe", ["-version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!ffmpegAvailable())("Audio QC media facts", () => {
  let root = "";
  afterAll(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("reads a locally generated silent mp4 as having no audio stream", async () => {
    root = await mkdtemp(join(tmpdir(), "ember-audio-qc-"));
    const silentPath = join(root, "silent.mp4");
    const audiblePath = join(root, "audible.mp4");
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1:r=24", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", silentPath], { windowsHide: true });
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1:r=24", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", audiblePath], { windowsHide: true });
    const silentFacts = await inspectAiStoryAudioQcMediaFacts(silentPath);
    const audibleFacts = await inspectAiStoryAudioQcMediaFacts(audiblePath);
    const silent = run(expectation(), evidence({ mediaFacts: silentFacts, mediaAssetId: id(9) }));
    const audible = run(expectation(), evidence({ mediaFacts: audibleFacts, mediaAssetId: id(9) }));
    expect(silentFacts.hasAudioStream).toBe(false);
    expect(silent.overallResult).toBe("PASS");
    expect(audibleFacts.hasAudioStream).toBe(true);
    expect(audible.overallResult).toBe("FAIL");
    expect(audible.blockingFindings.map((item) => item.code)).toContain("UNEXPECTED_AUDIO_STREAM");
  });
});
