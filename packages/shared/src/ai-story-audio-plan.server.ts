import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_AUDIO_MIX_CONTRACT_VERSION,
  AI_STORY_AUDIO_PLAN_CONTRACT_VERSION,
  AI_STORY_AUDIO_POLICY_VERSION,
  AI_STORY_TTS_REQUEST_CONTRACT_VERSION,
  AiStoryAudioMixExecutionPlanSchema,
  AiStoryAudioPlanSchema,
  AiStoryTtsExecutionRequestSchema,
  type AiStoryAudioFailureCode,
  type AiStoryAudioMixExecutionPlan,
  type AiStoryAudioPlan,
  type AiStoryAudioSourceMedia,
  type AiStorySpeechSegment,
  type AiStoryTtsExecutionRequest,
  type AiStoryTtsExecutionResult,
  type AiStoryVoiceCapability,
} from "./ai-story-audio-plan";
import {
  computeAiStoryAssemblyV2Fingerprint,
} from "./ai-story-assembly-v2.server";
import type {
  AiStoryAssemblyV2Plan,
  AiStoryAssemblyV2ResolvedTimelineEntry,
} from "./ai-story-assembly-v2";

export class AiStoryAudioAuthorityError extends Error {
  constructor(
    readonly code: AiStoryAudioFailureCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryAudioAuthorityError";
  }
}

const fail = (code: AiStoryAudioFailureCode, message: string): never => {
  throw new AiStoryAudioAuthorityError(code, message);
};

export type FrozenScriptSpeechEntry = {
  readonly sourceScriptEntryId: string;
  readonly speakerAuthorityId: string;
  readonly exactText: string;
};

export function computeAiStoryAudioPlanSourceHash(input: {
  storyId: string;
  storyVersionId: string;
  scriptVersionId: string;
  editorialPlanId: string;
  editorialFingerprint: string;
  assemblyV2PlanId: string;
  assemblyV2Fingerprint: string;
  frozenScriptEntries: readonly FrozenScriptSpeechEntry[];
}): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_AUDIO_PLAN_CONTRACT_VERSION,
    policyVersion: AI_STORY_AUDIO_POLICY_VERSION,
    ...input,
  });
}

export function computeAiStoryAudioPlanFingerprint(
  input: Pick<
    AiStoryAudioPlan,
    | "storyId"
    | "storyVersionId"
    | "scriptVersionId"
    | "editorialPlanId"
    | "editorialFingerprint"
    | "assemblyV2PlanId"
    | "assemblyV2Fingerprint"
    | "speechTracks"
    | "musicTracks"
    | "ambienceTracks"
    | "sfxTracks"
    | "duckingRules"
    | "mixPolicy"
    | "sourceHash"
    | "supersedesAudioPlanId"
  >
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_AUDIO_PLAN_CONTRACT_VERSION,
    policyVersion: AI_STORY_AUDIO_POLICY_VERSION,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    scriptVersionId: input.scriptVersionId,
    editorialPlanId: input.editorialPlanId,
    editorialFingerprint: input.editorialFingerprint,
    assemblyV2PlanId: input.assemblyV2PlanId,
    assemblyV2Fingerprint: input.assemblyV2Fingerprint,
    speechTracks: input.speechTracks,
    musicTracks: input.musicTracks,
    ambienceTracks: input.ambienceTracks,
    sfxTracks: input.sfxTracks,
    duckingRules: input.duckingRules,
    mixPolicy: input.mixPolicy,
    sourceHash: input.sourceHash,
    supersedesAudioPlanId: input.supersedesAudioPlanId,
  });
}

