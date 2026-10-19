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
import { LocalGpuSubmitAmbiguousError, LocalGpuSubmitRejectedError, type LocalGpuCloudAdapter } from "./local-gpu-adapter";
import { planLocalGpuCompletion } from "./local-gpu-result-finalization";

export type LocalGpuT2VRequest = Parameters<LocalGpuCloudAdapter["submitZeroAssetT2V"]>[0]["request"];
export type LocalGpuV2Request = Parameters<LocalGpuCloudAdapter["submitContractV2"]>[0]["request"];
export type LocalGpuNativeDialogueRequest = {
  body: Parameters<LocalGpuCloudAdapter["submitNativeDialogueV3"]>[0]["request"];
  creativeBinding: string;
};
type LocalGpuDispatchActor = {
  userId: string;
  workspaceId: string;
  organizationPlan: string | null;
  platformAdminStatus: "ACTIVE_GRANT";
};

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
  /** One persisted, explicitly authorized Production execution; never a global capability claim. */
  nativeDialogueCanaryAuthorized?: boolean;
  preQc: "DISPATCH_ELIGIBLE" | "DISPATCH_ELIGIBLE_WITH_WARNINGS" | "DISPATCH_BLOCKED" | null;
  runtimeAuthorizationId: string | null;
  capabilities: unknown;
  recommendedWorkflow?: string | null;
  generateAudio: boolean;
  audioBlocked: boolean;
  qcExpectation: "NATIVE_CHARACTER_DIALOGUE" | "NO_DIALOGUE_WITH_AMBIENT_AUDIO" | "SILENT_OUTPUT";
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
  if (input.dialogueRequired || input.recommendedWorkflow === "MINIMAX_H3_NATIVE_DIALOGUE") {
    if (input.assetMode !== "WITH_ASSET" || input.referenceCount < 1 || input.referenceCount > 3) {
      return blocked(input.assetMode, input.referenceCount > 3 ? "LOCAL_GPU_REFERENCE_SELECTION_AMBIGUOUS" : "LOCAL_GPU_REFERENCES_REQUIRED");
    }
    if (!input.generateAudio || input.audioBlocked || input.qcExpectation !== "NATIVE_CHARACTER_DIALOGUE") {
      return blocked(input.assetMode, "LOCAL_GPU_AUDIO_POLICY_INVALID");
    }
    if (input.voiceDnaRequired || input.continuityFrameRequired || (input.audioReferenceCount ?? 0) > 0 || (input.videoReferenceCount ?? 0) > 0) {
      return blocked(input.assetMode, "LOCAL_GPU_WORKFLOW_UNSUPPORTED");
    }
    const root = input.capabilities && typeof input.capabilities === "object" ? input.capabilities as Record<string, unknown> : {};
    const contracts = root.contracts && typeof root.contracts === "object" ? root.contracts as Record<string, unknown> : {};
    const v3 = contracts.v3 && typeof contracts.v3 === "object" ? contracts.v3 as Record<string, unknown> : {};
    const workflows = v3.workflows && typeof v3.workflows === "object" ? v3.workflows as Record<string, unknown> : {};
    const capability = workflows.MINIMAX_H3_NATIVE_DIALOGUE && typeof workflows.MINIMAX_H3_NATIVE_DIALOGUE === "object"
      ? workflows.MINIMAX_H3_NATIVE_DIALOGUE as Record<string, unknown>
      : {};
    if (
      !Array.isArray(root.acceptedContractVersions)
      || !root.acceptedContractVersions.includes(3)
      || capability.execution !== "enabled"
      || capability.implemented !== true
      || capability.modelInstalled !== true
      || capability.buildExecutable !== true
      || capability.nativeDialogue !== "PROMPT_CONDITIONED"
      || (capability.e2eCertified !== true && input.nativeDialogueCanaryAuthorized !== true)
    ) {
      return blocked(input.assetMode, "LOCAL_GPU_NATIVE_DIALOGUE_NOT_CERTIFIED");
    }
    return {
      eligible: true,
      blocked: null,
      contractVersion: 3,
      assetMode: "WITH_ASSET",
      workflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      desktopAudioPolicy: "NATIVE",
      qcExpectation: "NATIVE_CHARACTER_DIALOGUE",
      speechContent: "HUMAN_REVIEW_REQUIRED",
      hasAudio: true,
    };
  }
  // Native dialogue is handled exclusively by the certified Contract V3 branch above.
  // Keeping this guard explicit also prevents the legacy audio mapper from silently
  // interpreting a future unsupported native-dialogue combination.
  if (input.qcExpectation === "NATIVE_CHARACTER_DIALOGUE") {
    return blocked(input.assetMode, "LOCAL_GPU_AUDIO_POLICY_INVALID");
  }
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
  if (input.voiceDnaRequired || input.continuityFrameRequired) {
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
  globalSuperadmin: boolean;
} {
  const providerEnabled = enabledFlag(env.LOCAL_GPU_PROVIDER_ENABLED);
  const singleRun = enabledFlag(env.LOCAL_GPU_SINGLE_RUN_AUTHORIZED);
  const globalSuperadmin = enabledFlag(env.LOCAL_GPU_SUPERADMIN_GLOBAL_ENABLED);
  if (!providerEnabled || (!singleRun && !globalSuperadmin)) {
    return { dispatchAuthorized: false, environment: null, code: "DISABLED", scope: null, globalSuperadmin: false };
  }
  const environment = env.LOCAL_GPU_ENVIRONMENT?.trim();
  if (environment !== "staging" && environment !== "production") {
    return { dispatchAuthorized: false, environment: null, code: "LOCAL_GPU_ENVIRONMENT_REQUIRED", scope: null, globalSuperadmin: false };
  }
  if (environment === "production" && !enabledFlag(env.LOCAL_GPU_PRODUCTION_DISPATCH_ENABLED)) {
    return { dispatchAuthorized: false, environment: "production", code: "LOCAL_GPU_PRODUCTION_DENIED", scope: null, globalSuperadmin: false };
  }
  const scope = readLocalGpuSceneScope(env);
  if (environment === "production" && globalSuperadmin) {
    return { dispatchAuthorized: true, environment, code: "AUTHORIZED", scope, globalSuperadmin: true };
  }
  if (!scope) {
    return { dispatchAuthorized: false, environment, code: "LOCAL_GPU_SCENE_SCOPE_REQUIRED", scope: null, globalSuperadmin: false };
  }
  return { dispatchAuthorized: true, environment, code: "AUTHORIZED", scope, globalSuperadmin: false };
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

export type LocalGpuEnabledDispatchAdapter = {
  jobIdFor(input: { workspaceId: string; sceneExecutionId: string; packageId: string }): string;
  submitZeroAssetT2V(input: {
    actor: LocalGpuDispatchActor;
    package: { workspaceId: string; sceneExecutionId: string; packageId: string };
    request: LocalGpuT2VRequest;
    capabilities: unknown;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{ jobId: string }>;
  submitContractV2?(input: {
    actor: LocalGpuDispatchActor;
    package: { workspaceId: string; sceneExecutionId: string; packageId: string };
    request: LocalGpuV2Request;
    capabilities: Parameters<LocalGpuCloudAdapter["submitContractV2"]>[0]["capabilities"];
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
  }): Promise<{ jobId: string }>;
  submitNativeDialogueV3?(input: {
    actor: LocalGpuDispatchActor;
    package: { workspaceId: string; sceneExecutionId: string; packageId: string };
    request: Parameters<LocalGpuCloudAdapter["submitNativeDialogueV3"]>[0]["request"];
    creativeBinding: string;
    capabilities: unknown;
    existingGate: string | null;
    productionDispatchAuthorized?: boolean;
    nativeDialogueCanaryAuthorized?: boolean;
  }): Promise<{ jobId: string }>;
  status(jobId: string, scope: {
    actor: LocalGpuDispatchActor;
    workspaceId: string;
    sceneExecutionId: string;
    workflow: string;
  }): Promise<{ found: boolean; uncertain?: boolean; state?: string }>;
  result(jobId: string, scope: {
    actor: LocalGpuDispatchActor;
    workspaceId: string;
    sceneExecutionId: string;
    workflow: string;
  }): Promise<{ contentHash: string }>;
};

/**
 * Enabled path. Claims only the scoped scene, posts at most once, then reconciles
 * status and plans result finalization without another POST.
 */
/** A 404 status is reconciled, never trusted alone: only after this window of 404s since the last submit evidence does polling stop. */
export const LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS = 10 * 60 * 1000;

export type LocalGpuSubmitLedgerOutcome =
  | { kind: "SUBMIT_ACCEPTED"; diagnostic?: Record<string, unknown> }
  | { kind: "SUBMIT_REJECTED"; httpStatus: number; desktopErrorCode: string | null; desktopErrorMessage: string | null; diagnostic: Record<string, unknown> }
  | { kind: "SUBMIT_UNCERTAIN"; httpStatus: number | null; uncertainReason: string }
  | { kind: "STATUS_NOT_FOUND_EXHAUSTED"; httpStatus: 404; diagnostic: Record<string, unknown> };

export type LocalGpuSubmitLedger = {
  read: (jobId: string) => Promise<{
    attemptNumber: number;
    started: boolean;
    accepted: boolean;
    terminal: "SUBMIT_REJECTED" | "STATUS_NOT_FOUND_EXHAUSTED" | null;
    retryAuthorized: boolean;
    evidenceAt: Date | null;
  }>;
  /** Unique (job, attempt) claim; false means another consumer already started this attempt. */
  start: (jobId: string, attemptNumber: number) => Promise<boolean>;
  record: (jobId: string, attemptNumber: number, outcome: LocalGpuSubmitLedgerOutcome) => Promise<void>;
};

export type LocalGpuDispatchStepResult = {
  code: string;
  posts: number;
  gets: number;
  submit: false;
  jobId: string | null;
  completion: { action: string; submit: false } | null;
  rejection?: { httpStatus: number; desktopErrorCode: string | null };
};

export async function runEnabledLocalGpuDispatch(input: {
  scope: LocalGpuSceneScope;
  candidate: LocalGpuDispatchCandidate;
  claim: (claim: { workspaceId: string; storyId: string; sceneExecutionId: string; jobId: string }) => Promise<boolean> | boolean;
  adapter: LocalGpuEnabledDispatchAdapter;
  actor: LocalGpuDispatchActor;
  request: LocalGpuT2VRequest | LocalGpuV2Request | LocalGpuNativeDialogueRequest;
  capabilities: unknown;
  existingResultId: string | null;
  productionDispatchAuthorized?: boolean;
  finalize?: (completion: { jobId: string; existingResultId: string | null; contentHash: string }) => { action: string; submit: false };
  /** Durable submit evidence. Without it the step keeps the legacy claim-then-poll behavior. */
  ledger?: LocalGpuSubmitLedger;
  /** False when the persisted dispatch authority's submit TTL has lapsed. */
  authorityLive?: boolean;
  now?: () => Date;
}): Promise<LocalGpuDispatchStepResult> {
  if (!sameScope(input.scope, input.candidate)) {
    return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0, submit: false, jobId: null, completion: null };
  }
  const route = planLocalGpuRoute(input.candidate.route);
  if (!route.eligible) {
    return { code: route.blocked ?? "LOCAL_GPU_WORKFLOW_UNSUPPORTED", posts: 0, gets: 0, submit: false, jobId: null, completion: null };
  }
  if (route.contractVersion === 2 && !input.adapter.submitContractV2) {
    return { code: "LOCAL_GPU_V2_ADAPTER_UNBOUND", posts: 0, gets: 0, submit: false, jobId: null, completion: null };
  }
  if (route.workflow === "MINIMAX_H3_NATIVE_DIALOGUE" && !input.adapter.submitNativeDialogueV3) {
    return { code: "LOCAL_GPU_NATIVE_DIALOGUE_ADAPTER_UNBOUND", posts: 0, gets: 0, submit: false, jobId: null, completion: null };
  }
  const jobId = input.adapter.jobIdFor({
    workspaceId: input.scope.workspaceId,
    sceneExecutionId: input.scope.sceneExecutionId,
    packageId: input.candidate.packageId,
  });
  // Desktop binds status/result tokens to the job's own workflow.
  const scope = {
    actor: input.actor,
    workspaceId: input.scope.workspaceId,
    sceneExecutionId: input.scope.sceneExecutionId,
    workflow: route.workflow ?? LOCAL_GPU_WORKER_WORKFLOW,
  };
  const ledger = input.ledger;
  const now = input.now ?? (() => new Date());
  const submitOnce = async (): Promise<void> => {
    const submitInput = {
      actor: input.actor,
      package: { workspaceId: input.scope.workspaceId, sceneExecutionId: input.scope.sceneExecutionId, packageId: input.candidate.packageId },
      request: input.request,
      capabilities: input.capabilities,
      existingGate: null,
      productionDispatchAuthorized: input.productionDispatchAuthorized,
    };
    if (route.contractVersion === 2) {
      await input.adapter.submitContractV2!({
        ...submitInput,
        request: input.request as LocalGpuV2Request,
        capabilities: input.capabilities as Parameters<LocalGpuCloudAdapter["submitContractV2"]>[0]["capabilities"],
      });
    } else if (route.workflow === "MINIMAX_H3_NATIVE_DIALOGUE") {
      const native = input.request as LocalGpuNativeDialogueRequest;
      await input.adapter.submitNativeDialogueV3!({
        actor: input.actor,
        package: submitInput.package,
        request: native.body,
        creativeBinding: native.creativeBinding,
        capabilities: input.capabilities,
        existingGate: null,
        productionDispatchAuthorized: input.productionDispatchAuthorized,
        nativeDialogueCanaryAuthorized: input.candidate.route.nativeDialogueCanaryAuthorized === true,
      });
    } else {
      await input.adapter.submitZeroAssetT2V({ ...submitInput, request: input.request as LocalGpuT2VRequest });
    }
  };
  const stepResult = (code: string, posts: number, gets: number, extra: Partial<LocalGpuDispatchStepResult> = {}): LocalGpuDispatchStepResult => ({
    code, posts, gets, submit: false, jobId, completion: null, ...extra,
  });
  // Evidence is persisted before the step returns, so a terminal outcome is durable before polling stops.
  const submitAndRecord = async (attemptNumber: number): Promise<LocalGpuDispatchStepResult> => {
    try {
      await submitOnce();
    } catch (error) {
      if (!ledger) throw error;
      if (error instanceof LocalGpuSubmitRejectedError) {
        await ledger.record(jobId, attemptNumber, {
          kind: "SUBMIT_REJECTED",
          httpStatus: error.httpStatus,
          desktopErrorCode: error.rejection.desktopErrorCode,
          desktopErrorMessage: error.rejection.desktopErrorMessage,
          diagnostic: { issuePaths: error.rejection.issuePaths },
        });
        return stepResult("LOCAL_GPU_SUBMIT_REJECTED", 1, 0, {
          rejection: { httpStatus: error.httpStatus, desktopErrorCode: error.rejection.desktopErrorCode },
        });
      }
      const reason = error instanceof LocalGpuSubmitAmbiguousError
        ? error.reason
        : `local_error:${error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "UNKNOWN"}`;
      await ledger.record(jobId, attemptNumber, {
        kind: "SUBMIT_UNCERTAIN",
        httpStatus: error instanceof LocalGpuSubmitAmbiguousError ? error.httpStatus : null,
        uncertainReason: reason,
      });
      return stepResult("LOCAL_GPU_SUBMIT_UNCERTAIN", 1, 0);
    }
    if (ledger) await ledger.record(jobId, attemptNumber, { kind: "SUBMIT_ACCEPTED" });
    return stepResult("accepted", 1, 0);
  };

  if (input.candidate.existingGate === null) {
    const claimed = await input.claim({
      workspaceId: input.scope.workspaceId,
      storyId: input.scope.storyId,
      sceneExecutionId: input.scope.sceneExecutionId,
      jobId,
    });
    if (!claimed) return stepResult("LOCAL_GPU_CLAIM_LOST", 0, 0);
    if (ledger && !(await ledger.start(jobId, 1))) return stepResult("LOCAL_GPU_CLAIM_LOST", 0, 0);
    return submitAndRecord(1);
  }
  if (input.candidate.existingGate !== jobId) {
    return stepResult("LOCAL_GPU_JOB_IDENTITY_MISMATCH", 0, 0);
  }
  const state = ledger ? await ledger.read(jobId) : null;
  if (state?.terminal) return stepResult(`LOCAL_GPU_SUBMIT_TERMINAL_${state.terminal}`, 0, 0);
  if (ledger && state?.retryAuthorized && !state.started) {
    if (input.authorityLive === false) return stepResult("LOCAL_GPU_RETRY_AWAITING_AUTHORITY_RENEWAL", 0, 0);
    if (!(await ledger.start(jobId, state.attemptNumber))) return stepResult("LOCAL_GPU_CLAIM_LOST", 0, 0);
    return submitAndRecord(state.attemptNumber);
  }
  const observed = await input.adapter.status(jobId, scope);
  if (observed.found && ledger && state && !state.accepted) {
    await ledger.record(jobId, state.attemptNumber, { kind: "SUBMIT_ACCEPTED", diagnostic: { observedState: observed.state } });
  }
  if (!observed.found && !observed.uncertain && ledger && state) {
    const since = state.evidenceAt;
    if (since && now().getTime() - since.getTime() >= LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS) {
      await ledger.record(jobId, state.attemptNumber, {
        kind: "STATUS_NOT_FOUND_EXHAUSTED",
        httpStatus: 404,
        diagnostic: { notFoundSince: since.toISOString(), windowMs: LOCAL_GPU_STATUS_NOT_FOUND_RECONCILIATION_MS },
      });
      return stepResult("LOCAL_GPU_SUBMIT_TERMINAL_STATUS_NOT_FOUND_EXHAUSTED", 0, 1);
    }
  }
  if (!observed.found || observed.state !== "COMPLETED") {
    return stepResult(observed.found ? "poll" : observed.uncertain ? "uncertain" : "not_found", 0, 1);
  }
  const result = await input.adapter.result(jobId, scope);
  const completion = (input.finalize ?? planLocalGpuCompletion)({
    jobId,
    existingResultId: input.existingResultId,
    contentHash: result.contentHash,
  });
  return { code: completion.action, posts: 0, gets: 2, submit: false, jobId, completion };
}

export type LocalGpuInstalledRelease = {
  candidate: LocalGpuDispatchCandidate;
  submitReady: boolean;
};

/**
 * Composition root. A closed gate never loads a release or constructs the Desktop adapter.
 * An open gate loads only the scoped scene and still refuses to claim until submit authority exists.
 */
export async function runInstalledLocalGpuReleaseCycle(
  env: Record<string, string | undefined>,
  deps?: {
    load?: (scope: LocalGpuSceneScope) => Promise<LocalGpuInstalledRelease | null>;
    createPort?: (release: LocalGpuInstalledRelease) => LocalGpuDispatchPort;
  },
): Promise<{ code: string; posts: number; gets: number; submit: false }> {
  const gate = localGpuDispatchGate(env);
  if (!gate.dispatchAuthorized || !gate.scope) return runLocalGpuReleaseCycle(env);
  const load = deps?.load ?? loadScopedLocalGpuReleaseFromDatabase;
  const release = await load(gate.scope);
  if (!release || !sameScope(gate.scope, release.candidate)) {
    return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0, submit: false };
  }
  if (!release.submitReady) {
    return { code: "LOCAL_GPU_SUBMIT_AUTHORITY_REQUIRED", posts: 0, gets: 0, submit: false };
  }
  if (!deps?.createPort) {
    return { code: "LOCAL_GPU_DISPATCH_PORT_UNBOUND", posts: 0, gets: 0, submit: false };
  }
  return runLocalGpuReleaseCycle(env, { candidate: release.candidate, port: deps.createPort(release) });
}

async function loadScopedLocalGpuReleaseFromDatabase(scope: LocalGpuSceneScope): Promise<LocalGpuInstalledRelease | null> {
  const { getDb, selectScopedLocalGpuRelease } = await import("@ceo-agent/db");
  const row = await selectScopedLocalGpuRelease(getDb(), scope);
  if (!row || row.executionMode !== "LOCAL_GPU" || row.releaseState !== "RELEASED" || !row.packageId) return null;
  return {
    submitReady: false,
    candidate: {
      workspaceId: row.workspaceId,
      storyId: row.storyId,
      sceneExecutionId: row.sceneExecutionId,
      packageId: row.packageId,
      runtimeAuthorizationId: row.runtimeAuthorizationId,
      existingGate: row.existingGate,
      route: {
        assetMode: "WITHOUT_ASSET",
        assetRecommendationStatus: "ASSET_RECOMMENDATION_REQUIRED",
        referenceCount: 0,
        preQc: null,
        runtimeAuthorizationId: row.runtimeAuthorizationId,
        capabilities: null,
        generateAudio: false,
        audioBlocked: true,
        qcExpectation: "SILENT_OUTPUT",
      },
    },
  };
}
