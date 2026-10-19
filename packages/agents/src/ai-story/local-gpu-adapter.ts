import { randomUUID } from "node:crypto";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import type { AiStoryCharacterVoiceDna, AiStoryLocalGenerationPackage } from "@ceo-agent/shared";
import {
  assertLocalGpuDispatchWorkflow,
  assertLocalGpuRequestExpiry,
  assertLocalGpuUploadBinding,
  assertLocalGpuCreativeBinding,
  assertLocalGpuV2RuntimeCapabilities,
  assertLocalGpuV3RuntimeCapabilities,
  assertLocalGpuSubmitAllowed,
  buildLocalGpuDesktopSubmit,
  buildLocalGpuDesktopSubmitV2,
  readLocalGpuV2FirstFrameAuthorities,
  buildLocalGpuZeroAssetT2VSubmit,
  localGpuCanonicalCreativeJob,
  localGpuUploadBindingDigest,
  localGpuCreativeBindingForV2Body,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_CAPABILITIES_ACTION,
  LOCAL_GPU_DEFAULT_REQUEST_TTL_MS,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  LOCAL_GPU_RESULT_ACTION,
  LOCAL_GPU_STATUS_ACTION,
  LOCAL_GPU_SUBMIT_ACTION,
  LOCAL_GPU_SUBMISSION_EVIDENCE_ACTION,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  type LocalGpuRuntimeCapabilities,
  LocalGpuJobStateSchema,
  localGpuTerminalDisposition,
  mapLocalGpuAudioPolicy,
  type LocalGpuEnvironment,
  type LocalGpuJobState,
  type LocalGpuSignedFields,
  type LocalGpuUploadDestination,
} from "@ceo-agent/shared/server";
import { assertLocalGpuAccess, type LocalGpuServerActor } from "./local-gpu-access";
import { type LocalGpuConfig } from "./local-gpu-config";
import { signLocalGpuRequest } from "./local-gpu-signing";
import {
  localGpuSubmissionEvidenceDigest,
  verifyLocalGpuSubmissionEvidence,
  type LocalGpuSubmissionEvidence,
  type SignedLocalGpuSubmissionEvidence,
} from "./local-gpu-submission-evidence";
import {
  prepareLocalGpuR2vDnaHandoff,
} from "./local-gpu-r2v-dna-transport";
import type { LocalGpuResolvedAsset } from "./local-gpu-package-transport";