export function validateAiStoryAudioPlanScriptAuthority(
  plan: AiStoryAudioPlan,
  frozenScriptEntries: readonly FrozenScriptSpeechEntry[]
): void {
  const scriptById = new Map(
    frozenScriptEntries.map((entry) => [entry.sourceScriptEntryId, entry])
  );
  for (const segment of plan.speechTracks) {
    const source = scriptById.get(segment.sourceScriptEntryId);
    if (
      !source ||
      source.speakerAuthorityId !== segment.speakerAuthorityId ||
      source.exactText !== segment.text ||
      segment.subtitleBinding.exactText !== segment.text
    ) {
      fail(
        "TTS_REQUEST_INVALID",
        `Speech segment ${segment.speechSegmentId} does not preserve exact frozen Script text and speaker`
      );
    }
  }
}

function pairSupported(
  capability: AiStoryVoiceCapability,
  primaryLocale: string,
  secondaryLocale: string
): boolean {
  return capability.supportedCodeSwitchPairs.some(
    (pair) =>
      pair.primaryLocale === primaryLocale &&
      pair.secondaryLocale === secondaryLocale
  );
}

export function selectAiStoryVoiceCapability(input: {
  readonly segment: AiStorySpeechSegment;
  readonly capabilities: readonly AiStoryVoiceCapability[];
}): AiStoryVoiceCapability {
  const selected = input.capabilities
    .filter((candidate) => {
      if (
        candidate.certificationStatus === "UNSUPPORTED" ||
        !candidate.supportedLocales.includes(input.segment.primaryLocale) ||
        !candidate.supportedDeliveryStyles.includes(input.segment.deliveryStyle)
      ) {
        return false;
      }
      if (
        input.segment.voiceSelection.genderPresentation &&
        !candidate.supportedGenderPresentations.includes(
          input.segment.voiceSelection.genderPresentation
        )
      ) {
        return false;
      }
      if (
        input.segment.voiceSelection.ageRangePresentation &&
        !candidate.supportedAgeRangePresentations.includes(
          input.segment.voiceSelection.ageRangePresentation
        )
      ) {
        return false;
      }
      if (
        !candidate.supportedBrandTones.includes(
          input.segment.voiceSelection.brandTone
        )
      ) {
        return false;
      }
      return input.segment.secondaryLocales.every((locale) =>
        pairSupported(candidate, input.segment.primaryLocale, locale)
      );
    })
    .sort((left, right) =>
      left.voiceCapabilityId.localeCompare(right.voiceCapabilityId)
    )[0];
  if (!selected) {
    fail(
      "VOICE_CAPABILITY_UNSUPPORTED",
      "No voice capability truthfully satisfies frozen speech authority"
    );
  }
  return selected;
}

export function assertAiStoryVoiceCapability(input: {
  segment: AiStorySpeechSegment;
  capability: AiStoryVoiceCapability;
  outputFormat: "mp3" | "wav" | "aac";
}): void {
  const { segment, capability } = input;
  if (
    capability.certificationStatus === "UNSUPPORTED" ||
    capability.voiceCapabilityId !== segment.voiceSelection.voiceCapabilityId ||
    capability.providerVoiceRef !== segment.voiceSelection.providerVoiceRef
  ) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Selected voice capability is not certified or exactly bound");
  }
  if (!capability.supportedLocales.includes(segment.primaryLocale)) {
    fail("LOCALE_UNSUPPORTED", `Voice does not support ${segment.primaryLocale}`);
  }
  if (!capability.supportedDeliveryStyles.includes(segment.deliveryStyle)) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", `Voice does not support ${segment.deliveryStyle}`);
  }
  if (
    segment.voiceSelection.genderPresentation &&
    !capability.supportedGenderPresentations.includes(
      segment.voiceSelection.genderPresentation
    )
  ) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Voice does not support the explicitly requested gender presentation");
  }
  if (
    segment.voiceSelection.ageRangePresentation &&
    !capability.supportedAgeRangePresentations.includes(
      segment.voiceSelection.ageRangePresentation
    )
  ) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Voice does not support the explicitly requested age presentation");
  }
  if (!capability.supportedBrandTones.includes(segment.voiceSelection.brandTone)) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Voice does not support the frozen brand tone");
  }
  if (segment.text.length > capability.maxCharacters) {
    fail("TTS_REQUEST_INVALID", "Speech text exceeds voice capability limit");
  }
  if (!capability.audioFormats.includes(input.outputFormat)) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Requested audio format is unsupported");
  }
  if (
    segment.codeSwitchPolicy.mode === "DISABLED" &&
    segment.secondaryLocales.length > 0
  ) {
    fail("CODE_SWITCH_UNSUPPORTED", "Code-switch locales exist while policy is disabled");
  }
  if (
    segment.codeSwitchPolicy.mode === "REQUIRED" &&
    segment.secondaryLocales.length === 0
  ) {
    fail("CODE_SWITCH_UNSUPPORTED", "Required code-switch has no secondary locale");
  }
  for (const locale of segment.secondaryLocales) {
    if (
      !segment.codeSwitchPolicy.allowedLocales.includes(locale) ||
      !capability.supportedLocales.includes(locale) ||
      !pairSupported(capability, segment.primaryLocale, locale)
    ) {
      fail(
        "CODE_SWITCH_UNSUPPORTED",
        `Voice does not certify ${segment.primaryLocale} → ${locale} code-switch`
      );
    }
  }
}

