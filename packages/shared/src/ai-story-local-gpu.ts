/**
 * Cloud-side LOCAL_GPU contracts.
 *
 * LOCAL_GPU is a desktop worker reached by the EmberOS server. It is not a
 * remote video provider and it does not own duration, character, product,
 * sequential release, voice, or QC authority.
 *
 * The live worker accepts `Authorization: Bearer <base64url(payload)>.<hex hmac>`.
 * The payload is this module's canonical JSON, with keys in a fixed order.
 */
import { z } from "zod";
import type { AiStoryAudioQcExpectation } from "./ai-story-audio-qc";

export const LOCAL_GPU_PROVIDER_ID = "LOCAL_GPU" as const;
export const LOCAL_GPU_EXECUTION_CLASS = "LOCAL_GPU" as const;
export const LOCAL_GPU_BASE_URL = "https://local-gpu.embersoullabs.com" as const;
export const LOCAL_GPU_WORKER_WORKFLOW = "MINIMAX_H3_R2V" as const;
export const LOCAL_GPU_CERTIFIED_PACKAGE_WORKFLOW = "MINIMAX_H3_NATIVE_DIALOGUE" as const;
export const LOCAL_GPU_AUTOMATIC_GENERATION_RETRY = 0 as const;
export const LOCAL_GPU_REMOTE_PROVIDER_FALLBACK = 0 as const;
export const LOCAL_GPU_AUTO_APPROVED = false as const;
export const LOCAL_GPU_DEFAULT_AGENCY_ENABLED = false as const;
export const LOCAL_GPU_DEFAULT_REQUEST_TTL_MS = 120_000 as const;
export const LOCAL_GPU_MAX_REQUEST_TTL_MS = 600_000 as const;
export const LOCAL_GPU_SIGNING_VERSION = "local-gpu-job-token.v1" as const;

export const LOCAL_GPU_ENVIRONMENTS = ["staging", "production"] as const;
export const LOCAL_GPU_AUDIO_POLICIES = ["NATIVE", "REMOVE_AUDIO", "PRESERVE"] as const;
export const LOCAL_GPU_JOB_STATES = [
  "QUEUED",
  "PREPARING",
  "GENERATING",
  "POST_PROCESSING",
  "UPLOADING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export const LOCAL_GPU_HEALTH_STATES = ["AVAILABLE", "UNAVAILABLE", "DISABLED"] as const;

export const LOCAL_GPU_SIGNED_FIELDS = [
  "environment",
  "jobId",
  "workspaceId",
  "actorId",
  "workflow",
  "expiresAt",
  "nonce",
] as const;
export const LOCAL_GPU_BOUND_FIELDS = [
  "sceneExecutionId",
  "storyId",
  "storyVersionId",
] as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const LocalGpuEnvironmentSchema = z.enum(LOCAL_GPU_ENVIRONMENTS);
export const LocalGpuAudioPolicySchema = z.enum(LOCAL_GPU_AUDIO_POLICIES);
export const LocalGpuJobStateSchema = z.enum(LOCAL_GPU_JOB_STATES);

export type LocalGpuEnvironment = z.infer<typeof LocalGpuEnvironmentSchema>;
export type LocalGpuAudioPolicy = z.infer<typeof LocalGpuAudioPolicySchema>;
export type LocalGpuJobState = z.infer<typeof LocalGpuJobStateSchema>;
export type LocalGpuHealthState = (typeof LOCAL_GPU_HEALTH_STATES)[number];

export class LocalGpuContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalGpuContractError";
  }
}

export type LocalGpuSignedFields = {
  environment: LocalGpuEnvironment;
  jobId: string;
  workspaceId: string;
  actorId: string;
  workflow: string;
  expiresAt: string;
  nonce: string;
  sceneExecutionId?: string;
  storyId?: string;
  storyVersionId?: string;
};

function assertSignedScalar(value: string, field: string): string {
  if (!value || /[\r\n]/.test(value)) {
    throw new LocalGpuContractError(`LOCAL_GPU_SIGNED_FIELD_INVALID:${field}`);
  }
  return value;
}

/** Deterministic JSON. Key order is the signing contract, not object enumeration. */
export function canonicalLocalGpuSigningPayload(fields: LocalGpuSignedFields): string {
  const environment = LocalGpuEnvironmentSchema.parse(fields.environment);
  const entries: Array<[string, string]> = LOCAL_GPU_SIGNED_FIELDS.map((key) => {
    const value = key === "environment" ? environment : fields[key];
    return [key, assertSignedScalar(value, key)];
  });
  for (const key of LOCAL_GPU_BOUND_FIELDS) {
    const value = fields[key];
    if (value) entries.push([key, assertSignedScalar(value, key)]);
  }
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`).join(",")}}`;
}

