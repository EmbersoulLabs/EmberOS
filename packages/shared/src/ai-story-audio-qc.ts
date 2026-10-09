/**
 * Provider-neutral post-generation Audio QC.
 *
 * Audio QC checks whether generated or assembled media obeyed frozen audio
 * authorities. It does not generate audio, rewrite dialogue, choose a voice,
 * retry, or call a provider.
 *
 * Loudness and true-peak comparisons use the frozen Audio Mix policy.
 * V1 tolerance, documented here because the policy has targets but no range:
 * integrated loudness may differ from loudnessTargetLufs by at most 1 LU.
 * Measured true peak must not exceed peakCeilingDbfs, and must not exceed
 * truePeakTargetDbtp by more than 0.1 dB.
 * Native audiovisual duration uses the existing 250ms maximum tolerance.
 * Silence means no audio stream. Low volume is not silence.
 */
import { z } from "zod";
import { AiStoryAudioMixPolicySchema } from "./ai-story-audio-plan";

export const AI_STORY_AUDIO_QC_EXPECTATION_VERSION = "ai-story-audio-qc-expectation.v1" as const;
export const AI_STORY_AUDIO_QC_RESULT_VERSION = "ai-story-audio-qc-result.v1" as const;
export const AI_STORY_AUDIO_QC_NATIVE_AV_DURATION_TOLERANCE_MS = 250 as const;
export const AI_STORY_AUDIO_QC_LOUDNESS_TOLERANCE_LU = 1 as const;
export const AI_STORY_AUDIO_QC_TRUE_PEAK_TOLERANCE_DB = 0.1 as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1).max(500);

export const AI_STORY_AUDIO_QC_EXPECTATION_KINDS = [
  "SILENT_OUTPUT",
  "NATIVE_CHARACTER_DIALOGUE",
  "TTS_SPEECH",
  "FINAL_AUDIO_MIX",
  "PRESERVE_SOURCE_AUDIO",
  "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
] as const;

export const AI_STORY_AUDIO_QC_RESULTS = [
  "PASS",
  "FAIL",
  "HUMAN_REVIEW_REQUIRED",
  "NOT_APPLICABLE",
] as const;

export const AI_STORY_AUDIO_QC_DIMENSIONS = [
  "TECHNICAL_AUDIO_STREAM",
  "NATIVE_AV_DURATION",
  "VOICE_DNA_LINEAGE",
  "SEMANTIC_VOICE_AUTHORITY_LINEAGE",
  "EXACT_ACOUSTIC_IDENTITY",
  "CAPABILITY_TTS_LINEAGE",
  "REFERENCE_AUDIO_AUTHORITY",
  "SPEAKER_ISOLATION",
  "DIALOGUE_AUDIO_PRESENCE",
  "DETACHED_TTS_EXCLUSIVITY",
  "DIALOGUE_TEXT_LINEAGE",
  "FINAL_MIX_AUTHORITY",
  "LOUDNESS",
  "TRUE_PEAK",
  "DUCKING_AUTHORITY",
  "SPEECH_TRACK_COHERENCE",
  "SPEECH_CONTENT",
  "JL_CUT_COHERENCE",
  "HUMAN_PERFORMANCE",
] as const;

export const AI_STORY_AUDIO_QC_FINDING_CODES = [
  "UNEXPECTED_AUDIO_STREAM",
  "EXPECTED_DIALOGUE_AUDIO_MISSING",
  "EXPECTED_TTS_RESULT_MISSING",
  "PRESERVED_AUDIO_MISSING",
  "MEDIA_NOT_DECODABLE",
  "NATIVE_AV_DURATION_MISMATCH",
  "NATIVE_AV_STREAM_MISSING",
  "VOICE_DNA_LINEAGE_MISMATCH",
  "SPEAKER_VOICE_AUTHORITY_MISMATCH",
  "DETACHED_TTS_SUBSTITUTION",
  "CAPABILITY_TTS_LINEAGE_MISMATCH",
  "REFERENCE_AUDIO_EXECUTION_UNSUPPORTED",
  "REFERENCE_AUDIO_LINEAGE_MISMATCH",
  "LOUDNESS_OUT_OF_POLICY",
  "TRUE_PEAK_OUT_OF_POLICY",
  "FINAL_MIX_LINEAGE_MISMATCH",
  "DUCKING_AUTHORITY_MISSING",
  "TRACK_COUNT_MISMATCH",
  "JL_CUT_MISMATCH",
  "AUDIO_QC_SCOPE_MISMATCH",
  "DIALOGUE_AUTHORITY_MISMATCH",
  "AUDIO_QC_EXPECTATION_MISMATCH",
] as const;