export function computeAiStoryTtsRequestFingerprint(
  input: Omit<AiStoryTtsExecutionRequest, "ttsRequestId" | "fingerprint">
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_TTS_REQUEST_CONTRACT_VERSION,
    speechSegmentId: input.speechSegmentId,
    sourceScriptEntryId: input.sourceScriptEntryId,
    exactText: input.exactText,
    speakerAuthorityId: input.speakerAuthorityId,
    primaryLocale: input.primaryLocale,
    secondaryLocales: input.secondaryLocales,
    deliveryStyle: input.deliveryStyle,
    voiceCapabilityId: input.voiceCapabilityId,
    providerId: input.providerId,
    providerModel: input.providerModel,
    providerVoiceRef: input.providerVoiceRef,
    prosody: input.prosody,
    outputFormat: input.outputFormat,
    expectedDurationPolicy: input.expectedDurationPolicy,
  });
}

export function compileAiStoryTtsExecutionRequest(input: {
  segment: AiStorySpeechSegment;
  capability: AiStoryVoiceCapability;
  outputFormat: "mp3" | "wav" | "aac";
  speed?: number;
  pitchSemitones?: number;
}): AiStoryTtsExecutionRequest {
  assertAiStoryVoiceCapability(input);
  const speed = input.speed ?? 1;
  const pitchSemitones = input.pitchSemitones ?? 0;
  if (speed !== 1 && !input.capability.supportsSpeedControl) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Voice does not support speed control");
  }
  if (pitchSemitones !== 0 && !input.capability.supportsPitchControl) {
    fail("VOICE_CAPABILITY_UNSUPPORTED", "Voice does not support pitch control");
  }
  const withoutIdentity = {
    contractVersion: AI_STORY_TTS_REQUEST_CONTRACT_VERSION,
    speechSegmentId: input.segment.speechSegmentId,
    sourceScriptEntryId: input.segment.sourceScriptEntryId,
    exactText: input.segment.text,
    speakerAuthorityId: input.segment.speakerAuthorityId,
    primaryLocale: input.segment.primaryLocale,
    secondaryLocales: [...input.segment.secondaryLocales],
    deliveryStyle: input.segment.deliveryStyle,
    voiceCapabilityId: input.capability.voiceCapabilityId,
    providerId: input.capability.providerId,
    providerModel: input.capability.providerModel,
    providerVoiceRef: input.capability.providerVoiceRef,
    prosody: {
      speed,
      pitchSemitones,
      emotionIntent: input.segment.emotionIntent,
    },
    outputFormat: input.outputFormat,
    expectedDurationPolicy: "SOURCE_AUDIO_MEASURED_AT_EXECUTION" as const,
  };
  const fingerprint = computeAiStoryTtsRequestFingerprint(withoutIdentity);
  return AiStoryTtsExecutionRequestSchema.parse({
    ...withoutIdentity,
    ttsRequestId: deterministicUuidFromFingerprint(
      "ai-story-tts-request",
      fingerprint
    ),
    fingerprint,
  });
}

