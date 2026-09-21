import { createHash } from "node:crypto";
import {
  AiStoryTtsExecutionResultSchema,
  assertVisibleDialogueAudioAuthorityExclusive,
  computeAiStoryTtsRequestFingerprint,
  deterministicUuidFromFingerprint,
  type AiStoryCharacterDialoguePerformanceAuthority,
  type AiStoryTtsExecutionRequest,
  type AiStoryTtsExecutionResult,
  type AiStoryVoiceCapability,
} from "@ceo-agent/shared/server";
import { getOpenAI } from "../llm";

export type AiStoryTtsSynthesis = {
  readonly bytes: Buffer;
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly channelCount: number;
  readonly providerExecutionIdentity: string;
  readonly actualCostUsd: number | null;
};

export type AiStoryTtsAdapter = {
  readonly providerId: string;
  readonly synthesize: (
    request: AiStoryTtsExecutionRequest
  ) => Promise<AiStoryTtsSynthesis>;
};

export type AiStoryTtsCacheEntry = {
  readonly result: AiStoryTtsExecutionResult;
  readonly bytes: Buffer;
};

export type AiStoryTtsCache = {
  readonly get: (
    requestFingerprint: string
  ) => AiStoryTtsCacheEntry | null | Promise<AiStoryTtsCacheEntry | null>;
  readonly set: (
    requestFingerprint: string,
    entry: AiStoryTtsCacheEntry
  ) => void | Promise<void>;
};

export class AiStoryTtsMemoryCache implements AiStoryTtsCache {
  private readonly entries = new Map<string, AiStoryTtsCacheEntry>();

  get(requestFingerprint: string): AiStoryTtsCacheEntry | null {
    return this.entries.get(requestFingerprint) ?? null;
  }

  set(requestFingerprint: string, entry: AiStoryTtsCacheEntry): void {
    this.entries.set(requestFingerprint, entry);
  }
}

export function createOpenAiNeutralVoiceCapability(input: {
  readonly voiceCapabilityId: string;
  readonly providerVoiceRef: string;
  readonly supportedGenderPresentations?: AiStoryVoiceCapability["supportedGenderPresentations"];
  readonly supportedAgeRangePresentations?: AiStoryVoiceCapability["supportedAgeRangePresentations"];
  readonly supportedBrandTones?: string[];
}): AiStoryVoiceCapability {
  return {
    voiceCapabilityId: input.voiceCapabilityId,
    providerCapabilityRef: `openai/tts-1-hd/${input.providerVoiceRef}`,
    providerId: "openai",
    providerModel: "tts-1-hd",
    providerVoiceRef: input.providerVoiceRef,
    supportedLocales: ["en-SG", "en-MY", "ms-MY", "zh-SG", "zh-MY"],
    supportedDeliveryStyles: ["STANDARD_NEUTRAL"],
    supportedCodeSwitchPairs: [],
    supportsSSML: false,
    supportsProsodyControl: true,
    supportsEmotionControl: false,
    supportsSpeedControl: true,
    supportsPitchControl: false,
    supportedGenderPresentations: input.supportedGenderPresentations ?? [],
    supportedAgeRangePresentations: input.supportedAgeRangePresentations ?? [],
    supportedBrandTones: input.supportedBrandTones ?? ["STANDARD_NEUTRAL"],
    maxCharacters: 4096,
    audioFormats: ["mp3", "wav", "aac"],
    certificationStatus: "HUMAN_LISTENING_REVIEW_REQUIRED",
    version: 1,
  };
}

type ExecuteAiStoryTtsInput = {
  readonly request: AiStoryTtsExecutionRequest;
  readonly capability: AiStoryVoiceCapability;
  readonly adapter: AiStoryTtsAdapter;
  readonly cache: AiStoryTtsCache;
  readonly estimatedUsdPerMillionCharacters?: number;
  readonly nativeDialogueAuthorities?: readonly AiStoryCharacterDialoguePerformanceAuthority[];
};

