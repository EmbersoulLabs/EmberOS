import {
  LocalGpuCloudAdapter,
  loadLocalGpuConfigFromEnv,
  localGpuDispatchGate,
  planLocalGpuCompletion,
  runEnabledLocalGpuDispatch,
  type LocalGpuDispatchCandidate,
  type LocalGpuEnabledDispatchAdapter,
  type LocalGpuSceneScope,
  type LocalGpuT2VRequest,
  type LocalGpuV2Request,
} from "@ceo-agent/agents";

type Actor = {
  userId: string;
  workspaceId: string;
  organizationPlan: string | null;
  platformAdminStatus: "ACTIVE_GRANT";
};

export type LocalGpuWorkerDispatchDeps = {
  selectScope?: () => Promise<LocalGpuSceneScope | null>;
  load: (scope: LocalGpuSceneScope) => Promise<LocalGpuDispatchCandidate | null>;
  claim: (claim: { workspaceId: string; storyId: string; sceneExecutionId: string; jobId: string }) => Promise<boolean> | boolean;
  adapter: LocalGpuEnabledDispatchAdapter;
  actor: Actor;
  request: LocalGpuT2VRequest | LocalGpuV2Request;
  capabilities: unknown;
  existingResultId: string | null;
};

async function loadPersistedDispatch(scope: LocalGpuSceneScope): Promise<{
  candidate: LocalGpuDispatchCandidate;
  actor: Actor;
  request: LocalGpuT2VRequest | LocalGpuV2Request;
  capabilities: unknown;
} | null> {
  const { getDb, loadAuthorizedLocalGpuDispatch } = await import("@ceo-agent/db");
  const row = await loadAuthorizedLocalGpuDispatch(getDb(), scope);
  if (!row) return null;
  const snapshot = row.snapshot;
  return {
    candidate: {
      workspaceId: row.workspaceId,
      storyId: row.storyId,
      sceneExecutionId: row.sceneExecutionId,
      packageId: row.packageId,
      runtimeAuthorizationId: row.runtimeAuthorizationId,
      existingGate: row.existingGate,
      route: snapshot.route as LocalGpuDispatchCandidate["route"],
    },
    actor: snapshot.actor,
    request: snapshot.request as LocalGpuT2VRequest | LocalGpuV2Request,
    capabilities: snapshot.capabilities,
  };
}

/**
 * Worker composition root.
 * Closed gates do not load a release. Live Staging has no persisted zero-asset submit, so this
 * process does not construct an HTTP client. Tests inject the signed adapter, claim, and finalizer.
 */
export async function runWorkerLocalGpuDispatchCycle(
  env: Record<string, string | undefined>,
  deps?: LocalGpuWorkerDispatchDeps,
): Promise<{ code: string; posts: number; gets: number; submit: false }> {
  const gate = localGpuDispatchGate(env);
  if (!gate.dispatchAuthorized) {
    return { code: gate.code, posts: 0, gets: 0, submit: false };
  }
  let selectedScope = gate.scope;
  if (!selectedScope && gate.globalSuperadmin) {
    if (deps?.selectScope) selectedScope = await deps.selectScope();
    else {
      const { getDb, selectNextAuthorizedLocalGpuDispatchScope } = await import("@ceo-agent/db");
      selectedScope = await selectNextAuthorizedLocalGpuDispatchScope(getDb());
    }
    if (!selectedScope) return { code: "LOCAL_GPU_NO_AUTHORIZED_RELEASE", posts: 0, gets: 0, submit: false };
  }
  if (!selectedScope) return { code: "LOCAL_GPU_SCENE_SCOPE_REQUIRED", posts: 0, gets: 0, submit: false };
  if (!deps) {
    const { claimExplicitLocalGpuReleaseGate, getDb, selectScopedLocalGpuRelease } = await import("@ceo-agent/db");
    const row = await selectScopedLocalGpuRelease(getDb(), selectedScope);
    if (
      !row
      || row.workspaceId !== selectedScope.workspaceId
      || row.storyId !== selectedScope.storyId
      || row.sceneExecutionId !== selectedScope.sceneExecutionId
      || !row.packageId
    ) {
      return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0, submit: false };
    }
    const persisted = await loadPersistedDispatch(selectedScope);
    if (!persisted) {
      return { code: "LOCAL_GPU_SUBMIT_AUTHORITY_REQUIRED", posts: 0, gets: 0, submit: false };
    }
    const adapter = new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv(env), async (attempt) => {
      const response = await fetch(attempt.url, { method: attempt.method, headers: attempt.headers, body: attempt.body });
      return { status: response.status, body: await response.text() };
    });
    const step = await runEnabledLocalGpuDispatch({
      scope: selectedScope,
      candidate: persisted.candidate,
      claim: (claim) => claimExplicitLocalGpuReleaseGate(getDb(), claim),
      adapter,
      actor: persisted.actor,
      request: persisted.request,
      capabilities: persisted.capabilities,
      existingResultId: null,
      productionDispatchAuthorized: gate.environment === "production",
      finalize: planLocalGpuCompletion,
    });
    return { code: step.code, posts: step.posts, gets: step.gets, submit: false };
  }
  const candidate = await deps.load(selectedScope);
  if (!candidate) return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0, submit: false };
  const step = await runEnabledLocalGpuDispatch({
    scope: selectedScope,
    candidate,
    claim: deps.claim,
    adapter: deps.adapter,
    actor: deps.actor,
    request: deps.request,
    capabilities: deps.capabilities,
    existingResultId: deps.existingResultId,
    finalize: planLocalGpuCompletion,
  });
  return { code: step.code, posts: step.posts, gets: step.gets, submit: false };
}
