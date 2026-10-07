import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { CanonicalExecuteError } from "./authorize-and-execute-execution-plan";

/**
 * Explicit LOCAL_GPU uses the package Manual Local already froze.
 * The release mode is the Railway work marker. It does not select Seedance.
 */
export async function bindExplicitLocalGpuRelease(input: {
  readonly workspaceId: string;
  readonly executionPlanId: string;
}): Promise<{ readonly packageId: string; readonly sceneExecutionId: string }> {
  const db = getDb();
  const [row] = await db
    .select({
      sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId,
      executionMode: schema.aiStorySceneReleaseStates.executionMode,
      releaseState: schema.aiStorySceneReleaseStates.releaseState,
      packageId: schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
    })
    .from(schema.aiStorySceneReleaseStates)
    .where(and(
      eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
      eq(schema.aiStorySceneReleaseStates.executionPlanId, input.executionPlanId),
      eq(schema.aiStorySceneReleaseStates.sceneOrder, 1),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    ))
    .limit(1);
  if (!row?.packageId) {
    throw new CanonicalExecuteError(
      "LOCAL_GPU_EXECUTION_PACKAGE_REQUIRED",
      "Explicit LOCAL_GPU requires the frozen execution package",
    );
  }
  if (row.executionMode === "REMOTE_PROVIDER") {
    throw new CanonicalExecuteError(
      "LOCAL_GPU_EXECUTION_PACKAGE_REQUIRED",
      "Explicit LOCAL_GPU cannot take over a remote provider release",
    );
  }
  if (row.executionMode === "LOCAL_GPU") {
    return { packageId: row.packageId, sceneExecutionId: row.sceneExecutionId };
  }
  if (row.executionMode !== "MANUAL_LOCAL") {
    throw new CanonicalExecuteError(
      "LOCAL_GPU_EXECUTION_PACKAGE_REQUIRED",
      "Explicit LOCAL_GPU requires the current released package",
    );
  }
  const updated = await db
    .update(schema.aiStorySceneReleaseStates)
    .set({ executionMode: "LOCAL_GPU", updatedAt: new Date() })
    .where(and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, row.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
      eq(schema.aiStorySceneReleaseStates.executionMode, "MANUAL_LOCAL"),
    ))
    .returning({ sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId });
  if (updated.length === 0) {
    throw new CanonicalExecuteError(
      "LOCAL_GPU_EXECUTION_PACKAGE_REQUIRED",
      "Explicit LOCAL_GPU release marker was not accepted",
    );
  }
  return { packageId: row.packageId, sceneExecutionId: row.sceneExecutionId };
}

/**
 * Railway decision for one claimed LOCAL_GPU release.
 * A stored job id never submits again. Failure never selects another provider.
 */
export function localGpuQueuedAction(
  gateProviderAttemptId: string | null,
  state?: string | null,
): "submit" | "poll" | "stop" | "finalize" {
  if (!gateProviderAttemptId) return "submit";
  if (
    gateProviderAttemptId.startsWith("failed:")
    || gateProviderAttemptId.startsWith("completed:")
    || gateProviderAttemptId.startsWith("result:")
  ) {
    return "stop";
  }
  if (state === "FAILED" || state === "CANCELLED") return "stop";
  if (state === "COMPLETED") return "finalize";
  return "poll";
}
