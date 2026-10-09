import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";
import {
  AI_STORY_AUDIO_QC_EXPECTATION_VERSION,
  AI_STORY_AUDIO_QC_LOUDNESS_TOLERANCE_LU,
  AI_STORY_AUDIO_QC_NATIVE_AV_DURATION_TOLERANCE_MS,
  AI_STORY_AUDIO_QC_RESULT_VERSION,
  AI_STORY_AUDIO_QC_TRUE_PEAK_TOLERANCE_DB,
  AiStoryAudioQcEvidenceSchema,
  AiStoryAudioQcExpectationSchema,
  AiStoryAudioQcResultSchema,
  type AiStoryAudioQcEvidence,
  type AiStoryAudioQcExpectation,
  type AiStoryAudioQcResult,
} from "./ai-story-audio-qc";
import type { AiStoryAudioMixPolicy } from "./ai-story-audio-plan";

export type { AiStoryAudioQcEvidence, AiStoryAudioQcExpectation, AiStoryAudioQcResult } from "./ai-story-audio-qc";

const EXPECTATION_ID_KIND = "ai-story-audio-qc-expectation";
const RESULT_ID_KIND = "ai-story-audio-qc-result";

export type AudioQcExpectationBuildInput = {
  applicability: AiStoryAudioQcExpectation["applicability"];
  expectationKind: AiStoryAudioQcExpectation["expectationKind"];
  orgId: string;
  workspaceId: string;
  storyId: string;
  storyVersionId: string;
  sceneExecutionId: string;
  speakerRole?: AiStoryAudioQcExpectation["speakerRole"];
  speakerReusableCharacterId?: string | null;
  voiceDnaId?: string | null;
  voiceDnaFingerprint?: string | null;
  voiceConsistencyMode?: AiStoryAudioQcExpectation["voiceConsistencyMode"];
  reusableCharacterId?: string | null;
  reusableCharacterVersionId?: string | null;
  voiceCapabilityId?: string | null;
  referenceAudioAssetId?: string | null;
  referenceAudioContentHash?: string | null;
  referenceAudioExecutionSupported?: boolean | null;
  episodeVoiceDnaId?: string | null;
  episodeVoiceDnaFingerprint?: string | null;
  dialogueAuthorityId?: string | null;
  dialogueFingerprint?: string | null;
  dialogueVoiceDnaId?: string | null;
  dialogueVoiceDnaFingerprint?: string | null;
  speechSegmentId?: string | null;
  semanticInstructionFingerprint?: string | null;
  audioPlanId?: string | null;
  audioPlanFingerprint?: string | null;
  audioMixFingerprint?: string | null;
  mixPolicy?: AiStoryAudioMixPolicy | null;
  speechTrackCount?: number;
  musicTrackCount?: number;
  ambienceTrackCount?: number;
  sfxTrackCount?: number;
  duckingRuleCount?: number;
  jCutCount?: number;
  lCutCount?: number;
  preservedContentHash?: string | null;
};

type Dimension = AiStoryAudioQcResult["evaluatedDimensions"][number];
type Finding = AiStoryAudioQcResult["blockingFindings"][number];
type HumanDimension = AiStoryAudioQcResult["humanReviewRequirements"][number];
type HumanState = "PASS" | "FAIL" | "HUMAN_REVIEW_REQUIRED" | "NOT_RUN";