export const AI_STORY_AUDIO_QC_HUMAN_DIMENSIONS = [
  "LIP_SYNC",
  "DIALOGUE_NATURALNESS",
  "VOICE_SEMANTIC_CONTINUITY",
  "ACCENT_NATURALNESS",
  "EMOTIONAL_DELIVERY",
  "SPEECH_INTELLIGIBILITY",
  "BGM_SPEECH_BALANCE",
  "PHRASE_EMPHASIS",
  "MICRO_PAUSES",
  "DIALOGUE_EXACT_WORDING",
] as const;

const HumanState = z.enum(["PASS", "FAIL", "HUMAN_REVIEW_REQUIRED", "NOT_RUN"]);

export const AiStoryAudioQcMediaFactsSchema = z.object({
  hasVideoStream: z.boolean(),
  hasAudioStream: z.boolean(),
  videoDurationMs: z.number().int().positive().nullable(),
  audioDurationMs: z.number().int().positive().nullable(),
  audioCodec: Text.nullable(),
  sampleRate: z.number().int().positive().nullable(),
  channelCount: z.number().int().positive().nullable(),
  decodable: z.boolean(),
  mediaContentHash: Hash,
}).strict();
export type AiStoryAudioQcMediaFacts = z.infer<typeof AiStoryAudioQcMediaFactsSchema>;

export const AiStoryAudioQcExpectationSchema = z.object({
  audioQcExpectationId: Id,
  contractVersion: z.literal(AI_STORY_AUDIO_QC_EXPECTATION_VERSION),
  applicability: z.enum(["REQUIRED", "NOT_REQUIRED"]),
  expectationKind: z.enum(AI_STORY_AUDIO_QC_EXPECTATION_KINDS),
  orgId: Id,
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  speakerRole: z.enum(["CHARACTER", "NARRATION", "NONE"]),
  speakerReusableCharacterId: Id.nullable(),
  voiceDnaId: Id.nullable(),
  voiceDnaFingerprint: Hash.nullable(),
  voiceConsistencyMode: z.enum([
    "DESCRIPTIVE_VOICE_DNA",
    "CAPABILITY_VOICE_BINDING",
    "REFERENCE_AUDIO_IDENTITY",
  ]).nullable(),
  reusableCharacterId: Id.nullable(),
  reusableCharacterVersionId: Id.nullable(),
  voiceCapabilityId: Id.nullable(),
  referenceAudioAssetId: Id.nullable(),
  referenceAudioContentHash: Hash.nullable(),
  referenceAudioExecutionSupported: z.boolean().nullable(),
  episodeVoiceDnaId: Id.nullable(),
  episodeVoiceDnaFingerprint: Hash.nullable(),
  dialogueAuthorityId: Id.nullable(),
  dialogueFingerprint: Hash.nullable(),
  dialogueVoiceDnaId: Id.nullable(),
  dialogueVoiceDnaFingerprint: Hash.nullable(),
  speechSegmentId: Id.nullable(),
  semanticInstructionFingerprint: Hash.nullable(),
  audioPlanId: Id.nullable(),
  audioPlanFingerprint: Hash.nullable(),
  audioMixFingerprint: Hash.nullable(),
  mixPolicy: AiStoryAudioMixPolicySchema.nullable(),
  speechTrackCount: z.number().int().nonnegative(),
  musicTrackCount: z.number().int().nonnegative(),
  ambienceTrackCount: z.number().int().nonnegative(),
  sfxTrackCount: z.number().int().nonnegative(),
  duckingRuleCount: z.number().int().nonnegative(),
  jCutCount: z.number().int().nonnegative(),
  lCutCount: z.number().int().nonnegative(),
  preservedContentHash: Hash.nullable(),
  audioExpectationFingerprint: Hash,
}).strict();
export type AiStoryAudioQcExpectation = z.infer<typeof AiStoryAudioQcExpectationSchema>;