export function assertLocalGpuRequestExpiry(expiresAt: string, now: Date): void {
  const expiresAtMs = Date.parse(expiresAt);
  const ttlMs = expiresAtMs - now.getTime();
  if (!Number.isFinite(expiresAtMs) || ttlMs <= 0 || ttlMs > LOCAL_GPU_MAX_REQUEST_TTL_MS) {
    throw new LocalGpuContractError("LOCAL_GPU_REQUEST_EXPIRY_INVALID");
  }
}

export function assertDistinctLocalGpuSecrets(stagingSecret: string, productionSecret: string): void {
  if (!stagingSecret || !productionSecret || stagingSecret === productionSecret) {
    throw new LocalGpuContractError("LOCAL_GPU_SECRETS_MUST_DIFFER");
  }
}

export function localGpuPlannedDurationMs(authority: {
  readonly decision: { readonly plannedDurationMs: number };
}): number {
  const plannedDurationMs = authority.decision.plannedDurationMs;
  if (!Number.isInteger(plannedDurationMs) || plannedDurationMs <= 0) {
    throw new LocalGpuContractError("LOCAL_GPU_PLANNED_DURATION_INVALID");
  }
  return plannedDurationMs;
}

export function mapCertifiedWorkflowToLocalGpu(
  packageWorkflow: string,
  workerWorkflows: readonly string[],
): typeof LOCAL_GPU_WORKER_WORKFLOW {
  if (packageWorkflow !== LOCAL_GPU_CERTIFIED_PACKAGE_WORKFLOW) {
    throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  }
  if (!workerWorkflows.includes(LOCAL_GPU_WORKER_WORKFLOW)) {
    throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNAVAILABLE");
  }
  return LOCAL_GPU_WORKER_WORKFLOW;
}

export function mapLocalGpuAudioPolicy(input: {
  generateAudio: boolean;
  audioBlocked: boolean;
  expectationKind?: AiStoryAudioQcExpectation["expectationKind"] | null;
}): LocalGpuAudioPolicy {
  const kind = input.expectationKind ?? null;
  if (kind === "PRESERVE_SOURCE_AUDIO") return "PRESERVE";
  if (kind === "NATIVE_CHARACTER_DIALOGUE") return "NATIVE";
  if (kind === "SILENT_OUTPUT" || kind === "TTS_SPEECH" || kind === "FINAL_AUDIO_MIX") {
    return "REMOVE_AUDIO";
  }
  if (input.audioBlocked && !input.generateAudio) return "REMOVE_AUDIO";
  if (input.generateAudio && !input.audioBlocked) return "NATIVE";
  throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
}

export type LocalGpuReference = {
  assetId: string;
  contentHash: string;
  displayName: string;
};

export function selectLocalGpuReferences(input: {
  packageReferences: readonly {
    role?: string;
    authorityType?: string;
    assetId: string;
    contentHash: string;
    displayName?: string;
  }[];
  characterReferencePack?: readonly {
    assetId: string;
    contentHash: string;
    status: string;
    displayName?: string;
  }[] | null;
  predecessorAuthorityPresent: boolean;
  predecessorFrame?: { assetId: string; contentHash: string } | null;
}): {
  characterReferences: LocalGpuReference[];
  productReferences: LocalGpuReference[];
  predecessorFrame: LocalGpuReference | null;
} {
  const named = (reference: { assetId: string; contentHash: string; displayName?: string }): LocalGpuReference => ({
    assetId: reference.assetId,
    contentHash: reference.contentHash,
    displayName: reference.displayName ?? reference.assetId,
  });
  const characterReferences = input.characterReferencePack
    ? input.characterReferencePack.filter((view) => view.status === "APPROVED").map(named)
    : input.packageReferences
      .filter((reference) => reference.role === "CHARACTER_IDENTITY" || reference.authorityType === "CHARACTER")
      .map(named);
  const productReferences = input.packageReferences
    .filter((reference) => reference.role === "PRODUCT_IDENTITY" || reference.authorityType === "PRODUCT")
    .map(named);
  const predecessorFrame = input.predecessorAuthorityPresent && input.predecessorFrame
    ? named({ ...input.predecessorFrame, displayName: "predecessor-ending-frame" })
    : null;
  return { characterReferences, productReferences, predecessorFrame };
}