function expectationSemanticBody(input: AudioQcExpectationBuildInput) {
  return {
    contractVersion: AI_STORY_AUDIO_QC_EXPECTATION_VERSION,
    applicability: input.applicability,
    expectationKind: input.expectationKind,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    sceneExecutionId: input.sceneExecutionId,
    speakerRole: input.speakerRole ?? "NONE",
    speakerReusableCharacterId: input.speakerReusableCharacterId ?? null,
    voiceDnaId: input.voiceDnaId ?? null,
    voiceDnaFingerprint: input.voiceDnaFingerprint ?? null,
    voiceConsistencyMode: input.voiceConsistencyMode ?? null,
    reusableCharacterId: input.reusableCharacterId ?? null,
    reusableCharacterVersionId: input.reusableCharacterVersionId ?? null,
    voiceCapabilityId: input.voiceCapabilityId ?? null,
    referenceAudioAssetId: input.referenceAudioAssetId ?? null,
    referenceAudioContentHash: input.referenceAudioContentHash ?? null,
    referenceAudioExecutionSupported: input.referenceAudioExecutionSupported ?? null,
    episodeVoiceDnaId: input.episodeVoiceDnaId ?? null,
    episodeVoiceDnaFingerprint: input.episodeVoiceDnaFingerprint ?? null,
    dialogueAuthorityId: input.dialogueAuthorityId ?? null,
    dialogueFingerprint: input.dialogueFingerprint ?? null,
    dialogueVoiceDnaId: input.dialogueVoiceDnaId ?? null,
    dialogueVoiceDnaFingerprint: input.dialogueVoiceDnaFingerprint ?? null,
    speechSegmentId: input.speechSegmentId ?? null,
    semanticInstructionFingerprint: input.semanticInstructionFingerprint ?? null,
    audioPlanId: input.audioPlanId ?? null,
    audioPlanFingerprint: input.audioPlanFingerprint ?? null,
    audioMixFingerprint: input.audioMixFingerprint ?? null,
    mixPolicy: input.mixPolicy ?? null,
    speechTrackCount: input.speechTrackCount ?? 0,
    musicTrackCount: input.musicTrackCount ?? 0,
    ambienceTrackCount: input.ambienceTrackCount ?? 0,
    sfxTrackCount: input.sfxTrackCount ?? 0,
    duckingRuleCount: input.duckingRuleCount ?? 0,
    jCutCount: input.jCutCount ?? 0,
    lCutCount: input.lCutCount ?? 0,
    preservedContentHash: input.preservedContentHash ?? null,
  };
}

export function compileAiStoryAudioQcExpectation(
  input: AudioQcExpectationBuildInput
): AiStoryAudioQcExpectation {
  const semantic = expectationSemanticBody(input);
  const audioExpectationFingerprint = sha256CanonicalIntegrityHash(semantic);
  return AiStoryAudioQcExpectationSchema.parse({
    ...semantic,
    audioQcExpectationId: deterministicUuidFromFingerprint(EXPECTATION_ID_KIND, audioExpectationFingerprint),
    audioExpectationFingerprint,
  });
}

function recomputeExpectationFingerprint(expectation: AiStoryAudioQcExpectation): string {
  const { audioQcExpectationId: _id, audioExpectationFingerprint: _fingerprint, ...semantic } = expectation;
  return sha256CanonicalIntegrityHash(semantic);
}

function same(left: string | null | undefined, right: string | null | undefined): boolean {
  return (left ?? null) === (right ?? null);
}

function humanState(
  review: AiStoryAudioQcEvidence["humanReview"],
  key: keyof NonNullable<AiStoryAudioQcEvidence["humanReview"]>
): HumanState {
  return review?.[key] ?? "NOT_RUN";
}

function pushHuman(
  dimensions: Dimension[],
  findings: Finding[],
  requirements: HumanDimension[],
  dimension: HumanDimension,
  state: HumanState
) {
  requirements.push(dimension);
  if (state === "FAIL") {
    dimensions.push({ dimension: "HUMAN_PERFORMANCE", result: "FAIL", findingCode: null });
    return;
  }
  dimensions.push({
    dimension: "HUMAN_PERFORMANCE",
    result: state === "PASS" ? "PASS" : "HUMAN_REVIEW_REQUIRED",
    findingCode: null,
  });
}

