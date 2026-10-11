/**
 * Desktop LOCAL_GPU wire contract.
 * HMAC covers the base64url payload string. The secret is a UTF-8 string.
 * HTTP method and URL of /v1/jobs are not HMAC inputs; the upload destination is.
 * This module does not dispatch Native Dialogue or the Staging Product-only candidate.
 */
import { createHash } from "crypto";
import { z } from "zod";

export const LOCAL_GPU_PROVIDER_ID = "LOCAL_GPU" as const;
export const LOCAL_GPU_EXECUTION_CLASS = "LOCAL_GPU" as const;
export const LOCAL_GPU_BASE_URL = "https://local-gpu.embersoullabs.com" as const;
export const LOCAL_GPU_WORKER_WORKFLOW = "MINIMAX_H3_R2V" as const;
export const LOCAL_GPU_DISPATCH_DISABLED_WORKFLOWS = [
  "MINIMAX_H3_NATIVE_DIALOGUE",
  "MINIMAX_H3_PRODUCT_ONLY_CANDIDATE_V1",
] as const;
export const LOCAL_GPU_AUTOMATIC_GENERATION_RETRY = 0 as const;
export const LOCAL_GPU_REMOTE_PROVIDER_FALLBACK = 0 as const;
export const LOCAL_GPU_AUTO_APPROVED = false as const;
export const LOCAL_GPU_DEFAULT_AGENCY_ENABLED = false as const;
export const LOCAL_GPU_DEFAULT_REQUEST_TTL_MS = 600_000 as const;
export const LOCAL_GPU_MAX_REQUEST_TTL_MS = 600_000 as const;
export const LOCAL_GPU_TOKEN_VERSION = 1 as const;
export const LOCAL_GPU_CAPABILITIES_ACTION = "capabilities" as const;
export const LOCAL_GPU_SUBMIT_ACTION = "submit" as const;
export const LOCAL_GPU_STATUS_ACTION = "status" as const;
export const LOCAL_GPU_RESULT_ACTION = "result" as const;
export const LOCAL_GPU_DURATION_SOURCE = "RECOMMENDED_DURATION_AUTHORITY" as const;
export const LOCAL_GPU_DURATION_MIN_SEC = 5;
export const LOCAL_GPU_DURATION_MAX_SEC = 15;
export const LOCAL_GPU_REFERENCE_MIN = 1;
export const LOCAL_GPU_REFERENCE_MAX = 2;
export const LOCAL_GPU_RECONCILE_ATTEMPT_LIMIT = 3 as const;
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

export const LocalGpuEnvironmentSchema = z.enum(LOCAL_GPU_ENVIRONMENTS);
export const LocalGpuAudioPolicySchema = z.enum(LOCAL_GPU_AUDIO_POLICIES);
export const LocalGpuJobStateSchema = z.enum(LOCAL_GPU_JOB_STATES);
export type LocalGpuEnvironment = z.infer<typeof LocalGpuEnvironmentSchema>;
export type LocalGpuAudioPolicy = z.infer<typeof LocalGpuAudioPolicySchema>;
export type LocalGpuJobState = z.infer<typeof LocalGpuJobStateSchema>;

export class LocalGpuContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalGpuContractError";
  }
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

function assertUploadBinding(value: LocalGpuSignedFields["uploadBinding"]): LocalGpuSignedFields["uploadBinding"] {
  if (typeof value === "string") {
    if (!/^[0-9a-f]{64}$/.test(value)) throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:uploadBinding");
    return value;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:uploadBinding");
  }
  return value;
}

export function canonicalLocalGpuSigningPayload(fields: LocalGpuSignedFields): string {
  if (!Number.isInteger(fields.expiresAt)) throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:expiresAt");
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
    uploadBinding: assertUploadBinding(fields.uploadBinding),
  };
  return JSON.stringify(claims);
}

export function assertLocalGpuRequestExpiry(expiresAt: number, now: Date): void {
  const ttlMs = expiresAt - now.getTime();
  if (!Number.isInteger(expiresAt) || ttlMs <= 0 || ttlMs > LOCAL_GPU_MAX_REQUEST_TTL_MS) {
    throw new LocalGpuContractError("LOCAL_GPU_REQUEST_EXPIRY_INVALID");
  }
}

export function localGpuUploadBindingDigest(upload: { environment: string; method: string; url: string }): string {
  return createHash("sha256").update(`${upload.environment}\n${upload.method}\n${upload.url}`, "utf8").digest("hex");
}

export function assertLocalGpuUploadBinding(
  upload: { environment: string; method: string; url: string },
  binding: string,
): void {
  if (binding !== localGpuUploadBindingDigest(upload)) throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_BINDING_MISMATCH");
}

export function assertLocalGpuDispatchWorkflow(workflow: string): typeof LOCAL_GPU_WORKER_WORKFLOW {
  if ((LOCAL_GPU_DISPATCH_DISABLED_WORKFLOWS as readonly string[]).includes(workflow)) {
    throw new LocalGpuContractError("LOCAL_GPU_DISPATCH_DISABLED");
  }
  if (workflow !== LOCAL_GPU_WORKER_WORKFLOW) throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  return LOCAL_GPU_WORKER_WORKFLOW;
}

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

const DESKTOP_ROLE_BY_SOURCE: Record<string, LocalGpuDesktopReferenceRole> = {
  CHARACTER: "CHARACTER",
  CHARACTER_IDENTITY: "CHARACTER",
  PRODUCT: "PRODUCT",
  PRODUCT_IDENTITY: "PRODUCT",
  STYLE: "STYLE",
  OTHER: "OTHER",
};

