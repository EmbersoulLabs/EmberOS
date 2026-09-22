import { createHash, randomUUID } from "node:crypto";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CHARACTER_VIRTUALIZER_CONTRACT_VERSION,
  AiStoryCharacterVirtualizerError,
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZATION,
  CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS,
  CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS,
  DEFAULT_CHARACTER_VIRTUAL_STYLE,
  VIRTUAL_CHARACTER_CANDIDATE,
  characterVirtualizationUserSafeFailure,
  readCharacterVirtualizationProviderMode,
  visualClassForVirtualStyle,
  type AiStoryCharacterVirtualStyle,
  type AiStoryCharacterVirtualizationJob,
  type CharacterVirtualizationProvider,
  type CharacterVirtualizationProviderRequest,
  type CharacterVirtualizationProviderResult,
} from "./ai-story-character-virtualizer";
import type { AiStoryReusableCharacterVersion } from "./ai-story-reusable-character";

/** 1x1 PNG used only by the CI mock adapter. Not a real-person replica. */
export const MOCK_VIRTUAL_CHARACTER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

export function hashCharacterVirtualizationBytes(bytes: Uint8Array | Buffer) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function compileCharacterVirtualizationPrompt(input: {
  style: AiStoryCharacterVirtualStyle;
  creativeDirection?: string | null;
}) {
  const direction = input.creativeDirection?.trim();
  const premium = [
    "Transform the authorized source portrait into a clearly synthetic premium 3D CGI commercial spokesperson.",
    "Preserve broad visual inspiration: face structure, hairstyle direction, general expression, and overall recognizable character impression,",
    "but ensure the output is unmistakably CGI / virtual.",
    "Use a premium 3D render, subtly simplified facial geometry, stylized skin material, cinematic commercial lighting, natural professional proportions, and a polished advertising aesthetic.",
    "Avoid photorealistic live-action human appearance, photographic skin realism, celebrity likeness, uncanny doll appearance, anime exaggeration, and cartoon mascot proportions.",
    "The purpose is a synthetic reusable brand Character.",
  ].join(" ");
  const stylized = [
    "Transform the authorized source portrait into a stylized CGI virtual Character.",
    "Keep broad visual inspiration while remaining clearly non-photoreal.",
    "Avoid photorealistic live-action human appearance and celebrity likeness.",
  ].join(" ");
  const illustrated = [
    "Transform the authorized source portrait into an illustrated virtual Character.",
    "Keep broad visual inspiration while remaining clearly illustrated, not photographic.",
    "Avoid photorealistic live-action human appearance and celebrity likeness.",
  ].join(" ");
  const base =
    input.style === "PREMIUM_3D" ? premium : input.style === "STYLIZED_CGI" ? stylized : illustrated;
  return direction ? `${base} Creative direction: ${direction}` : base;
}

export function fingerprintCharacterVirtualizationPrompt(prompt: string) {
  return sha256CanonicalIntegrityHash({ prompt });
}

export function deriveAcceptedVirtualIdentityCore(input: {
  name: string;
  style: AiStoryCharacterVirtualStyle;
  creativeDirection?: string | null;
}): AiStoryReusableCharacterVersion["identityCore"] {
  const styleLabel =
    input.style === "PREMIUM_3D"
      ? "premium 3D CGI"
      : input.style === "STYLIZED_CGI"
        ? "stylized CGI"
        : "illustrated";
  const direction = input.creativeDirection?.trim();
  return {
    identityDescription: `${input.name} is a ${styleLabel} virtual spokesperson${direction ? ` (${direction})` : ""}.`,
    faceIdentityDescription: `Synthetic ${styleLabel} face inspired by the authorized source portrait, not a live-action photograph.`,
    bodyIdentityDescription: "Natural adult proportions with commercial-friendly presentation.",
    distinctiveVisualFacts: [
      `clearly synthetic ${styleLabel} material`,
      "cinematic commercial lighting",
    ],
    mustPreserve: ["canonical synthetic face identity", "body proportions"],
    mustNeverChange: ["canonical face identity"],
  };
}

export function defaultVirtualCharacterLook(): AiStoryReusableCharacterVersion["defaultLook"] {
  return {
    wardrobe: "clean commercial wardrobe",
    makeup: "soft stylized finish",
    accessories: null,
    hairstyle: "inspired by source portrait",
    hairColor: null,
  };
}

export function defaultVirtualMutableLookPolicy(): AiStoryReusableCharacterVersion["mutableLookPolicy"] {
  return {
    wardrobeAllowed: true,
    makeupAllowed: true,
    accessoriesAllowed: true,
    hairstyleAllowed: true,
    hairColorAllowed: false,
  };
}