export function evaluateAiStoryAudioQc(input: {
  expectation: AiStoryAudioQcExpectation;
  evidence: AiStoryAudioQcEvidence;
  evaluatedAt: string;
}): AiStoryAudioQcResult {
  const expectation = AiStoryAudioQcExpectationSchema.parse(input.expectation);
  const evidence = AiStoryAudioQcEvidenceSchema.parse(input.evidence);
  const dimensions: Dimension[] = [];
  const findings: Finding[] = [];
  const humanReviewRequirements: HumanDimension[] = [];

  const scopeMatches =
    evidence.orgId === expectation.orgId &&
    evidence.workspaceId === expectation.workspaceId &&
    evidence.storyId === expectation.storyId &&
    evidence.storyVersionId === expectation.storyVersionId &&
    evidence.sceneExecutionId === expectation.sceneExecutionId;
  if (!scopeMatches) {
    findings.push({
      code: "AUDIO_QC_SCOPE_MISMATCH",
      dimension: "TECHNICAL_AUDIO_STREAM",
      message: "Audio QC evidence is outside the frozen Scene authority",
    });
    dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "FAIL", findingCode: "AUDIO_QC_SCOPE_MISMATCH" });
  } else if (recomputeExpectationFingerprint(expectation) !== expectation.audioExpectationFingerprint) {
    findings.push({
      code: "AUDIO_QC_EXPECTATION_MISMATCH",
      dimension: "TECHNICAL_AUDIO_STREAM",
      message: "Audio QC expectation fingerprint does not match its authority",
    });
    dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "FAIL", findingCode: "AUDIO_QC_EXPECTATION_MISMATCH" });
  } else if (expectation.applicability === "NOT_REQUIRED") {
    dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "NOT_APPLICABLE", findingCode: null });
  } else {
    evaluateRequired(expectation, evidence, dimensions, findings, humanReviewRequirements);
  }

  const overallResult = aggregate(dimensions, findings, humanReviewRequirements, expectation.applicability);
  const semantic = {
    contractVersion: AI_STORY_AUDIO_QC_RESULT_VERSION,
    expectationKind: expectation.expectationKind,
    orgId: expectation.orgId,
    workspaceId: expectation.workspaceId,
    storyId: expectation.storyId,
    storyVersionId: expectation.storyVersionId,
    sceneExecutionId: expectation.sceneExecutionId,
    generationResultId: evidence.generationResultId,
    providerAttemptId: evidence.providerAttemptId,
    mediaAssetId: evidence.mediaAssetId,
    mediaContentHash: evidence.mediaFacts.mediaContentHash,
    audioExpectationFingerprint: expectation.audioExpectationFingerprint,
    voiceDnaId: expectation.voiceDnaId,
    voiceDnaFingerprint: expectation.voiceDnaFingerprint,
    dialogueAuthorityId: expectation.dialogueAuthorityId,
    dialogueFingerprint: expectation.dialogueFingerprint,
    audioPlanId: expectation.audioPlanId,
    audioPlanFingerprint: expectation.audioPlanFingerprint,
    evaluatedDimensions: dimensions,
    overallResult,
    blockingFindings: findings,
    humanReviewRequirements,
  };
  const qcFingerprint = sha256CanonicalIntegrityHash(semantic);
  return AiStoryAudioQcResultSchema.parse({
    ...semantic,
    audioQcResultId: deterministicUuidFromFingerprint(RESULT_ID_KIND, qcFingerprint),
    qcFingerprint,
    evaluatedAt: input.evaluatedAt,
  });
}

function aggregate(
  dimensions: readonly Dimension[],
  findings: readonly Finding[],
  humanReviewRequirements: readonly HumanDimension[],
  applicability: AiStoryAudioQcExpectation["applicability"]
): AiStoryAudioQcResult["overallResult"] {
  if (applicability === "NOT_REQUIRED" && findings.length === 0) return "NOT_APPLICABLE";
  if (findings.length > 0 || dimensions.some((item) => item.result === "FAIL")) return "FAIL";
  if (
    humanReviewRequirements.length > 0 ||
    dimensions.some((item) => item.result === "HUMAN_REVIEW_REQUIRED")
  ) {
    return "HUMAN_REVIEW_REQUIRED";
  }
  return "PASS";
}