function assertFrozenPlan(
  audioPlan: AiStoryAudioPlan,
  assemblyPlan: AiStoryAssemblyV2Plan
): void {
  if (audioPlan.status !== "FROZEN") {
    fail("MIX_POLICY_INVALID", "Audio Mix requires a frozen Audio Plan");
  }
  if (
    computeAiStoryAudioPlanFingerprint(audioPlan) !== audioPlan.audioPlanFingerprint
  ) {
    fail("MIX_POLICY_INVALID", "Frozen Audio Plan fingerprint is stale");
  }
  if (
    audioPlan.assemblyV2PlanId !== assemblyPlan.assemblyV2PlanId ||
    audioPlan.assemblyV2Fingerprint !== assemblyPlan.assemblyFingerprint ||
    computeAiStoryAssemblyV2Fingerprint(assemblyPlan) !==
      assemblyPlan.assemblyFingerprint
  ) {
    fail("MIX_POLICY_INVALID", "Audio Plan is not bound to the exact Assembly V2 Plan");
  }
}

type EntryTiming = {
  entry: AiStoryAssemblyV2ResolvedTimelineEntry;
  startMs: number;
  endMs: number;
};

function assemblyTimings(plan: AiStoryAssemblyV2Plan): EntryTiming[] {
  let cursor = 0;
  return plan.resolvedTimeline.map((entry) => {
    cursor -= entry.transitionFromPrevious.durationMs;
    const startMs = cursor;
    const endMs = startMs + entry.trimWindow.durationMs;
    cursor = endMs;
    return { entry, startMs, endMs };
  });
}

function anchorTime(
  timeline: readonly EntryTiming[],
  timelineEntryId: string,
  offsetMs: number,
  edge: "START" | "END"
): number {
  const timing =
    timeline.find(
      (candidate) => candidate.entry.timelineEntryId === timelineEntryId
    ) ??
    fail("SPEECH_TIMING_INVALID", "Audio anchor does not bind an editorial entry");
  return (edge === "START" ? timing.startMs : timing.endMs) + offsetMs;
}

function sourceFor(
  sources: readonly AiStoryAudioSourceMedia[],
  sourceAssetId: string,
  expectedHash: string,
  missingCode:
    | "BGM_SOURCE_MISSING"
    | "AMBIENCE_SOURCE_MISSING"
    | "SFX_SOURCE_MISSING"
): AiStoryAudioSourceMedia {
  const source =
    sources.find((candidate) => candidate.sourceAssetId === sourceAssetId) ??
    fail(missingCode, `Audio source ${sourceAssetId} is missing`);
  if (source.contentHash !== expectedHash) {
    fail("AUDIO_SOURCE_HASH_MISMATCH", "Audio source hash does not match frozen authority");
  }
  return source;
}

export function computeAiStoryAudioMixFingerprint(
  input: Omit<AiStoryAudioMixExecutionPlan, "audioMixPlanId" | "fingerprint">
): string {
  return sha256CanonicalIntegrityHash({
    contractVersion: AI_STORY_AUDIO_MIX_CONTRACT_VERSION,
    audioPlanId: input.audioPlanId,
    audioPlanFingerprint: input.audioPlanFingerprint,
    assemblyV2PlanId: input.assemblyV2PlanId,
    assemblyV2Fingerprint: input.assemblyV2Fingerprint,
    assemblyV2VideoContentHash: input.assemblyV2VideoContentHash,
    mode: input.mode,
    videoDurationMs: input.videoDurationMs,
    resolvedTracks: input.resolvedTracks,
    duckingRules: input.duckingRules,
    mixPolicy: input.mixPolicy,
    subtitleSpeechTiming: input.subtitleSpeechTiming,
  });
}

