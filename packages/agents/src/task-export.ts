import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueTaskExport } from "@ceo-agent/queue";
import {
  AUTO_CLIP,
  FREE_EXPORT_RESOLUTION,
  PAID_EXPORT_RESOLUTION,
  boundOpsDiagnosticMessage,
  type RenderStatus,
  type TaskExportResolution,
  type StepProgress,
} from "@ceo-agent/shared";

const TASK_EXPORT_READY_RENDER_STATUSES = new Set<RenderStatus>([
  "preview_ready",
  "final_ready",
]);

/** Preview or final rendition is terminal-ready for task ZIP export. Fail-closed otherwise. */
export function isCreativeReadyForTaskExport(
  renderStatus: string | null | undefined
): boolean {
  return TASK_EXPORT_READY_RENDER_STATUSES.has(renderStatus as RenderStatus);
}

/** Complete three-output package with usable 720p artifacts. Missing/in-flight/failed denied. */
export function isTaskPackageReadyForFreeExport(
  creatives: Array<{ renderStatus: string | null; videoUrl: string | null }>
): boolean {
  if (creatives.length < AUTO_CLIP.CLIP_COUNT) return false;
  const ready = creatives.filter(
    (c) => isCreativeReadyForTaskExport(c.renderStatus) && Boolean(c.videoUrl)
  ).length;
  return ready >= AUTO_CLIP.CLIP_COUNT;
}

export interface TaskExportRequestState {
  resolution: TaskExportResolution;
  status: "pending_final" | "exporting" | "completed" | "failed";
  requestedAt: string;
  error?: string;
}

export async function getTaskCreatives(taskId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId))
    .orderBy(schema.creatives.createdAt);
}

export function countFinalRenderProgress(
  creatives: Array<{ renderStatus: string | null; videoExportUrl: string | null; videoUrl: string | null }>
) {
  const total = creatives.length;
  const finalReady = creatives.filter(
    (c) => c.renderStatus === "final_ready" && Boolean(c.videoExportUrl)
  ).length;
  const finalRendering = creatives.filter((c) => c.renderStatus === "final_rendering").length;
  const previewReady = creatives.filter(
    (c) => isCreativeReadyForTaskExport(c.renderStatus) && Boolean(c.videoUrl)
  ).length;
  return { total, finalReady, finalRendering, previewReady };
}

type CreativeRenditionRow = {
  renderStatus?: string | null;
  videoUrl: string | null;
  videoExportUrl: string | null;
  platformAdaptations?: Record<string, unknown> | null;
  renderProgress?: { rendition?: string; phase?: string; error?: string } | null;
};

export function count2kRenderProgress(creatives: CreativeRenditionRow[]) {
  const total = creatives.length;
  const ready = creatives.filter((c) => Boolean(pickVideoUrlForExport(c, "2k"))).length;
  const rendering = creatives.filter((c) => {
    const progress = c.renderProgress;
    return (
      progress?.rendition === "2k" &&
      progress.phase !== "done" &&
      !progress.error &&
      !pickVideoUrlForExport(c, "2k")
    );
  }).length;
  return { total, ready, rendering };
}

function allRenditionReady(
  creatives: CreativeRenditionRow[],
  resolution: TaskExportResolution
): boolean {
  if (resolution === FREE_EXPORT_RESOLUTION) {
    return creatives.every((c) => Boolean(c.videoUrl));
  }
  if (resolution === "2k") {
    const { ready, total } = count2kRenderProgress(creatives);
    return total > 0 && ready >= total;
  }
  return countFinalRenderProgress(
    creatives as Array<{
      renderStatus: string | null;
      videoExportUrl: string | null;
      videoUrl: string | null;
    }>
  ).finalReady >= creatives.length;
}

function anyRenditionRendering(
  creatives: CreativeRenditionRow[],
  resolution: TaskExportResolution
): boolean {
  if (resolution === "2k") {
    return count2kRenderProgress(creatives).rendering > 0;
  }
  if (resolution === PAID_EXPORT_RESOLUTION) {
    return countFinalRenderProgress(
      creatives as Array<{
        renderStatus: string | null;
        videoExportUrl: string | null;
        videoUrl: string | null;
      }>
    ).finalRendering > 0;
  }
  return false;
}