function evaluateRequired(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[],
  humanReviewRequirements: HumanDimension[]
) {
  const facts = evidence.mediaFacts;
  if (!facts.decodable) {
    fail(dimensions, findings, "TECHNICAL_AUDIO_STREAM", "MEDIA_NOT_DECODABLE", "Generated media could not be decoded");
  }

  if (expectation.expectationKind === "SILENT_OUTPUT") {
    if (facts.hasAudioStream) {
      fail(dimensions, findings, "TECHNICAL_AUDIO_STREAM", "UNEXPECTED_AUDIO_STREAM", "Silent output contains an audio stream");
    } else if (facts.decodable) {
      dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "PASS", findingCode: null });
    }
    dimensions.push({ dimension: "DIALOGUE_AUDIO_PRESENCE", result: "NOT_APPLICABLE", findingCode: null });
    dimensions.push({ dimension: "HUMAN_PERFORMANCE", result: "NOT_APPLICABLE", findingCode: null });
    return;
  }

  if (expectation.expectationKind === "PRESERVE_SOURCE_AUDIO") {
    if (!facts.hasAudioStream) {
      fail(dimensions, findings, "DIALOGUE_AUDIO_PRESENCE", "PRESERVED_AUDIO_MISSING", "Preserved source audio is missing");
    } else if (expectation.preservedContentHash && expectation.preservedContentHash !== facts.mediaContentHash) {
      fail(dimensions, findings, "FINAL_MIX_AUTHORITY", "FINAL_MIX_LINEAGE_MISMATCH", "Preserved source audio hash does not match");
    } else if (facts.decodable) {
      dimensions.push({ dimension: "DIALOGUE_AUDIO_PRESENCE", result: "PASS", findingCode: null });
      dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "PASS", findingCode: null });
    }
    return;
  }

  if (expectation.expectationKind === "NATIVE_CHARACTER_DIALOGUE") {
    evaluateNative(expectation, evidence, dimensions, findings, humanReviewRequirements);
    return;
  }

  if (expectation.expectationKind === "TTS_SPEECH") {
    evaluateTts(expectation, evidence, dimensions, findings, humanReviewRequirements);
    return;
  }

  if (expectation.expectationKind === "NO_DIALOGUE_WITH_AMBIENT_AUDIO") {
    evaluateNoDialogueAmbient(facts, dimensions);
    return;
  }

  evaluateFinalMix(expectation, evidence, dimensions, findings, humanReviewRequirements);
}

/**
 * No-dialogue ambient QC. An audio stream is allowed and is not required.
 * This repository has no reliable speech detector, so speech content stays
 * in human review and is never an automatic PASS.
 */
function evaluateNoDialogueAmbient(
  facts: AiStoryAudioQcEvidence["mediaFacts"],
  dimensions: Dimension[],
) {
  if (facts.decodable) {
    dimensions.push({
      dimension: "TECHNICAL_AUDIO_STREAM",
      result: facts.hasAudioStream ? "PASS" : "NOT_APPLICABLE",
      findingCode: null,
    });
  }
  dimensions.push({ dimension: "DIALOGUE_AUDIO_PRESENCE", result: "NOT_APPLICABLE", findingCode: null });
  dimensions.push({
    dimension: "SPEECH_CONTENT",
    result: "HUMAN_REVIEW_REQUIRED",
    findingCode: null,
  });
}

function fail(
  dimensions: Dimension[],
  findings: Finding[],
  dimension: Dimension["dimension"],
  code: Finding["code"],
  message: string
) {
  dimensions.push({ dimension, result: "FAIL", findingCode: code });
  findings.push({ code, dimension, message });
}

