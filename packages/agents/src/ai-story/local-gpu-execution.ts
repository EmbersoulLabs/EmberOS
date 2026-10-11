import {
  LOCAL_GPU_T2V_WORKFLOW,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  assertLocalGpuDispatchWorkflow,
  assertLocalGpuSubmitAllowed,
  localGpuPersistedAudioSeparation,
  readLocalGpuV3T2vCapability,
  selectLocalGpuV3Workflow,
} from "@ceo-agent/shared/server";
import { advanceLocalGpuRelease, type LocalGpuReleaseRuntime } from "./local-gpu-release-cycle";

export type LocalGpuAssetMode = "WITH_ASSET" | "WITHOUT_ASSET";

export type LocalGpuRouteInput = {
  assetMode: LocalGpuAssetMode;
  assetRecommendationStatus: "SATISFIED" | "ASSET_RECOMMENDATION_REQUIRED" | "CONFIRMED_NO_ASSETS";
  referenceCount: number;
  imageReferenceCount?: number;
  videoReferenceCount?: number;
  audioReferenceCount?: number;
  dialogueRequired?: boolean;
  voiceDnaRequired?: boolean;
  continuityFrameRequired?: boolean;
  preQc: "DISPATCH_ELIGIBLE" | "DISPATCH_ELIGIBLE_WITH_WARNINGS" | "DISPATCH_BLOCKED" | null;
  runtimeAuthorizationId: string | null;
  capabilities: unknown;
  recommendedWorkflow?: string | null;
  generateAudio: boolean;
  audioBlocked: boolean;
  qcExpectation: "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "SILENT_OUTPUT";
};

export type LocalGpuRoutePlan = {
  eligible: boolean;
  blocked: string | null;
  contractVersion: 2 | 3 | null;
  assetMode: LocalGpuAssetMode;
  workflow: string | null;
  desktopAudioPolicy: "NATIVE" | "REMOVE_AUDIO" | "PRESERVE" | null;
  qcExpectation: LocalGpuRouteInput["qcExpectation"] | null;
  speechContent: "HUMAN_REVIEW_REQUIRED" | "NOT_APPLICABLE" | null;
  hasAudio: boolean;
};

function blocked(assetMode: LocalGpuAssetMode, code: string): LocalGpuRoutePlan {
  return {
    eligible: false,
    blocked: code,
    contractVersion: null,
    assetMode,
    workflow: null,
    desktopAudioPolicy: null,
    qcExpectation: null,
    speechContent: null,
    hasAudio: false,
  };
}

function codeOf(error: unknown): string {
  return error instanceof LocalGpuContractError ? error.message : "LOCAL_GPU_WORKFLOW_UNSUPPORTED";
}

