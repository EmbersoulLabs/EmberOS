import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  LocalGpuCanonicalAdapter,
  localGpuQueuedAction,
  localGpuSubmitFailureLog,
  LOCAL_GPU_ADAPTER_VERSION,
} from "@ceo-agent/agents";
import { AiStoryLocalGenerationRepository, getDb, schema } from "@ceo-agent/db";
import {
  assertLocalGpuPackageCompatibility,
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_WORKER_WORKFLOW,
  LocalGpuContractError,
  localGpuDesktopReferenceRole,
  mapLocalGpuAudioPolicy,
  positiveDurationSecToMs,
  type AiStoryLocalGenerationPackage,
  type LocalGpuDesktopReference,
  type LocalGpuEnvironment,
  type LocalGpuUploadDestination,
} from "@ceo-agent/shared";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";
import { recoverCompletedLocalGpuResults } from "./ai-story-local-gpu-result-finalization";
import { createSignedStorageReadUrl, createSignedStorageUploadUrl } from "./storage";

const PROBE_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
let callerProbed = false;
let ledgerUnavailable = false;

function workerActor(userId: string, workspaceId: string) {
  return {
    userId,
    workspaceId,
    organizationPlan: null,
    platformAdminStatus: "ACTIVE_GRANT" as const,
  };
}

/** One signed health and capabilities call from this Railway process. */
export async function probeProductionLocalGpuCaller(): Promise<void> {
  if (callerProbed) return;
  callerProbed = true;
  const registry = createProductionAiStoryCanonicalAdapterRegistry();
  const adapter = registry.resolve(LOCAL_GPU_PROVIDER_ID, LOCAL_GPU_ADAPTER_VERSION);
  if (!(adapter instanceof LocalGpuCanonicalAdapter)) {
    console.info(JSON.stringify({
      event: "PRODUCTION_LOCAL_GPU_CALLER",
      registered: false,
    }));
    return;
  }
  const health = await adapter.cloud.health();
  let workflows: string[] = [];
  let capabilities: "PASS" | "FAIL" = "FAIL";
  try {
    const scope = {
      actor: workerActor(PROBE_ACTOR_ID, PROBE_ACTOR_ID),
      workspaceId: PROBE_ACTOR_ID,
      workflow: "",
      sceneExecutionId: "",
    };
    workflows = (await adapter.cloud.capabilities(scope)).workflows;
    capabilities = workflows.includes(LOCAL_GPU_WORKER_WORKFLOW) ? "PASS" : "FAIL";
  } catch (error) {
    console.info(JSON.stringify({
      event: "PRODUCTION_LOCAL_GPU_CALLER",
      registered: true,
      health: health.state,
      capabilities: "FAIL",
      message: error instanceof Error ? error.message : "LOCAL_GPU_CAPABILITIES_FAILED",
    }));
    return;
  }
  console.info(JSON.stringify({
    event: "PRODUCTION_LOCAL_GPU_CALLER",
    registered: true,
    health: health.state,
    capabilities,
    workflows,
    minimaxH3R2v: workflows.includes(LOCAL_GPU_WORKER_WORKFLOW),
  }));
}

/**
 * Claims one explicit LOCAL_GPU release and submits it once through the
 * production registry. Failure records a stop marker and does not resubmit.
 */
export async function runProductionLocalGpuExecutionCycle(): Promise<void> {
  await probeProductionLocalGpuCaller();
  if (ledgerUnavailable) return;
  try {
    await claimExplicitLocalGpuRelease();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("does not exist")) {
      ledgerUnavailable = true;
      console.warn("[local-gpu] production release ledger cannot queue LOCAL_GPU:", message);
      return;
    }
    throw error;
  }
}