export const AiStoryAudioQcEvidenceSchema = z.object({
  orgId: Id,
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  mediaAssetId: Id,
  generationResultId: Id.nullable(),
  providerAttemptId: z.string().trim().min(1).max(300).nullable(),
  mediaFacts: AiStoryAudioQcMediaFactsSchema,
  nativeDurationToleranceMs: z.number().int().min(0).max(AI_STORY_AUDIO_QC_NATIVE_AV_DURATION_TOLERANCE_MS).nullable(),
  executedDialogueAuthorityId: Id.nullable(),
  executedDialogueFingerprint: Hash.nullable(),
  durableVoiceDna: z.object({
    voiceDnaId: Id,
    voiceDnaFingerprint: Hash,
    orgId: Id,
    workspaceId: Id,
    reusableCharacterId: Id,
    reusableCharacterVersionId: Id,
    consistencyMode: z.enum([
      "DESCRIPTIVE_VOICE_DNA",
      "CAPABILITY_VOICE_BINDING",
      "REFERENCE_AUDIO_IDENTITY",
    ]),
    voiceCapabilityId: Id.nullable(),
    referenceAudioAssetId: Id.nullable(),
    referenceAudioContentHash: Hash.nullable(),
  }).strict().nullable(),
  semanticInstructionFingerprint: Hash.nullable(),
  ttsRequest: z.object({
    fingerprint: Hash,
    voiceCapabilityId: Id,
    speechSegmentId: Id,
    speakerAuthorityId: Id,
  }).strict().nullable(),
  ttsResult: z.object({
    requestFingerprint: Hash,
    voiceCapabilityId: Id,
    speechSegmentId: Id,
    contentHash: Hash,
    durationMs: z.number().int().positive(),
    audioAssetId: Id,
  }).strict().nullable(),
  finalMix: z.object({
    audioPlanId: Id,
    audioMixFingerprint: Hash,
    finalContentHash: Hash,
    durationMs: z.number().int().positive(),
    sampleRate: z.number().int().positive(),
    channelCount: z.number().int().positive(),
    measuredIntegratedLufs: z.number(),
    measuredTruePeakDbfs: z.number(),
    speechSegmentCount: z.number().int().nonnegative(),
    musicTrackCount: z.number().int().nonnegative(),
    ambienceTrackCount: z.number().int().nonnegative(),
    sfxTrackCount: z.number().int().nonnegative(),
    jCutCount: z.number().int().nonnegative(),
    lCutCount: z.number().int().nonnegative(),
  }).strict().nullable(),
  detachedTtsUsed: z.boolean(),
  humanReview: z.object({
    lipSync: HumanState.optional(),
    dialogueNaturalness: HumanState.optional(),
    voiceSemanticContinuity: HumanState.optional(),
    accentNaturalness: HumanState.optional(),
    emotionalDelivery: HumanState.optional(),
    speechIntelligibility: HumanState.optional(),
    bgmSpeechBalance: HumanState.optional(),
    phraseEmphasis: HumanState.optional(),
    microPauses: HumanState.optional(),
    dialogueExactWording: HumanState.optional(),
  }).strict().nullable(),
}).strict();
export type AiStoryAudioQcEvidence = z.infer<typeof AiStoryAudioQcEvidenceSchema>;

export const AiStoryAudioQcDimensionResultSchema = z.object({
  dimension: z.enum(AI_STORY_AUDIO_QC_DIMENSIONS),
  result: z.enum(AI_STORY_AUDIO_QC_RESULTS),
  findingCode: z.enum(AI_STORY_AUDIO_QC_FINDING_CODES).nullable(),
}).strict();

export const AiStoryAudioQcFindingSchema = z.object({
  code: z.enum(AI_STORY_AUDIO_QC_FINDING_CODES),
  dimension: z.enum(AI_STORY_AUDIO_QC_DIMENSIONS),
  message: Text,
}).strict();