/** Chooses one supported Desktop workflow. Does not submit. */
export function planLocalGpuRoute(input: LocalGpuRouteInput): LocalGpuRoutePlan {
  if (input.preQc !== "DISPATCH_ELIGIBLE") return blocked(input.assetMode, "LOCAL_GPU_PRE_QC_REQUIRED");
  if (!input.runtimeAuthorizationId) return blocked(input.assetMode, "LOCAL_GPU_RUNTIME_AUTHORIZATION_REQUIRED");
  let audio: ReturnType<typeof localGpuPersistedAudioSeparation>;
  try {
    audio = localGpuPersistedAudioSeparation({
      qcExpectation: input.qcExpectation,
      generateAudio: input.generateAudio,
      audioBlocked: input.audioBlocked,
    });
  } catch (error) {
    return blocked(input.assetMode, codeOf(error));
  }
  if (input.assetMode === "WITHOUT_ASSET") {
    if (input.assetRecommendationStatus !== "CONFIRMED_NO_ASSETS") {
      return blocked(input.assetMode, "LOCAL_GPU_NO_ASSET_AUTHORITY_REQUIRED");
    }
    if (input.referenceCount > 0) return blocked(input.assetMode, "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS");
    try {
      const selected = selectLocalGpuV3Workflow({
        assetMode: "WITHOUT_ASSET",
        dialogueRequired: input.dialogueRequired,
        voiceDnaRequired: input.voiceDnaRequired,
        continuityFrameRequired: input.continuityFrameRequired,
        audioReferenceCount: input.audioReferenceCount,
        videoReferenceCount: input.videoReferenceCount,
        imageReferenceCount: input.imageReferenceCount ?? 0,
      });
      const capability = readLocalGpuV3T2vCapability(input.capabilities);
      if (selected.workflow !== LOCAL_GPU_T2V_WORKFLOW || capability.workflow !== LOCAL_GPU_T2V_WORKFLOW) {
        return blocked(input.assetMode, "LOCAL_GPU_WORKFLOW_UNSUPPORTED");
      }
      if (capability.placeholderImage !== false) return blocked(input.assetMode, "LOCAL_GPU_CONTRACT_CAPABILITY_MISMATCH");
      return {
        eligible: true,
        blocked: null,
        contractVersion: 3,
        assetMode: "WITHOUT_ASSET",
        workflow: LOCAL_GPU_T2V_WORKFLOW,
        desktopAudioPolicy: audio.desktopAudioPolicy,
        qcExpectation: audio.qcExpectation === "SILENT_OUTPUT" ? "SILENT_OUTPUT" : "NO_DIALOGUE_WITH_AMBIENT_AUDIO",
        speechContent: audio.speechContent,
        hasAudio: audio.hasAudio,
      };
    } catch (error) {
      return blocked(input.assetMode, codeOf(error));
    }
  }
  if (input.assetRecommendationStatus === "CONFIRMED_NO_ASSETS") {
    return blocked(input.assetMode, "LOCAL_GPU_ASSET_MODE_CONFLICT");
  }
  if (input.referenceCount < 1) return blocked(input.assetMode, "LOCAL_GPU_REFERENCES_REQUIRED");
  if (input.dialogueRequired || input.voiceDnaRequired || input.continuityFrameRequired) {
    return blocked(input.assetMode, "LOCAL_GPU_T2V_CAPABILITY_UNSUPPORTED");
  }
  try {
    const workflow = assertLocalGpuDispatchWorkflow(input.recommendedWorkflow ?? "");
    if (workflow !== LOCAL_GPU_WORKER_WORKFLOW) return blocked(input.assetMode, "LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    return {
      eligible: true,
      blocked: null,
      contractVersion: 2,
      assetMode: "WITH_ASSET",
      workflow,
      desktopAudioPolicy: audio.desktopAudioPolicy,
      qcExpectation: input.qcExpectation,
      speechContent: audio.speechContent,
      hasAudio: audio.hasAudio,
    };
  } catch (error) {
    return blocked(input.assetMode, codeOf(error));
  }
}

const LOCAL_GPU_SCOPE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalGpuSceneScope = {
  workspaceId: string;
  storyId: string;
  sceneExecutionId: string;
};

export type LocalGpuDispatchCandidate = {
  workspaceId: string;
  storyId: string;
  sceneExecutionId: string;
  packageId: string;
  runtimeAuthorizationId: string | null;
  existingGate: string | null;
  route: LocalGpuRouteInput;
};

/** Injected Staging dispatch. The worker cycle does not construct this port. */
export type LocalGpuDispatchPort = {
  jobIdFor(input: { workspaceId: string; sceneExecutionId: string; packageId: string }): string;
  claim(sceneExecutionId: string, jobId: string): Promise<boolean> | boolean;
  post(jobId: string): Promise<"accepted" | "ambiguous" | "rejected">;
  status(jobId: string): Promise<"found" | "not_found" | "uncertain">;
};

function enabledFlag(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((value ?? "").trim().toLowerCase());
}