export function compileAiStoryAudioMixExecutionPlan(input: {
  audioPlan: AiStoryAudioPlan;
  assemblyPlan: AiStoryAssemblyV2Plan;
  assemblyV2VideoContentHash: string;
  ttsRequests: readonly AiStoryTtsExecutionRequest[];
  ttsResults: readonly AiStoryTtsExecutionResult[];
  audioSources: readonly AiStoryAudioSourceMedia[];
  authorizedActionAuthorityIds: readonly string[];
}): AiStoryAudioMixExecutionPlan {
  assertFrozenPlan(input.audioPlan, input.assemblyPlan);
  const timeline = assemblyTimings(input.assemblyPlan);
  const videoDurationMs = input.assemblyPlan.expectedOutputDurationMs;
  const resolvedTracks: AiStoryAudioMixExecutionPlan["resolvedTracks"] = [];
  const ttsBySegment = new Map(
    input.ttsResults.map((result) => [result.speechSegmentId, result])
  );
  const requestBySegment = new Map(
    input.ttsRequests.map((request) => [request.speechSegmentId, request])
  );

  for (const segment of input.audioPlan.speechTracks) {
    const request =
      requestBySegment.get(segment.speechSegmentId) ??
      fail("TTS_REQUEST_INVALID", `Speech ${segment.speechSegmentId} has no frozen TTS request`);
    const result =
      ttsBySegment.get(segment.speechSegmentId) ??
      fail("TTS_OUTPUT_INVALID", `Speech ${segment.speechSegmentId} has no exact TTS result`);
    if (
      request.exactText !== segment.text ||
      request.sourceScriptEntryId !== segment.sourceScriptEntryId ||
      request.speakerAuthorityId !== segment.speakerAuthorityId
    ) {
      fail("TTS_REQUEST_INVALID", "Frozen TTS request rewrites or misbinds Script authority");
    }
    if (
      result.voiceCapabilityId !== segment.voiceSelection.voiceCapabilityId ||
      result.requestFingerprint !== request.fingerprint
    ) {
      fail("TTS_OUTPUT_STALE", `Speech ${segment.speechSegmentId} TTS output is stale`);
    }
    const anchor =
      timeline.find(
        (timing) =>
          timing.entry.timelineEntryId === segment.timelineAnchor.timelineEntryId
      ) ?? fail("SPEECH_TIMING_INVALID", "Speech anchor is unresolved");
    const anchorIndex = timeline.indexOf(anchor);
    const nextAnchor = timeline[anchorIndex + 1];
    let baseStartMs: number;
    switch (segment.timelineAnchor.relation) {
      case "SHOT_START":
        baseStartMs = anchor.startMs + segment.timelineAnchor.offsetMs;
        break;
      case "AFTER_VISUAL_EVENT":
        if (
          segment.startIntent !== "AFTER_VISUAL_EVENT" ||
          segment.timelineAnchor.offsetMs < 0
        ) {
          fail("SPEECH_TIMING_INVALID", "After-event speech requires a non-negative event offset");
        }
        baseStartMs = anchor.startMs + segment.timelineAnchor.offsetMs;
        break;
      case "BEFORE_NEXT_SHOT":
        if (!nextAnchor || segment.timelineAnchor.offsetMs > 0) {
          fail("SPEECH_TIMING_INVALID", "Before-next-shot speech requires a next beat and non-positive offset");
        }
        baseStartMs = nextAnchor.startMs + segment.timelineAnchor.offsetMs;
        break;
      case "CONTINUE_INTO_NEXT_SHOT":
        if (!segment.lCutIntent.enabled) {
          fail("J_L_CUT_INVALID", "Continue-into-next-shot requires L-cut authority");
        }
        baseStartMs = anchor.startMs + segment.timelineAnchor.offsetMs;
        break;
      case "FINISH_BEFORE_CTA":
        baseStartMs = anchor.startMs + segment.timelineAnchor.offsetMs;
        break;
    }
    let startMs = baseStartMs;
    if (segment.jCutIntent.enabled) {
      if (segment.timelineAnchor.relation !== "SHOT_START") {
        fail("J_L_CUT_INVALID", "J-cut must bind the start of its incoming visual beat");
      }
      startMs = baseStartMs - segment.jCutIntent.overlapMs;
      const previousAnchor = timeline[anchorIndex - 1];
      if (
        !previousAnchor ||
        startMs < 0 ||
        startMs < previousAnchor.startMs ||
        startMs >= anchor.startMs ||
        (!segment.jCutIntent.allowCrossScene &&
          previousAnchor.entry.sceneId !== anchor.entry.sceneId)
      ) {
        fail("J_L_CUT_INVALID", "J-cut exceeds its authorized semantic boundary");
      }
    } else if (startMs < anchor.startMs) {
      fail("J_L_CUT_INVALID", "Speech starts before its visual anchor without J-cut authority");
    }
    const endMs = startMs + result.durationMs;
    const lOverlapMs = Math.max(0, endMs - anchor.endMs);
    if (segment.lCutIntent.enabled) {
      if (
        lOverlapMs <= 0 ||
        lOverlapMs > segment.lCutIntent.overlapMs ||
        (!segment.lCutIntent.allowCrossScene &&
          timeline[timeline.indexOf(anchor) + 1]?.entry.sceneId !== anchor.entry.sceneId)
      ) {
        fail("J_L_CUT_INVALID", "L-cut exceeds or does not reach its authorized boundary");
      }
    } else if (lOverlapMs > 0) {
      fail("J_L_CUT_INVALID", "Speech continues after its visual beat without L-cut authority");
    }
    if (endMs > videoDurationMs) {
      fail("SPEECH_TIMING_INVALID", "Speech extends beyond final video duration");
    }
    if (
      segment.endIntent === "FINISH_BEFORE_CTA" ||
      segment.timelineAnchor.relation === "FINISH_BEFORE_CTA"
    ) {
      const cta = timeline.find(
        (timing) =>
          timing.startMs >= anchor.startMs &&
          timing.entry.editorialRole === "CTA"
      );
      if (!cta || endMs > cta.startMs) {
        fail("SPEECH_TIMING_INVALID", "Speech does not finish before the CTA boundary");
      }
    }
    resolvedTracks.push({
      trackId: segment.speechSegmentId,
      trackKind: "SPEECH",
      sourceAssetId: result.audioAssetId,
      contentHash: result.contentHash,
      startMs,
      endMs,
      sourceDurationMs: result.durationMs,
      sourceSampleRate: result.sampleRate,
      sourceChannelCount: result.channelCount,
      gainDb: input.audioPlan.mixPolicy.speechTargetDb,
      loop: false,
      fadeInMs: 0,
      fadeOutMs: 0,
      speechSegmentId: segment.speechSegmentId,
      exactScriptText: segment.text,
      jCutExecuted: segment.jCutIntent.enabled,
      lCutExecuted: segment.lCutIntent.enabled,
    });
  }

  const speech = resolvedTracks.filter((track) => track.trackKind === "SPEECH");
  for (let left = 0; left < speech.length; left += 1) {
    for (let right = left + 1; right < speech.length; right += 1) {
      const a = speech[left]!;
      const b = speech[right]!;
      const overlaps = a.startMs < b.endMs && b.startMs < a.endMs;
      const authorityA = input.audioPlan.speechTracks.find(
        (segment) => segment.speechSegmentId === a.speechSegmentId
      )!;
      const authorityB = input.audioPlan.speechTracks.find(
        (segment) => segment.speechSegmentId === b.speechSegmentId
      )!;
      if (overlaps && !(authorityA.allowSpeechOverlap && authorityB.allowSpeechOverlap)) {
        fail("AUDIO_OVERLAP_CONFLICT", "Speech segments collide without overlap authority");
      }
    }
  }

  for (const track of input.audioPlan.musicTracks) {
    const source = sourceFor(
      input.audioSources,
      track.sourceAssetId,
      track.contentHash,
      "BGM_SOURCE_MISSING"
    );
    const startMs = anchorTime(timeline, track.startAnchor.timelineEntryId, track.startAnchor.offsetMs, "START");
    const endMs = anchorTime(timeline, track.endAnchor.timelineEntryId, track.endAnchor.offsetMs, "END");
    resolvedTracks.push({
      trackId: track.musicTrackId,
      trackKind: "MUSIC",
      sourceAssetId: track.sourceAssetId,
      contentHash: track.contentHash,
      startMs,
      endMs,
      sourceDurationMs: source.durationMs,
      sourceSampleRate: source.sampleRate,
      sourceChannelCount: source.channelCount,
      gainDb: track.baseGainDb,
      loop: track.loopPolicy === "LOOP_TO_END",
      fadeInMs: track.fadeInMs,
      fadeOutMs: track.fadeOutMs,
      speechSegmentId: null,
      exactScriptText: null,
      jCutExecuted: false,
      lCutExecuted: false,
    });
  }
  for (const track of input.audioPlan.ambienceTracks) {
    const source = sourceFor(
      input.audioSources,
      track.sourceAssetId,
      track.contentHash,
      "AMBIENCE_SOURCE_MISSING"
    );
    const startMs = anchorTime(timeline, track.startAnchor.timelineEntryId, track.startAnchor.offsetMs, "START");
    const endMs = anchorTime(timeline, track.endAnchor.timelineEntryId, track.endAnchor.offsetMs, "END");
    resolvedTracks.push({
      trackId: track.ambienceTrackId,
      trackKind: "AMBIENCE",
      sourceAssetId: track.sourceAssetId,
      contentHash: track.contentHash,
      startMs,
      endMs,
      sourceDurationMs: source.durationMs,
      sourceSampleRate: source.sampleRate,
      sourceChannelCount: source.channelCount,
      gainDb: track.baseGainDb,
      loop: track.loopPolicy === "LOOP_TO_END",
      fadeInMs: 0,
      fadeOutMs: 0,
      speechSegmentId: null,
      exactScriptText: null,
      jCutExecuted: false,
      lCutExecuted: false,
    });
  }
  for (const track of input.audioPlan.sfxTracks) {
    if (!input.authorizedActionAuthorityIds.includes(track.actionAuthorityId)) {
      fail(
        "SFX_ACTION_AUTHORITY_INVALID",
        "SFX cue is not bound to an authorized Story action"
      );
    }
    const source = sourceFor(
      input.audioSources,
      track.sourceAssetId,
      track.contentHash,
      "SFX_SOURCE_MISSING"
    );
    const startMs = anchorTime(timeline, track.anchor.timelineEntryId, track.anchor.offsetMs, "START");
    const endMs = Math.min(videoDurationMs, startMs + source.durationMs);
    resolvedTracks.push({
      trackId: track.sfxTrackId,
      trackKind: "SFX",
      sourceAssetId: track.sourceAssetId,
      contentHash: track.contentHash,
      startMs,
      endMs,
      sourceDurationMs: source.durationMs,
      sourceSampleRate: source.sampleRate,
      sourceChannelCount: source.channelCount,
      gainDb: track.baseGainDb,
      loop: false,
      fadeInMs: 0,
      fadeOutMs: 0,
      speechSegmentId: null,
      exactScriptText: null,
      jCutExecuted: false,
      lCutExecuted: false,
    });
  }

  if (
    input.audioPlan.mixPolicy.duckingRequiredWhenSpeechAndMusic &&
    speech.length > 0 &&
    input.audioPlan.musicTracks.length > 0 &&
    input.audioPlan.duckingRules.length === 0
  ) {
    fail("MIX_POLICY_INVALID", "Speech and music require explicit ducking authority");
  }
  const speechIds = new Set(
    input.audioPlan.speechTracks.map((segment) => segment.speechSegmentId)
  );
  const musicIds = new Set(
    input.audioPlan.musicTracks.map((track) => track.musicTrackId)
  );
  if (input.audioPlan.duckingRules.length > 1) {
    fail(
      "MIX_POLICY_INVALID",
      "AUDIO_MIX_V1 supports one explicit global ducking rule; scoped multi-rule mixing is unsupported"
    );
  }
  for (const rule of input.audioPlan.duckingRules) {
    if (
      new Set(rule.speechSegmentIds).size !== speechIds.size ||
      new Set(rule.targetMusicTrackIds).size !== musicIds.size ||
      rule.speechSegmentIds.some((id) => !speechIds.has(id)) ||
      rule.targetMusicTrackIds.some((id) => !musicIds.has(id))
    ) {
      fail(
        "MIX_POLICY_INVALID",
        "AUDIO_MIX_V1 ducking rule must exactly cover all authoritative speech and music tracks"
      );
    }
  }
  if (
    speech.length > 0 &&
    input.audioPlan.musicTracks.some(
      (track) =>
        track.baseGainDb > input.audioPlan.mixPolicy.speechTargetDb - 3
    )
  ) {
    fail("MIX_POLICY_INVALID", "BGM base gain is too loud relative to speech");
  }
  for (const track of resolvedTracks) {
    if (track.startMs < 0 || track.endMs <= track.startMs || track.endMs > videoDurationMs) {
      fail("SPEECH_TIMING_INVALID", `Resolved ${track.trackKind} timing is invalid`);
    }
  }

  const withoutIdentity = {
    contractVersion: AI_STORY_AUDIO_MIX_CONTRACT_VERSION,
    audioPlanId: input.audioPlan.audioPlanId,
    audioPlanFingerprint: input.audioPlan.audioPlanFingerprint,
    assemblyV2PlanId: input.assemblyPlan.assemblyV2PlanId,
    assemblyV2Fingerprint: input.assemblyPlan.assemblyFingerprint,
    assemblyV2VideoContentHash: input.assemblyV2VideoContentHash,
    mode: "AUDIO_MIX_V1" as const,
    videoDurationMs,
    resolvedTracks,
    duckingRules: input.audioPlan.duckingRules,
    mixPolicy: input.audioPlan.mixPolicy,
    subtitleSpeechTiming: resolvedTracks
      .filter((track) => track.trackKind === "SPEECH")
      .map((track) => ({
        speechSegmentId: track.speechSegmentId!,
        startMs: track.startMs,
        endMs: track.endMs,
        exactScriptText: track.exactScriptText!,
      })),
  };
  const fingerprint = computeAiStoryAudioMixFingerprint(withoutIdentity);
  return AiStoryAudioMixExecutionPlanSchema.parse({
    ...withoutIdentity,
    audioMixPlanId: deterministicUuidFromFingerprint(
      "ai-story-audio-mix-plan",
      fingerprint
    ),
    fingerprint,
  });
}

