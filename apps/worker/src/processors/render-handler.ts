import { eq } from "drizzle-orm";
import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, schema } from "@ceo-agent/db";
import { runComplianceAfterRender } from "@ceo-agent/agents";
import {
  STORAGE_PATHS,
  baseClipFingerprint,
  renderStatusForMode,
  type RenderMode,
  type RenderProgress,
} from "@ceo-agent/shared";
import type { EditPlan } from "@ceo-agent/shared";
import {
  renderVideo,
  extractCover,
  extractCoverFromImage,
  probeVideo,
  type RenderAssetMap,
} from "../ffmpeg/pipeline";
import { downloadStorageFile, uploadStorageFile, publicStorageUrl } from "../storage";

export interface RenderJobData {
  taskId: string;
  creativeId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
  mode?: RenderMode;
  /** @deprecated use mode */
  resolution?: "preview" | "export";
}

function resolveMode(data: RenderJobData): RenderMode {
  if (data.mode) return data.mode;
  return data.resolution === "export" ? "final" : "preview";
}

async function updateRenderState(
  taskId: string,
  creativeId: string,
  progress: RenderProgress,
  renderStatus: ReturnType<typeof renderStatusForMode>
) {
  const db = getDb();
  const stepOutput = {
    status: progress.phase === "done" ? "completed" : "running",
    percent: progress.percent,
    phase: progress.phase,
    mode: progress.mode,
    renderStatus,
    updatedAt: new Date().toISOString(),
    ...(progress.phase === "done" ? { completedAt: new Date().toISOString() } : {}),
  };

  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (task) {
    const stepProgress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
    stepProgress.ffmpeg_render = stepOutput;
    await db
      .update(schema.tasks)
      .set({ stepProgress, currentStep: "ffmpeg_render" })
      .where(eq(schema.tasks.id, taskId));
  }

  await db
    .update(schema.creatives)
    .set({
      renderStatus,
      renderProgress: progress,
      updatedAt: new Date(),
    })
    .where(eq(schema.creatives.id, creativeId));
}

