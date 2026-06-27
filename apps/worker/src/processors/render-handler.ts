import { eq } from "drizzle-orm";
import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, schema } from "@ceo-agent/db";
import { runComplianceAfterRender, maybeFinalizeAutoClipTask, maybeTriggerPendingTaskExport } from "@ceo-agent/agents";
import {
  STORAGE_PATHS,
  baseClipFingerprint,
  renderStatusForMode,
  AUTO_CLIP,
  resolveAutoClipSourceAsset,
  mergeStoredRendition,
  profileKeyForDownloadResolution,
  BrandProfileSchema,
  resolveRenderPreferences,
  stampRenderPreferences,
  type ClipDownloadResolution,
  type RenderMode,
  type RenderProgress,
  type RenderStatus,
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
  /** Single-clip download rendition (1080p / 2k). */
  outputResolution?: ClipDownloadResolution;
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

  await db
    .update(schema.creatives)
    .set({
      renderStatus,
      renderProgress: progress as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(schema.creatives.id, creativeId));

  const creatives = await db
    .select({
      id: schema.creatives.id,
      renderStatus: schema.creatives.renderStatus,
      videoUrl: schema.creatives.videoUrl,
      renderProgress: schema.creatives.renderProgress,
      status: schema.creatives.status,
    })
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId));

  const isMultiClipPreview =
    creatives.length > 1 &&
    (progress.mode === "preview" || progress.mode === "subtitles_only");

  let stepOutput: Record<string, unknown>;

  if (isMultiClipPreview) {
    const total = creatives.length;
    const ready = creatives.filter(
      (c) => c.renderStatus === "preview_ready" && Boolean(c.videoUrl)
    ).length;
    const rendering = creatives.some((c) => c.renderStatus === "preview_rendering");
    const failed = creatives.some(
      (c) =>
        c.status === "failed" ||
        Boolean((c.renderProgress as { error?: string } | null)?.error)
    );
    const allDone = ready === total && total > 0;
    const inFlight = creatives.filter((c) => c.renderStatus === "preview_rendering");
    const inFlightPercent =
      inFlight.reduce((sum, c) => {
        const p = (c.renderProgress as { percent?: number } | null)?.percent ?? 0;
        return sum + p;
      }, 0) / Math.max(inFlight.length, 1);
    const aggregatePercent = allDone
      ? 100
      : Math.min(99, Math.round(((ready + inFlightPercent / 100) / total) * 100));

    stepOutput = {
      status: failed ? "failed" : allDone ? "completed" : "running",
      percent: aggregatePercent,
      phase: allDone ? "done" : rendering ? "render" : "queued",
      mode: progress.mode,
      renderStatus: allDone ? "preview_ready" : "preview_rendering",
      updatedAt: new Date().toISOString(),
      output: { clipCount: total, ready, pending: total - ready },
      ...(allDone ? { completedAt: new Date().toISOString() } : {}),
    };
  } else {
    stepOutput = {
      status: progress.phase === "done" ? "completed" : "running",
      percent: progress.percent,
      phase: progress.phase,
      mode: progress.mode,
      renderStatus,
      updatedAt: new Date().toISOString(),
      ...(progress.phase === "done" ? { completedAt: new Date().toISOString() } : {}),
    };
  }

  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (task) {
    const stepProgress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
    stepProgress.ffmpeg_render = stepOutput;
    await db
      .update(schema.tasks)
      .set({ stepProgress, currentStep: "ffmpeg_render" })
      .where(eq(schema.tasks.id, taskId));
  }
}