export const AiStoryAudioQcResultSchema = z.object({
  audioQcResultId: Id,
  contractVersion: z.literal(AI_STORY_AUDIO_QC_RESULT_VERSION),
  expectationKind: z.enum(AI_STORY_AUDIO_QC_EXPECTATION_KINDS),
  orgId: Id,
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  generationResultId: Id.nullable(),
  providerAttemptId: z.string().trim().min(1).max(300).nullable(),
  mediaAssetId: Id,
  mediaContentHash: Hash,
  audioExpectationFingerprint: Hash,
  voiceDnaId: Id.nullable(),
  voiceDnaFingerprint: Hash.nullable(),
  dialogueAuthorityId: Id.nullable(),
  dialogueFingerprint: Hash.nullable(),
  audioPlanId: Id.nullable(),
  audioPlanFingerprint: Hash.nullable(),
  evaluatedDimensions: z.array(AiStoryAudioQcDimensionResultSchema),
  overallResult: z.enum(AI_STORY_AUDIO_QC_RESULTS),
  blockingFindings: z.array(AiStoryAudioQcFindingSchema),
  humanReviewRequirements: z.array(z.enum(AI_STORY_AUDIO_QC_HUMAN_DIMENSIONS)),
  qcFingerprint: Hash,
  evaluatedAt: z.string().datetime(),
}).strict();
export type AiStoryAudioQcResult = z.infer<typeof AiStoryAudioQcResultSchema>;

const EXPECTATION_LABEL: Record<AiStoryAudioQcExpectation["expectationKind"], string> = {
  SILENT_OUTPUT: "Silent output",
  NATIVE_CHARACTER_DIALOGUE: "Native character dialogue",
  TTS_SPEECH: "TTS speech",
  FINAL_AUDIO_MIX: "Final audio mix",
  PRESERVE_SOURCE_AUDIO: "Preserved source audio",
  NO_DIALOGUE_WITH_AMBIENT_AUDIO: "No dialogue with ambient audio",
};

function dimensionResult(
  result: AiStoryAudioQcResult,
  dimension: z.infer<typeof AiStoryAudioQcDimensionResultSchema>["dimension"]
): string {
  return result.evaluatedDimensions.find((item) => item.dimension === dimension)?.result ?? "NOT_APPLICABLE";
}

export function describeAudioQcResult(result: AiStoryAudioQcResult | null): {
  expectation: string;
  technicalAudio: string;
  voiceIdentityLineage: string;
  dialogueAudio: string;
  humanReview: string;
  overallResult: string;
} {
  if (!result || result.overallResult === "NOT_APPLICABLE") {
    return {
      expectation: "Not applicable",
      technicalAudio: "Not applicable",
      voiceIdentityLineage: "Not applicable",
      dialogueAudio: "Not applicable",
      humanReview: "Not required",
      overallResult: "NOT_APPLICABLE",
    };
  }
  const technical = dimensionResult(result, "TECHNICAL_AUDIO_STREAM");
  const voice = dimensionResult(result, "VOICE_DNA_LINEAGE");
  const dialogue = dimensionResult(result, "DIALOGUE_AUDIO_PRESENCE");
  const human = result.humanReviewRequirements.length > 0 ? "Review required" : "Not required";
  const silent = result.expectationKind === "SILENT_OUTPUT" && technical === "PASS";
  return {
    expectation: EXPECTATION_LABEL[result.expectationKind],
    technicalAudio: silent ? "Audio stream: None" : technical,
    voiceIdentityLineage: voice,
    dialogueAudio: dialogue,
    humanReview: human,
    overallResult: result.overallResult,
  };
}

type Dimension = z.infer<typeof AiStoryAudioQcDimensionResultSchema>;

export function describeAudioQcExpectationKind(
  kind: AiStoryAudioQcExpectation["expectationKind"] | null
): string {
  return kind ? EXPECTATION_LABEL[kind] : "Not applicable";
}

export type AiStoryAudioQcDimensionDraft = Dimension;