export async function processRenderJob(data: RenderJobData): Promise<void> {
  const mode = resolveMode(data);
  const cacheProfile = mode === "final" ? "final" : "preview";
  const isPreviewPath = mode === "preview" || mode === "subtitles_only";

  const db = getDb();
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, data.creativeId))
    .limit(1);
  if (!creative?.editPlan) throw new Error("Edit plan not found");

  const assets = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.campaignId, data.campaignId));
  if (assets.length === 0) throw new Error("No source asset");

  const editPlan = creative.editPlan as EditPlan;
  const fingerprint = baseClipFingerprint(editPlan);
  const cacheStoragePath = STORAGE_PATHS.renderCache(
    data.workspaceId,
    data.campaignId,
    data.creativeId,
    fingerprint,
    cacheProfile
  );

  const runningStatus = renderStatusForMode(isPreviewPath ? "preview" : "final", true);
  await updateRenderState(data.taskId, data.creativeId, {
    percent: 0,
    phase: "queued",
    mode,
    updatedAt: new Date().toISOString(),
  }, runningStatus);

  const workDir = join(tmpdir(), `render-${data.creativeId}-${mode}`);
  await mkdir(workDir, { recursive: true });

  try {
    const onProgress = async (percent: number, phase: RenderProgress["phase"]) => {
      await updateRenderState(
        data.taskId,
        data.creativeId,
        { percent, phase, mode, updatedAt: new Date().toISOString() },
        runningStatus
      );
    };

    let cachedBaseLocal: string | undefined;
    const canUseCache =
      mode === "subtitles_only" ||
      (creative.renderCachePath === cacheStoragePath &&
        creative.renderCacheFingerprint === fingerprint);

    if (canUseCache || mode === "subtitles_only") {
      try {
        cachedBaseLocal = join(workDir, "cached_base.mp4");
        await downloadStorageFile(cacheStoragePath, cachedBaseLocal);
        await access(cachedBaseLocal);
      } catch {
        if (mode === "subtitles_only") {
          throw new Error("Cached base clip not found; run full preview render first");
        }
        cachedBaseLocal = undefined;
      }
    }

    const assetMap: RenderAssetMap = new Map();
    const videoAsset = assets.find((a) => a.type === "video");
    const imageAssets = assets.filter((a) => a.type === "image");

    if (!cachedBaseLocal) {
      await onProgress(8, "downloading");
      for (const asset of assets) {
        const ext = asset.storagePath.split(".").pop() ?? "bin";
        const localPath = join(workDir, `${asset.id}.${ext}`);
        await downloadStorageFile(asset.storagePath, localPath);
        assetMap.set(asset.id, {
          path: localPath,
          type: asset.type as "video" | "image",
        });
      }
    }

    const renderInput: RenderAssetMap = assetMap;
    if (renderInput.size === 0 && !cachedBaseLocal) {
      throw new Error("No downloadable assets");
    }

    const outputLocal = join(workDir, "output.mp4");
    const cacheLocal = join(workDir, "cache_base.mp4");
    const effectiveMode: RenderMode = cachedBaseLocal && mode !== "final" ? "subtitles_only" : mode;

    let sourceDurationSec = videoAsset?.durationSec ? parseFloat(videoAsset.durationSec) : 0;
    if (sourceDurationSec <= 0 && videoAsset && assetMap.has(videoAsset.id)) {
      try {
        sourceDurationSec = (await probeVideo(assetMap.get(videoAsset.id)!.path)).durationSec;
      } catch {
        sourceDurationSec = editPlan.targetDurationSec;
      }
    }

    const { usedCache } = await renderVideo(
      renderInput,
      editPlan,
      outputLocal,
      effectiveMode,
      {
        cachedBasePath: cachedBaseLocal,
        cacheOutputPath: !cachedBaseLocal && mode !== "subtitles_only" ? cacheLocal : undefined,
        sourceDurationSec,
        onProgress,
      }
    );

    if (!usedCache && mode !== "subtitles_only") {
      await uploadStorageFile(cacheStoragePath, cacheLocal, "video/mp4");
    }

    const outputStoragePath = isPreviewPath
      ? STORAGE_PATHS.preview(data.workspaceId, data.campaignId, data.creativeId)
      : STORAGE_PATHS.export(data.workspaceId, data.campaignId, data.creativeId);

    await onProgress(92, "upload");
    await uploadStorageFile(outputStoragePath, outputLocal, "video/mp4");

    let coverUrl = creative.coverUrl;
    if (isPreviewPath && !coverUrl) {
      const coverLocal = join(workDir, "cover.jpg");
      const firstImage = imageAssets[0];
      if (!videoAsset && firstImage && assetMap.has(firstImage.id)) {
        await extractCoverFromImage(assetMap.get(firstImage.id)!.path, coverLocal);
      } else {
        const coverSource =
          cachedBaseLocal ??
          (videoAsset ? assetMap.get(videoAsset.id)?.path : assetMap.values().next().value?.path);
        if (!coverSource) throw new Error("No cover source");
        await extractCover(coverSource, editPlan.cover.atSec, coverLocal);
      }
      const coverPath = STORAGE_PATHS.cover(data.workspaceId, data.campaignId, data.creativeId);
      await uploadStorageFile(coverPath, coverLocal, "image/jpeg");
      coverUrl = publicStorageUrl(coverPath);
    }

    const videoUrl = publicStorageUrl(outputStoragePath);
    const doneStatus = renderStatusForMode(isPreviewPath ? "preview" : "final", false);

    const creativeUpdate = isPreviewPath
      ? {
          videoUrl,
          coverUrl,
          renderStatus: doneStatus,
          renderCachePath: cacheStoragePath,
          renderCacheFingerprint: fingerprint,
          renderProgress: { percent: 100, phase: "done" as const, mode, updatedAt: new Date().toISOString() },
        }
      : {
          videoExportUrl: videoUrl,
          renderStatus: doneStatus,
          renderCachePath: cacheStoragePath,
          renderCacheFingerprint: fingerprint,
          renderProgress: { percent: 100, phase: "done" as const, mode, updatedAt: new Date().toISOString() },
        };

    await db.update(schema.creatives).set(creativeUpdate).where(eq(schema.creatives.id, data.creativeId));

    await updateRenderState(
      data.taskId,
      data.creativeId,
      { percent: 100, phase: "done", mode, updatedAt: new Date().toISOString() },
      doneStatus
    );

    if (isPreviewPath) {
      await runComplianceAfterRender(data.taskId, data.creativeId);
    }

    console.log(`[ffmpeg.render] done creative=${data.creativeId} mode=${mode} cache=${!!cachedBaseLocal}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
