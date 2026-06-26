import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueTaskExport } from "@ceo-agent/queue";
import {
  AUTO_CLIP,
  FREE_EXPORT_RESOLUTION,
  PAID_EXPORT_RESOLUTION,
  canDownloadResolution,
  exportPaywallEnabled,
  parseTaskExportResolution,
} from "@ceo-agent/shared";
import {
  count2kRenderProgress,
  countFinalRenderProgress,
  getTaskCreatives,
  setTaskExportRequest,
  type TaskExportRequestState,
} from "@ceo-agent/agents";
import { enqueueFinalRendersForTask, enqueue2kRendersForTask } from "@/lib/render-queue";

type ExportPackOutput = {
  exportPackUrl?: string;
  resolution?: string;
  clipCount?: number;
  filename?: string;
  completedAt?: string;
};

type ExportProgressStep = {
  status?: string;
  output?: ExportPackOutput;
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const resolutionParam = new URL(request.url).searchParams.get("resolution");
    const requestedResolution = resolutionParam
      ? parseTaskExportResolution(resolutionParam, FREE_EXPORT_RESOLUTION)
      : null;

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "client_viewer");

    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, task.orgId))
      .limit(1);

    const progress = (task.stepProgress ?? {}) as Record<string, ExportProgressStep | unknown>;
    const exportPacks = (progress.export_packs ?? {}) as Record<string, ExportProgressStep>;
    const exportRequest = progress.export_request as ExportProgressStep | undefined;
    const exportRequestState = exportRequest?.output as TaskExportRequestState | undefined;

    let packOutput: ExportPackOutput | undefined;
    if (requestedResolution) {
      const packStep = exportPacks[requestedResolution];
      if (packStep?.status === "completed" && packStep.output?.exportPackUrl) {
        packOutput = packStep.output;
      }
    }
    if (!packOutput) {
      const legacy = (progress.export_pack as ExportProgressStep | undefined)?.output;
      if (legacy?.exportPackUrl) {
        if (!requestedResolution || legacy.resolution === requestedResolution) {
          packOutput = legacy;
        }
      }
    }

    const exportPackUrl = packOutput?.exportPackUrl ?? null;
    const exportedResolution = packOutput?.resolution ?? null;
    const exportPackFilename = packOutput?.filename ?? null;

    const readyResolutions = Object.entries(exportPacks)
      .filter(([, step]) => step.status === "completed" && step.output?.exportPackUrl)
      .map(([resolution]) => resolution);

    const creatives = await getTaskCreatives(id);
    const renderProgress = countFinalRenderProgress(creatives);
    const rendition2kProgress = count2kRenderProgress(creatives);

    const allPreviewReady =
      creatives.length >= AUTO_CLIP.CLIP_COUNT &&
      renderProgress.previewReady >= AUTO_CLIP.CLIP_COUNT;

    const allFinalReady =
      creatives.length >= AUTO_CLIP.CLIP_COUNT &&
      renderProgress.finalReady >= AUTO_CLIP.CLIP_COUNT;

    const all2kReady =
      creatives.length >= AUTO_CLIP.CLIP_COUNT &&
      rendition2kProgress.ready >= AUTO_CLIP.CLIP_COUNT;

    const paid1080p = canDownloadResolution(org?.plan, "1080p");
    const paid2k = canDownloadResolution(org?.plan, "2k");

    let status: "none" | "final_rendering" | "export_pending" | "ready" | "failed" = "none";
    if (exportPackUrl) {
      status = "ready";
    } else if (
      exportRequest?.status === "exporting" &&
      (!requestedResolution || exportRequestState?.resolution === requestedResolution)
    ) {
      status = "export_pending";
    } else if (
      exportRequest?.status === "pending_final" &&
      (!requestedResolution || exportRequestState?.resolution === requestedResolution)
    ) {
      status = "final_rendering";
    } else if (
      renderProgress.finalRendering > 0 ||
      rendition2kProgress.rendering > 0
    ) {
      status = "final_rendering";
    } else if (exportRequest?.status === "failed") {
      status = "failed";
    }

    return apiSuccess({
      taskStatus: task.status,
      orgPlan: org?.plan ?? "free",
      canExport1080p: paid1080p,
      canExport2k: paid2k,
      exportPaywallEnabled: exportPaywallEnabled(),
      exportPackUrl,
      exportedResolution,
      exportPackFilename,
      readyResolutions,
      exportRequest: exportRequestState,
      status,
      clipCount: creatives.length,
      allClipsReady: allPreviewReady,
      allFinalReady,
      all2kReady,
      finalRenderProgress: renderProgress,
      rendition2kProgress,
      canExport:
        allPreviewReady &&
        status !== "final_rendering" &&
        status !== "export_pending",
      creatives: creatives.map((c, index) => ({
        id: c.id,
        index: index + 1,
        status: c.status,
        renderStatus: c.renderStatus,
        videoUrl: c.videoUrl,
        videoExportUrl: c.videoExportUrl,
        coverUrl: c.coverUrl,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { platforms, resolution: resolutionRaw } = body as {
      platforms?: string[];
      resolution?: string;
    };

    const resolution = parseTaskExportResolution(resolutionRaw, FREE_EXPORT_RESOLUTION);

    const db = getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).limit(1);
    if (!task) return apiError("Task not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(task.workspaceId, user.id, "publisher");

    const [org] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, task.orgId))
      .limit(1);

    const paidResolution = resolution === "2k" ? "2k" : resolution === PAID_EXPORT_RESOLUTION ? "1080p" : null;
    if (paidResolution && !canDownloadResolution(org?.plan, paidResolution)) {
      return apiError(
        `${resolution} export requires a paid plan. Upgrade to Pro or export 720p preview.`,
        "UPGRADE_REQUIRED",
        403
      );
    }

    const creatives = await getTaskCreatives(id);
    const renderProgress = countFinalRenderProgress(creatives);
    const rendition2kProgress = count2kRenderProgress(creatives);

    const allPreviewReady =
      creatives.length >= AUTO_CLIP.CLIP_COUNT &&
      renderProgress.previewReady >= AUTO_CLIP.CLIP_COUNT;

    if (!allPreviewReady) {
      return apiError(
        "Not all clips are ready yet. Wait for rendering to finish.",
        "VALIDATION_ERROR",
        409
      );
    }

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, task.campaignId))
      .limit(1);

    const exportPlatforms = platforms ?? campaign?.platforms ?? ["tiktok"];
    const requestedAt = new Date().toISOString();

    if (resolution === "2k") {
      const all2kReady = rendition2kProgress.ready >= AUTO_CLIP.CLIP_COUNT;

      if (!all2kReady) {
        const { enqueued, rendering } = await enqueue2kRendersForTask(id);

        await setTaskExportRequest(id, {
          resolution: "2k",
          status: "pending_final",
          requestedAt,
        });

        return apiSuccess(
          {
            taskId: id,
            status: "final_rendering",
            message:
              enqueued > 0
                ? `Rendering ${enqueued} clip(s) in 2K. Export will start automatically when done.`
                : "2K renders in progress. Export will start automatically when done.",
            rendition2kProgress: count2kRenderProgress(await getTaskCreatives(id)),
            rendering,
          },
          202
        );
      }
    } else if (resolution === PAID_EXPORT_RESOLUTION) {
      const allFinalReady = renderProgress.finalReady >= AUTO_CLIP.CLIP_COUNT;

      if (!allFinalReady) {
        const { enqueued, rendering } = await enqueueFinalRendersForTask(id);

        await setTaskExportRequest(id, {
          resolution: PAID_EXPORT_RESOLUTION,
          status: "pending_final",
          requestedAt,
        });

        return apiSuccess(
          {
            taskId: id,
            status: "final_rendering",
            message:
              enqueued > 0
                ? `Rendering ${enqueued} clip(s) in 1080p. Export will start automatically when done.`
                : "1080p renders in progress. Export will start automatically when done.",
            finalRenderProgress: countFinalRenderProgress(await getTaskCreatives(id)),
            rendering,
          },
          202
        );
      }
    }

    await setTaskExportRequest(id, {
      resolution,
      status: "exporting",
      requestedAt,
    });

    await enqueueTaskExport({
      taskId: id,
      workspaceId: task.workspaceId,
      orgId: task.orgId,
      campaignId: task.campaignId,
      platforms: exportPlatforms,
      resolution,
    });

    return apiSuccess({ taskId: id, status: "export_pending", resolution }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task export enqueue failed";
    if (/ECONNREFUSED|Redis|redis/i.test(message)) {
      return apiError(
        "Redis is not running. Start Redis, then run pnpm worker:dev.",
        "REDIS_UNAVAILABLE",
        503
      );
    }
    return handleApiError(error);
  }
}
