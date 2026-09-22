import { createHash, randomUUID } from "node:crypto";
import { deterministicUuidFromFingerprint, sha256CanonicalIntegrityHash } from "./canonical-integrity";
import {
  AI_STORY_CHARACTER_VIRTUALIZER_CONTRACT_VERSION,
  CHARACTER_SOURCE_PORTRAIT,
  CHARACTER_VIRTUALIZATION,
  CHARACTER_VIRTUALIZER_REAL_IMAGE_PROVIDER_CALLS,
  CHARACTER_VIRTUALIZER_SEEDANCE_VIDEO_CALLS,
  DEFAULT_CHARACTER_VIRTUAL_STYLE,
  VIRTUAL_CHARACTER_CANDIDATE,
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
    "Preserve broad recognizable visual inspiration such as face structure, hairstyle direction, general expression, and overall visual character,",
    "but intentionally render as unmistakably CGI / virtual.",
    "Use stylized skin material, subtle simplified geometry, premium advertising render, clean cinematic lighting, and natural proportions.",
    "Avoid photorealistic live-action human appearance, celebrity likeness, hyperreal skin, camera-photo aesthetic, uncanny doll look, and anime exaggeration.",
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
  constructor(private readonly mode: "succeed" | "reject" = "succeed") {}

  async virtualizeCharacter(
    request: CharacterVirtualizationProviderRequest
  ): Promise<CharacterVirtualizationProviderResult> {
    const providerAttemptId = randomUUID();
    const reject =
      this.mode === "reject" ||
      (request.creativeDirection ?? "").toUpperCase().includes("__REJECT__");
    if (reject) {
      return {
        ok: false,
        code: "PROVIDER_REJECTED",
        userSafeMessage:
          "This photo could not be turned into a virtual Character. No Character was created.",
        provider: "mock",
        providerModel: "character-virtualizer-mock.v1",
        providerAttemptId,
      };
    }
    const bytes = new Uint8Array(MOCK_VIRTUAL_CHARACTER_PNG);
    return {
      ok: true,
      bytes,
      mimeType: "image/png",
      width: 1,
      height: 1,
      provider: "mock",
      providerModel: "character-virtualizer-mock.v1",
      providerAttemptId,
      contentHash: hashCharacterVirtualizationBytes(bytes),
    };
  }
}

export function resolveCharacterVirtualizationProvider(): CharacterVirtualizationProvider {
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
    costUsd,
    completedAt,
    realImageProviderCalls: 0,
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
    realImageProviderCalls: 0,
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