export function localGpuDesktopReferenceRole(reference: { role?: string; authorityType?: string }): LocalGpuDesktopReferenceRole | null {
  return DESKTOP_ROLE_BY_SOURCE[reference.role ?? reference.authorityType ?? ""] ?? null;
}

export function isDesktopFilesystemPath(value: string): boolean {
  return /^[A-Za-z]:\\/.test(value) || value.startsWith("\\\\") || value.startsWith("file:");
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
  if (parsed.username || parsed.password || parsed.protocol !== "https:") throw new LocalGpuContractError(code);
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
};

export function mapLocalGpuAudioPolicy(input: {
  generateAudio: boolean;
  audioBlocked: boolean;
  expectationKind?: "PRESERVE_SOURCE_AUDIO" | "NATIVE_CHARACTER_DIALOGUE" | "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "SILENT_OUTPUT" | "TTS_SPEECH" | "FINAL_AUDIO_MIX" | null;
}): LocalGpuAudioPolicy {
  const kind = input.expectationKind ?? null;
  if (kind === "PRESERVE_SOURCE_AUDIO") return "PRESERVE";
  if (kind === "NATIVE_CHARACTER_DIALOGUE" || kind === "NO_DIALOGUE_WITH_AMBIENT_AUDIO") {
    if (!input.generateAudio || input.audioBlocked) throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
    return "NATIVE";
  }
  if (kind === "SILENT_OUTPUT" || kind === "TTS_SPEECH" || kind === "FINAL_AUDIO_MIX") return "REMOVE_AUDIO";
  if (input.audioBlocked && !input.generateAudio) return "REMOVE_AUDIO";
  if (input.generateAudio && !input.audioBlocked) return "NATIVE";
  throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
}

export function buildLocalGpuDesktopSubmit(input: {
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: string;
  prompt: string;
  plannedDurationMs: number;
  references: readonly { approval?: string; role?: string; assetUrl?: string; contentHash?: string }[];
  audioPolicy: string;
  upload?: { environment?: string; method?: string; url?: string; headers?: Record<string, string>; assetId?: string } | null;
  aspectRatio?: string | null;
}): { body: LocalGpuDesktopSubmitBody; uploadBinding: string } {
  const workflow = assertLocalGpuDispatchWorkflow(input.workflow);
  const durationSec = localGpuDesktopDurationSec(input.plannedDurationMs);
  if (!LOCAL_GPU_AUDIO_POLICIES.includes(input.audioPolicy as LocalGpuAudioPolicy)) {
    throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  }
  if (!input.prompt || /[\r\n]/.test(input.prompt)) throw new LocalGpuContractError("LOCAL_GPU_PROMPT_REQUIRED");
  if (input.references.length < LOCAL_GPU_REFERENCE_MIN) throw new LocalGpuContractError("LOCAL_GPU_REFERENCES_REQUIRED");
  if (input.references.length > LOCAL_GPU_REFERENCE_MAX) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  const references: LocalGpuDesktopReference[] = input.references.map((reference) => {
    if (reference.approval !== "APPROVED") throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_NOT_APPROVED");
    const role = localGpuDesktopReferenceRole({ role: reference.role });
    if (!role) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ROLE_UNSUPPORTED");
    if (!reference.assetUrl) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    assertHttpsDestination(reference.assetUrl, "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    if (!reference.contentHash || !/^sha256:[0-9a-f]{64}$/.test(reference.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    return { approval: "APPROVED", role, assetUrl: reference.assetUrl, contentHash: reference.contentHash };
  });
  const upload = input.upload;
  if (!upload?.environment || !upload.method || !upload.url || /[\r\n]/.test(upload.method)) {
    throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
  }
  if (upload.environment !== input.environment) throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
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
  return {
    uploadBinding,
    body: {
      environment: input.environment,
      jobId: input.jobId,
      sceneExecutionId: input.sceneExecutionId,
      workspaceId: input.workspaceId,
      workflow,
      prompt: input.prompt,
      durationSec,
      durationSource: LOCAL_GPU_DURATION_SOURCE,
      references,
      audioPolicy: input.audioPolicy as LocalGpuAudioPolicy,
      upload: destination,
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
    },
  };
}

export function localGpuTerminalDisposition(state: LocalGpuJobState): {
  state: LocalGpuJobState;
  automaticGenerationRetry: 0;
  remoteProviderFallback: null;
} {
  return { state, automaticGenerationRetry: 0, remoteProviderFallback: null };
}

export function localGpuReconcileBackoffMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new LocalGpuContractError("LOCAL_GPU_RECONCILE_ATTEMPT_INVALID");
  return Math.min(30_000, 1_000 * (2 ** (attempt - 1)));
}

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function localGpuJobIdFromGate(gate: string | null): string | null {
  if (!gate) return null;
  if (JOB_ID.test(gate)) return gate;
  const reconcile = /^reconcile:(\d+):([0-9a-f-]{36})$/i.exec(gate);
  if (reconcile?.[2] && JOB_ID.test(reconcile[2])) return reconcile[2];
  const prefixed = /^(?:failed|blocked|result):([0-9a-f-]{36})$/i.exec(gate);
  return prefixed?.[1] && JOB_ID.test(prefixed[1]) ? prefixed[1] : null;
}

export function assertLocalGpuSubmitAllowed(gate: string | null): void {
  if (gate !== null) throw new LocalGpuContractError("LOCAL_GPU_DUPLICATE_SUBMIT");
}
