import { randomUUID } from "node:crypto";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
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
  buildLocalGpuZeroAssetT2VSubmit,
  localGpuCreativeBindingForV2Body,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_CAPABILITIES_ACTION,
  LOCAL_GPU_DEFAULT_REQUEST_TTL_MS,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  LOCAL_GPU_RESULT_ACTION,
  LOCAL_GPU_STATUS_ACTION,
  LOCAL_GPU_SUBMIT_ACTION,
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

/** 400/401/403/422 reject before acceptance. 409 is not in this set: the Desktop contract fixture does not define it as a validation failure, and a client-supplied job id can already exist after a lost acceptance. */
const DEFINITE_REJECTION = new Set([400, 401, 403, 422]);

export class LocalGpuSubmitRejectedError extends LocalGpuContractError {
  readonly jobId: string;
  readonly httpStatus: number;
  constructor(jobId: string, httpStatus: number) {
    super("LOCAL_GPU_SUBMIT_REJECTED");
    this.jobId = jobId;
    this.httpStatus = httpStatus;
  }
}

export class LocalGpuSubmitAmbiguousError extends LocalGpuContractError {
  readonly jobId: string;
  readonly reason: "timeout" | "connection" | "not_found" | "unavailable" | "unreadable" | "conflict";
  constructor(jobId: string, reason: LocalGpuSubmitAmbiguousError["reason"]) {
    super("LOCAL_GPU_SUBMIT_AMBIGUOUS");
    this.jobId = jobId;
    this.reason = reason;
  }
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
      throw new LocalGpuSubmitAmbiguousError(input.jobId, "unreadable");
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
    if (DEFINITE_REJECTION.has(response.status)) throw new LocalGpuSubmitRejectedError(jobId, response.status);
    if (response.status === 404) throw new LocalGpuSubmitAmbiguousError(jobId, "not_found");
    if (response.status === 409) throw new LocalGpuSubmitAmbiguousError(jobId, "conflict");
    throw new LocalGpuSubmitAmbiguousError(jobId, "unavailable");
  }

  async submitContractV2(input: {
    actor: LocalGpuServerActor;
    package: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">;
    request: Omit<Parameters<typeof buildLocalGpuDesktopSubmitV2>[0], "environment" | "jobId">;
    capabilities: LocalGpuRuntimeCapabilities | null;
    existingGate: string | null;
  }): Promise<{
    jobId: string;
    workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
    contractVersion: 2;
    state: LocalGpuJobState;
    remoteProviderFallback: 0;
    automaticGenerationRetry: 0;
  }> {
    const { environment } = this.requireEnabled();
    if (environment === "production") throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    assertLocalGpuV2RuntimeCapabilities(input.capabilities);
    assertLocalGpuSubmitAllowed(input.existingGate);
    const jobId = this.jobIdFor(input.package);
    const desktop = buildLocalGpuDesktopSubmitV2({ ...input.request, environment, jobId });
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
    if (DEFINITE_REJECTION.has(response.status)) throw new LocalGpuSubmitRejectedError(jobId, response.status);
    if (response.status === 404) throw new LocalGpuSubmitAmbiguousError(jobId, "not_found");
    if (response.status === 409) throw new LocalGpuSubmitAmbiguousError(jobId, "conflict");
    throw new LocalGpuSubmitAmbiguousError(jobId, "unavailable");
  }

  async submitZeroAssetT2V(input: {
    actor: LocalGpuServerActor;
    package: Pick<LocalGpuSubmitPackage, "workspaceId" | "sceneExecutionId" | "packageId">;
    request: Omit<Parameters<typeof buildLocalGpuZeroAssetT2VSubmit>[0], "environment" | "jobId" | "workspaceId" | "sceneExecutionId">;
    capabilities: { contractVersion: number | null; workflowIds?: readonly string[]; runtimeExecutableWorkflows?: readonly string[] } | null;
    existingGate: string | null;
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
    if (environment === "production") throw new LocalGpuContractError("LOCAL_GPU_PRODUCTION_DENIED");
    assertLocalGpuV3RuntimeCapabilities(input.capabilities, "MINIMAX_H3_T2V");
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
    if (DEFINITE_REJECTION.has(response.status)) throw new LocalGpuSubmitRejectedError(jobId, response.status);
    if (response.status === 404) throw new LocalGpuSubmitAmbiguousError(jobId, "not_found");
    if (response.status === 409) throw new LocalGpuSubmitAmbiguousError(jobId, "conflict");
    throw new LocalGpuSubmitAmbiguousError(jobId, "unavailable");
  }

  async status(jobId: string, scope: { actor: LocalGpuServerActor; workspaceId: string; sceneExecutionId: string }): Promise<
    | { found: true; jobId: string; state: LocalGpuJobState; remoteProviderFallback: null }
    | { found: false; jobId: string; uncertain: boolean }
  > {
    const { environment } = this.requireEnabled();
    const token = this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: scope.sceneExecutionId,
      action: LOCAL_GPU_STATUS_ACTION,
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
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

  async result(jobId: string, scope: { actor: LocalGpuServerActor; workspaceId: string; sceneExecutionId: string }): Promise<{ jobId: string; state: "COMPLETED"; contentHash: string }> {
    const token = this.authorize({
      actor: scope.actor,
      workspaceId: scope.workspaceId,
      sceneExecutionId: scope.sceneExecutionId,
      action: LOCAL_GPU_RESULT_ACTION,
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
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
