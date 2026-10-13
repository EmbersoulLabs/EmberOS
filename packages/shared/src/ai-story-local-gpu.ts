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
  /** Present for contract V2 and V3. V1 tokens omit it. */
  creativeBinding?: string;
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
    ...(fields.creativeBinding !== undefined
      ? { creativeBinding: assertCreativeBinding(fields.creativeBinding) }
      : {}),
  };
  return JSON.stringify(claims);
}

function assertCreativeBinding(value: string): string {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new LocalGpuContractError("LOCAL_GPU_SIGNED_FIELD_INVALID:creativeBinding");
  return value;
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

/**
 * Desktop keeps the native audio stream. QC still expects no dialogue.
 * Speech is never auto-passed.
 */
export function localGpuPersistedAudioSeparation(input: {
  qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "SILENT_OUTPUT" | "PRESERVE" | "NATIVE" | "REMOVE_AUDIO";
  generateAudio: boolean;
  audioBlocked: boolean;
}): {
  desktopAudioPolicy: LocalGpuAudioPolicy;
  qcExpectation: typeof input.qcExpectation;
  speechContent: "HUMAN_REVIEW_REQUIRED" | "NOT_APPLICABLE";
  hasAudio: boolean;
} {
  if (input.qcExpectation === "NO_DIALOGUE_WITH_AMBIENT_AUDIO") {
    return {
      desktopAudioPolicy: mapLocalGpuAudioPolicy({
        generateAudio: input.generateAudio,
        audioBlocked: input.audioBlocked,
        expectationKind: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      }),
      qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
      speechContent: "HUMAN_REVIEW_REQUIRED",
      hasAudio: true,
    };
  }
  if (input.qcExpectation === "SILENT_OUTPUT") {
    return {
      desktopAudioPolicy: mapLocalGpuAudioPolicy({
        generateAudio: input.generateAudio,
        audioBlocked: input.audioBlocked,
        expectationKind: "SILENT_OUTPUT",
      }),
      qcExpectation: "SILENT_OUTPUT",
      speechContent: "NOT_APPLICABLE",
      hasAudio: false,
    };
  }
  if (input.qcExpectation === "REMOVE_AUDIO") {
    return {
      desktopAudioPolicy: "REMOVE_AUDIO",
      qcExpectation: "REMOVE_AUDIO",
      speechContent: "NOT_APPLICABLE",
      hasAudio: false,
    };
  }
  if (input.qcExpectation === "PRESERVE" || input.qcExpectation === "NATIVE") {
    return {
      desktopAudioPolicy: input.qcExpectation,
      qcExpectation: input.qcExpectation,
      speechContent: "HUMAN_REVIEW_REQUIRED",
      hasAudio: true,
    };
  }
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

export const LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V2 = 2 as const;
export const LOCAL_GPU_V2_ASSET_MODE = "WITH_ASSET" as const;
export const LOCAL_GPU_V2_AUDIO_POLICIES = [
  "NATIVE",
  "PRESERVE",
  "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
  "REMOVE_AUDIO",
  "SILENT_OUTPUT",
] as const;
export type LocalGpuV2AudioPolicy = (typeof LOCAL_GPU_V2_AUDIO_POLICIES)[number];

export type LocalGpuRuntimeCapabilities = {
  contractVersion: number | null;
  /** Current Desktop response field. */
  workflows?: readonly unknown[];
  /** Versioned Desktop response field. */
  contracts?: { v2?: { workflows?: readonly unknown[] } };
  /** Historical cloud snapshot field; retained for persisted compatibility. */
  workflowIds?: readonly string[];
};

function readLocalGpuV2WorkflowIds(entries: readonly unknown[]): readonly string[] | null {
  const ids: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      if (!entry) return null;
      ids.push(entry);
      continue;
    }
    const record = entry && typeof entry === "object" && !Array.isArray(entry)
      ? entry as Record<string, unknown>
      : null;
    const id = record?.id ?? record?.workflow;
    if (typeof id !== "string" || !id) return null;
    ids.push(id);
  }
  return ids;
}

export type LocalGpuContractV2Reference = {
  role: "CHARACTER" | "PRODUCT";
  subjectId: string;
  variantId?: string | null;
  assetUrl: string;
  contentHash: string;
  approval?: string;
};