export function buildAiStoryCharacterVirtualizationJob(input: {
  orgId: string;
  workspaceId: string;
  sourceAssetId: string;
  sourceContentHash: string;
  style?: AiStoryCharacterVirtualStyle;
  creativeDirection?: string | null;
  permissionConfirmed: true;
  createdBy: string;
  createdAt: string;
  parentJobId?: string | null;
  provider?: string;
  providerModel?: string;
}): AiStoryCharacterVirtualizationJob {
  const style = input.style ?? DEFAULT_CHARACTER_VIRTUAL_STYLE;
  const prompt = compileCharacterVirtualizationPrompt({
    style,
    creativeDirection: input.creativeDirection,
  });
  const promptFingerprint = fingerprintCharacterVirtualizationPrompt(prompt);
  const id = deterministicUuidFromFingerprint(
    "ai-story-character-virtualization-job",
    sha256CanonicalIntegrityHash({
      workspaceId: input.workspaceId,
      sourceAssetId: input.sourceAssetId,
      sourceContentHash: input.sourceContentHash,
      style,
      creativeDirection: input.creativeDirection?.trim() || null,
      parentJobId: input.parentJobId ?? null,
      createdAt: input.createdAt,
    })
  );
  return {
    id,
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    sourceAssetId: input.sourceAssetId,
    sourceContentHash: input.sourceContentHash,
    sourceSemantic: CHARACTER_SOURCE_PORTRAIT,
    style,
    visualClass: visualClassForVirtualStyle(style),
    creativeDirection: input.creativeDirection?.trim() || null,
    permissionConfirmed: true,
    status: "QUEUED",
    acceptanceStatus: "NOT_READY",
    provider: input.provider ?? "mock",
    providerModel: input.providerModel ?? "character-virtualizer-mock.v1",
    providerAttemptId: null,
    promptFingerprint,
    outputAssetId: null,
    outputContentHash: null,
    outputSemantic: null,
    costCategory: CHARACTER_VIRTUALIZATION,
    costUsd: null,
    parentJobId: input.parentJobId ?? null,
    automaticRetry: false,
    reusableCharacterId: null,
    reusableCharacterVersionId: null,
    seedanceVideoCalls: CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS,
    realImageProviderCalls: CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS,
    userSafeError: null,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    completedAt: null,
    contractVersion: AI_STORY_CHARACTER_VIRTUALIZER_CONTRACT_VERSION,
  };
}

export class MockCharacterVirtualizationProvider implements CharacterVirtualizationProvider {
  readonly providerId = "mock";
  readonly providerModel = "character-virtualizer-mock.v1";
  readonly externalPaidCall = false;

  constructor(private readonly mode: "succeed" | "reject" | "unavailable" = "succeed") {}

  async virtualizeCharacter(
    request: CharacterVirtualizationProviderRequest
  ): Promise<CharacterVirtualizationProviderResult> {
    const providerAttemptId = randomUUID();
    const direction = (request.creativeDirection ?? "").toUpperCase();
    const reject = this.mode === "reject" || direction.includes("__REJECT__");
    const unavailable = this.mode === "unavailable" || direction.includes("__UNAVAILABLE__");
    if (reject || unavailable) {
      const code = unavailable ? "PROVIDER_UNAVAILABLE" : "PROVIDER_REJECTED";
      return {
        ok: false,
        code,
        userSafeMessage: characterVirtualizationUserSafeFailure(code),
        provider: this.providerId,
        providerModel: this.providerModel,
        providerAttemptId,
        realImageProviderCalls: 0,
      };
    }
    const bytes = new Uint8Array(MOCK_VIRTUAL_CHARACTER_PNG);
    return {
      ok: true,
      bytes,
      mimeType: "image/png",
      width: 1,
      height: 1,
      provider: this.providerId,
      providerModel: this.providerModel,
      providerAttemptId,
      contentHash: hashCharacterVirtualizationBytes(bytes),
      retries: 0,
      realImageProviderCalls: 0,
      costUsd: "0.0000",
    };
  }
}

export function resolveCharacterVirtualizationProvider(
  env: NodeJS.ProcessEnv = process.env
): CharacterVirtualizationProvider {
  const mode = readCharacterVirtualizationProviderMode(env);
  if (mode === "creative-image") {
    throw new AiStoryCharacterVirtualizerError(
      "VIRTUALIZATION_PROVIDER_UNAVAILABLE",
      "Character virtualization Creative Image runtime must be resolved by the application layer."
    );
  }
  return new MockCharacterVirtualizationProvider("succeed");
}

export function applyProviderSuccessToJob(
  job: AiStoryCharacterVirtualizationJob,
  result: Extract<CharacterVirtualizationProviderResult, { ok: true }>,
  outputAssetId: string,
  completedAt: string,
  costUsd: string
): AiStoryCharacterVirtualizationJob {
  return {
    ...job,
    status: "SUCCEEDED",
    acceptanceStatus: VIRTUAL_CHARACTER_CANDIDATE,
    provider: result.provider,
    providerModel: result.providerModel,
    providerAttemptId: result.providerAttemptId,
    outputAssetId,
    outputContentHash: result.contentHash,
    outputSemantic: VIRTUAL_CHARACTER_CANDIDATE,
    costUsd: result.costUsd ?? costUsd,
    completedAt,
    realImageProviderCalls: result.realImageProviderCalls ?? 0,
    seedanceVideoCalls: 0,
  };
}

export function applyProviderFailureToJob(
  job: AiStoryCharacterVirtualizationJob,
  result: Extract<CharacterVirtualizationProviderResult, { ok: false }>,
  completedAt: string
): AiStoryCharacterVirtualizationJob {
  return {
    ...job,
    status: result.code === "PROVIDER_REJECTED" ? "REJECTED" : "FAILED",
    acceptanceStatus: "NOT_READY",
    provider: result.provider,
    providerModel: result.providerModel,
    providerAttemptId: result.providerAttemptId,
    userSafeError: result.userSafeMessage,
    completedAt,
    outputAssetId: null,
    outputContentHash: null,
    outputSemantic: null,
    reusableCharacterId: null,
    reusableCharacterVersionId: null,
    realImageProviderCalls: result.realImageProviderCalls ?? 0,
    seedanceVideoCalls: 0,
  };
}

export function markJobAccepted(
  job: AiStoryCharacterVirtualizationJob,
  input: { reusableCharacterId: string; reusableCharacterVersionId: string; completedAt?: string }
): AiStoryCharacterVirtualizationJob {
  return {
    ...job,
    acceptanceStatus: "ACCEPTED",
    outputSemantic: "ACCEPTED_VIRTUAL_IDENTITY_MASTER",
    reusableCharacterId: input.reusableCharacterId,
    reusableCharacterVersionId: input.reusableCharacterVersionId,
    completedAt: input.completedAt ?? job.completedAt,
  };
}