async function claimExplicitLocalGpuRelease(): Promise<void> {
  const registry = createProductionAiStoryCanonicalAdapterRegistry();
  const adapter = registry.resolve(LOCAL_GPU_PROVIDER_ID, LOCAL_GPU_ADAPTER_VERSION);
  if (!(adapter instanceof LocalGpuCanonicalAdapter)) return;
  const db = getDb();
  const environment = localGpuServerEnvironment();
  await recoverCompletedLocalGpuResults({
    db,
    environment,
    readResult: async (jobId, release, pkg) => {
      const media = await adapter.cloud.result(jobId, {
        actor: workerActor(release.releasedBy!, release.workspaceId),
        workspaceId: release.workspaceId,
        workflow: LOCAL_GPU_WORKER_WORKFLOW,
        sceneExecutionId: pkg.sceneExecutionId,
        storyId: pkg.storyId,
        storyVersionId: pkg.storyVersionId,
      });
      return media;
    },
  });
  const releases = await db
    .select()
    .from(schema.aiStorySceneReleaseStates)
    .where(and(
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    ));
  const release = releases.find((row) =>
    localGpuQueuedAction(row.gateProviderAttemptId) !== "stop"
    && row.currentLocalGenerationPackageId
    && row.releasedBy
  );
  if (!release?.currentLocalGenerationPackageId || !release.releasedBy) return;
  const action = localGpuQueuedAction(release.gateProviderAttemptId);
  const packages = new AiStoryLocalGenerationRepository(db);
  const pkg = await packages.getExecutablePackage({
    workspaceId: release.workspaceId,
    executionPlanId: release.executionPlanId,
    packageId: release.currentLocalGenerationPackageId,
  });
  if (!pkg) return;
  const actor = workerActor(release.releasedBy, release.workspaceId);
  const scope = {
    actor,
    workspaceId: release.workspaceId,
    workflow: LOCAL_GPU_WORKER_WORKFLOW,
    sceneExecutionId: pkg.sceneExecutionId,
    storyId: pkg.storyId,
    storyVersionId: pkg.storyVersionId,
  };
  if (action === "submit") {
    const jobId = adapter.cloud.jobIdFor(pkg);
    const plannedDurationMs = positiveDurationSecToMs(pkg.durationSec);
    try {
      const packageExpectation = "audioQcExpectationKind" in pkg ? pkg.audioQcExpectationKind : undefined;
      const audioPolicy = mapLocalGpuAudioPolicy({
        generateAudio: pkg.generateAudio,
        audioBlocked: pkg.audioBlocked,
        expectationKind: packageExpectation,
      });
      assertLocalGpuPackageCompatibility({
        recommendedWorkflow: pkg.recommendedWorkflow,
        plannedDurationMs,
        generationMode: pkg.generationMode,
        references: pkg.references,
        audioPolicy,
      });
    } catch (error) {
      if (error instanceof LocalGpuContractError) {
        await markLocalGpuStop(db, release.sceneExecutionId, jobId, "unclaimed");
        console.warn(
          "[local-gpu] package is not Desktop-compatible:",
          JSON.stringify(localGpuSubmitFailureLog(error)),
        );
        return;
      }
      throw error;
    }
    const claimed = await db
      .update(schema.aiStorySceneReleaseStates)
      .set({ gateProviderAttemptId: jobId, updatedAt: new Date() })
      .where(and(
        eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId),
        eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
        isNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId),
      ))
      .returning({ sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId });
    if (claimed.length === 0) return;
    try {
      const references = await resolveFrozenDesktopReferences(db, pkg);
      const upload = await createLocalGpuUploadDestination({
        db,
        pkg,
        actorUserId: release.releasedBy,
        environment: localGpuServerEnvironment(),
      });
      const capabilities = await adapter.cloud.capabilities(scope);
      await adapter.cloud.submit({
        actor,
        package: pkg,
        recommendedDurationAuthority: { decision: { plannedDurationMs } },
        workerWorkflows: capabilities.workflows,
        references,
        upload,
      });
    } catch (error) {
      await markLocalGpuStop(db, release.sceneExecutionId, jobId, "claimed");
      console.warn(
        "[local-gpu] submit failed without fallback:",
        JSON.stringify(localGpuSubmitFailureLog(error)),
      );
    }
    return;
  }
  const jobId = release.gateProviderAttemptId!;
  try {
    const status = await adapter.cloud.status(jobId, scope);
    const next = localGpuQueuedAction(jobId, status.state);
    if (next === "stop") {
      await db
        .update(schema.aiStorySceneReleaseStates)
        .set({ gateProviderAttemptId: `failed:${jobId}`, updatedAt: new Date() })
        .where(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId));
      return;
    }
    if (next === "finalize") {
      const media = await adapter.cloud.result(jobId, scope);
      await db
        .update(schema.aiStorySceneReleaseStates)
        .set({ gateProviderAttemptId: `result:${jobId}`, updatedAt: new Date() })
        .where(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId));
      await recoverCompletedLocalGpuResults({
        db,
        environment,
        readResult: async (requestedJobId, requestedRelease, requestedPackage) => {
          if (requestedJobId === jobId) return media;
          return adapter.cloud.result(requestedJobId, {
            actor: workerActor(requestedRelease.releasedBy!, requestedRelease.workspaceId),
            workspaceId: requestedRelease.workspaceId,
            workflow: LOCAL_GPU_WORKER_WORKFLOW,
            sceneExecutionId: requestedPackage.sceneExecutionId,
            storyId: requestedPackage.storyId,
            storyVersionId: requestedPackage.storyVersionId,
          });
        },
      });
    }
  } catch (error) {
    await db
      .update(schema.aiStorySceneReleaseStates)
      .set({ gateProviderAttemptId: `failed:${jobId}`, updatedAt: new Date() })
      .where(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId));
    console.warn(
      "[local-gpu] status failed without retry:",
      error instanceof Error ? error.message : error,
    );
  }
}

