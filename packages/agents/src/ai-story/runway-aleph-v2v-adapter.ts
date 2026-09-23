/**
 * Runway Aleph 2 compile adapter for the frozen VIDEO_TO_VIDEO contract.
 * Provider-specific mapping only. Domain contracts stay provider-neutral.
 * This module compiles one request and does not submit it.
 */
import {
  AI_STORY_V2V_AUDIO_AUTHORITY,
  AI_STORY_V2V_CONTINUITY_ROLE,
  AI_STORY_V2V_PROVIDER_SOURCE_ROLE,
  AI_STORY_V2V_TRANSFORMATION_INTENT,
  AiStoryV2vExecutionAuthoritySchema,
  HYBRID_CHARACTER_CONSISTENCY_MODE,
  CHARACTER_CONSISTENCY_MODE,
  seedanceIdentityAssetIdsForCharacter,
  sourcePhotoSentToVideoProviderForDna,
  type AiStoryV2vExecutionAuthority,
} from "@ceo-agent/shared";

export const RUNWAY_ALEPH_V2V_PROVIDER = "runway" as const;
export const RUNWAY_ALEPH_V2V_MODEL = "aleph2" as const;
export const RUNWAY_ALEPH_V2V_ENDPOINT = "POST /v1/video_to_video" as const;
/** Official Aleph 2 input videos are 2–30 seconds. Exact duration outside that range cannot be represented. */
export const RUNWAY_ALEPH_V2V_MIN_DURATION_SEC = 2 as const;
export const RUNWAY_ALEPH_V2V_MAX_DURATION_SEC = 30 as const;
export const RUNWAY_ALEPH_V2V_MAX_PROMPT_CHARS = 1000 as const;
export const RUNWAY_ALEPH_V2V_PROVIDER_CALLS = 0 as const;
export const RUNWAY_ALEPH_V2V_PROVIDER_COST_USD = 0 as const;
export const RUNWAY_ALEPH_V2V_SUBMITS = false as const;

const INTENT_PROMPT =
  "Keep the source timing, gross body movement, shot timing, and camera movement. Change only the visible character appearance to the approved synthetic character.";

export class RunwayAlephV2vAdapterError extends Error {
  readonly code: "PROVIDER_CAPABILITY_MISMATCH" | "V2V_SOURCE_AUTHORITY_MISMATCH" | "EXISTING_VIDEO_NON_GENERATIVE" | "SYNTHETIC_CHARACTER_BINDING_MISMATCH";

  constructor(
    code: RunwayAlephV2vAdapterError["code"],
    message: string,
  ) {
    super(message);
    this.name = "RunwayAlephV2vAdapterError";
    this.code = code;
  }
}

export type RunwayAlephSourceVideoDelivery = {
  readonly role: typeof AI_STORY_V2V_PROVIDER_SOURCE_ROLE;
  readonly videoUri: string;
  readonly assetId: string;
  readonly contentHash: string;
  readonly durationMs: number;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly permissionAuthority: "USER_CONFIRMED_AUTHORIZED_USE";
};

export type RunwayAlephCharacterReference = {
  readonly reusableCharacterId: string;
  readonly reusableCharacterVersionId: string;
  readonly identityFingerprint: string;
  readonly characterDnaFingerprint?: string;
  readonly identityMode: "CHARACTER_DNA";
  readonly characterConsistencyMode: typeof HYBRID_CHARACTER_CONSISTENCY_MODE | typeof CHARACTER_CONSISTENCY_MODE;
  readonly canonicalAssets: readonly { readonly assetId: string; readonly role: string }[];
  readonly syntheticAnchor?: { readonly assetId: string; readonly imageUri: string };
  readonly identityText?: string;
  readonly sourcePortrait?: { readonly assetId: string; readonly imageUri: string } | null;
  readonly sourcePhotoSentToVideoProvider: false;
};

export type RunwayAlephContinuityReference = {
  readonly role: typeof AI_STORY_V2V_CONTINUITY_ROLE;
  readonly videoUri: string;
  readonly assetId: string;
};