function evaluateNative(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[],
  humanReviewRequirements: HumanDimension[]
) {
  const facts = evidence.mediaFacts;
  if (!facts.hasAudioStream) {
    fail(dimensions, findings, "DIALOGUE_AUDIO_PRESENCE", "EXPECTED_DIALOGUE_AUDIO_MISSING", "Native character dialogue has no audio stream");
  } else {
    dimensions.push({ dimension: "DIALOGUE_AUDIO_PRESENCE", result: "PASS", findingCode: null });
  }
  if (!facts.hasVideoStream || !facts.hasAudioStream || !facts.videoDurationMs || !facts.audioDurationMs) {
    fail(dimensions, findings, "TECHNICAL_AUDIO_STREAM", "NATIVE_AV_STREAM_MISSING", "Native dialogue requires decodable video and audio streams");
  } else {
    const tolerance = evidence.nativeDurationToleranceMs ?? AI_STORY_AUDIO_QC_NATIVE_AV_DURATION_TOLERANCE_MS;
    const difference = Math.abs(facts.videoDurationMs - facts.audioDurationMs);
    if (difference > tolerance) {
      fail(dimensions, findings, "NATIVE_AV_DURATION", "NATIVE_AV_DURATION_MISMATCH", "Native audiovisual durations exceed the existing tolerance");
    } else {
      dimensions.push({ dimension: "NATIVE_AV_DURATION", result: "PASS", findingCode: null });
      dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "PASS", findingCode: null });
    }
  }
  if (evidence.detachedTtsUsed) {
    fail(dimensions, findings, "DETACHED_TTS_EXCLUSIVITY", "DETACHED_TTS_SUBSTITUTION", "Visible native dialogue was replaced by detached TTS");
  } else {
    dimensions.push({ dimension: "DETACHED_TTS_EXCLUSIVITY", result: "PASS", findingCode: null });
  }
  if (
    expectation.dialogueAuthorityId &&
    (evidence.executedDialogueAuthorityId !== expectation.dialogueAuthorityId ||
      evidence.executedDialogueFingerprint !== expectation.dialogueFingerprint)
  ) {
    fail(dimensions, findings, "DIALOGUE_TEXT_LINEAGE", "DIALOGUE_AUTHORITY_MISMATCH", "Executed dialogue authority does not match the frozen dialogue lineage");
  } else if (expectation.dialogueAuthorityId) {
    dimensions.push({ dimension: "DIALOGUE_TEXT_LINEAGE", result: "PASS", findingCode: null });
  }
  evaluateVoiceLineage(expectation, evidence, dimensions, findings);
  evaluateSpeaker(expectation, evidence, dimensions, findings);
  for (const dimension of [
    "LIP_SYNC",
    "DIALOGUE_NATURALNESS",
    "ACCENT_NATURALNESS",
    "EMOTIONAL_DELIVERY",
    "PHRASE_EMPHASIS",
    "MICRO_PAUSES",
    "DIALOGUE_EXACT_WORDING",
  ] as const) {
    const key = {
      LIP_SYNC: "lipSync",
      DIALOGUE_NATURALNESS: "dialogueNaturalness",
      ACCENT_NATURALNESS: "accentNaturalness",
      EMOTIONAL_DELIVERY: "emotionalDelivery",
      PHRASE_EMPHASIS: "phraseEmphasis",
      MICRO_PAUSES: "microPauses",
      DIALOGUE_EXACT_WORDING: "dialogueExactWording",
    }[dimension] as keyof NonNullable<AiStoryAudioQcEvidence["humanReview"]>;
    pushHuman(dimensions, findings, humanReviewRequirements, dimension, humanState(evidence.humanReview, key));
  }
  if (expectation.voiceConsistencyMode === "DESCRIPTIVE_VOICE_DNA") {
    pushHuman(
      dimensions,
      findings,
      humanReviewRequirements,
      "VOICE_SEMANTIC_CONTINUITY",
      humanState(evidence.humanReview, "voiceSemanticContinuity")
    );
  }
}