export function mapLocalGpuVoicePerformance(input: {
  dialogue: readonly { speakerLabel: string; text: string; locale?: string; offscreen?: boolean }[];
  pinnedVoiceDna?: {
    voiceDnaId: string;
    voiceDnaFingerprint: string;
    status: "APPROVED" | "FROZEN";
    performanceInstruction: string;
  } | null;
}): {
  dialogue: { speakerLabel: string; text: string; locale: string | null; offscreen: boolean }[];
  voiceDna: { voiceDnaId: string; voiceDnaFingerprint: string; performanceInstruction: string } | null;
} {
  const pinned = input.pinnedVoiceDna ?? null;
  if (pinned && pinned.status !== "APPROVED" && pinned.status !== "FROZEN") {
    throw new LocalGpuContractError("LOCAL_GPU_VOICE_DNA_NOT_PINNED");
  }
  return {
    dialogue: input.dialogue.map((line) => ({
      speakerLabel: line.speakerLabel,
      text: line.text,
      locale: line.locale ?? null,
      offscreen: line.offscreen ?? false,
    })),
    voiceDna: pinned ? {
      voiceDnaId: pinned.voiceDnaId,
      voiceDnaFingerprint: pinned.voiceDnaFingerprint,
      performanceInstruction: pinned.performanceInstruction,
    } : null,
  };
}

export function localGpuTerminalDisposition(state: LocalGpuJobState): {
  state: LocalGpuJobState;
  automaticGenerationRetry: 0;
  remoteProviderFallback: null;
} {
  return { state, automaticGenerationRetry: 0, remoteProviderFallback: null };
}

export function assertLocalGpuResultEnvironment(
  resultEnvironment: string,
  serverEnvironment: LocalGpuEnvironment,
): void {
  if (resultEnvironment !== serverEnvironment) {
    throw new LocalGpuContractError("LOCAL_GPU_ENVIRONMENT_ISOLATION");
  }
}

export const LocalGpuGenerationInputAuthoritySchema = z.object({
  localGpuEnvironment: LocalGpuEnvironmentSchema,
  localGpuJobId: Id,
  localGpuWorkflow: z.string().min(1),
  workspaceId: Id,
  storyId: Id,
  storyVersionId: Id,
  sceneExecutionId: Id,
  audioPolicy: LocalGpuAudioPolicySchema,
  plannedDurationMs: z.number().int().positive(),
  actualDurationMs: z.number().int().positive(),
  fps: z.number().positive(),
  hasAudio: z.boolean(),
  localPackageId: Id,
  localPackageFingerprint: Hash,
  characterAuthority: z.unknown(),
  productAuthority: z.unknown(),
  references: z.unknown(),
  generationMode: z.unknown(),
  generateAudio: z.boolean(),
  audioBlocked: z.boolean(),
  sourceAuthority: z.unknown(),
  planningAuthority: z.unknown(),
}).strict();

export type LocalGpuGenerationInputAuthority = z.infer<typeof LocalGpuGenerationInputAuthoritySchema>;

export function buildLocalGpuGenerationInputAuthority(
  input: LocalGpuGenerationInputAuthority,
): LocalGpuGenerationInputAuthority {
  return LocalGpuGenerationInputAuthoritySchema.parse(input);
}

export function assertLocalGpuGenerationResultBinding(input: {
  serverEnvironment: LocalGpuEnvironment | null;
  authority: LocalGpuGenerationInputAuthority;
  mediaDurationMs: number;
}): void {
  if (input.serverEnvironment && input.authority.localGpuEnvironment !== input.serverEnvironment) {
    throw new LocalGpuContractError("LOCAL_GPU_ENVIRONMENT_ISOLATION");
  }
  if (input.authority.actualDurationMs !== input.mediaDurationMs) {
    throw new LocalGpuContractError("LOCAL_GPU_DURATION_AUTHORITY_MISMATCH");
  }
}

export function localGpuWorkspaceAssetPath(workspaceId: string, contentHash: string): string {
  if (!contentHash.startsWith("sha256:")) {
    throw new LocalGpuContractError("LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED");
  }
  return `${workspaceId}/ai-story/local-gpu/${contentHash.slice("sha256:".length)}.mp4`;
}

export function isDesktopFilesystemPath(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value) || value.startsWith("\\\\") || value.startsWith("file:");
}
