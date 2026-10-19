import {
  LocalGpuCloudAdapter,
  loadLocalGpuConfigFromEnv,
  localGpuDispatchGate,
  localGpuOutputAssetId,
  planLocalGpuCompletion,
  runEnabledLocalGpuDispatch,
  type LocalGpuDispatchCandidate,
  type LocalGpuEnabledDispatchAdapter,
  type LocalGpuSceneScope,
  type LocalGpuSubmitLedger,
  type LocalGpuT2VRequest,
  type LocalGpuV2Request,
  type LocalGpuNativeDialogueRequest,
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
  request: LocalGpuT2VRequest | LocalGpuV2Request | LocalGpuNativeDialogueRequest;
  capabilities: unknown;
  existingResultId: string | null;
  ledger?: LocalGpuSubmitLedger;
  authorityLive?: boolean;
  now?: () => Date;
};

async function loadPersistedDispatch(scope: LocalGpuSceneScope): Promise<{
  authority: {
    dispatchAuthorityId: string; orgId: string; workspaceId: string; storyId: string; sceneExecutionId: string;
    campaignId: string; executionPlanId: string; packageId: string; runtimeAuthorizationId: string; expiresAt: Date;
  };
  candidate: LocalGpuDispatchCandidate;
  actor: Actor;
  request: LocalGpuT2VRequest | LocalGpuV2Request | LocalGpuNativeDialogueRequest;
  capabilities: unknown;
} | null> {
  const { getDb, loadAuthorizedLocalGpuDispatch } = await import("@ceo-agent/db");
  const row = await loadAuthorizedLocalGpuDispatch(getDb(), scope);
  if (!row) return null;
  const snapshot = row.snapshot;
  return {
    authority: row,
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
    request: snapshot.request as LocalGpuT2VRequest | LocalGpuV2Request | LocalGpuNativeDialogueRequest,
    capabilities: snapshot.capabilities,
  };
}

const LOCAL_GPU_SCOPES_PER_CYCLE = 5;

/**
 * Production adapter path for one persisted scope: claim + single POST, then status-only
 * observations. A COMPLETED job binds the Desktop-uploaded output to the canonical
 * VALIDATE_OUTPUT media job, which owns hashing, probing, the Generation Result and Post-QC.
 */
async function dispatchPersistedScope(
  env: Record<string, string | undefined>,
  environment: string | null,
  scope: LocalGpuSceneScope,
): Promise<{ code: string; posts: number; gets: number }> {
  const { claimExplicitLocalGpuReleaseGate, getDb, selectScopedLocalGpuRelease } = await import("@ceo-agent/db");
  const row = await selectScopedLocalGpuRelease(getDb(), scope);
  if (
    !row
    || row.workspaceId !== scope.workspaceId
    || row.storyId !== scope.storyId
    || row.sceneExecutionId !== scope.sceneExecutionId
    || !row.packageId
  ) {
    return { code: "LOCAL_GPU_SCENE_SCOPE_MISMATCH", posts: 0, gets: 0 };
  }
  const persisted = await loadPersistedDispatch(scope);
  if (!persisted) return { code: "LOCAL_GPU_SUBMIT_AUTHORITY_REQUIRED", posts: 0, gets: 0 };
  const ledger = persistedSubmitLedger(getDb(), persisted.authority);
  const adapter = new LocalGpuCloudAdapter(loadLocalGpuConfigFromEnv(env), async (attempt) => {
    const response = await fetch(attempt.url, { method: attempt.method, headers: attempt.headers, body: attempt.body });
    return { status: response.status, body: await response.text() };
  });
  let completedHash: string | null = null;
  const step = await runEnabledLocalGpuDispatch({
    scope,
    candidate: persisted.candidate,
    claim: (claim) => claimExplicitLocalGpuReleaseGate(getDb(), claim),
    adapter,
    actor: persisted.actor,
    request: persisted.request,
    capabilities: persisted.capabilities,
    existingResultId: null,
    productionDispatchAuthorized: environment === "production",
    ledger,
    authorityLive: persisted.authority.expiresAt > new Date(),
    finalize: (completion) => {
      completedHash = completion.contentHash;
      return planLocalGpuCompletion(completion);
    },
  });
  if (step.completion?.action === "materialize_once" && completedHash) {
    const bound = await bindLocalGpuDesktopOutput(persisted.authority, completedHash);
    return { code: bound, posts: step.posts, gets: step.gets };
  }
  return { code: localGpuStepCode(step), posts: step.posts, gets: step.gets };
}

/** Appends the Desktop status and error code so operational logs carry the rejection, never its body. */
function localGpuStepCode(step: { code: string; rejection?: { httpStatus: number; desktopErrorCode: string | null } }): string {
  if (!step.rejection) return step.code;
  return `${step.code}:${step.rejection.httpStatus}:${step.rejection.desktopErrorCode ?? "NO_DESKTOP_CODE"}`;
}

type PersistedAuthority = {
  dispatchAuthorityId: string; orgId: string; workspaceId: string; storyId: string; sceneExecutionId: string; packageId: string;
};