/** Pure merge: persist export failure without replacing unrelated stepProgress. */
export function applyTaskExportFailure(
  stepProgress: StepProgress | Record<string, unknown> | null | undefined,
  input: { error: string; resolution?: TaskExportResolution }
): StepProgress {
  const progress: StepProgress = { ...((stepProgress as StepProgress) ?? {}) };
  const priorStep = progress.export_request;
  const prior = priorStep?.output as TaskExportRequestState | undefined;
  const error = boundOpsDiagnosticMessage(input.error);
  const requestedAt = prior?.requestedAt ?? new Date().toISOString();
  const resolution = prior?.resolution ?? input.resolution ?? FREE_EXPORT_RESOLUTION;
  progress.export_request = {
    status: "failed",
    startedAt: priorStep?.startedAt ?? requestedAt,
    completedAt: new Date().toISOString(),
    error,
    output: {
      resolution,
      status: "failed",
      requestedAt,
      error,
    } satisfies TaskExportRequestState,
  };
  return progress;
}

export async function persistTaskExportFailure(input: {
  taskId: string;
  error: string;
  resolution?: TaskExportResolution;
}): Promise<void> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId)).limit(1);
  if (!task) return;
  await db
    .update(schema.tasks)
    .set({
      stepProgress: applyTaskExportFailure(task.stepProgress as StepProgress, {
        error: input.error,
        resolution: input.resolution,
      }),
    })
    .where(eq(schema.tasks.id, input.taskId));
}

export async function setTaskExportRequest(
  taskId: string,
  request: TaskExportRequestState
): Promise<void> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return;

  const progress = { ...((task.stepProgress as StepProgress) ?? {}) };
  progress.export_request = {
    status: request.status === "completed" ? "completed" : "running",
    startedAt: request.requestedAt,
    completedAt: request.status === "completed" ? new Date().toISOString() : undefined,
    output: request,
  };

  await db
    .update(schema.tasks)
    .set({ stepProgress: progress })
    .where(eq(schema.tasks.id, taskId));
}

/** After paid renditions finish, auto-start ZIP if user already requested export. */
export async function maybeTriggerPendingTaskExport(taskId: string): Promise<boolean> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) return false;

  const progress = (task.stepProgress as StepProgress) ?? {};
  const request = progress.export_request?.output as TaskExportRequestState | undefined;
  if (!request || request.status !== "pending_final") {
    return false;
  }

  const resolution = request.resolution;
  if (resolution === FREE_EXPORT_RESOLUTION) return false;

  const creatives = await getTaskCreatives(taskId);
  if (creatives.length < AUTO_CLIP.CLIP_COUNT) return false;

  if (anyRenditionRendering(creatives, resolution)) return false;
  if (!allRenditionReady(creatives, resolution)) return false;

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, task.campaignId))
    .limit(1);

  await setTaskExportRequest(taskId, { ...request, status: "exporting" });

  await enqueueTaskExport({
    taskId,
    workspaceId: task.workspaceId,
    orgId: task.orgId,
    campaignId: task.campaignId,
    platforms: campaign?.platforms ?? ["tiktok"],
    resolution,
  });

  return true;
}

export function pickVideoUrlForExport(
  creative: {
    videoUrl: string | null;
    videoExportUrl: string | null;
    platformAdaptations?: Record<string, unknown> | null;
  },
  resolution: TaskExportResolution
): string | null {
  if (resolution === "2k") {
    const renditions = (creative.platformAdaptations as Record<string, unknown> | undefined)?._renditions as
      | Record<string, string>
      | undefined;
    return renditions?.["2k"] ?? null;
  }
  if (resolution === PAID_EXPORT_RESOLUTION) {
    return creative.videoExportUrl ?? null;
  }
  return creative.videoUrl ?? null;
}

export { FREE_EXPORT_RESOLUTION, PAID_EXPORT_RESOLUTION };