export type LocalGpuHttpResponse = { status: number; body: string };
export type LocalGpuHttp = (input: {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<LocalGpuHttpResponse>;

export type LocalGpuSubmitPackage = {
  workspaceId: string;
  sceneExecutionId: string;
  packageId: string;
  storyId: string;
  storyVersionId: string;
  prompt: string;
  recommendedWorkflow: string;
  generateAudio: boolean;
  audioBlocked: boolean;
  aspectRatio?: string | null;
  references: readonly { approval?: string; role?: string; assetUrl?: string; contentHash?: string }[];
};

export type LocalGpuContractV3Request = Record<string, unknown> & {
  contractVersion: 3;
  environment: LocalGpuEnvironment;
  jobId: string;
  sceneExecutionId: string;
  workspaceId: string;
  workflow: string;
  upload: LocalGpuUploadDestination;
};

function assertNativeDialogueV3Capability(capabilities: unknown, environment: LocalGpuEnvironment): void {
  const root = asRecord(capabilities);
  const contracts = asRecord(root.contracts);
  const v3 = asRecord(contracts.v3);
  const workflows = asRecord(v3.workflows);
  const capability = asRecord(workflows.MINIMAX_H3_NATIVE_DIALOGUE);
  const accepted = Array.isArray(root.acceptedContracts) ? root.acceptedContracts : [];
  if (
    root.contractVersion !== 3
    || !accepted.includes(3)
    || capability.execution !== "enabled"
    || capability.implemented !== true
    || capability.modelInstalled !== true
    || capability.buildExecutable !== true
    || capability.nativeDialogue !== "PROMPT_CONDITIONED"
  ) {
    throw new LocalGpuContractError("LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
  }
  if (environment === "production" && capability.e2eCertified !== true) {
    throw new LocalGpuContractError("LOCAL_GPU_NATIVE_DIALOGUE_NOT_CERTIFIED");
  }
}

/** 400/401/403/422 reject before acceptance. 409 is not in this set: the Desktop contract fixture does not define it as a validation failure, and a client-supplied job id can already exist after a lost acceptance. */
const DEFINITE_REJECTION = new Set([400, 401, 403, 422]);

/** Secret-free projection of a Desktop error body. Values are never copied; only codes, a redacted message and field paths. */
export type LocalGpuDesktopRejection = {
  desktopErrorCode: string | null;
  desktopErrorMessage: string | null;
  issuePaths: string[];
};

const DESKTOP_CODE = /^[A-Za-z0-9_.:-]{1,80}$/;

export function redactLocalGpuDiagnosticText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/Bearer\s+\S+/gi, "Bearer <redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+){0,2}/g, "<token>")
    .replace(/\b(token|signature|sig|secret|key|authorization)=([^&\s"]+)/gi, "$1=<redacted>")
    .replace(/[0-9a-f]{40,}/gi, "<hex>")
    .slice(0, 300);
}

export function readLocalGpuDesktopRejection(json: unknown): LocalGpuDesktopRejection {
  const body = asRecord(json);
  const nested = asRecord(body.error);
  const codeCandidate = [body.code, body.errorCode, nested.code].find((value) => typeof value === "string" && DESKTOP_CODE.test(value));
  const messageCandidate = [body.message, typeof body.error === "string" ? body.error : undefined, nested.message, body.detail]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  const issues = [body.issues, body.errors, nested.issues, body.details].find(Array.isArray) as unknown[] | undefined;
  const issuePaths = (issues ?? []).slice(0, 10).flatMap((issue) => {
    const path = asRecord(issue).path ?? asRecord(issue).field ?? asRecord(issue).loc;
    const joined = Array.isArray(path) ? path.map(String).join(".") : typeof path === "string" ? path : null;
    return joined && /^[A-Za-z0-9_.[\]-]{1,120}$/.test(joined) ? [joined] : [];
  });
  return {
    desktopErrorCode: typeof codeCandidate === "string" ? codeCandidate : null,
    desktopErrorMessage: messageCandidate ? redactLocalGpuDiagnosticText(messageCandidate) : null,
    issuePaths,
  };
}

export class LocalGpuSubmitRejectedError extends LocalGpuContractError {
  readonly jobId: string;
  readonly httpStatus: number;
  readonly rejection: LocalGpuDesktopRejection;
  constructor(jobId: string, httpStatus: number, rejection: LocalGpuDesktopRejection = { desktopErrorCode: null, desktopErrorMessage: null, issuePaths: [] }) {
    super("LOCAL_GPU_SUBMIT_REJECTED");
    this.jobId = jobId;
    this.httpStatus = httpStatus;
    this.rejection = rejection;
  }
}

export class LocalGpuSubmitAmbiguousError extends LocalGpuContractError {
  readonly jobId: string;
  readonly reason: "timeout" | "connection" | "not_found" | "unavailable" | "unreadable" | "conflict";
  readonly httpStatus: number | null;
  constructor(jobId: string, reason: LocalGpuSubmitAmbiguousError["reason"], httpStatus: number | null = null) {
    super("LOCAL_GPU_SUBMIT_AMBIGUOUS");
    this.jobId = jobId;
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** Maps a non-2xx submit response. Only 400/401/403/422 are definite non-acceptance. */
function throwSubmitFailure(jobId: string, response: { status: number; json: unknown }): never {
  if (DEFINITE_REJECTION.has(response.status)) {
    throw new LocalGpuSubmitRejectedError(jobId, response.status, readLocalGpuDesktopRejection(response.json));
  }
  if (response.status === 404) throw new LocalGpuSubmitAmbiguousError(jobId, "not_found", 404);
  if (response.status === 409) throw new LocalGpuSubmitAmbiguousError(jobId, "conflict", 409);
  throw new LocalGpuSubmitAmbiguousError(jobId, "unavailable", response.status);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readState(value: unknown): LocalGpuJobState {
  const parsed = LocalGpuJobStateSchema.safeParse(value);
  if (!parsed.success) throw new LocalGpuContractError("LOCAL_GPU_JOB_STATE_UNKNOWN");
  return parsed.data;
}

function ambiguousReason(error: unknown): LocalGpuSubmitAmbiguousError["reason"] {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("aborted")) return "timeout";
  return "connection";
}

export class LocalGpuCloudAdapter {
  readonly providerId = LOCAL_GPU_PROVIDER_ID;
  readonly automaticGenerationRetry = LOCAL_GPU_AUTOMATIC_GENERATION_RETRY;
  readonly remoteProviderFallback = LOCAL_GPU_REMOTE_PROVIDER_FALLBACK;

  constructor(
    private readonly config: LocalGpuConfig,
    private readonly http: LocalGpuHttp,
    private readonly clock: { now: () => Date; nonce: () => string } = { now: () => new Date(), nonce: () => randomUUID() },
  ) {}

  private requireEnabled(): { environment: LocalGpuEnvironment; secret: string } {
    if (!this.config.enabled || !this.config.environment || !this.config.signingSecret || this.config.agencyEnabled) {
      throw new Error("LOCAL_GPU_PROVIDER_DISABLED");
    }
    return { environment: this.config.environment, secret: this.config.signingSecret };
  }

  jobIdFor(pkg: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">): string {
    const { environment } = this.requireEnabled();
    return deterministicPersistenceUuid("local-gpu-job.v1", {
      environment,
      workspaceId: pkg.workspaceId,
      sceneExecutionId: pkg.sceneExecutionId,
      packageId: pkg.packageId,
    });
  }

  private authorize(input: {
    actor: LocalGpuServerActor;
    workspaceId: string;
    sceneExecutionId: string;
    action: string;
    workflow: string;
    jobId: string;
    uploadBinding?: LocalGpuSignedFields["uploadBinding"];
    creativeBinding?: string;
  }): string {
    assertLocalGpuAccess(input.actor, { workspaceId: input.workspaceId });
    const { environment, secret } = this.requireEnabled();
    const expiresAt = this.clock.now().getTime() + LOCAL_GPU_DEFAULT_REQUEST_TTL_MS;
    assertLocalGpuRequestExpiry(expiresAt, this.clock.now());
    return signLocalGpuRequest(secret, {
      v: 1,
      environment,
      action: input.action,
      jobId: input.jobId,
      workspaceId: input.workspaceId,
      actorId: input.actor.userId,
      authority: "SUPERADMIN",
      workflow: input.workflow,
      sceneExecutionId: input.sceneExecutionId,
      expiresAt,
      nonce: this.clock.nonce(),
      uploadBinding: input.uploadBinding ?? {},
      ...(input.creativeBinding !== undefined ? { creativeBinding: input.creativeBinding } : {}),
    }).token;
  }

  private async send(input: { method: "GET" | "POST"; path: string; token: string; body?: unknown; jobId: string }): Promise<{ status: number; json: unknown }> {
    let response: LocalGpuHttpResponse;
    try {
      response = await this.http({
        method: input.method,
        url: `${this.config.baseUrl}${input.path}`,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${input.token}`,
          ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
      });
    } catch (error) {
      throw new LocalGpuSubmitAmbiguousError(input.jobId, ambiguousReason(error));
    }
    if (!response.body) return { status: response.status, json: null };
    try {
      return { status: response.status, json: JSON.parse(response.body) };
    } catch {
      if (response.status < 200 || response.status >= 300) return { status: response.status, json: null };
      throw new LocalGpuSubmitAmbiguousError(input.jobId, "unreadable", response.status);
    }
  }

  async submit(input: {
    actor: LocalGpuServerActor;
    package: LocalGpuSubmitPackage;
    plannedDurationMs: number;
    upload: LocalGpuUploadDestination;
  }): Promise<{ jobId: string; workflow: typeof LOCAL_GPU_WORKER_WORKFLOW; state: LocalGpuJobState; remoteProviderFallback: 0 }> {
    const workflow = assertLocalGpuDispatchWorkflow(input.package.recommendedWorkflow);
    const { environment } = this.requireEnabled();
    const jobId = this.jobIdFor(input.package);
    const audioPolicy = mapLocalGpuAudioPolicy({
      generateAudio: input.package.generateAudio,
      audioBlocked: input.package.audioBlocked,
    });
    const desktop = buildLocalGpuDesktopSubmit({
      environment,
      jobId,
      sceneExecutionId: input.package.sceneExecutionId,
      workspaceId: input.package.workspaceId,
      workflow,
      prompt: input.package.prompt,
      plannedDurationMs: input.plannedDurationMs,
      references: input.package.references,
      audioPolicy,
      upload: input.upload,
      aspectRatio: input.package.aspectRatio,
    });
    const token = this.authorize({
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
      action: LOCAL_GPU_SUBMIT_ACTION,
      workflow,
      jobId,
      uploadBinding: desktop.uploadBinding,
    });
    assertLocalGpuUploadBinding(desktop.body.upload, desktop.uploadBinding);
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body: desktop.body, jobId });
    if (response.status >= 200 && response.status < 300) {
      return {
        jobId,
        workflow,
        state: readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED"),
        remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
      };
    }
    throwSubmitFailure(jobId, response);
  }

  async submitContractV2(input: {
    actor: LocalGpuServerActor;
    package: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">;
    request: Omit<Parameters<typeof buildLocalGpuDesktopSubmitV2>[0], "environment" | "jobId">;
    capabilities: LocalGpuRuntimeCapabilities | null;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{
    jobId: string;
    workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
    contractVersion: 2;
    state: LocalGpuJobState;
    remoteProviderFallback: 0;
    automaticGenerationRetry: 0;
  }> {
    const { environment } = this.requireEnabled();
    if (environment === "production" && input.productionDispatchAuthorized !== true) {
      throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    }
    assertLocalGpuV2RuntimeCapabilities(input.capabilities);
    assertLocalGpuSubmitAllowed(input.existingGate);
    const jobId = this.jobIdFor(input.package);
    const desktop = buildLocalGpuDesktopSubmitV2({
      ...input.request,
      environment,
      jobId,
      firstFrameAuthorities: readLocalGpuV2FirstFrameAuthorities(input.capabilities),
    });
    const creativeBinding = localGpuCreativeBindingForV2Body(desktop.body);
    const token = this.authorize({
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
      action: LOCAL_GPU_SUBMIT_ACTION,
      workflow: desktop.body.workflow,
      jobId,
      uploadBinding: desktop.uploadBinding,
      creativeBinding,
    });
    assertLocalGpuUploadBinding(desktop.body.upload, desktop.uploadBinding);
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body: desktop.body, jobId });
    if (response.status >= 200 && response.status < 300) {
      return {
        jobId,
        workflow: desktop.body.workflow,
        contractVersion: 2,
        state: readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED"),
        remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
        automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      };
    }
    throwSubmitFailure(jobId, response);
  }

  async submitZeroAssetT2V(input: {
    actor: LocalGpuServerActor;
    package: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">;
    request: Omit<Parameters<typeof buildLocalGpuZeroAssetT2VSubmit>[0], "environment" | "jobId" | "workspaceId" | "sceneExecutionId">;
    capabilities: unknown;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{
    jobId: string;
    workflow: "MINIMAX_H3_T2V";
    contractVersion: 3;
    creativeBinding: string;
    state: LocalGpuJobState;
    remoteProviderFallback: 0;
    automaticGenerationRetry: 0;
  }> {
    const { environment } = this.requireEnabled();
    if (environment === "production" && input.productionDispatchAuthorized !== true) {
      throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    }
    assertLocalGpuV3RuntimeCapabilities(input.capabilities);
    assertLocalGpuSubmitAllowed(input.existingGate);
    const jobId = this.jobIdFor(input.package);
    const desktop = buildLocalGpuZeroAssetT2VSubmit({
      ...input.request,
      environment,
      jobId,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
    });
    assertLocalGpuCreativeBinding(desktop.canonicalJob, desktop.creativeBinding);
    const token = this.authorize({
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
      action: LOCAL_GPU_SUBMIT_ACTION,
      workflow: desktop.body.workflow,
      jobId,
      uploadBinding: desktop.uploadBinding,
      creativeBinding: desktop.creativeBinding,
    });
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body: desktop.body, jobId });
    if (response.status >= 200 && response.status < 300) {
      return {
        jobId,
        workflow: "MINIMAX_H3_T2V",
        contractVersion: 3,
        creativeBinding: desktop.creativeBinding,
        state: readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED"),
        remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
        automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      };
    }
    throwSubmitFailure(jobId, response);
  }

  /** Submit approved native dialogue without changing any creative fields. Staging may certify it; Production requires Desktop E2E evidence. */
  async submitNativeDialogueV3(input: {
    actor: LocalGpuServerActor;
    package: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">;
    request: LocalGpuContractV3Request;
    creativeBinding: string;
    capabilities: unknown;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{
    jobId: string;
    workflow: string;
    contractVersion: 3;
    creativeBinding: string;
    state: LocalGpuJobState;
    remoteProviderFallback: 0;
    automaticGenerationRetry: 0;
  }> {
    const { environment } = this.requireEnabled();
    if (environment === "production" && input.productionDispatchAuthorized !== true) {
      throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    }
    assertLocalGpuSubmitAllowed(input.existingGate);
    assertNativeDialogueV3Capability(input.capabilities, environment);
    const jobId = this.jobIdFor(input.package);
    if (
      input.request.contractVersion !== 3
      || input.request.workflow !== "MINIMAX_H3_NATIVE_DIALOGUE"
      || input.request.environment !== environment
      || input.request.jobId !== jobId
      || input.request.workspaceId !== input.package.workspaceId
      || input.request.sceneExecutionId !== input.package.sceneExecutionId
    ) {
      throw new LocalGpuContractError("LOCAL_GPU_CONTRACT_IDENTITY_MISMATCH");
    }
    const canonical = localGpuCanonicalCreativeJob(input.request as unknown as Parameters<typeof localGpuCanonicalCreativeJob>[0]);
    assertLocalGpuCreativeBinding(canonical, input.creativeBinding);
    const uploadBinding = localGpuUploadBindingDigest(input.request.upload);
    const token = this.authorize({
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
      action: LOCAL_GPU_SUBMIT_ACTION,
      workflow: input.request.workflow,
      jobId,
      uploadBinding,
      creativeBinding: input.creativeBinding,
    });
    assertLocalGpuUploadBinding(input.request.upload, uploadBinding);
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body: input.request, jobId });
    if (response.status >= 200 && response.status < 300) {
      return {
        jobId,
        workflow: input.request.workflow,
        contractVersion: 3,
        creativeBinding: input.creativeBinding,
        state: readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED"),
        remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
        automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      };
    }
    throwSubmitFailure(jobId, response);
  }

  async submitR2vDna(input: {
    actor: LocalGpuServerActor;
    package: AiStoryLocalGenerationPackage;
    assets: readonly LocalGpuResolvedAsset[];
    upload: LocalGpuUploadDestination;
    capabilities: unknown;
    voiceDna?: AiStoryCharacterVoiceDna | null;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{
    jobId: string;
    workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
    contractVersion: 3;
    creativeBinding: string;
    state: LocalGpuJobState;
    remoteProviderFallback: 0;
    automaticGenerationRetry: 0;
  }> {
    const { environment } = this.requireEnabled();
    if (environment === "production" && input.productionDispatchAuthorized !== true) {
      throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    }
    assertLocalGpuSubmitAllowed(input.existingGate);
    const jobId = this.jobIdFor(input.package);
    const prepared = prepareLocalGpuR2vDnaHandoff({
      package: input.package,
      assets: input.assets,
      environment,
      jobId,
      upload: input.upload,
      capabilities: input.capabilities,
      voiceDna: input.voiceDna,
    });
    const token = this.authorize({
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      sceneExecutionId: input.package.sceneExecutionId,
      action: LOCAL_GPU_SUBMIT_ACTION,
      workflow: prepared.handoff.workflow,
      jobId,
      uploadBinding: prepared.uploadBinding,
      creativeBinding: prepared.authorityBinding,
    });
    assertLocalGpuUploadBinding(prepared.handoff.upload, prepared.uploadBinding);
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body: prepared.handoff, jobId });
    if (response.status >= 200 && response.status < 300) {
      return {
        jobId,
        workflow: LOCAL_GPU_WORKER_WORKFLOW,
        contractVersion: 3,
        creativeBinding: prepared.authorityBinding,
        state: readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED"),
        remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
        automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      };
    }
    throwSubmitFailure(jobId, response);
  }

  async status(jobId: string, scope: { actor: LocalGpuServerActor; workspaceId: string; sceneExecutionId: string; workflow?: string }): Promise<
    | { found: true; jobId: string; state: LocalGpuJobState; remoteProviderFallback: null }
    | { found: false; jobId: string; uncertain: boolean }
  > {
    const { environment } = this.requireEnabled();
    const token = this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: scope.sceneExecutionId,
      action: LOCAL_GPU_STATUS_ACTION,
      workflow: scope.workflow ?? LOCAL_GPU_WORKER_WORKFLOW,
      jobId,
    });
    let response: { status: number; json: unknown };
    try {
      response = await this.send({ method: "GET", path: `/v1/jobs/${jobId}`, token, jobId });
    } catch (error) {
      if (error instanceof LocalGpuSubmitAmbiguousError) return { found: false, jobId, uncertain: true };
      throw error;
    }
    if (response.status === 404) return { found: false, jobId, uncertain: false };
    if (response.status !== 200) return { found: false, jobId, uncertain: true };
    const record = asRecord(asRecord(response.json).job ?? response.json);
    const state = readState(record.state ?? record.status);
    localGpuTerminalDisposition(state);
    if (environment !== this.config.environment) throw new LocalGpuContractError("LOCAL_GPU_ENVIRONMENT_ISOLATION");
    return { found: true, jobId, state, remoteProviderFallback: null };
  }

  async result(jobId: string, scope: { actor: LocalGpuServerActor; workspaceId: string; sceneExecutionId: string; workflow?: string }): Promise<{ jobId: string; state: "COMPLETED"; contentHash: string }> {
    const token = this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: scope.sceneExecutionId,
      action: LOCAL_GPU_RESULT_ACTION,
      workflow: scope.workflow ?? LOCAL_GPU_WORKER_WORKFLOW,
      jobId,
    });
    const response = await this.send({ method: "GET", path: `/v1/jobs/${jobId}/result`, token, jobId });
    if (response.status !== 200) throw new LocalGpuContractError("LOCAL_GPU_RESULT_FAILED");
    const record = asRecord(asRecord(response.json).result ?? response.json);
    if (readState(record.state ?? "COMPLETED") !== "COMPLETED") throw new LocalGpuContractError("LOCAL_GPU_RESULT_NOT_READY");
    const contentHash = record.contentHash;
    if (typeof contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED");
    }
    return { jobId, state: "COMPLETED", contentHash };
  }

  /**
   * Reads Desktop's signed submission evidence for one job. Read-only on the Desktop: it never
   * enqueues, and an unreachable or pre-evidence Desktop is reported as unavailable, not as proof.
   */
  async submissionEvidence(jobId: string, scope: {
    actor: LocalGpuServerActor; workspaceId: string; sceneExecutionId: string; workflow: string; challenge: string;
  }): Promise<{ available: true; evidence: LocalGpuSubmissionEvidence; digest: string } | { available: false; httpStatus: number | null }> {
    const { environment, secret } = this.requireEnabled();
    const token = this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: scope.sceneExecutionId,
      action: LOCAL_GPU_SUBMISSION_EVIDENCE_ACTION,
      workflow: scope.workflow,
      jobId,
    });
    let response: { status: number; json: unknown };
    try {
      response = await this.send({
        method: "GET",
        path: `/v1/jobs/${encodeURIComponent(jobId)}/submission-evidence?challenge=${scope.challenge}`,
        token,
        jobId,
      });
    } catch (error) {
      if (error instanceof LocalGpuSubmitAmbiguousError) return { available: false, httpStatus: error.httpStatus };
      throw error;
    }
    if (response.status !== 200) return { available: false, httpStatus: response.status };
    const evidence = verifyLocalGpuSubmissionEvidence({
      signed: response.json,
      secret,
      now: this.clock.now(),
      expected: { environment, jobId, workspaceId: scope.workspaceId, sceneExecutionId: scope.sceneExecutionId, workflow: scope.workflow, challenge: scope.challenge },
    });
    return { available: true, evidence, digest: localGpuSubmissionEvidenceDigest(response.json as SignedLocalGpuSubmissionEvidence) };
  }

  capabilitiesToken(scope: { actor: LocalGpuServerActor; workspaceId: string }): string {
    return this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: "",
      action: LOCAL_GPU_CAPABILITIES_ACTION,
      workflow: "",
      jobId: randomUUID(),
    });
  }
}