export type RunwayAlephV2vCompileInput = {
  readonly authority: unknown;
  readonly sourceVideo?: RunwayAlephSourceVideoDelivery;
  readonly additionalSourceVideos?: readonly unknown[];
  readonly character: RunwayAlephCharacterReference;
  readonly continuityReferences?: readonly RunwayAlephContinuityReference[];
};

export type RunwayAlephV2vWireBody = {
  readonly model: typeof RUNWAY_ALEPH_V2V_MODEL;
  readonly videoUri: string;
  readonly promptText: string;
  readonly keyframes?: readonly [{ readonly uri: string; readonly seconds: 0 }];
};

export type RunwayAlephV2vCompiledRequest = {
  readonly submitted: false;
  readonly providerCalls: 0;
  readonly providerCostUsd: 0;
  readonly provider: typeof RUNWAY_ALEPH_V2V_PROVIDER;
  readonly model: typeof RUNWAY_ALEPH_V2V_MODEL;
  readonly endpoint: typeof RUNWAY_ALEPH_V2V_ENDPOINT;
  readonly mode: "VIDEO_TO_VIDEO";
  readonly sourceVideoCount: 1;
  readonly providerSourceRole: typeof AI_STORY_V2V_PROVIDER_SOURCE_ROLE;
  readonly continuityReferencesEmitted: 0;
  readonly sourcePhotoSentToVideoProvider: false;
  readonly sourceAudioAuthority: typeof AI_STORY_V2V_AUDIO_AUTHORITY;
  readonly outputDurationFollowsSource: true;
  readonly outputDurationMs: number;
  readonly reusableCharacterId: string;
  readonly reusableCharacterVersionId: string;
  readonly transformationIntent: typeof AI_STORY_V2V_TRANSFORMATION_INTENT;
  readonly retry: "NOT_CERTIFIED";
  readonly body: RunwayAlephV2vWireBody;
};

function mismatch(message: string): never {
  throw new RunwayAlephV2vAdapterError("PROVIDER_CAPABILITY_MISMATCH", message);
}

function httpsUri(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    mismatch(`${label} must be an https URI`);
  }
  if (url.protocol !== "https:") mismatch(`${label} must be an https URI`);
  return value;
}

function assertSourceMatchesAuthority(
  delivery: RunwayAlephSourceVideoDelivery,
  authority: AiStoryV2vExecutionAuthority,
): void {
  const source = authority.sourceVideo;
  const checks: Array<[string, unknown, unknown]> = [
    ["assetId", delivery.assetId, source.sourceVideoAssetId],
    ["contentHash", delivery.contentHash, source.sourceVideoContentHash],
    ["durationMs", delivery.durationMs, source.durationMs],
    ["durationSec", delivery.durationSec, source.durationSec],
    ["width", delivery.width, source.width],
    ["height", delivery.height, source.height],
    ["fps", delivery.fps, source.fps],
    ["hasAudio", delivery.hasAudio, source.hasAudio],
    ["orgId", delivery.orgId, source.orgId],
    ["workspaceId", delivery.workspaceId, source.workspaceId],
    ["campaignId", delivery.campaignId, source.campaignId],
    ["permissionAuthority", delivery.permissionAuthority, source.permissionAuthority],
  ];
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      throw new RunwayAlephV2vAdapterError(
        "V2V_SOURCE_AUTHORITY_MISMATCH",
        `Frozen source video ${field} does not match the VIDEO_TO_VIDEO authority`,
      );
    }
  }
  if (delivery.role !== AI_STORY_V2V_PROVIDER_SOURCE_ROLE) {
    mismatch("Aleph requires exactly one PROVIDER_SOURCE_VIDEO");
  }
}

function characterPrompt(identityText: string | undefined): string {
  const prompt = identityText ? `${INTENT_PROMPT} ${identityText.trim()}` : INTENT_PROMPT;
  if (prompt.length > RUNWAY_ALEPH_V2V_MAX_PROMPT_CHARS) {
    mismatch("Aleph promptText cannot represent the synthetic character identity within 1000 characters");
  }
  return prompt;
}

