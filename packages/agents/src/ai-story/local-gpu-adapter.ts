import { randomUUID } from "node:crypto";
import {
  assertLocalGpuRequestExpiry,
  isDesktopFilesystemPath,
  LOCAL_GPU_AUDIO_POLICIES,
  LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
  LOCAL_GPU_DEFAULT_REQUEST_TTL_MS,
  LOCAL_GPU_JOB_STATES,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  LocalGpuJobStateSchema,
  localGpuPlannedDurationMs,
  localGpuTerminalDisposition,
  mapCertifiedWorkflowToLocalGpu,
  mapLocalGpuAudioPolicy,
  mapLocalGpuVoicePerformance,
  selectLocalGpuReferences,
  type AiStoryLocalGenerationPackage,
  type LocalGpuAudioPolicy,
  type LocalGpuEnvironment,
  type LocalGpuHealthState,
  type LocalGpuJobState,
  type LocalGpuSignedFields,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import type { LocalGpuConfig } from "./local-gpu-config";
import { assertLocalGpuAccess, type LocalGpuServerActor } from "./local-gpu-access";
import { signLocalGpuRequest } from "./local-gpu-signing";

export type LocalGpuHttp = (input: {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; body: string }>;

export type LocalGpuJobScope = {
  actor: LocalGpuServerActor;
  workspaceId: string;
  workflow: string;
  sceneExecutionId?: string;
  storyId?: string;
  storyVersionId?: string;
};

type Clock = { now: () => Date; nonce: () => string };

function defaultHttp(): LocalGpuHttp {
  return async (input) => {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
    });
    return { status: response.status, body: await response.text() };
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readState(value: unknown): LocalGpuJobState {
  const raw = typeof value === "string" ? value.toUpperCase() : "";
  const normalized = raw === "CANCELED" ? "CANCELLED" : raw;
  const parsed = LocalGpuJobStateSchema.safeParse(normalized);
  if (!parsed.success) throw new LocalGpuContractError("LOCAL_GPU_JOB_STATE_UNKNOWN");
  return parsed.data;
}

function assertSemanticRequest(value: unknown): void {
  if (typeof value === "string") {
    if (value.includes("class_type") || isDesktopFilesystemPath(value)) {
      throw new LocalGpuContractError("LOCAL_GPU_SEMANTIC_REQUEST_INVALID");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertSemanticRequest);
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(assertSemanticRequest);
  }
}

function collectWorkflows(body: unknown): string[] {
  const record = asRecord(body);
  const sources = [record.workflows, record.capabilities, record.supportedWorkflows];
  const names = new Set<string>();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      if (typeof item === "string") names.add(item);
      else if (item && typeof item === "object") {
        const id = (item as { id?: unknown; workflow?: unknown }).id ?? (item as { workflow?: unknown }).workflow;
        if (typeof id === "string") names.add(id);
      }
    }
  }
  return [...names];
}

export type LocalGpuSubmitInput = {
  actor: LocalGpuServerActor;
  package: AiStoryLocalGenerationPackage;
  recommendedDurationAuthority: { readonly decision: { readonly plannedDurationMs: number } };
  workerWorkflows: readonly string[];
  audioExpectationKind?: Parameters<typeof mapLocalGpuAudioPolicy>[0]["expectationKind"];
  characterReferencePack?: Parameters<typeof selectLocalGpuReferences>[0]["characterReferencePack"];
  pinnedVoiceDna?: Parameters<typeof mapLocalGpuVoicePerformance>[0]["pinnedVoiceDna"];
};

export class LocalGpuCloudAdapter {
  readonly providerId = LOCAL_GPU_PROVIDER_ID;
  readonly automaticGenerationRetry = LOCAL_GPU_AUTOMATIC_GENERATION_RETRY;
  readonly remoteProviderFallback = LOCAL_GPU_REMOTE_PROVIDER_FALLBACK;

  constructor(
    private readonly config: LocalGpuConfig,
    private readonly http: LocalGpuHttp = defaultHttp(),
    private readonly clock: Clock = { now: () => new Date(), nonce: () => randomUUID() },
  ) {}

  private requireEnabledEnvironment(): { environment: LocalGpuEnvironment; secret: string } {
    if (!this.config.enabled || !this.config.environment || !this.config.signingSecret) {
      throw new Error("LOCAL_GPU_PROVIDER_DISABLED");
    }
    return { environment: this.config.environment, secret: this.config.signingSecret };
  }

  private authorize(scope: LocalGpuJobScope, workflow: string, jobId: string): { token: string; fields: LocalGpuSignedFields } {
    assertLocalGpuAccess(scope.actor, { workspaceId: scope.workspaceId }, {
      agencyLocalGpuEnabled: this.config.agencyEnabled,
    });
    const { environment, secret } = this.requireEnabledEnvironment();
    const expiresAt = new Date(this.clock.now().getTime() + LOCAL_GPU_DEFAULT_REQUEST_TTL_MS).toISOString();
    assertLocalGpuRequestExpiry(expiresAt, this.clock.now());
    const fields: LocalGpuSignedFields = {
      environment,
      jobId,
      workspaceId: scope.workspaceId,
      actorId: scope.actor.userId,
      workflow,
      expiresAt,
      nonce: this.clock.nonce(),
      ...(scope.sceneExecutionId ? { sceneExecutionId: scope.sceneExecutionId } : {}),
      ...(scope.storyId ? { storyId: scope.storyId } : {}),
      ...(scope.storyVersionId ? { storyVersionId: scope.storyVersionId } : {}),
    };
    return { token: signLocalGpuRequest(secret, fields).token, fields };
  }