export function persistedSubmitLedger(
  db: Parameters<typeof import("@ceo-agent/db").appendLocalGpuSubmitOutcome>[0],
  authority: PersistedAuthority,
): LocalGpuSubmitLedger {
  const context = (jobId: string) => ({
    orgId: authority.orgId,
    workspaceId: authority.workspaceId,
    storyId: authority.storyId,
    sceneExecutionId: authority.sceneExecutionId,
    packageId: authority.packageId,
    dispatchAuthorityId: authority.dispatchAuthorityId,
    jobId,
  });
  return {
    read: async (jobId) => {
      const { readLocalGpuSubmitLedger } = await import("@ceo-agent/db");
      return readLocalGpuSubmitLedger(db, { workspaceId: authority.workspaceId, sceneExecutionId: authority.sceneExecutionId, jobId });
    },
    start: async (jobId, attemptNumber) => {
      const { appendLocalGpuSubmitOutcome } = await import("@ceo-agent/db");
      return appendLocalGpuSubmitOutcome(db, context(jobId), attemptNumber, "SUBMIT_STARTED");
    },
    record: async (jobId, attemptNumber, outcome) => {
      const { appendLocalGpuSubmitOutcome } = await import("@ceo-agent/db");
      const { kind, ...evidence } = outcome;
      await appendLocalGpuSubmitOutcome(db, context(jobId), attemptNumber, kind, evidence);
    },
  };
}

export async function bindLocalGpuDesktopOutput(
  authority: { orgId: string; workspaceId: string; campaignId: string; executionPlanId: string; packageId: string; runtimeAuthorizationId: string },
  contentHash: string,
): Promise<string> {
  if (!/^sha256:[0-9a-f]{64}$/.test(contentHash)) return "LOCAL_GPU_RESULT_CONTENT_HASH_REQUIRED";
  const { AiStoryLocalMediaJobRepository, getDb, schema } = await import("@ceo-agent/db");
  const { and, eq, isNull } = await import("drizzle-orm");
  const db = getDb();
  const assetId = localGpuOutputAssetId(authority);
  const [asset] = await db.select().from(schema.assets).where(and(
    eq(schema.assets.id, assetId),
    eq(schema.assets.orgId, authority.orgId),
    eq(schema.assets.workspaceId, authority.workspaceId),
    eq(schema.assets.campaignId, authority.campaignId),
    eq(schema.assets.source, "ai_story_manual_local"),
    isNull(schema.assets.deletedAt),
  )).limit(1);
  if (!asset?.uploadedBy || asset.metadata?.sourceKind !== "LOCAL_GPU_WORKER" || asset.metadata?.localGenerationPackageId !== authority.packageId) {
    return "LOCAL_GPU_OUTPUT_ASSET_MISSING";
  }
  const recorded = asset.metadata?.desktopResultContentHash;
  if (recorded !== undefined && recorded !== contentHash) return "GENERATION_RESULT_CONTENT_MISMATCH";
  if (recorded === undefined) {
    await db.update(schema.assets).set({
      metadata: { ...asset.metadata, desktopResultContentHash: contentHash },
      updatedAt: new Date(),
    }).where(and(eq(schema.assets.id, asset.id), eq(schema.assets.workspaceId, authority.workspaceId), eq(schema.assets.status, "uploading")));
  }
  await new AiStoryLocalMediaJobRepository(db).enqueue({
    workspaceId: authority.workspaceId, executionPlanId: authority.executionPlanId, packageId: authority.packageId,
    actorUserId: asset.uploadedBy, kind: "VALIDATE_OUTPUT", assetId: asset.id,
  });
  return "LOCAL_GPU_OUTPUT_VALIDATION_ENQUEUED";
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
  if (!deps && !gate.scope && gate.globalSuperadmin) {
    const { getDb, selectAuthorizedLocalGpuDispatchScopes } = await import("@ceo-agent/db");
    const scopes = await selectAuthorizedLocalGpuDispatchScopes(getDb(), LOCAL_GPU_SCOPES_PER_CYCLE);
    if (scopes.length === 0) return { code: "LOCAL_GPU_NO_AUTHORIZED_RELEASE", posts: 0, gets: 0, submit: false };
    let posts = 0, gets = 0;
    const codes: string[] = [];
    // Each scope is isolated: one failing Desktop job never blocks later released scenes.
    for (const scope of scopes) {
      try {
        const step = await dispatchPersistedScope(env, gate.environment, scope);
        posts += step.posts;
        gets += step.gets;
        codes.push(step.code);
      } catch (error) {
        codes.push(error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : "LOCAL_GPU_DISPATCH_STEP_FAILED");
      }
    }
    return { code: codes.join(","), posts, gets, submit: false };
  }
  let selectedScope = gate.scope;
  if (!selectedScope && gate.globalSuperadmin && deps?.selectScope) selectedScope = await deps.selectScope();
  if (!selectedScope && gate.globalSuperadmin) return { code: "LOCAL_GPU_NO_AUTHORIZED_RELEASE", posts: 0, gets: 0, submit: false };
  if (!selectedScope) return { code: "LOCAL_GPU_SCENE_SCOPE_REQUIRED", posts: 0, gets: 0, submit: false };
  if (!deps) {
    const step = await dispatchPersistedScope(env, gate.environment, selectedScope);
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
    ledger: deps.ledger,
    authorityLive: deps.authorityLive,
    now: deps.now,
  });
  return { code: localGpuStepCode(step), posts: step.posts, gets: step.gets, submit: false };
}