function syntheticKeyframe(
  authority: AiStoryV2vExecutionAuthority,
  character: RunwayAlephCharacterReference,
  portraitUri: string | null,
): { readonly uri: string; readonly seconds: 0 } | undefined {
  if (
    character.reusableCharacterId !== authority.targetCharacter.reusableCharacterId ||
    character.reusableCharacterVersionId !== authority.targetCharacter.reusableCharacterVersionId ||
    character.identityFingerprint !== authority.targetCharacter.identityFingerprint ||
    (authority.targetCharacter.characterDnaFingerprint ?? undefined) !== character.characterDnaFingerprint
  ) {
    throw new RunwayAlephV2vAdapterError(
      "SYNTHETIC_CHARACTER_BINDING_MISMATCH",
      "Synthetic target Character id and version must match the frozen authority",
    );
  }
  if (character.sourcePhotoSentToVideoProvider !== false || sourcePhotoSentToVideoProviderForDna() !== false) {
    mismatch("Original source portrait must not be sent to the video Provider");
  }
  if (character.identityMode !== "CHARACTER_DNA") {
    mismatch("Aleph V1 target requires Character DNA identity authority");
  }

  const allowedAssetIds = new Set(seedanceIdentityAssetIdsForCharacter({
    identityMode: character.identityMode,
    characterDnaFingerprint: character.characterDnaFingerprint,
    canonicalAssets: character.canonicalAssets,
  }));
  const portrait = character.sourcePortrait ?? null;
  if (portrait && allowedAssetIds.has(portrait.assetId)) {
    mismatch("Character source portrait is not a synthetic anchor");
  }

  if (character.characterConsistencyMode === HYBRID_CHARACTER_CONSISTENCY_MODE) {
    const anchor = character.syntheticAnchor;
    if (!anchor) mismatch("Aleph cannot represent the synthetic target without a synthetic identity anchor");
    const asset = character.canonicalAssets.find((item) => item.assetId === anchor.assetId);
    if (!asset || asset.role !== "SYNTHETIC_IDENTITY_ANCHOR" || !allowedAssetIds.has(anchor.assetId)) {
      mismatch("Aleph character image must be the synthetic identity anchor");
    }
    if (portrait && (portrait.assetId === anchor.assetId || portrait.imageUri === anchor.imageUri)) {
      mismatch("Original source portrait must not be sent as the synthetic anchor");
    }
    const uri = httpsUri(anchor.imageUri, "Synthetic anchor");
    if (portraitUri && uri === portraitUri) mismatch("Original source portrait must not be sent to the video Provider");
    return { uri, seconds: 0 };
  }

  if (character.characterConsistencyMode === CHARACTER_CONSISTENCY_MODE) {
    if (character.syntheticAnchor) mismatch("Text Character DNA must not send an image reference");
    if (!character.identityText?.trim()) mismatch("Aleph cannot represent the synthetic target without character identity text");
    return undefined;
  }

  mismatch("Aleph cannot represent the requested character consistency authority");
}

