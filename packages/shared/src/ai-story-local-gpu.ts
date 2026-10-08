/**
 * Cloud-side LOCAL_GPU contracts.
 *
 * LOCAL_GPU is a desktop worker reached by the EmberOS server. It is not a
 * remote video provider and it does not own duration, character, product,
 * sequential release, voice, or QC authority.
 *
 * The desktop worker accepts `Authorization: Bearer <base64url(payload)>.<base64url(hmac)>`.
 * HMAC-SHA256 covers the base64url payload string. The secret is a UTF-8 string.
 * Claim order is fixed. expiresAt is Unix epoch milliseconds. HTTP transport is not signed.
 */
import { createHash } from "node:crypto";
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
export const LOCAL_GPU_DEFAULT_REQUEST_TTL_MS = 600_000 as const;
export const LOCAL_GPU_MAX_REQUEST_TTL_MS = 600_000 as const;
export const LOCAL_GPU_SIGNING_VERSION = "local-gpu-job-token.v1" as const;
export const LOCAL_GPU_TOKEN_VERSION = 1 as const;
/** Capabilities operation claim. This is not the HTTP route. */
export const LOCAL_GPU_CAPABILITIES_ACTION = "capabilities" as const;
/**
 * Job-creation operation claim.
 * Desktop signs this claim. It is not the HTTP method and it is not `/v1/jobs`.
 */
export const LOCAL_GPU_SUBMIT_ACTION = "submit" as const;
export const LOCAL_GPU_DURATION_SOURCE = "RECOMMENDED_DURATION_AUTHORITY" as const;
export const LOCAL_GPU_DURATION_MIN_SEC = 5;
export const LOCAL_GPU_DURATION_MAX_SEC = 15;
export const LOCAL_GPU_REFERENCE_MIN = 1;
export const LOCAL_GPU_REFERENCE_MAX = 2;
export const LOCAL_GPU_DESKTOP_REFERENCE_ROLES = ["CHARACTER", "PRODUCT", "STYLE", "OTHER"] as const;
export const LOCAL_GPU_AUDIO_POLICIES = ["NATIVE", "REMOVE_AUDIO", "PRESERVE"] as const;
export const LOCAL_GPU_CLAIM_ORDER = [
  "v",
  "environment",
  "action",
  "jobId",
  "workspaceId",
  "actorId",
  "authority",
  "workflow",
  "sceneExecutionId",
  "expiresAt",
  "nonce",
  "uploadBinding",
] as const;
/** Public dummy only. Never a staging or production signing secret. */
export const LOCAL_GPU_PUBLIC_DUMMY_SIGNING_SECRET = "local-gpu-public-dummy-secret" as const;

export const LOCAL_GPU_ENVIRONMENTS = ["staging", "production"] as const;
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

export const LOCAL_GPU_SIGNED_FIELDS = LOCAL_GPU_CLAIM_ORDER;

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

export type LocalGpuUpstreamFailure = {
  code: "LOCAL_GPU_SUBMIT_FAILED";
  httpStatus: number;
  upstreamCode: string | null;
  upstreamMessage: string | null;
  correlationId: string | null;
};

const UPSTREAM_CODE_MAX = 80;
const UPSTREAM_MESSAGE_MAX = 300;

function redactLocalGpuDiagnostic(value: string, max: number): string {
  const bounded = value.replace(/\s+/g, " ").trim().slice(0, max);
  return bounded
    .replace(/Bearer\s+\S+/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s/]*:[^\s@/]+@[^\s]+/gi, "[REDACTED]")
    .replace(/\b(?:signature|token|secret|authorization)\b\s*[:=]\s*\S+/gi, "[REDACTED]");
}

function readDiagnosticString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const redacted = redactLocalGpuDiagnostic(value, max);
  return redacted.length > 0 ? redacted : null;
}

function readUpstreamCode(record: Record<string, unknown>): string | null {
  const nested = record.error;
  const candidate = typeof nested === "object" && nested && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).code ?? (nested as Record<string, unknown>).error
    : record.code ?? record.error;
  const code = readDiagnosticString(candidate, UPSTREAM_CODE_MAX);
  if (!code || !/^[A-Za-z0-9_.:-]{1,80}$/.test(code)) return null;
  return code;
}