export function finalizeAiStoryAudioPlan(input: {
  plan: Omit<AiStoryAudioPlan, "audioPlanFingerprint">;
  frozenScriptEntries: readonly FrozenScriptSpeechEntry[];
}): AiStoryAudioPlan {
  const expectedSourceHash = computeAiStoryAudioPlanSourceHash({
    storyId: input.plan.storyId,
    storyVersionId: input.plan.storyVersionId,
    scriptVersionId: input.plan.scriptVersionId,
    editorialPlanId: input.plan.editorialPlanId,
    editorialFingerprint: input.plan.editorialFingerprint,
    assemblyV2PlanId: input.plan.assemblyV2PlanId,
    assemblyV2Fingerprint: input.plan.assemblyV2Fingerprint,
    frozenScriptEntries: input.frozenScriptEntries,
  });
  if (input.plan.sourceHash !== expectedSourceHash) {
    fail("TTS_REQUEST_INVALID", "Audio Plan source hash is stale");
  }
  const audioPlanFingerprint = computeAiStoryAudioPlanFingerprint(input.plan);
  const plan = AiStoryAudioPlanSchema.parse({
    ...input.plan,
    audioPlanFingerprint,
  });
  validateAiStoryAudioPlanScriptAuthority(plan, input.frozenScriptEntries);
  return plan;
}