export function compileRunwayAlephV2vRequest(input: RunwayAlephV2vCompileInput): RunwayAlephV2vCompiledRequest {
  const raw = input.authority;
  if (!raw || typeof raw !== "object") mismatch("Exact VIDEO_TO_VIDEO authority is required");
  const record = raw as Record<string, unknown>;
  if (record.unitType === "EXISTING_VIDEO") {
    throw new RunwayAlephV2vAdapterError(
      "EXISTING_VIDEO_NON_GENERATIVE",
      "EXISTING_VIDEO must not dispatch a Provider",
    );
  }
  if (record.executionMode !== "VIDEO_TO_VIDEO") {
    mismatch("Exact VIDEO_TO_VIDEO authority is required. Refusing T2V or I2V degradation");
  }
  if (record.transformationIntent !== AI_STORY_V2V_TRANSFORMATION_INTENT) {
    mismatch("Aleph V1 only represents KEEP_SOURCE_MOTION_CHANGE_CHARACTER");
  }
  if (record.audioAuthority !== AI_STORY_V2V_AUDIO_AUTHORITY) {
    mismatch("Aleph V1 does not request preserved source audio");
  }
  if ((input.additionalSourceVideos?.length ?? 0) > 0) {
    mismatch("Aleph V1 accepts exactly one source video");
  }
  if (!input.sourceVideo) mismatch("Aleph requires exactly one PROVIDER_SOURCE_VIDEO");

  const authority = AiStoryV2vExecutionAuthoritySchema.parse(input.authority);
  assertSourceMatchesAuthority(input.sourceVideo, authority);

  const durationSec = authority.sourceVideo.durationSec;
  if (durationSec < RUNWAY_ALEPH_V2V_MIN_DURATION_SEC || durationSec > RUNWAY_ALEPH_V2V_MAX_DURATION_SEC) {
    mismatch("Aleph cannot represent the exact source duration");
  }
  if (authority.outputDurationMs !== authority.sourceVideo.durationMs) {
    mismatch("Aleph output duration must follow the source video");
  }

  const continuity = input.continuityReferences ?? [];
  const continuityUris = new Set(continuity.map((item) => item.videoUri));
  if (continuity.some((item) => item.role !== AI_STORY_V2V_CONTINUITY_ROLE)) {
    mismatch("Continuity media is not a Provider source video");
  }
  if (continuityUris.has(input.sourceVideo.videoUri)) {
    mismatch("A continuity video cannot be used as the Provider source video");
  }

  const portraitUri = input.character.sourcePortrait?.imageUri ?? null;
  const keyframe = syntheticKeyframe(authority, input.character, portraitUri);
  const promptText = characterPrompt(input.character.identityText);
  const videoUri = httpsUri(input.sourceVideo.videoUri, "Source video");
  if (portraitUri && videoUri === portraitUri) mismatch("Original source portrait must not be sent as the source video");

  const body: RunwayAlephV2vWireBody = {
    model: RUNWAY_ALEPH_V2V_MODEL,
    videoUri,
    promptText,
    ...(keyframe ? { keyframes: [keyframe] as const } : {}),
  };

  const serialized = JSON.stringify(body);
  const forbidden = [portraitUri, ...continuityUris].filter((value): value is string => Boolean(value));
  if (forbidden.some((value) => serialized.includes(value))) {
    mismatch("Provider wire leaked a continuity video or the original source portrait");
  }
  if (/"audio"|preserveAudio|generateAudio|keepAudio|"duration"/.test(serialized)) {
    mismatch("Aleph wire must not request preserved source audio or a duration override");
  }

  return {
    submitted: false,
    providerCalls: RUNWAY_ALEPH_V2V_PROVIDER_CALLS,
    providerCostUsd: RUNWAY_ALEPH_V2V_PROVIDER_COST_USD,
    provider: RUNWAY_ALEPH_V2V_PROVIDER,
    model: RUNWAY_ALEPH_V2V_MODEL,
    endpoint: RUNWAY_ALEPH_V2V_ENDPOINT,
    mode: "VIDEO_TO_VIDEO",
    sourceVideoCount: 1,
    providerSourceRole: AI_STORY_V2V_PROVIDER_SOURCE_ROLE,
    continuityReferencesEmitted: 0,
    sourcePhotoSentToVideoProvider: sourcePhotoSentToVideoProviderForDna(),
    sourceAudioAuthority: AI_STORY_V2V_AUDIO_AUTHORITY,
    outputDurationFollowsSource: true,
    outputDurationMs: authority.sourceVideo.durationMs,
    reusableCharacterId: authority.targetCharacter.reusableCharacterId,
    reusableCharacterVersionId: authority.targetCharacter.reusableCharacterVersionId,
    transformationIntent: AI_STORY_V2V_TRANSFORMATION_INTENT,
    retry: "NOT_CERTIFIED",
    body,
  };
}
