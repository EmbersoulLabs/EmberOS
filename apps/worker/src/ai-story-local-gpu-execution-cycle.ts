import { and, eq, isNull } from "drizzle-orm";
import {
  LocalGpuCanonicalAdapter,
  localGpuQueuedAction,
  LOCAL_GPU_ADAPTER_VERSION,
} from "@ceo-agent/agents";
import { AiStoryLocalGenerationRepository, getDb, schema } from "@ceo-agent/db";
import {
  LOCAL_GPU_PROVIDER_ID,
  LOCAL_GPU_WORKER_WORKFLOW,
  positiveDurationSecToMs,
} from "@ceo-agent/shared";
import { createProductionAiStoryCanonicalAdapterRegistry } from "./ai-story-canonical-adapter-registry";

const PROBE_ACTOR_ID = "11111111-1111-4111-8111-111111111111";
let callerProbed = false;

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
  const registry = createProductionAiStoryCanonicalAdapterRegistry();
  const adapter = registry.resolve(LOCAL_GPU_PROVIDER_ID, LOCAL_GPU_ADAPTER_VERSION);
  if (!(adapter instanceof LocalGpuCanonicalAdapter)) return;
  const db = getDb();
  const [release] = await db
    .select()
    .from(schema.aiStorySceneReleaseStates)
    .where(and(
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    ))
    .limit(1);
  if (!release?.currentLocalGenerationPackageId || !release.releasedBy) return;
  const action = localGpuQueuedAction(release.gateProviderAttemptId);
  if (action === "stop") return;
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
      const capabilities = await adapter.cloud.capabilities(scope);
      await adapter.cloud.submit({
        actor,
        package: pkg,
        recommendedDurationAuthority: {
          decision: { plannedDurationMs: positiveDurationSecToMs(pkg.durationSec) },
        },
        workerWorkflows: capabilities.workflows,
      });
    } catch (error) {
      await db
        .update(schema.aiStorySceneReleaseStates)
        .set({
          gateProviderAttemptId: `failed:${jobId}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId));
      console.warn(
        "[local-gpu] submit failed without fallback:",
        error instanceof Error ? error.message : error,
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
      await adapter.cloud.result(jobId, scope);
      await db
        .update(schema.aiStorySceneReleaseStates)
        .set({ gateProviderAttemptId: `result:${jobId}`, updatedAt: new Date() })
        .where(eq(schema.aiStorySceneReleaseStates.sceneExecutionId, release.sceneExecutionId));
      console.warn("[local-gpu] result metadata stored; media bytes are not in the certified result contract");
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
