import { eq } from "drizzle-orm";
import { mkdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, schema, getCampaignAssets } from "@ceo-agent/db";
import {
  buildRenderSpecification,
  runComplianceAfterRender,
  maybeFinalizeAutoClipTask,
  maybeTriggerPendingTaskExport,
  type CompositionResult,
  type RenderSpecification,
} from "@ceo-agent/agents";
import {
  STORAGE_PATHS,
  baseClipFingerprint,
  renderStatusForMode,
  AUTO_CLIP,
  resolveAutoClipSourceAsset,
  mergeStoredRendition,
  profileKeyForDownloadResolution,
  BrandProfileSchema,
  getRenderProfile,
  resolveRenderPreferences,
  stampRenderPreferences,
  type ClipDownloadResolution,
  type RenderMode,
  type RenderProgress,
  type RenderStatus,
} from "@ceo-agent/shared";
import type { EditPlan } from "@ceo-agent/shared";
import { downloadStorageFile, uploadStorageFile, publicStorageUrl } from "../storage";
import { selectRenderProvider } from "../render-providers";
import {
  renderFingerprint,
  type RenderProviderCapability,
} from "../render-providers/contracts";

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
  retryAttempt?: number;
}

function resolveMode(data: RenderJobData): RenderMode {
  if (data.mode) return data.mode;
  return data.resolution === "export" ? "final" : "preview";
}

function resolveRenderSpecification(
  stepProgress: Record<string, unknown>,
  creativeId: string,
  editPlan: EditPlan
): RenderSpecification {
  const compositionStep = stepProgress.VIDEO_COMPOSITION_COMPLETE as
    | { output?: CompositionResult }
    | undefined;
  const canonical = compositionStep?.output?.creativeDrafts.find(
    (draft) => draft.creativeId === creativeId
  )?.renderSpecification;
  // Historical tasks predate PR-3A.3 and require a compatibility projection.
  return canonical ?? buildRenderSpecification(editPlan);
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
  const [renderTask] = await db
    .select({ stepProgress: schema.tasks.stepProgress })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, data.taskId))
    .limit(1);

  const assets = await getCampaignAssets(db, data.campaignId, data.workspaceId);
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

    const assetMap = new Map<
      string,
      { path: string; type: "video" | "image" }
    >();
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

    if (assetMap.size === 0 && !cachedBaseLocal) {
      throw new Error("No downloadable assets");
    }

    const outputLocal = join(workDir, "output.mp4");
    const cacheLocal = join(workDir, "cache_base.mp4");
    const effectiveMode: RenderMode =
      cachedBaseLocal && !isRenditionJob && mode !== "final" ? "subtitles_only" : mode;

    const sourceDurationSec = sourceVideo?.durationSec ?? 0;

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

    const outputStoragePath =
      outputResolution === "2k"
        ? STORAGE_PATHS.export2k(data.workspaceId, data.campaignId, data.creativeId)
        : outputResolution === "1080p" || mode === "final"
          ? STORAGE_PATHS.export(data.workspaceId, data.campaignId, data.creativeId)
          : STORAGE_PATHS.preview(data.workspaceId, data.campaignId, data.creativeId);
    const coverLocal =
      isPreviewPath && !creative.coverUrl
        ? join(workDir, "cover.jpg")
        : undefined;
    const firstImage = imageAssets[0];
    const renderSpecification = resolveRenderSpecification(
      (renderTask?.stepProgress as Record<string, unknown> | null) ?? {},
      data.creativeId,
      editPlan
    );
    const profile = getRenderProfile(
      profileKey ??
        (effectiveMode === "subtitles_only" ? "preview" : effectiveMode)
    );
    const requiredCapabilities: RenderProviderCapability[] = [
      videoAsset ? "VIDEO" : "IMAGE",
      "CACHE",
      ...(editPlan.subtitles.length > 0 ? (["SUBTITLES"] as const) : []),
      ...(editPlan.audio.voiceover?.enabled ? (["VOICEOVER"] as const) : []),
      ...(editPlan.audio.bgm && editPlan.audio.bgm !== "none"
        ? (["BGM"] as const)
        : []),
      ...(logoLocalPath ? (["BRAND_OVERLAY"] as const) : []),
      ...(coverLocal ? (["COVER"] as const) : []),
    ];
    const renderResult = await selectRenderProvider(requiredCapabilities).render(
      {
        contractVersion: "1",
        renderSpecification,
        sourceAssets: [...assetMap.entries()].map(([assetId, asset]) => ({
          assetId,
          uri: asset.path,
          mediaType: asset.type,
        })),
        outputProfile: {
          mode: effectiveMode,
          resolution: outputResolution,
          profileKey,
        },
        qualityProfile: {
          width: profile.width,
          height: profile.height,
          frameRate: renderSpecification.output.frameRate,
          videoBitrateKbps:
            effectiveMode === "preview"
              ? renderSpecification.output.videoBitrateTargetsKbps.preview
              : renderSpecification.output.videoBitrateTargetsKbps.export,
          audioBitrateKbps: renderSpecification.output.audio.bitrateKbps,
        },
        retry: {
          attempt: data.retryAttempt ?? 1,
          deterministicKey: renderFingerprint({
            creativeId: data.creativeId,
            mode: effectiveMode,
            outputResolution,
            renderSpecification: renderSpecification.deterministicKey,
          }),
          cachedOutputUri: cachedBaseLocal,
        },
        correlation: {
          taskId: data.taskId,
          creativeId: data.creativeId,
          campaignId: data.campaignId,
          workspaceId: data.workspaceId,
          orgId: data.orgId,
          correlationId: `${data.taskId}:${data.creativeId}:${mode}`,
        },
        destinations: {
          outputUri: outputLocal,
          cacheOutputUri:
            !cachedBaseLocal && effectiveMode !== "subtitles_only"
              ? cacheLocal
              : undefined,
          coverOutputUri: coverLocal,
        },
        cachedBaseUri: cachedBaseLocal,
        sourceDurationSec,
        cover: coverLocal
          ? {
              sourceAssetId:
                !videoAsset && firstImage ? firstImage.id : videoAsset?.id,
              atSec: editPlan.cover.atSec,
            }
          : undefined,
        branding: logoLocalPath ? { logoUri: logoLocalPath } : undefined,
        legacyEditPlan: editPlan,
      },
      onProgress
    );
    const usedCache = renderResult.usedCache;

    if (!usedCache && effectiveMode !== "subtitles_only") {
      await uploadStorageFile(cacheStoragePath, cacheLocal, "video/mp4");
    }

    await onProgress(92, "upload");
    await uploadStorageFile(outputStoragePath, outputLocal, "video/mp4");

    let coverUrl = creative.coverUrl;
    if (coverLocal) {
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