export type LocalGpuDesktopSubmitBodyV2 = {
  contractVersion: typeof LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V2;
  assetMode: typeof LOCAL_GPU_V2_ASSET_MODE;
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
  prompt: string;
  durationSec: number;
  durationSource: typeof LOCAL_GPU_DURATION_SOURCE;
  audioPolicy: LocalGpuV2AudioPolicy;
  upload: LocalGpuUploadDestination;
  creative: {
    characters: { subjectId: string; dnaFingerprint: string | null; modelBound: false }[];
    products: { subjectId: string; variantId: string | null; modelBound: false }[];
    scene: { sceneExecutionId: string } | null;
  };
  references: {
    order: number;
    approval: "APPROVED";
    role: "CHARACTER" | "PRODUCT";
    subjectId: string;
    variantId: string | null;
    assetUrl: string;
    contentHash: string;
  }[];
  firstFrame: null | { sourceAssetId: string; contentHash: string; assetUrl: string };
};

export function assertLocalGpuV2RuntimeCapabilities(capabilities: LocalGpuRuntimeCapabilities | null): void {
  const workflowEntries = capabilities?.workflows
    ?? capabilities?.contracts?.v2?.workflows
    ?? capabilities?.workflowIds
    ?? [];
  const workflows = readLocalGpuV2WorkflowIds(workflowEntries);
  if (
    !capabilities
    || capabilities.contractVersion !== LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V2
    || !workflows?.includes(LOCAL_GPU_WORKER_WORKFLOW)
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
  }
}

