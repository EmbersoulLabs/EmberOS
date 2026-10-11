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

export function localGpuDispatchGate(env: Record<string, string | undefined>): {
  dispatchAuthorized: boolean;
  environment: "staging" | "production" | null;
  code: "DISABLED" | "LOCAL_GPU_PRODUCTION_DENIED" | "LOCAL_GPU_ENVIRONMENT_REQUIRED" | "AUTHORIZED";
} {
  const providerEnabled = ["1", "true", "yes", "on"].includes((env.LOCAL_GPU_PROVIDER_ENABLED ?? "").trim().toLowerCase());
  const singleRun = ["1", "true", "yes", "on"].includes((env.LOCAL_GPU_SINGLE_RUN_AUTHORIZED ?? "").trim().toLowerCase());
  if (!providerEnabled || !singleRun) {
    return { dispatchAuthorized: false, environment: null, code: "DISABLED" };
  }
  const environment = env.LOCAL_GPU_ENVIRONMENT?.trim();
  if (environment === "production") {
    return { dispatchAuthorized: false, environment: "production", code: "LOCAL_GPU_PRODUCTION_DENIED" };
  }
  if (environment !== "staging") {
    return { dispatchAuthorized: false, environment: null, code: "LOCAL_GPU_ENVIRONMENT_REQUIRED" };
  }
  return { dispatchAuthorized: true, environment: "staging", code: "AUTHORIZED" };
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

/** Worker entry. Disabled and production environments never receive a dispatch port. */
export async function runLocalGpuReleaseCycle(
  env: Record<string, string | undefined>,
  authorized?: {
    jobId: string;
    existingGate: string | null;
    route: LocalGpuRouteInput;
    post: () => Promise<"accepted" | "ambiguous" | "rejected">;
    status: () => Promise<"found" | "not_found" | "uncertain">;
  },
): Promise<{ code: string; posts: number; gets: number; submit: false }> {
  const gate = localGpuDispatchGate(env);
  if (!gate.dispatchAuthorized) return { code: gate.code, posts: 0, gets: 0, submit: false };
  if (!authorized) return { code: "AUTHORIZED_UNBOUND", posts: 0, gets: 0, submit: false };
  const route = planLocalGpuRoute(authorized.route);
  const http = planLocalGpuHttp({
    dispatchAuthorized: true,
    existingGate: authorized.existingGate,
    eligible: route.eligible,
  });
  if (!route.eligible) return { code: route.blocked ?? "LOCAL_GPU_WORKFLOW_UNSUPPORTED", posts: 0, gets: 0, submit: false };
  const step = await runAuthorizedLocalGpuStep({
    http: http.http,
    jobId: authorized.jobId,
    gate: authorized.existingGate,
    post: authorized.post,
    status: authorized.status,
  });
  return { code: step.action, posts: step.posts, gets: step.gets, submit: false };
}