export async function processRenderJob(data: RenderJobData): Promise<void> {
  const outputResolution = data.outputResolution;
  const isRenditionJob = Boolean(outputResolution && outputResolution !== "720p");
  const mode: RenderMode = isRenditionJob ? "final" : resolveMode(data);
  const subtitlesOnly = data.mode === "subtitles_only";
  const cacheProfile =
    outputResolution === "2k" ? "2k" : mode === "final" ? "final" : "preview";
  const isPreviewPath = !isRenditionJob && (mode === "preview" || mode === "subtitles_only");
  const profileKey = outputResolution
    ? profileKeyForDownloadResolution(outputResolution)
    : undefined;

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

  const [campaign] = await db
    .select({ metadata: schema.campaigns.metadata })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, data.campaignId))
    .limit(1);

  const rawPlan = creative.editPlan as EditPlan;
  const renderPrefs = resolveRenderPreferences({
    editPlan: rawPlan,
    campaignMetadata: (campaign?.metadata ?? {}) as Record<string, unknown>,
  });
  const editPlan = stampRenderPreferences(rawPlan, renderPrefs);
  const fingerprint = baseClipFingerprint(editPlan);

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, data.workspaceId))
    .limit(1);
  const brandProfile = BrandProfileSchema.safeParse(workspace?.brandProfile ?? {}).data;
  const cacheStoragePath = STORAGE_PATHS.renderCache(
    data.workspaceId,
    data.campaignId,
    data.creativeId,
    fingerprint,
    cacheProfile
  );

  const priorStatus = (creative.renderStatus ?? "none") as RenderStatus;
  const runningStatus: RenderStatus =
    isRenditionJob && outputResolution === "2k"
      ? priorStatus
      : renderStatusForMode(isPreviewPath ? "preview" : "final", true);

  async function pushProgress(percent: number, phase: RenderProgress["phase"]) {
    const progress = {
      percent,
      phase,
      mode,
      updatedAt: new Date().toISOString(),
      ...(outputResolution ? { rendition: outputResolution } : {}),
    };
    if (isRenditionJob && outputResolution === "2k") {
      await db
        .update(schema.creatives)
        .set({ renderProgress: progress, updatedAt: new Date() })
        .where(eq(schema.creatives.id, data.creativeId));
      return;
    }
    await updateRenderState(data.taskId, data.creativeId, progress, runningStatus);
  }

  await pushProgress(0, "queued");

  const workDir = join(
    tmpdir(),
    `render-${data.creativeId}-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await mkdir(workDir, { recursive: true });

  try {
    const onProgress = async (percent: number, phase: RenderProgress["phase"]) => {
      await pushProgress(percent, phase);
    };

    let cachedBaseLocal: string | undefined;
    const canUseCache =
      subtitlesOnly ||
      (creative.renderCachePath === cacheStoragePath &&
        creative.renderCacheFingerprint === fingerprint);

    if (canUseCache || subtitlesOnly) {
      const cacheDownloadPath =
        subtitlesOnly && creative.renderCachePath
          ? creative.renderCachePath
          : cacheStoragePath;
      try {
        cachedBaseLocal = join(workDir, "cached_base.mp4");
        await downloadStorageFile(cacheDownloadPath, cachedBaseLocal);
        await access(cachedBaseLocal);
      } catch {
        if (subtitlesOnly) {
          throw new Error(
            "Cached base clip not found; run full preview render first"
          );
        }
        cachedBaseLocal = undefined;
      }
    }

    const assetMap: RenderAssetMap = new Map();
    const sourceVideo = resolveAutoClipSourceAsset(assets);
    const videoAsset = sourceVideo?.asset;
    const imageAssets = assets.filter((a) => a.type === "image");

    if (!cachedBaseLocal) {
      await onProgress(8, "downloading");
      const downloadOrder = videoAsset
        ? [videoAsset, ...assets.filter((a) => a.id !== videoAsset.id)]
        : assets;
      for (const asset of downloadOrder) {
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
    const effectiveMode: RenderMode =
      cachedBaseLocal && !isRenditionJob && mode !== "final" ? "subtitles_only" : mode;

    let sourceDurationSec = sourceVideo?.durationSec ?? 0;
    if (sourceDurationSec <= 0 && videoAsset && assetMap.has(videoAsset.id)) {
      try {
        sourceDurationSec = (await probeVideo(assetMap.get(videoAsset.id)!.path)).durationSec;
      } catch {
        sourceDurationSec = editPlan.targetDurationSec;
      }
    }

    let logoLocalPath: string | undefined;
    const logoUrl = brandProfile?.logoUrl?.trim();
    if (logoUrl) {
      try {
        logoLocalPath = join(workDir, "brand-logo.png");
        await downloadStorageFile(logoUrl, logoLocalPath);
      } catch (err) {
        console.warn("[render] brand logo download failed, skipping watermark:", err);
        logoLocalPath = undefined;
      }
    }

    const { usedCache } = await renderVideo(
      renderInput,
      editPlan,
      outputLocal,
      effectiveMode,
      {
        cachedBasePath: cachedBaseLocal,
        cacheOutputPath: !cachedBaseLocal && effectiveMode !== "subtitles_only" ? cacheLocal : undefined,
        sourceDurationSec,
        onProgress,
        profileKey,
        logoPath: logoLocalPath,
      }
    );

    if (!usedCache && effectiveMode !== "subtitles_only") {
      await uploadStorageFile(cacheStoragePath, cacheLocal, "video/mp4");
    }

    const outputStoragePath =
      outputResolution === "2k"
        ? STORAGE_PATHS.export2k(data.workspaceId, data.campaignId, data.creativeId)
        : outputResolution === "1080p" || mode === "final"
          ? STORAGE_PATHS.export(data.workspaceId, data.campaignId, data.creativeId)
          : STORAGE_PATHS.preview(data.workspaceId, data.campaignId, data.creativeId);

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
    const doneProgress = {
      percent: 100,
      phase: "done" as const,
      mode,
      updatedAt: new Date().toISOString(),
      ...(outputResolution ? { rendition: outputResolution } : {}),
    };

    if (outputResolution === "2k") {
      const adaptations = mergeStoredRendition(
        (creative.platformAdaptations as Record<string, unknown> | null) ?? {},
        "2k",
        videoUrl
      );
      await db
        .update(schema.creatives)
        .set({
          platformAdaptations: adaptations,
          renderCachePath: cacheStoragePath,
          renderCacheFingerprint: fingerprint,
          renderProgress: doneProgress,
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, data.creativeId));
    } else if (outputResolution === "1080p" || mode === "final") {
      const doneStatus = renderStatusForMode("final", false);
      await db
        .update(schema.creatives)
        .set({
          videoExportUrl: videoUrl,
          renderStatus: doneStatus,
          renderCachePath: cacheStoragePath,
          renderCacheFingerprint: fingerprint,
          renderProgress: doneProgress,
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, data.creativeId));
      await updateRenderState(data.taskId, data.creativeId, doneProgress, doneStatus);
    } else {
      const doneStatus = renderStatusForMode("preview", false);
      await db
        .update(schema.creatives)
        .set({
          videoUrl,
          coverUrl,
          renderStatus: doneStatus,
          renderCachePath: cacheStoragePath,
          renderCacheFingerprint: fingerprint,
          renderProgress: doneProgress,
          updatedAt: new Date(),
        })
        .where(eq(schema.creatives.id, data.creativeId));
      await updateRenderState(data.taskId, data.creativeId, doneProgress, doneStatus);
    }

    if (isPreviewPath) {
      const siblings = await db
        .select({ id: schema.creatives.id })
        .from(schema.creatives)
        .where(eq(schema.creatives.taskId, data.taskId));
      if (siblings.length >= AUTO_CLIP.CLIP_COUNT) {
        await maybeFinalizeAutoClipTask(data.taskId);
      } else {
        await runComplianceAfterRender(data.taskId, data.creativeId);
      }
    }

    if (mode === "final" && !isRenditionJob) {
      await maybeTriggerPendingTaskExport(data.taskId);
    }
    if (outputResolution === "2k") {
      await maybeTriggerPendingTaskExport(data.taskId);
    }

    console.log(
      `[ffmpeg.render] done creative=${data.creativeId} mode=${mode} rendition=${outputResolution ?? "none"} cache=${!!cachedBaseLocal} task=${data.taskId}`
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Render validation failed: voiceover or subtitles incomplete.";
    console.error(`[ffmpeg.render] failed creative=${data.creativeId}:`, message);

    await db
      .update(schema.creatives)
      .set({
        status: creative.videoUrl ? creative.status : "failed",
        renderStatus: creative.videoUrl ? "preview_ready" : "none",
        renderProgress: {
          percent: 0,
          phase: "done",
          mode,
          error: message,
          updatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.creatives.id, data.creativeId));

    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, data.taskId)).limit(1);
    if (task) {
      const stepProgress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
      stepProgress.ffmpeg_render = {
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      };
      await db
        .update(schema.tasks)
        .set({ stepProgress, errorMessage: message })
        .where(eq(schema.tasks.id, data.taskId));
    }

    throw err;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