export function buildLocalGpuDesktopSubmitV2(input: {
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: string;
  prompt: string;
  plannedDurationMs: number;
  upload?: { environment?: string; method?: string; url?: string; headers?: Record<string, string>; assetId?: string } | null;
  audioPolicy: LocalGpuV2AudioPolicy;
  productOnlyScene?: boolean;
  creative: {
    characters: readonly { subjectId: string; dnaFingerprint?: string | null }[];
    products: readonly { subjectId: string; variantId?: string | null }[];
    scene?: { sceneExecutionId: string } | null;
  };
  references: readonly LocalGpuContractV2Reference[];
  firstFrame?: null | {
    sourceAssetId: string;
    contentHash: string;
    assetUrl: string;
    authoritySourceAssetId: string;
    authorityContentHash: string;
  };
  continuityRequired?: boolean;
  dialogueLineCount?: number;
  pinnedVoiceDna?: boolean;
  structuredCamera?: boolean;
  structuredMotion?: boolean;
  textOnly?: boolean;
}): { body: LocalGpuDesktopSubmitBodyV2; uploadBinding: string; speechReviewRequired: boolean } {
  if ((input.dialogueLineCount ?? 0) > 0 || input.workflow === "MINIMAX_H3_NATIVE_DIALOGUE") {
    throw new LocalGpuContractError("LOCAL_GPU_DISPATCH_DISABLED");
  }
  if (input.pinnedVoiceDna) throw new LocalGpuContractError("LOCAL_GPU_VOICE_DNA_UNSUPPORTED");
  if (input.structuredCamera || input.structuredMotion) throw new LocalGpuContractError("LOCAL_GPU_CAMERA_MOTION_UNSUPPORTED");
  if (input.textOnly || input.workflow === "WAN_T2V" || input.workflow === "TEXT_TO_VIDEO") {
    throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  }
  const workflow = assertLocalGpuDispatchWorkflow(input.workflow);
  if (!LOCAL_GPU_V2_AUDIO_POLICIES.includes(input.audioPolicy)) throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  if (input.productOnlyScene && input.audioPolicy === "REMOVE_AUDIO") throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  if (!input.prompt || /[\r\n]/.test(input.prompt)) throw new LocalGpuContractError("LOCAL_GPU_PROMPT_REQUIRED");
  if (input.references.length < LOCAL_GPU_REFERENCE_MIN) throw new LocalGpuContractError("LOCAL_GPU_REFERENCES_REQUIRED");
  if (input.references.length > LOCAL_GPU_REFERENCE_MAX) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
  const references = input.references.map((reference, order) => {
    if (reference.approval !== "APPROVED") throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_NOT_APPROVED");
    if (reference.role !== "CHARACTER" && reference.role !== "PRODUCT") throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ROLE_UNSUPPORTED");
    if (!reference.subjectId) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_AUTHORITY_REQUIRED");
    if (!reference.assetUrl) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    assertHttpsDestination(reference.assetUrl, "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    if (!reference.contentHash || !/^sha256:[0-9a-f]{64}$/.test(reference.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    const variantId = reference.variantId ?? null;
    const authority = reference.role === "CHARACTER"
      ? input.creative.characters.find((character) => character.subjectId === reference.subjectId)
      : input.creative.products.find((product) => product.subjectId === reference.subjectId);
    if (!authority) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_AUTHORITY_REQUIRED");
    if (reference.role === "PRODUCT" && (authority as { variantId?: string | null }).variantId !== variantId) {
      throw new LocalGpuContractError("LOCAL_GPU_VARIANT_MISMATCH");
    }
    return {
      order,
      approval: "APPROVED" as const,
      role: reference.role,
      subjectId: reference.subjectId,
      variantId,
      assetUrl: reference.assetUrl,
      contentHash: reference.contentHash,
    };
  });
  const characterIds = references.filter((reference) => reference.role === "CHARACTER").map((reference) => reference.subjectId);
  const productIds = references.filter((reference) => reference.role === "PRODUCT").map((reference) => reference.subjectId);
  if (input.creative.characters.some((character) => !characterIds.includes(character.subjectId))) {
    throw new LocalGpuContractError("LOCAL_GPU_CHARACTER_REFERENCE_REQUIRED");
  }
  if (input.creative.products.some((product) => !productIds.includes(product.subjectId))) {
    throw new LocalGpuContractError("LOCAL_GPU_PRODUCT_REFERENCE_REQUIRED");
  }
  let firstFrame: LocalGpuDesktopSubmitBodyV2["firstFrame"] = null;
  if (input.continuityRequired && !input.firstFrame) throw new LocalGpuContractError("LOCAL_GPU_CONTINUITY_FRAME_REQUIRED");
  if (input.firstFrame) {
    const frame = input.firstFrame;
    if (!frame.sourceAssetId || !frame.authoritySourceAssetId || frame.sourceAssetId !== frame.authoritySourceAssetId) {
      throw new LocalGpuContractError("LOCAL_GPU_CONTINUITY_FRAME_MISMATCH");
    }
    if (!frame.contentHash || frame.contentHash !== frame.authorityContentHash || !/^sha256:[0-9a-f]{64}$/.test(frame.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_CONTINUITY_FRAME_MISMATCH");
    }
    if (!frame.assetUrl) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    assertHttpsDestination(frame.assetUrl, "LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    firstFrame = { sourceAssetId: frame.sourceAssetId, contentHash: frame.contentHash, assetUrl: frame.assetUrl };
  }
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
  const durationSec = localGpuDesktopDurationSec(input.plannedDurationMs);
  return {
    uploadBinding,
    speechReviewRequired: input.audioPolicy === "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    body: {
      contractVersion: LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V2,
      assetMode: LOCAL_GPU_V2_ASSET_MODE,
      environment: input.environment,
      jobId: input.jobId,
      sceneExecutionId: input.sceneExecutionId,
      workspaceId: input.workspaceId,
      workflow,
      prompt: input.prompt,
      durationSec,
      durationSource: LOCAL_GPU_DURATION_SOURCE,
      audioPolicy: input.audioPolicy,
      upload: destination,
      creative: {
        characters: input.creative.characters.map((character) => ({
          subjectId: character.subjectId,
          dnaFingerprint: character.dnaFingerprint ?? null,
          modelBound: false as const,
        })),
        products: input.creative.products.map((product) => ({
          subjectId: product.subjectId,
          variantId: product.variantId ?? null,
          modelBound: false as const,
        })),
        scene: input.creative.scene ?? null,
      },
      references,
      firstFrame,
    },
  };
}

export const LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V3 = 3 as const;
export const LOCAL_GPU_T2V_WORKFLOW = "MINIMAX_H3_T2V" as const;
export const LOCAL_GPU_DIRECTOR_GUIDANCE = "PROMPT_GUIDANCE" as const;
export const LOCAL_GPU_V3_E2E_CERTIFIED = false as const;
/** Inclusive Desktop H3 T2V workflow range. Out-of-range values are rejected, not clamped. */
export const LOCAL_GPU_T2V_MEGAPIXELS_MIN = 0.2;
export const LOCAL_GPU_T2V_MEGAPIXELS_MAX = 0.98;
export const LOCAL_GPU_CREATIVE_BINDING_KEYS_V2 = [
  "contractVersion",
  "assetMode",
  "jobId",
  "sceneExecutionId",
  "workspaceId",
  "workflow",
  "prompt",
  "durationSec",
  "audioPolicy",
  "aspectRatio",
  "megapixels",
  "voiceInstructions",
  "seed",
  "references",
  "firstFrame",
] as const;
export const LOCAL_GPU_CREATIVE_BINDING_KEYS_V3 = [
  ...LOCAL_GPU_CREATIVE_BINDING_KEYS_V2,
  "audioReferences",
  "videoReferences",
  "dialogue",
  "director",
  "lastFrame",
] as const;

export type LocalGpuDirectorGuidance = {
  guidance: typeof LOCAL_GPU_DIRECTOR_GUIDANCE;
  camera: string | null;
  motion: string | null;
};

export type LocalGpuCanonicalCreativeJob = {
  contractVersion: 2 | 3;
  assetMode: "WITH_ASSET" | "WITHOUT_ASSET";
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: string;
  prompt: string;
  durationSec: number;
  audioPolicy: string;
  aspectRatio: string | null;
  megapixels: number | null;
  voiceInstructions: string | null;
  seed: number | null;
  references: unknown;
  firstFrame: unknown | null;
  audioReferences?: unknown | null;
  videoReferences?: unknown | null;
  dialogue?: unknown | null;
  director?: LocalGpuDirectorGuidance | null;
  lastFrame?: unknown | null;
};

export function localGpuDirectorGuidance(input: { camera?: string | null; motion?: string | null } | null): LocalGpuDirectorGuidance | null {
  if (!input || (!input.camera && !input.motion)) return null;
  return {
    guidance: LOCAL_GPU_DIRECTOR_GUIDANCE,
    camera: input.camera ?? null,
    motion: input.motion ?? null,
  };
}

export function localGpuCanonicalCreativeJob(input: LocalGpuCanonicalCreativeJob): Record<string, unknown> {
  const job: Record<string, unknown> = {
    contractVersion: input.contractVersion,
    assetMode: input.assetMode,
    jobId: input.jobId,
    sceneExecutionId: input.sceneExecutionId,
    workspaceId: input.workspaceId,
    workflow: input.workflow,
    prompt: input.prompt,
    durationSec: input.durationSec,
    audioPolicy: input.audioPolicy,
    aspectRatio: input.aspectRatio ?? null,
    megapixels: input.megapixels ?? null,
    voiceInstructions: input.voiceInstructions ?? null,
    seed: input.seed ?? null,
    references: input.references,
    firstFrame: input.firstFrame ?? null,
  };
  if (input.contractVersion === LOCAL_GPU_DESKTOP_CONTRACT_VERSION_V3) {
    job.audioReferences = input.audioReferences ?? null;
    job.videoReferences = input.videoReferences ?? null;
    job.dialogue = input.dialogue ?? null;
    job.director = input.director ?? null;
    job.lastFrame = input.lastFrame ?? null;
  }
  return job;
}

export function localGpuCreativeBindingDigest(job: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(job), "utf8").digest("hex");
}

export function assertLocalGpuCreativeBinding(job: Record<string, unknown>, creativeBinding: string): void {
  if (localGpuCreativeBindingDigest(job) !== creativeBinding) {
    throw new LocalGpuContractError("LOCAL_GPU_CREATIVE_BINDING_MISMATCH");
  }
}

export function localGpuCreativeBindingForV2Body(
  body: LocalGpuDesktopSubmitBodyV2 & { aspectRatio?: string | null },
  seed: number | null = null,
): string {
  return localGpuCreativeBindingDigest(localGpuCanonicalCreativeJob({
    contractVersion: 2,
    assetMode: body.assetMode,
    jobId: body.jobId,
    sceneExecutionId: body.sceneExecutionId,
    workspaceId: body.workspaceId,
    workflow: body.workflow,
    prompt: body.prompt,
    durationSec: body.durationSec,
    audioPolicy: body.audioPolicy,
    aspectRatio: body.aspectRatio ?? null,
    megapixels: null,
    voiceInstructions: null,
    seed,
    references: body.references,
    firstFrame: body.firstFrame,
  }));
}

export function assertLocalGpuZeroAssetAuthority(input: {
  workspaceId: string;
  storyId: string;
  storyVersionId: string;
  assetRecommendationStatus: "SATISFIED" | "ASSET_RECOMMENDATION_REQUIRED" | "CONFIRMED_NO_ASSETS";
  confirmationStoryId?: string | null;
  confirmationStoryVersionId?: string | null;
  confirmationWorkspaceId?: string | null;
  imageReferenceCount: number;
  activeBindingCount?: number;
  obsoleteReferenceCount?: number;
  planningFrozen: boolean;
  preGenerationQcEvaluationId: string | null;
  runtimeAuthorizationId: string | null;
}): void {
  if (input.assetRecommendationStatus !== "CONFIRMED_NO_ASSETS") {
    throw new LocalGpuContractError("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
  }
  if (
    input.confirmationStoryId !== input.storyId
    || input.confirmationStoryVersionId !== input.storyVersionId
    || (input.confirmationWorkspaceId !== undefined && input.confirmationWorkspaceId !== input.workspaceId)
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
  }
  if (!input.workspaceId || !input.storyId || !input.storyVersionId) {
    throw new LocalGpuContractError("LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
  }
  if (input.planningFrozen !== true) throw new LocalGpuContractError("LOCAL_GPU_PLANNING_AUTHORITY_REQUIRED");
  if (!input.preGenerationQcEvaluationId) throw new LocalGpuContractError("LOCAL_GPU_PRE_QC_REQUIRED");
  if (!input.runtimeAuthorizationId) throw new LocalGpuContractError("LOCAL_GPU_RUNTIME_AUTHORIZATION_REQUIRED");
  if ((input.activeBindingCount ?? 0) > 0) throw new LocalGpuContractError("LOCAL_GPU_ASSET_BINDING_PRESENT");
  if ((input.obsoleteReferenceCount ?? 0) > 0) throw new LocalGpuContractError("LOCAL_GPU_OBSOLETE_ASSET_REFERENCE");
  if (input.imageReferenceCount > 0) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
}

export function selectLocalGpuV3Workflow(input: {
  assetMode: "WITH_ASSET" | "WITHOUT_ASSET";
  nativeDialogue?: boolean;
  dialogueRequired?: boolean;
  continuityFrameRequired?: boolean;
  voiceDnaRequired?: boolean;
  audioReferenceCount?: number;
  videoReferenceCount?: number;
  imageReferenceCount?: number;
}): { contractVersion: 3; assetMode: "WITH_ASSET" | "WITHOUT_ASSET"; workflow: typeof LOCAL_GPU_T2V_WORKFLOW | typeof LOCAL_GPU_WORKER_WORKFLOW } {
  if (
    input.nativeDialogue
    || input.dialogueRequired
    || input.continuityFrameRequired
    || input.voiceDnaRequired
    || (input.audioReferenceCount ?? 0) > 0
    || (input.videoReferenceCount ?? 0) > 0
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
  }
  if (input.assetMode === "WITHOUT_ASSET") {
    if ((input.imageReferenceCount ?? 0) > 0) throw new LocalGpuContractError("LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
    return { contractVersion: 3, assetMode: "WITHOUT_ASSET", workflow: LOCAL_GPU_T2V_WORKFLOW };
  }
  if ((input.imageReferenceCount ?? 0) < 1) throw new LocalGpuContractError("LOCAL_GPU_REFERENCES_REQUIRED");
  return { contractVersion: 3, assetMode: "WITH_ASSET", workflow: LOCAL_GPU_WORKER_WORKFLOW };
}

export type LocalGpuV3T2vCapability = {
  workflow: typeof LOCAL_GPU_T2V_WORKFLOW;
  execution: "enabled";
  textToVideo: true;
  placeholderImage: false;
  missingModels: [];
  e2eCertified: boolean;
};

function asCapabilityRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readV3Workflow(contractsV3: Record<string, unknown>): Record<string, unknown> | null {
  const workflows = contractsV3.workflows;
  if (Array.isArray(workflows)) {
    for (const item of workflows) {
      const record = asCapabilityRecord(item);
      const id = record?.id ?? record?.workflow;
      if (id === LOCAL_GPU_T2V_WORKFLOW && record) return record;
    }
    return null;
  }
  const map = asCapabilityRecord(workflows);
  return map ? asCapabilityRecord(map[LOCAL_GPU_T2V_WORKFLOW]) : null;
}

/** Top-level contractVersion is not enough. Contract V3 must advertise MINIMAX_H3_T2V under contracts.v3. */
export function readLocalGpuV3T2vCapability(body: unknown): LocalGpuV3T2vCapability {
  const root = asCapabilityRecord(body);
  const contracts = asCapabilityRecord(root?.contracts);
  const v3 = asCapabilityRecord(contracts?.v3);
  const workflow = v3 ? readV3Workflow(v3) : null;
  if (!workflow) throw new LocalGpuContractError("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
  const missingModels = Array.isArray(workflow.missingModels) ? workflow.missingModels.filter((item) => typeof item === "string") : null;
  if (
    workflow.execution !== "enabled"
    || workflow.textToVideo !== true
    || workflow.placeholderImage !== false
    || !missingModels
    || missingModels.length > 0
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
  }
  return {
    workflow: LOCAL_GPU_T2V_WORKFLOW,
    execution: "enabled",
    textToVideo: true,
    placeholderImage: false,
    missingModels: [],
    e2eCertified: workflow.e2eCertified === true,
  };
}

export function assertLocalGpuV3RuntimeCapabilities(capabilities: unknown): LocalGpuV3T2vCapability {
  return readLocalGpuV3T2vCapability(capabilities);
}

export type LocalGpuDesktopSubmitBodyV3 = {
  contractVersion: 3;
  assetMode: "WITHOUT_ASSET" | "WITH_ASSET";
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: typeof LOCAL_GPU_T2V_WORKFLOW | typeof LOCAL_GPU_WORKER_WORKFLOW;
  prompt: string;
  durationSec: number;
  durationSource: typeof LOCAL_GPU_DURATION_SOURCE;
  audioPolicy: LocalGpuV2AudioPolicy;
  aspectRatio: string;
  megapixels: number;
  voiceInstructions: null;
  seed: number;
  references: [];
  firstFrame: null;
  audioReferences: null;
  videoReferences: null;
  dialogue: null;
  director: LocalGpuDirectorGuidance | null;
  lastFrame: null;
  upload: LocalGpuUploadDestination;
};

export function assertLocalGpuT2vMegapixels(megapixels: number): number {
  if (!Number.isFinite(megapixels) || megapixels <= 0) {
    throw new LocalGpuContractError("LOCAL_GPU_RESOLUTION_REQUIRED");
  }
  if (megapixels < LOCAL_GPU_T2V_MEGAPIXELS_MIN || megapixels > LOCAL_GPU_T2V_MEGAPIXELS_MAX) {
    throw new LocalGpuContractError("LOCAL_GPU_RESOLUTION_UNSUPPORTED");
  }
  return megapixels;
}

export function buildLocalGpuZeroAssetT2VSubmit(input: {
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  storyId: string;
  storyVersionId: string;
  prompt: string;
  plannedDurationMs: number;
  aspectRatio: "9:16" | "16:9" | "1:1";
  seed: number;
  audioPolicy: LocalGpuV2AudioPolicy;
  megapixels: number;
  director?: { camera?: string | null; motion?: string | null } | null;
  upload?: { environment?: string; method?: string; url?: string; headers?: Record<string, string>; assetId?: string } | null;
  assetRecommendationStatus: "SATISFIED" | "ASSET_RECOMMENDATION_REQUIRED" | "CONFIRMED_NO_ASSETS";
  confirmationStoryId?: string | null;
  confirmationStoryVersionId?: string | null;
  confirmationWorkspaceId?: string | null;
  imageReferenceCount?: number;
  activeBindingCount?: number;
  obsoleteReferenceCount?: number;
  planningFrozen: boolean;
  preGenerationQcEvaluationId: string;
  runtimeAuthorizationId: string;
  nativeDialogue?: boolean;
  dialogueLineCount?: number;
  dialogueRequired?: boolean;
  continuityFrameRequired?: boolean;
  voiceDnaRequired?: boolean;
  audioReferenceCount?: number;
  videoReferenceCount?: number;
}): { body: LocalGpuDesktopSubmitBodyV3; canonicalJob: Record<string, unknown>; creativeBinding: string; uploadBinding: string; speechReviewRequired: boolean; e2eCertified: false } {
  assertLocalGpuZeroAssetAuthority({
    workspaceId: input.workspaceId,
    storyId: input.storyId,
    storyVersionId: input.storyVersionId,
    assetRecommendationStatus: input.assetRecommendationStatus,
    confirmationStoryId: input.confirmationStoryId,
    confirmationStoryVersionId: input.confirmationStoryVersionId,
    confirmationWorkspaceId: input.confirmationWorkspaceId,
    imageReferenceCount: input.imageReferenceCount ?? 0,
    activeBindingCount: input.activeBindingCount,
    obsoleteReferenceCount: input.obsoleteReferenceCount,
    planningFrozen: input.planningFrozen,
    preGenerationQcEvaluationId: input.preGenerationQcEvaluationId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
  });
  const selected = selectLocalGpuV3Workflow({
    assetMode: "WITHOUT_ASSET",
    nativeDialogue: input.nativeDialogue,
    dialogueRequired: input.dialogueRequired,
    continuityFrameRequired: input.continuityFrameRequired,
    voiceDnaRequired: input.voiceDnaRequired,
    audioReferenceCount: input.audioReferenceCount,
    videoReferenceCount: input.videoReferenceCount,
    imageReferenceCount: input.imageReferenceCount ?? 0,
  });
  if (selected.workflow !== LOCAL_GPU_T2V_WORKFLOW) throw new LocalGpuContractError("LOCAL_GPU_WORKFLOW_UNSUPPORTED");
  if (!LOCAL_GPU_V2_AUDIO_POLICIES.includes(input.audioPolicy)) throw new LocalGpuContractError("LOCAL_GPU_AUDIO_POLICY_INVALID");
  if (!input.prompt || /[\r\n]/.test(input.prompt)) throw new LocalGpuContractError("LOCAL_GPU_PROMPT_REQUIRED");
  if (!Number.isInteger(input.seed)) throw new LocalGpuContractError("LOCAL_GPU_SEED_REQUIRED");
  const megapixels = assertLocalGpuT2vMegapixels(input.megapixels);
  const durationSec = localGpuDesktopDurationSec(input.plannedDurationMs);
  const upload = input.upload;
  if (!upload?.environment || !upload.method || !upload.url || upload.environment !== input.environment) {
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
  const director = localGpuDirectorGuidance(input.director ?? null);
  const canonicalJob = localGpuCanonicalCreativeJob({
    contractVersion: 3,
    assetMode: "WITHOUT_ASSET",
    jobId: input.jobId,
    sceneExecutionId: input.sceneExecutionId,
    workspaceId: input.workspaceId,
    workflow: LOCAL_GPU_T2V_WORKFLOW,
    prompt: input.prompt,
    durationSec,
    audioPolicy: input.audioPolicy,
    aspectRatio: input.aspectRatio,
    megapixels,
    voiceInstructions: null,
    seed: input.seed,
    references: [],
    firstFrame: null,
    audioReferences: null,
    videoReferences: null,
    dialogue: null,
    director,
    lastFrame: null,
  });
  const creativeBinding = localGpuCreativeBindingDigest(canonicalJob);
  assertLocalGpuCreativeBinding(canonicalJob, creativeBinding);
  return {
    uploadBinding,
    canonicalJob,
    creativeBinding,
    speechReviewRequired: input.audioPolicy === "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
    e2eCertified: false,
    body: {
      contractVersion: 3,
      assetMode: "WITHOUT_ASSET",
      environment: input.environment,
      jobId: input.jobId,
      sceneExecutionId: input.sceneExecutionId,
      workspaceId: input.workspaceId,
      workflow: LOCAL_GPU_T2V_WORKFLOW,
      prompt: input.prompt,
      durationSec,
      durationSource: LOCAL_GPU_DURATION_SOURCE,
      audioPolicy: input.audioPolicy,
      aspectRatio: input.aspectRatio,
      megapixels,
      voiceInstructions: null,
      seed: input.seed,
      references: [],
      firstFrame: null,
      audioReferences: null,
      videoReferences: null,
      dialogue: null,
      director,
      lastFrame: null,
      upload: destination,
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