function readUpstreamMessage(record: Record<string, unknown>): string | null {
  const nested = record.error;
  const candidate = typeof nested === "object" && nested && !Array.isArray(nested)
    ? (nested as Record<string, unknown>).message
    : record.message;
  return readDiagnosticString(candidate, UPSTREAM_MESSAGE_MAX);
}

function readCorrelationId(record: Record<string, unknown>): string | null {
  const candidate = record.correlationId ?? record.correlation_id ?? record.requestId ?? record.request_id;
  const id = readDiagnosticString(candidate, 80);
  if (!id || id.includes(".") || id.includes(" ")) return null;
  return id;
}

/** Safe fields from a non-2xx Desktop response. Secrets and credentials are never copied. */
export function readLocalGpuUpstreamFailure(httpStatus: number, json: unknown): LocalGpuUpstreamFailure {
  const record = json && typeof json === "object" && !Array.isArray(json)
    ? json as Record<string, unknown>
    : {};
  return {
    code: "LOCAL_GPU_SUBMIT_FAILED",
    httpStatus,
    upstreamCode: readUpstreamCode(record),
    upstreamMessage: readUpstreamMessage(record),
    correlationId: readCorrelationId(record),
  };
}

export type LocalGpuSignedFields = {
  v?: typeof LOCAL_GPU_TOKEN_VERSION;
  environment: LocalGpuEnvironment;
  action: string;
  jobId: string;
  workspaceId: string;
  actorId: string;
  authority: string;
  workflow: string;
  sceneExecutionId: string;
  expiresAt: number;
  nonce: string;
  uploadBinding: Record<string, unknown> | string;
};

export type LocalGpuDesktopReferenceRole = (typeof LOCAL_GPU_DESKTOP_REFERENCE_ROLES)[number];

export type LocalGpuDesktopReference = {
  approval: "APPROVED";
  role: LocalGpuDesktopReferenceRole;
  assetUrl: string;
  contentHash: string;
};

export type LocalGpuUploadDestination = {
  environment: LocalGpuEnvironment;
  method: string;
  url: string;
  headers?: Record<string, string>;
  assetId?: string;
};

function assertSignedString(value: string, field: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || /[\r\n]/.test(value)) {
    throw new LocalGpuContractError(`LOCAL_GPU_SIGNED_FIELD_INVALID:${field}`);
  }
  return value;
}

/** Capabilities keep `{}`. Submit carries the lowercase SHA-256 hex of the upload destination. */
function assertUploadBinding(value: LocalGpuSignedFields["uploadBinding"]): LocalGpuSignedFields["uploadBinding"] {
  if (typeof value === "string") {
    if (!/^[0-9a-f]{64}$/.test(value)) {
      throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:uploadBinding");
    }
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:uploadBinding");
  }
  return value;
}

/** Compact JSON in desktop claim order. Callers cannot reorder or omit claims. */
export function canonicalLocalGpuSigningPayload(fields: LocalGpuSignedFields): string {
  if (!Number.isInteger(fields.expiresAt)) {
    throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:expiresAt");
  }
  const uploadBinding = assertUploadBinding(fields.uploadBinding);
  const claims = {
    v: LOCAL_GPU_TOKEN_VERSION,
    environment: LocalGpuEnvironmentSchema.parse(fields.environment),
    action: assertSignedString(fields.action, "action"),
    jobId: assertSignedString(fields.jobId, "jobId"),
    workspaceId: assertSignedString(fields.workspaceId, "workspaceId"),
    actorId: assertSignedString(fields.actorId, "actorId"),
    authority: assertSignedString(fields.authority, "authority"),
    workflow: assertSignedString(fields.workflow, "workflow", true),
    sceneExecutionId: assertSignedString(fields.sceneExecutionId, "sceneExecutionId", true),
    expiresAt: fields.expiresAt,
    nonce: assertSignedString(fields.nonce, "nonce"),
    uploadBinding,
  };
  return JSON.stringify(claims);
}