function hashAudioBytes(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function executeAiStoryTtsRequestInternal(
  input: ExecuteAiStoryTtsInput,
  bypassCache: boolean
): Promise<AiStoryTtsCacheEntry> {
  if (input.nativeDialogueAuthorities?.length) {
    assertVisibleDialogueAudioAuthorityExclusive({
      nativeDialogueAuthorities: input.nativeDialogueAuthorities,
      detachedTtsBindings: [
        { dialogueEntryId: input.request.sourceScriptEntryId },
      ],
    });
  }
  if (
    computeAiStoryTtsRequestFingerprint(input.request) !==
    input.request.fingerprint
  ) {
    throw new Error("TTS_REQUEST_INVALID");
  }
  if (
    input.adapter.providerId !== input.request.providerId ||
    input.capability.certificationStatus === "UNSUPPORTED" ||
    input.capability.voiceCapabilityId !== input.request.voiceCapabilityId ||
    input.capability.providerModel !== input.request.providerModel ||
    input.capability.providerVoiceRef !== input.request.providerVoiceRef
  ) {
    throw new Error("TTS_REQUEST_INVALID");
  }
  if (!bypassCache) {
    const cached = await input.cache.get(input.request.fingerprint);
    if (cached) {
      if (
        cached.result.requestFingerprint !== input.request.fingerprint ||
        cached.result.speechSegmentId !== input.request.speechSegmentId ||
        cached.result.voiceCapabilityId !== input.request.voiceCapabilityId ||
        cached.result.contentHash !== hashAudioBytes(cached.bytes)
      ) {
        throw new Error("TTS_OUTPUT_STALE");
      }
      return { result: cached.result, bytes: Buffer.from(cached.bytes) };
    }
  }
  const synthesis = await input.adapter.synthesize(input.request);
  if (
    synthesis.bytes.length === 0 ||
    synthesis.durationMs <= 0 ||
    synthesis.sampleRate <= 0 ||
    synthesis.channelCount <= 0
  ) {
    throw new Error("TTS_OUTPUT_INVALID");
  }
  const contentHash = hashAudioBytes(synthesis.bytes);
  const ttsResultId = deterministicUuidFromFingerprint(
    "ai-story-tts-result",
    `${input.request.fingerprint}:${contentHash}`
  );
  const result = AiStoryTtsExecutionResultSchema.parse({
    ttsResultId,
    speechSegmentId: input.request.speechSegmentId,
    requestFingerprint: input.request.fingerprint,
    voiceCapabilityId: input.request.voiceCapabilityId,
    contentHash,
    durationMs: synthesis.durationMs,
    mediaType:
      input.request.outputFormat === "mp3"
        ? "audio/mpeg"
        : input.request.outputFormat === "wav"
          ? "audio/wav"
          : "audio/aac",
    sampleRate: synthesis.sampleRate,
    channelCount: synthesis.channelCount,
    providerExecutionIdentity: synthesis.providerExecutionIdentity,
    audioAssetId: deterministicUuidFromFingerprint(
      "ai-story-tts-audio-asset",
      contentHash
    ),
    usage: {
      characters: input.request.exactText.length,
      provider: input.request.providerId,
      model: input.request.providerModel,
      voice: input.request.providerVoiceRef,
      estimatedCostUsd:
        input.estimatedUsdPerMillionCharacters === undefined
          ? null
          : (input.request.exactText.length *
              input.estimatedUsdPerMillionCharacters) /
            1_000_000,
      actualCostUsd: synthesis.actualCostUsd,
    },
  });
  const entry = { result, bytes: synthesis.bytes };
  await input.cache.set(input.request.fingerprint, entry);
  return entry;
}

export async function executeAiStoryTtsRequest(
  input: ExecuteAiStoryTtsInput
): Promise<AiStoryTtsCacheEntry> {
  return executeAiStoryTtsRequestInternal(input, false);
}

export async function retryAiStoryTtsSegment(input: {
  readonly request: AiStoryTtsExecutionRequest;
  readonly capability: AiStoryVoiceCapability;
  readonly adapter: AiStoryTtsAdapter;
  readonly cache: AiStoryTtsCache;
  readonly authorization: {
    readonly speechSegmentId: string;
    readonly authorized: boolean;
    readonly attempt: number;
    readonly maxAttempts: number;
  };
  readonly estimatedUsdPerMillionCharacters?: number;
}): Promise<AiStoryTtsCacheEntry> {
  if (
    !input.authorization.authorized ||
    input.authorization.speechSegmentId !== input.request.speechSegmentId ||
    input.authorization.attempt < 1 ||
    input.authorization.attempt > input.authorization.maxAttempts ||
    input.authorization.maxAttempts > 2
  ) {
    throw new Error("TTS_RETRY_AUTHORITY_REQUIRED");
  }
  return executeAiStoryTtsRequestInternal(input, true);
}

export function createOpenAiStoryTtsAdapter(input: {
  readonly probeAudio: (
    bytes: Buffer,
    format: AiStoryTtsExecutionRequest["outputFormat"]
  ) => Promise<{ durationMs: number; sampleRate: number; channelCount: number }>;
  readonly requireExplicitPaidExecutionAuthorization: (
    request: AiStoryTtsExecutionRequest
  ) => Promise<{ authorizationId: string }>;
}): AiStoryTtsAdapter {
  return {
    providerId: "openai",
    async synthesize(request) {
      if (
        request.providerId !== "openai" ||
        request.providerModel !== "tts-1-hd" ||
        request.deliveryStyle !== "STANDARD_NEUTRAL" ||
        request.secondaryLocales.length > 0 ||
        request.prosody.pitchSemitones !== 0
      ) {
        throw new Error("VOICE_CAPABILITY_UNSUPPORTED");
      }
      const authorization =
        await input.requireExplicitPaidExecutionAuthorization(request);
      if (!authorization.authorizationId.trim()) {
        throw new Error("TTS_PAID_EXECUTION_AUTHORITY_REQUIRED");
      }
      const client = getOpenAI();
      const response = await client.audio.speech.create({
        model: request.providerModel,
        voice: request.providerVoiceRef as
          | "alloy"
          | "ash"
          | "ballad"
          | "coral"
          | "echo"
          | "fable"
          | "nova"
          | "onyx"
          | "sage"
          | "shimmer"
          | "verse",
        input: request.exactText,
        response_format: request.outputFormat,
        speed: request.prosody.speed,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      const probe = await input.probeAudio(bytes, request.outputFormat);
      return {
        bytes,
        ...probe,
        providerExecutionIdentity: `openai:${authorization.authorizationId}:${request.fingerprint}`,
        actualCostUsd: null,
      };
    },
  };
}

export function createDeterministicFakeTtsAdapter(input: {
  readonly bytesForRequest: (
    request: AiStoryTtsExecutionRequest
  ) => Promise<{
    bytes: Buffer;
    durationMs: number;
    sampleRate: number;
    channelCount: number;
  }>;
  readonly onExecute?: (request: AiStoryTtsExecutionRequest) => void;
}): AiStoryTtsAdapter {
  return {
    providerId: "fake-local",
    async synthesize(request) {
      input.onExecute?.(request);
      const generated = await input.bytesForRequest(request);
      return {
        ...generated,
        providerExecutionIdentity: `fake-local:${request.fingerprint}`,
        actualCostUsd: 0,
      };
    },
  };
}