function evaluateVoiceLineage(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[]
) {
  if (!expectation.voiceDnaId) {
    dimensions.push({ dimension: "VOICE_DNA_LINEAGE", result: "NOT_APPLICABLE", findingCode: null });
    return;
  }
  const dna = evidence.durableVoiceDna;
  const semanticMatches = expectation.semanticInstructionFingerprint === null
    || expectation.semanticInstructionFingerprint === evidence.semanticInstructionFingerprint;
  const matches = Boolean(
    dna &&
    dna.voiceDnaId === expectation.voiceDnaId &&
    dna.voiceDnaFingerprint === expectation.voiceDnaFingerprint &&
    dna.orgId === expectation.orgId &&
    dna.workspaceId === expectation.workspaceId &&
    dna.reusableCharacterId === expectation.reusableCharacterId &&
    dna.reusableCharacterVersionId === expectation.reusableCharacterVersionId &&
    same(expectation.episodeVoiceDnaId, expectation.voiceDnaId) &&
    same(expectation.episodeVoiceDnaFingerprint, expectation.voiceDnaFingerprint) &&
    same(expectation.dialogueVoiceDnaId, expectation.voiceDnaId) &&
    same(expectation.dialogueVoiceDnaFingerprint, expectation.voiceDnaFingerprint) &&
    dna.consistencyMode === expectation.voiceConsistencyMode &&
    semanticMatches
  );
  if (!matches) {
    fail(dimensions, findings, "VOICE_DNA_LINEAGE", "VOICE_DNA_LINEAGE_MISMATCH", "Voice DNA lineage does not match the frozen Character authority");
    dimensions.push({ dimension: "SEMANTIC_VOICE_AUTHORITY_LINEAGE", result: "FAIL", findingCode: "VOICE_DNA_LINEAGE_MISMATCH" });
    return;
  }
  dimensions.push({ dimension: "VOICE_DNA_LINEAGE", result: "PASS", findingCode: null });
  dimensions.push({ dimension: "SEMANTIC_VOICE_AUTHORITY_LINEAGE", result: "PASS", findingCode: null });
  if (expectation.voiceConsistencyMode === "DESCRIPTIVE_VOICE_DNA") {
    dimensions.push({ dimension: "EXACT_ACOUSTIC_IDENTITY", result: "HUMAN_REVIEW_REQUIRED", findingCode: null });
  } else if (expectation.voiceConsistencyMode === "REFERENCE_AUDIO_IDENTITY") {
    dimensions.push({ dimension: "EXACT_ACOUSTIC_IDENTITY", result: "HUMAN_REVIEW_REQUIRED", findingCode: null });
  } else {
    dimensions.push({ dimension: "EXACT_ACOUSTIC_IDENTITY", result: "NOT_APPLICABLE", findingCode: null });
  }
}

function evaluateSpeaker(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[]
) {
  if (expectation.speakerRole === "NARRATION") {
    if (expectation.voiceDnaId) {
      fail(dimensions, findings, "SPEAKER_ISOLATION", "SPEAKER_VOICE_AUTHORITY_MISMATCH", "Narration cannot inherit a Character Voice DNA");
    } else {
      dimensions.push({ dimension: "SPEAKER_ISOLATION", result: "PASS", findingCode: null });
    }
    return;
  }
  if (expectation.speakerRole !== "CHARACTER" || !expectation.voiceDnaId) {
    dimensions.push({ dimension: "SPEAKER_ISOLATION", result: "NOT_APPLICABLE", findingCode: null });
    return;
  }
  const dna = evidence.durableVoiceDna;
  if (!dna || dna.reusableCharacterId !== expectation.speakerReusableCharacterId) {
    fail(dimensions, findings, "SPEAKER_ISOLATION", "SPEAKER_VOICE_AUTHORITY_MISMATCH", "A speaking Character cannot use another Character's Voice DNA");
    return;
  }
  dimensions.push({ dimension: "SPEAKER_ISOLATION", result: "PASS", findingCode: null });
}