type WorkerDb = ReturnType<typeof getDb>;

function localGpuServerEnvironment(): LocalGpuEnvironment {
  const value = process.env.LOCAL_GPU_ENVIRONMENT;
  if (value !== "staging" && value !== "production") {
    throw new LocalGpuContractError("LOCAL_GPU_ENVIRONMENT_REQUIRED");
  }
  return value;
}

/** Writes a stop marker without calling Desktop. An existing marker is left unchanged. */
async function markLocalGpuStop(
  db: WorkerDb,
  sceneExecutionId: string,
  jobId: string,
  phase: "unclaimed" | "claimed",
): Promise<void> {
  await db
    .update(schema.aiStorySceneReleaseStates)
    .set({ gateProviderAttemptId: `failed:${jobId}`, updatedAt: new Date() })
    .where(and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
      phase === "unclaimed"
        ? isNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId)
        : eq(schema.aiStorySceneReleaseStates.gateProviderAttemptId, jobId),
    ));
}

async function resolveFrozenDesktopReferences(
  db: WorkerDb,
  pkg: AiStoryLocalGenerationPackage,
): Promise<LocalGpuDesktopReference[]> {
  const resolved: LocalGpuDesktopReference[] = [];
  for (const reference of pkg.references) {
    const source = reference as {
      role?: string;
      authorityType?: string;
      assetId: string;
      contentHash: string;
    };
    const role = localGpuDesktopReferenceRole(source);
    if (!role) continue;
    if (!source.contentHash || !/^sha256:[0-9a-f]{64}$/.test(source.contentHash)) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    const [asset] = await db
      .select({
        storagePath: schema.assets.storagePath,
        contentHash: schema.assets.contentHash,
      })
      .from(schema.assets)
      .where(and(
        eq(schema.assets.id, source.assetId),
        eq(schema.assets.workspaceId, pkg.workspaceId),
        isNull(schema.assets.deletedAt),
      ))
      .limit(1);
    if (!asset?.storagePath) throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    if (asset.contentHash && asset.contentHash !== source.contentHash) {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_CONTENT_HASH_REQUIRED");
    }
    let assetUrl: string;
    try {
      assetUrl = await createSignedStorageReadUrl(asset.storagePath);
    } catch {
      throw new LocalGpuContractError("LOCAL_GPU_REFERENCE_ASSET_URL_REQUIRED");
    }
    resolved.push({
      approval: "APPROVED",
      role,
      assetUrl,
      contentHash: source.contentHash,
    });
  }
  return resolved;
}

async function createLocalGpuUploadDestination(input: {
  db: WorkerDb;
  pkg: AiStoryLocalGenerationPackage;
  actorUserId: string;
  environment: LocalGpuEnvironment;
}): Promise<LocalGpuUploadDestination> {
  const assetId = randomUUID();
  const storagePath = `${input.pkg.workspaceId}/ai-story/local-generation/${input.pkg.packageId}/${assetId}.mp4`;
  await input.db.insert(schema.assets).values({
    id: assetId,
    orgId: input.pkg.organizationId,
    workspaceId: input.pkg.workspaceId,
    campaignId: input.pkg.campaignId,
    type: "video",
    storagePath,
    displayName: `Local GPU Unit ${input.pkg.order}`,
    originalFilename: "local-gpu-result.mp4",
    status: "uploading",
    source: "ai_story_manual_local",
    uploadedBy: input.actorUserId,
    mimeType: "video/mp4",
    metadata: {
      localGenerationPackageId: input.pkg.packageId,
      localGenerationUnitId: input.pkg.unitId,
      executionPlanId: input.pkg.executionPlanId,
    },
  });
  let url: string;
  try {
    url = await createSignedStorageUploadUrl(storagePath);
  } catch {
    throw new LocalGpuContractError("LOCAL_GPU_UPLOAD_DESTINATION_REQUIRED");
  }
  return {
    environment: input.environment,
    method: "PUT",
    url,
    headers: { "content-type": "video/mp4" },
    assetId,
  };
}