export function assertLocalGpuRequestExpiry(expiresAt: number, now: Date): void {
  const ttlMs = expiresAt - now.getTime();
  if (!Number.isInteger(expiresAt) || ttlMs <= 0 || ttlMs > LOCAL_GPU_MAX_REQUEST_TTL_MS) {
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

const DESKTOP_ROLE_BY_SOURCE: Record<string, LocalGpuDesktopReferenceRole> = {
  CHARACTER: "CHARACTER",
  CHARACTER_IDENTITY: "CHARACTER",
  PRODUCT: "PRODUCT",
  PRODUCT_IDENTITY: "PRODUCT",
  STYLE: "STYLE",
  OTHER: "OTHER",
};

export function localGpuDesktopReferenceRole(reference: {
  role?: string;
  authorityType?: string;
}): LocalGpuDesktopReferenceRole {
  const source = reference.role ?? reference.authorityType ?? "";
  const mapped = DESKTOP_ROLE_BY_SOURCE[source];
  if (!mapped) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ROLE_UNSUPPORTED");
  return mapped;
}

/** Integer seconds from frozen Recommended Duration. Values outside 5–15 are rejected, never clamped. */
export function localGpuDesktopDurationSec(plannedDurationMs: number): number {
  if (!Number.isInteger(plannedDurationMs) || plannedDurationMs % 1000 !== 0) {
    throw new LocalGpuContractError("LOCAL_GPU_DURATION_UNSUPPORTED");
  }
  const durationSec = plannedDurationMs / 1000;
  if (durationSec < LOCAL_GPU_DURATION_MIN_SEC || durationSec > LOCAL_GPU_DURATION_MAX_SEC) {
    throw new LocalGpuContractError("LOCAL_GPU_DURATION_UNSUPPORTED");
  }
  return durationSec;
}

export function localGpuUploadBindingDigest(upload: {
  environment: string;
  method: string;
  url: string;
}): string {
  return createHash("sha256")
    .update(`${upload.environment}\n${upload.method}\n${upload.url}`, "utf8")
    .digest("hex");
}

export function assertLocalGpuUploadBinding(
  upload: { environment: string; method: string; url: string },
  binding: string,
): void {
  if (binding !== localGpuUploadBindingDigest(upload)) {
    throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
  }
}

export type LocalGpuPackageReferenceSource = {
  role?: string;
  authorityType?: string;
  assetId?: string;
  contentHash?: string;
};

/** Package-level gate used before a signed upload or a Desktop call exists. */
export function assertLocalGpuPackageCompatibility(input: {
  recommendedWorkflow: string;
  plannedDurationMs: number;
  generationMode?: string | null;
  references: readonly LocalGpuPackageReferenceSource[];
  audioPolicy: string;
}): void {
  if (
    input.recommendedWorkflow !== LOCAL_GPU_CERTIFIED_PACKAGE_WORKFLOW
    && input.recommendedWorkflow !== LOCAL_GPU_WORKER_WORKFLOW
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  }
  localGpuDesktopDurationSec(input.plannedDurationMs);
  if (!LOCAL_GPU_AUDIO_POLICIES.includes(input.audioPolicy as LocalGpuAudioPolicy)) {
    throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  }
  assertDesktopReferenceCardinality(input.references.length, input.generationMode);
  for (const reference of input.references) {
    localGpuDesktopReferenceRole(reference);
    if (!reference.assetId) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    if (!reference.contentHash || !/^sha256:[0-9a-f]{64}$/.test(reference.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
  }
}

function assertDesktopReferenceCardinality(count: number, generationMode?: string | null): void {
  if (count === 0 || (generationMode === "TEXT_TO_VIDEO" && count === 0)) {
    throw new LocalGpuContractError("LOCAL_GPU_REFERENCES_REQUIRED");
  }
  if (count > LOCAL_GPU_REFERENCE_MAX) {
    throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  }
  if (count < LOCAL_GPU_REFERENCE_MIN) {
    throw new LocalGpuContractError("LOCAL_GPU_REFERENCES_REQUIRED");
  }
}

function assertHttpsDestination(url: string, code: string): void {
  if (!url.startsWith("https://") || /[\r\n]/.test(url) || isDesktopFilesystemPath(url)) {
    throw new LocalGpuContractError(code);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LocalGpuContractError(code);
  }
  if (parsed.username || parsed.password || parsed.protocol !== "https:") {
    throw new LocalGpuContractError(code);
  }
}

export type LocalGpuDesktopSubmitBody = {
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
  prompt: string;
  durationSec: number;
  durationSource: typeof LOCAL_GPU_DURATION_SOURCE;
  references: LocalGpuDesktopReference[];
  audioPolicy: LocalGpuAudioPolicy;
  upload: LocalGpuUploadDestination;
  aspectRatio?: string;
  megapixels?: number;
  seed?: number;
  voiceInstructions?: string;
  firstFrame?: { assetUrl: string; contentHash: string };
};

/**
 * Deterministic Desktop POST /v1/jobs body.
 * Incompatible packages throw before any network call. This is not a fallback.
 */
export function buildLocalGpuDesktopSubmit(input: {
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: string;
  prompt: string;
  plannedDurationMs: number;
  references: readonly {
    approval?: string;
    role?: string;
    assetUrl?: string;
    contentHash?: string;
  }[];
  audioPolicy: string;
  upload?: {
    environment?: string;
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    assetId?: string;
  } | null;
  generationMode?: string | null;
  aspectRatio?: string | null;
  megapixels?: number | null;
  seed?: number | null;
  voiceInstructions?: string | null;
  firstFrame?: { assetUrl?: string; contentHash?: string } | null;
}): { body: LocalGpuDesktopSubmitBody; uploadBinding: string } {
  if (input.workflow !== LOCAL_GPU_WORKER_WORKFLOW) {
    throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  }
  const durationSec = localGpuDesktopDurationSec(input.plannedDurationMs);
  if (!LOCAL_GPU_AUDIO_POLICIES.includes(input.audioPolicy as LocalGpuAudioPolicy)) {
    throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  }
  if (!input.prompt || /[\r\n]/.test(input.prompt)) {
    throw new LocalGpuContractError("LOCAL_GPU_PROMPT_REQUIRED");
  }
  assertDesktopReferenceCardinality(input.references.length, input.generationMode);
  const references: LocalGpuDesktopReference[] = input.references.map((reference) => {
    if (reference.approval !== "APPROVED") {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_NOT_APPROVED");
    }
    const role = localGpuDesktopReferenceRole({ role: reference.role });
    if (!reference.assetUrl) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    assertHttpsDestination(reference.assetUrl, "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    if (!reference.contentHash || !/^sha256:[0-9a-f]{64}$/.test(reference.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    return {
      approval: "APPROVED",
      role,
      assetUrl: reference.assetUrl,
      contentHash: reference.contentHash,
    };
  });
  const upload = input.upload;
  if (!upload?.environment || !upload.method || !upload.url || /[\r\n]/.test(upload.method)) {
    throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
  }
  if (upload.environment !== input.environment) {
    throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
  }
  assertHttpsDestination(upload.url, "LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
  const destination: LocalGpuUploadDestination = {
    environment: input.environment,
    method: upload.method,
    url: upload.url,
    ...(upload.headers ? { headers: upload.headers } : {}),
    ...(upload.assetId ? { assetId: upload.assetId } : {}),
  };
  const uploadBinding = localGpuUploadBindingDigest(destination);
  assertLocalGpuUploadBinding(destination, uploadBinding);
  let firstFrame: LocalGpuDesktopSubmitBody["firstFrame"];
  if (input.firstFrame) {
    if (!input.firstFrame.assetUrl || !input.firstFrame.contentHash) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    }
    assertHttpsDestination(input.firstFrame.assetUrl, "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    firstFrame = { assetUrl: input.firstFrame.assetUrl, contentHash: input.firstFrame.contentHash };
  }
  const body: LocalGpuDesktopSubmitBody = {
    environment: input.environment,
    jobId: input.jobId,
    sceneExecutionId: input.sceneExecutionId,
    workspaceId: input.workspaceId,
    workflow: LOCAL_GPU_WORKER_WORKFLOW,
    prompt: input.prompt,
    durationSec,
    durationSource: LOCAL_GPU_DURATION_SOURCE,
    references,
    audioPolicy: input.audioPolicy as LocalGpuAudioPolicy,
    upload: destination,
    ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    ...(typeof input.megapixels === "number" ? { megapixels: input.megapixels } : {}),
    ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    ...(input.voiceInstructions ? { voiceInstructions: input.voiceInstructions } : {}),
    ...(firstFrame ? { firstFrame } : {}),
  };
  return { body, uploadBinding };
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