function evaluateTts(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[],
  humanReviewRequirements: HumanDimension[]
) {
  evaluateVoiceLineage(expectation, evidence, dimensions, findings);
  evaluateSpeaker(expectation, evidence, dimensions, findings);
  if (expectation.voiceConsistencyMode === "REFERENCE_AUDIO_IDENTITY") {
    if (expectation.referenceAudioExecutionSupported !== true) {
      fail(dimensions, findings, "REFERENCE_AUDIO_AUTHORITY", "REFERENCE_AUDIO_EXECUTION_UNSUPPORTED", "Execution cannot honor reference-audio identity");
    } else if (
      !evidence.durableVoiceDna ||
      evidence.durableVoiceDna.referenceAudioAssetId !== expectation.referenceAudioAssetId ||
      evidence.durableVoiceDna.referenceAudioContentHash !== expectation.referenceAudioContentHash
    ) {
      fail(dimensions, findings, "REFERENCE_AUDIO_AUTHORITY", "REFERENCE_AUDIO_LINEAGE_MISMATCH", "Reference audio authority does not match execution");
    } else {
      dimensions.push({ dimension: "REFERENCE_AUDIO_AUTHORITY", result: "PASS", findingCode: null });
    }
    if (!humanReviewRequirements.includes("VOICE_SEMANTIC_CONTINUITY")) {
      humanReviewRequirements.push("VOICE_SEMANTIC_CONTINUITY");
    }
    return;
  }
  const request = evidence.ttsRequest;
  const result = evidence.ttsResult;
  if (!request || !result) {
    fail(dimensions, findings, "CAPABILITY_TTS_LINEAGE", "EXPECTED_TTS_RESULT_MISSING", "Required TTS result is absent");
    return;
  }
  const capabilityMatches = expectation.voiceConsistencyMode !== "CAPABILITY_VOICE_BINDING" || (
    request.voiceCapabilityId === expectation.voiceCapabilityId &&
    result.voiceCapabilityId === request.voiceCapabilityId &&
    evidence.durableVoiceDna?.voiceCapabilityId === expectation.voiceCapabilityId
  );
  const lineageMatches =
    result.requestFingerprint === request.fingerprint &&
    result.speechSegmentId === request.speechSegmentId &&
    request.speechSegmentId === expectation.speechSegmentId &&
    result.durationMs > 0 &&
    Boolean(result.audioAssetId) &&
    Boolean(result.contentHash) &&
    capabilityMatches;
  if (!lineageMatches) {
    fail(dimensions, findings, "CAPABILITY_TTS_LINEAGE", "CAPABILITY_TTS_LINEAGE_MISMATCH", "TTS execution does not match the frozen voice capability");
    return;
  }
  dimensions.push({ dimension: "CAPABILITY_TTS_LINEAGE", result: "PASS", findingCode: null });
  dimensions.push({ dimension: "DIALOGUE_AUDIO_PRESENCE", result: "PASS", findingCode: null });
  dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "PASS", findingCode: null });
  if (expectation.dialogueFingerprint && expectation.dialogueAuthorityId) {
    dimensions.push({ dimension: "DIALOGUE_TEXT_LINEAGE", result: "PASS", findingCode: null });
  }
}