  private async send(input: {
    method: "GET" | "POST";
    path: string;
    token?: string;
    body?: unknown;
  }): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (input.token) headers.authorization = `Bearer ${input.token}`;
    let body: string | undefined;
    if (input.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(input.body);
    }
    const response = await this.http({
      method: input.method,
      url: `${this.config.baseUrl}${input.path}`,
      headers,
      body,
    });
    let json: unknown = null;
    if (response.body) {
      try { json = JSON.parse(response.body); } catch { json = null; }
    }
    return { status: response.status, json };
  }

  async health(): Promise<{
    providerId: typeof LOCAL_GPU_PROVIDER_ID;
    state: LocalGpuHealthState;
    worker?: unknown;
  }> {
    if (!this.config.enabled) return { providerId: LOCAL_GPU_PROVIDER_ID, state: "DISABLED" };
    try {
      const response = await this.send({ method: "GET", path: "/health" });
      const body = asRecord(response.json);
      if (response.status === 200 && body.status === "ok") {
        return { providerId: LOCAL_GPU_PROVIDER_ID, state: "AVAILABLE", worker: body };
      }
      return { providerId: LOCAL_GPU_PROVIDER_ID, state: "UNAVAILABLE" };
    } catch {
      return { providerId: LOCAL_GPU_PROVIDER_ID, state: "UNAVAILABLE" };
    }
  }

  async capabilities(scope: LocalGpuJobScope): Promise<{ workflows: string[] }> {
    const jobId = randomUUID();
    const { token } = this.authorize({ ...scope, workflow: "CAPABILITIES" }, "CAPABILITIES", jobId);
    const response = await this.send({ method: "GET", path: "/v1/capabilities", token });
    if (response.status !== 200) throw new LocalGpuContractError("LOCAL_GPU_CAPABILITIES_FAILED");
    return { workflows: collectWorkflows(response.json) };
  }

  jobIdFor(pkg: AiStoryLocalGenerationPackage): string {
    const { environment } = this.requireEnabledEnvironment();
    return deterministicPersistenceUuid("local-gpu-job.v1", {
      environment,
      workspaceId: pkg.workspaceId,
      sceneExecutionId: pkg.sceneExecutionId,
      packageId: pkg.packageId,
    });
  }

  async submit(input: LocalGpuSubmitInput): Promise<{
    providerId: typeof LOCAL_GPU_PROVIDER_ID;
    jobId: string;
    workflow: typeof LOCAL_GPU_WORKER_WORKFLOW;
    state: LocalGpuJobState;
    plannedDurationMs: number;
    automaticGenerationRetry: 0;
    remoteProviderFallback: 0;
  }> {
    const scope: LocalGpuJobScope = {
      actor: input.actor,
      workspaceId: input.package.workspaceId,
      workflow: LOCAL_GPU_WORKER_WORKFLOW,
      sceneExecutionId: input.package.sceneExecutionId,
      storyId: input.package.storyId,
      storyVersionId: input.package.storyVersionId,
    };
    assertLocalGpuAccess(scope.actor, { workspaceId: scope.workspaceId }, {
      agencyLocalGpuEnabled: this.config.agencyEnabled,
    });
    this.requireEnabledEnvironment();
    const plannedDurationMs = localGpuPlannedDurationMs(input.recommendedDurationAuthority);
    const workflow = mapCertifiedWorkflowToLocalGpu(input.package.recommendedWorkflow, input.workerWorkflows);
    const predecessor = input.package.version === "local-generation-package.v3"
      ? input.package.predecessorAuthority
      : null;
    const references = selectLocalGpuReferences({
      packageReferences: input.package.references,
      characterReferencePack: input.characterReferencePack,
      predecessorAuthorityPresent: Boolean(predecessor),
      predecessorFrame: predecessor ? {
        assetId: predecessor.semantic.continuityFrameAssetId,
        contentHash: predecessor.semantic.continuityFrameContentHash,
      } : null,
    });
    const audioPolicy: LocalGpuAudioPolicy = mapLocalGpuAudioPolicy({
      generateAudio: input.package.generateAudio,
      audioBlocked: input.package.audioBlocked,
      expectationKind: input.audioExpectationKind,
    });
    const voicePerformance = mapLocalGpuVoicePerformance({
      dialogue: input.package.dialogue,
      pinnedVoiceDna: input.pinnedVoiceDna,
    });
    const jobId = this.jobIdFor(input.package);
    const { token, fields } = this.authorize(scope, workflow, jobId);
    const body = {
      environment: fields.environment,
      jobId,
      sceneExecutionId: input.package.sceneExecutionId,
      storyId: input.package.storyId,
      storyVersionId: input.package.storyVersionId,
      workspaceId: input.package.workspaceId,
      actorId: input.actor.userId,
      workflow,
      prompt: input.package.prompt,
      plannedDurationMs,
      characterReferences: references.characterReferences,
      productReferences: references.productReferences,
      predecessorFrame: references.predecessorFrame,
      audioPolicy,
      voicePerformance,
      aspectRatio: input.package.aspectRatio,
      resolutionIntent: input.package.resolutionIntent,
    };
    assertSemanticRequest(body);
    const response = await this.send({ method: "POST", path: "/v1/jobs", token, body });
    if (response.status < 200 || response.status >= 300) {
      throw new LocalGpuContractError("LOCAL_GPU_SUBMIT_FAILED");
    }
    const state = readState(asRecord(response.json).state ?? asRecord(response.json).status ?? "QUEUED");
    return {
      providerId: LOCAL_GPU_PROVIDER_ID,
      jobId,
      workflow,
      state,
      plannedDurationMs,
      automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
      remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
    };
  }

  async status(jobId: string, scope: LocalGpuJobScope): Promise<{
    jobId: string;
    state: LocalGpuJobState;
    disposition: ReturnType<typeof localGpuTerminalDisposition>;
  }> {
    const { token } = this.authorize(scope, scope.workflow, jobId);
    const response = await this.send({ method: "GET", path: `/v1/jobs/${jobId}`, token });
    if (response.status !== 200) throw new LocalGpuContractError("LOCAL_GPU_STATUS_FAILED");
    const record = asRecord(asRecord(response.json).job ?? response.json);
    const state = readState(record.state ?? record.status);
    return { jobId, state, disposition: localGpuTerminalDisposition(state) };
  }

  async cancel(jobId: string, scope: LocalGpuJobScope): Promise<{
    jobId: string;
    confirmed: boolean;
    state: LocalGpuJobState | "CANCELLATION_REQUESTED";
  }> {
    const { token } = this.authorize(scope, scope.workflow, jobId);
    const response = await this.send({ method: "POST", path: `/v1/jobs/${jobId}/cancel`, token, body: {} });
    if (response.status < 200 || response.status >= 300) {
      throw new LocalGpuContractError("LOCAL_GPU_CANCEL_FAILED");
    }
    const record = asRecord(response.json);
    const raw = record.state ?? record.status;
    if (typeof raw === "string" && readState(raw) === "CANCELLED") {
      return { jobId, confirmed: true, state: "CANCELLED" };
    }
    return { jobId, confirmed: false, state: "CANCELLATION_REQUESTED" };
  }

  async result(jobId: string, scope: LocalGpuJobScope): Promise<{
    jobId: string;
    state: "COMPLETED";
    contentHash: string;
    durationMs: number;
    width: number | null;
    height: number | null;
    fps: number;
    hasAudio: boolean;
    byteSize: number | null;
  }> {
    const { token } = this.authorize(scope, scope.workflow, jobId);
    const response = await this.send({ method: "GET", path: `/v1/jobs/${jobId}/result`, token });
    if (response.status !== 200) throw new LocalGpuContractError("LOCAL_GPU_RESULT_FAILED");
    const record = asRecord(asRecord(response.json).result ?? response.json);
    const state = readState(record.state ?? record.status ?? "COMPLETED");
    if (state !== "COMPLETED") throw new LocalGpuContractError("LOCAL_GPU_RESULT_NOT_READY");
    const contentHash = record.contentHash;
    if (typeof contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED");
    }
    const durationMs = record.durationMs;
    const fps = record.fps;
    if (typeof durationMs !== "number" || typeof fps !== "number" || typeof record.hasAudio !== "boolean") {
      throw new LocalGpuContractError("LOCAL_GPU_RESULT_EVIDENCE_INCOMPLETE");
    }
    return {
      jobId,
      state,
      contentHash,
      durationMs,
      width: typeof record.width === "number" ? record.width : null,
      height: typeof record.height === "number" ? record.height : null,
      fps,
      hasAudio: record.hasAudio,
      byteSize: typeof record.byteSize === "number" ? record.byteSize : null,
    };
  }
}

export function createLocalGpuProviderRegistration(config: LocalGpuConfig) {
  return Object.freeze({
    providerId: LOCAL_GPU_PROVIDER_ID,
    executionClass: "LOCAL_GPU" as const,
    remoteProvider: false as const,
    enabled: config.enabled,
    environment: config.environment,
    baseUrl: config.baseUrl,
    agencyEnabled: config.agencyEnabled,
    automaticGenerationRetry: LOCAL_GPU_AUTOMATIC_GENERATION_RETRY,
    remoteProviderFallback: LOCAL_GPU_REMOTE_PROVIDER_FALLBACK,
    audioPolicies: LOCAL_GPU_AUDIO_POLICIES,
    jobStates: LOCAL_GPU_JOB_STATES,
  });
}

export function createLocalGpuProviderRegistry(config: LocalGpuConfig) {
  const registration = createLocalGpuProviderRegistration(config);
  return new Map([[registration.providerId, registration]]);
}