function readScopeUuid(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return LOCAL_GPU_SCOPE_UUID.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function readLocalGpuSceneScope(env: Record<string, string | undefined>): LocalGpuSceneScope | null {
  const workspaceId = readScopeUuid(env.LOCAL_GPU_SCOPE_WORKSPACE_ID);
  const storyId = readScopeUuid(env.LOCAL_GPU_SCOPE_STORY_ID);
  const sceneExecutionId = readScopeUuid(env.LOCAL_GPU_SCOPE_SCENE_EXECUTION_ID);
  if (!workspaceId || !storyId || !sceneExecutionId) return null;
  return { workspaceId, storyId, sceneExecutionId };
}

export function localGpuDispatchGate(env: Record<string, string | undefined>): {
  dispatchAuthorized: boolean;
  environment: "staging" | "production" | null;
  code: "DISABLED" | "LOCAL_GPU_PRODUCTION_DENIED" | "LOCAL_GPU_ENVIRONMENT_REQUIRED" | "LOCAL_GPU_SCENE_SCOPE_REQUIRED" | "AUTHORIZED";
  scope: LocalGpuSceneScope | null;
} {
  const providerEnabled = enabledFlag(env.LOCAL_GPU_PROVIDER_ENABLED);
  const singleRun = enabledFlag(env.LOCAL_GPU_SINGLE_RUN_AUTHORIZED);
  if (!providerEnabled || !singleRun) {
    return { dispatchAuthorized: false, environment: null, code: "DISABLED", scope: null };
  }
  const environment = env.LOCAL_GPU_ENVIRONMENT?.trim();
  if (environment === "production") {
    return { dispatchAuthorized: false, environment: "production", code: "LOCAL_GPU_PRODUCTION_DENIED", scope: null };
  }
  if (environment !== "staging") {
    return { dispatchAuthorized: false, environment: null, code: "LOCAL_GPU_ENVIRONMENT_REQUIRED", scope: null };
  }
  const scope = readLocalGpuSceneScope(env);
  if (!scope) {
    return { dispatchAuthorized: false, environment: "staging", code: "LOCAL_GPU_SCENE_SCOPE_REQUIRED", scope: null };
  }
  return { dispatchAuthorized: true, environment: "staging", code: "AUTHORIZED", scope };
}

/** First observation may POST once. Every later observation is status-only. */
export function planLocalGpuHttp(input: {
  dispatchAuthorized: boolean;
  existingGate: string | null;
  eligible: boolean;
}): { http: "none" | "post_once" | "status_only"; submit: false } {
  if (!input.dispatchAuthorized || !input.eligible) return { http: "none", submit: false };
  try {
    assertLocalGpuSubmitAllowed(input.existingGate);
  } catch {
    return { http: "status_only", submit: false };
  }
  return { http: "post_once", submit: false };
}

export async function runAuthorizedLocalGpuStep(input: {
  http: "none" | "post_once" | "status_only";
  jobId: string;
  gate: string | null;
  post: () => Promise<"accepted" | "ambiguous" | "rejected">;
  status: () => Promise<"found" | "not_found" | "uncertain">;
}): Promise<{ posts: number; gets: number; runtime: LocalGpuReleaseRuntime | null; action: string }> {
  if (input.http === "none") return { posts: 0, gets: 0, runtime: null, action: "none" };
  if (input.http === "post_once") {
    const outcome = await input.post();
    const runtime = advanceLocalGpuRelease(
      { gate: input.jobId, notFoundCount: 0, uncertainCount: 0 },
      outcome === "accepted" ? { type: "submit_accepted" } : outcome === "rejected" ? { type: "submit_rejected" } : { type: "submit_ambiguous" },
    );
    return { posts: 1, gets: 0, runtime, action: runtime.action };
  }
  const found = await input.status();
  const runtime = advanceLocalGpuRelease(
    { gate: input.gate ?? input.jobId, notFoundCount: 0, uncertainCount: 0 },
    found === "found" ? { type: "status", state: "GENERATING" } : found === "not_found" ? { type: "status_not_found" } : { type: "status_uncertain" },
  );
  return { posts: 0, gets: 1, runtime, action: runtime.action };
}

function sameScope(scope: LocalGpuSceneScope, candidate: LocalGpuDispatchCandidate): boolean {
  return candidate.workspaceId.trim().toLowerCase() === scope.workspaceId
    && candidate.storyId.trim().toLowerCase() === scope.storyId
    && candidate.sceneExecutionId.trim().toLowerCase() === scope.sceneExecutionId;
}

/**
 * One authorized Staging scene. Claims that scene only, posts at most once,
 * and later observations stay on status for the same job id.
 */
export async function runScopedLocalGpuDispatch(input: {
  scope: LocalGpuSceneScope;
  candidate: LocalGpuDispatchCandidate;
  port: LocalGpuDispatchPort;
}): Promise<{ code: string; posts: number; gets: number; submit: false; jobId: string | null }> {
  if (!sameScope(input.scope, input.candidate)) {
    return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0, submit: false, jobId: null };
  }
  if (!input.candidate.runtimeAuthorizationId || input.candidate.route.runtimeAuthorizationId !== input.candidate.runtimeAuthorizationId) {
    return { code: "LOCAL_GPU_RUNTIME_AUTHORIZATION_REQUIRED", posts: 0, gets: 0, submit: false, jobId: null };
  }
  const route = planLocalGpuRoute(input.candidate.route);
  if (!route.eligible) {
    return { code: route.blocked ?? "LOCAL_GPU_WORKFLOW_UNSUPPORTED", posts: 0, gets: 0, submit: false, jobId: null };
  }
  const jobId = input.port.jobIdFor({
    workspaceId: input.scope.workspaceId,
    sceneExecutionId: input.scope.sceneExecutionId,
    packageId: input.candidate.packageId,
  });
  const http = planLocalGpuHttp({
    dispatchAuthorized: true,
    existingGate: input.candidate.existingGate,
    eligible: true,
  });
  if (http.http === "post_once") {
    const claimed = await input.port.claim(input.scope.sceneExecutionId, jobId);
    if (!claimed) return { code: "LOCAL_GPU_CLAIM_LOST", posts: 0, gets: 0, submit: false, jobId };
    const step = await runAuthorizedLocalGpuStep({
      http: "post_once",
      jobId,
      gate: null,
      post: () => input.port.post(jobId),
      status: () => input.port.status(jobId),
    });
    return { code: step.action, posts: step.posts, gets: step.gets, submit: false, jobId };
  }
  if (http.http === "status_only") {
    if (input.candidate.existingGate !== jobId) {
      return { code: "LOCAL_GPU_JOB_IDENTITY_MISMATCH", posts: 0, gets: 0, submit: false, jobId };
    }
    const step = await runAuthorizedLocalGpuStep({
      http: "status_only",
      jobId,
      gate: input.candidate.existingGate,
      post: () => input.port.post(jobId),
      status: () => input.port.status(jobId),
    });
    return { code: step.action, posts: step.posts, gets: step.gets, submit: false, jobId };
  }
  return { code: "none", posts: 0, gets: 0, submit: false, jobId };
}

/** Worker entry. No port is constructed here, so this call cannot POST. */
export async function runLocalGpuReleaseCycle(
  env: Record<string, string | undefined>,
  authorized?: {
    candidate: LocalGpuDispatchCandidate;
    port: LocalGpuDispatchPort;
  },
): Promise<{ code: string; posts: number; gets: number; submit: false }> {
  const gate = localGpuDispatchGate(env);
  if (!gate.dispatchAuthorized || !gate.scope) return { code: gate.code, posts: 0, gets: 0, submit: false };
  if (!authorized) return { code: "AUTHORIZED_UNBOUND", posts: 0, gets: 0, submit: false };
  const step = await runScopedLocalGpuDispatch({
    scope: gate.scope,
    candidate: authorized.candidate,
    port: authorized.port,
  });
  return { code: step.code, posts: step.posts, gets: step.gets, submit: false };
}