function evaluateFinalMix(
  expectation: AiStoryAudioQcExpectation,
  evidence: AiStoryAudioQcEvidence,
  dimensions: Dimension[],
  findings: Finding[],
  humanReviewRequirements: HumanDimension[]
) {
  const mix = evidence.finalMix;
  const policy = expectation.mixPolicy;
  if (!mix || !policy) {
    fail(dimensions, findings, "FINAL_MIX_AUTHORITY", "FINAL_MIX_LINEAGE_MISMATCH", "Final audio mix evidence is absent");
    return;
  }
  const lineage =
    mix.audioPlanId === expectation.audioPlanId &&
    mix.audioMixFingerprint === expectation.audioMixFingerprint &&
    mix.finalContentHash === evidence.mediaFacts.mediaContentHash &&
    mix.durationMs > 0 &&
    mix.sampleRate === policy.sampleRate &&
    mix.channelCount === 2;
  if (!lineage) {
    fail(dimensions, findings, "FINAL_MIX_AUTHORITY", "FINAL_MIX_LINEAGE_MISMATCH", "Final mix does not match the frozen Audio Plan");
  } else {
    dimensions.push({ dimension: "FINAL_MIX_AUTHORITY", result: "PASS", findingCode: null });
  }
  const loudnessDelta = Math.abs(mix.measuredIntegratedLufs - policy.loudnessTargetLufs);
  if (loudnessDelta > AI_STORY_AUDIO_QC_LOUDNESS_TOLERANCE_LU) {
    fail(dimensions, findings, "LOUDNESS", "LOUDNESS_OUT_OF_POLICY", "Measured loudness is outside the frozen policy tolerance");
  } else {
    dimensions.push({ dimension: "LOUDNESS", result: "PASS", findingCode: null });
  }
  const peakCeiling = mix.measuredTruePeakDbfs <= policy.peakCeilingDbfs;
  const peakTarget = mix.measuredTruePeakDbfs <= policy.truePeakTargetDbtp + AI_STORY_AUDIO_QC_TRUE_PEAK_TOLERANCE_DB;
  if (!peakCeiling || !peakTarget) {
    fail(dimensions, findings, "TRUE_PEAK", "TRUE_PEAK_OUT_OF_POLICY", "Measured true peak exceeds the frozen policy ceiling");
  } else {
    dimensions.push({ dimension: "TRUE_PEAK", result: "PASS", findingCode: null });
  }
  const countsMatch =
    mix.speechSegmentCount === expectation.speechTrackCount &&
    mix.musicTrackCount === expectation.musicTrackCount &&
    mix.ambienceTrackCount === expectation.ambienceTrackCount &&
    mix.sfxTrackCount === expectation.sfxTrackCount;
  if (!countsMatch) {
    fail(dimensions, findings, "SPEECH_TRACK_COHERENCE", "TRACK_COUNT_MISMATCH", "Mix track counts do not match the execution plan");
  } else {
    dimensions.push({ dimension: "SPEECH_TRACK_COHERENCE", result: "PASS", findingCode: null });
  }
  if (mix.jCutCount !== expectation.jCutCount || mix.lCutCount !== expectation.lCutCount) {
    fail(dimensions, findings, "JL_CUT_COHERENCE", "JL_CUT_MISMATCH", "J/L cut evidence does not match the Audio Plan");
  } else {
    dimensions.push({ dimension: "JL_CUT_COHERENCE", result: "PASS", findingCode: null });
  }
  const duckingRequired = policy.duckingRequiredWhenSpeechAndMusic && expectation.speechTrackCount > 0 && expectation.musicTrackCount > 0;
  if (duckingRequired && expectation.duckingRuleCount < 1) {
    fail(dimensions, findings, "DUCKING_AUTHORITY", "DUCKING_AUTHORITY_MISSING", "Speech and music require a frozen ducking rule");
  } else {
    dimensions.push({ dimension: "DUCKING_AUTHORITY", result: "PASS", findingCode: null });
  }
  if (expectation.speechTrackCount > 0 && expectation.musicTrackCount > 0) {
    humanReviewRequirements.push("BGM_SPEECH_BALANCE");
    dimensions.push({ dimension: "HUMAN_PERFORMANCE", result: "HUMAN_REVIEW_REQUIRED", findingCode: null });
  }
  if (evidence.mediaFacts.decodable && evidence.mediaFacts.hasAudioStream) {
    dimensions.push({ dimension: "TECHNICAL_AUDIO_STREAM", result: "PASS", findingCode: null });
  }
}
