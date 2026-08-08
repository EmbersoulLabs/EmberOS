import { UnrecoverableError, Worker, type WorkerOptions } from "bullmq";
import { eq, and } from "drizzle-orm";
import { getDb, schema, getCampaignAssets } from "@ceo-agent/db";
import { QUEUE_NAMES, getRedisConnection, getBullmqPrefix, logQueueConfig } from "@ceo-agent/queue";
import {
  failPipelineExecution,
  isVisionAnalysisTimeoutError,
  runPipeline,
  runPublishAgent,
  type PipelineHooks,
} from "@ceo-agent/agents";
import {
  STORAGE_PATHS,
  MAX_UPLOAD_DURATION_SEC,
  MAX_PROCESSED_SIZE_BYTES,
  assessFinishedAdRisk,
  sumUploadVideoDurationSec,
  validateCombinedVideoDurationSec,
  platformPublishCopyText,
  encodeCopyExportBody,
  plainTextToDocHtml,
} from "@ceo-agent/shared";
import { createExportZip, probeVideo } from "../ffmpeg/pipeline";
import { processRenderJob } from "./render-handler";
import { processTaskExportJob, musicCreditFor } from "./export-handler";
import { prepareVisionFromStorage } from "../media/vision-prep";
import { ensureMergedSourceVideo } from "../media/merge-source-videos";
import { mediaHasAudio } from "../ffmpeg/probe-audio";
import { compressSourceVideo } from "../ffmpeg/compress-source";
import {
  downloadStorageFile,
  uploadStorageFile,
  publicStorageUrl,
} from "../storage";
import { mkdir, writeFile, readFile, rm, access, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EditPlan, CopyVariant, Platform } from "@ceo-agent/shared";
import { delayPipelineJobForDependencies } from "./dependency-delay";
import { refreshAnalyzedAssetDisplayName } from "../asset-auto-name";
import { processAssetAnalysisJob } from "./asset-analysis-handler";

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10);
/** FFmpeg is memory-heavy — default 1 parallel render on Railway to avoid OOM slot deadlock. */
const renderConcurrency = parseInt(process.env.RENDER_CONCURRENCY ?? "1", 10);
const agentLockMs = parseInt(process.env.AGENT_JOB_LOCK_MS ?? String(15 * 60 * 1000), 10);
const renderLockMs = parseInt(process.env.RENDER_JOB_LOCK_MS ?? String(30 * 60 * 1000), 10);

/** Reduce Upstash command churn when queues are idle (free tier ~500k/month). */
const workerOpts = {
  drainDelay: 5000,
  stalledInterval: 120_000,
  maxStalledCount: 2,
} satisfies Pick<WorkerOptions, "drainDelay" | "stalledInterval" | "maxStalledCount">;

const pipelineHooks: PipelineHooks = {
  prepareVisionMedia: {
    prepare: (input) => prepareVisionFromStorage(input),
  },
};

async function markTaskStepFailed(
  taskId: string,
  stepId: string,
  message: string
): Promise<void> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  // Already terminal or recoverable — do not overwrite (OPS-002 Rule 3).
  if (
    !task ||
    task.status === "failed" ||
    task.status === "completed" ||
    task.status === "retrying"
  ) {
    return;
  }

  const progress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
  const prior = progress[stepId] as Record<string, unknown> | undefined;
  progress[stepId] = {
    ...prior,
    status: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  };

  await db
    .update(schema.tasks)
    .set({
      stepProgress: progress,
      currentStep: stepId,
    })
    .where(eq(schema.tasks.id, taskId));

  await failPipelineExecution({
    taskId,
    campaignId: task.campaignId,
    message,
  });
}

const PIPELINE_STEP_ORDER = [
  "parse_intent",
  "vision_analyze",
  "strategy_plan",
  "ceo_plan",
  "content_classify",
  "highlight_index",
  "content_generate",
  "hook_generate",
  "clip_segment",
  "copy_generate",
  "edit_director_plan",
  "ffmpeg_render",
  "compliance_check",
  "marketing_score",
  "export_ready",
  "human_review",
] as const;

function formatAgentPipelineError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/SIGKILL|signal.*kill/i.test(raw)) {
    return "Video processing ran out of memory on the server. Try fewer or shorter uploads, then run again.";
  }
  if (/video-concat|merge-source|concatVideoFiles|ensureMerged/i.test(raw)) {
    return "Failed to merge uploaded videos into one source clip.";
  }
  const firstLine = raw.split("\n")[0]?.trim() ?? raw;
  return firstLine.length > 500 ? `${firstLine.slice(0, 497)}...` : firstLine;
}

function resolveAgentFailureStep(
  message: string,
  progress: Record<string, { status?: string }>
): string {
  if (/video-concat|merge-source|concatVideoFiles|ensureMerged/i.test(message)) {
    return "parse_intent";
  }
  for (const step of PIPELINE_STEP_ORDER) {
    if (progress[step]?.status === "running") return step;
  }
  for (let i = PIPELINE_STEP_ORDER.length - 1; i >= 0; i--) {
    const step = PIPELINE_STEP_ORDER[i]!;
    if (progress[step]?.status === "completed") {
      return PIPELINE_STEP_ORDER[i + 1] ?? step;
    }
  }
  return "parse_intent";
}

export function startWorkers() {
  const connection = getRedisConnection();
  const prefix = getBullmqPrefix();
  logQueueConfig();

  const agentWorker = new Worker(
    QUEUE_NAMES.AGENT,
    async (job) => {
      if (job.name === "agent.pipeline") {
        const { taskId } = job.data as { taskId: string };
        console.log(`[agent.pipeline] start task=${taskId}`);
        await ensureMergedSourceVideo(taskId);
        let result;
        try {
          result = await runPipeline(taskId, pipelineHooks);
        } catch (error) {
          // The pipeline has already persisted the terminal timeout state. Do not
          // let BullMQ repeat the same provider call for a terminal task.
          if (isVisionAnalysisTimeoutError(error)) {
            throw new UnrecoverableError(error.message);
          }
          throw error;
        }
        await refreshAnalyzedAssetDisplayName(taskId);
        const queued =
          result &&
          typeof result === "object" &&
          "status" in result &&
          (result as { status?: string }).status === "render_queued";
        const waitingForDependency =
          result &&
          typeof result === "object" &&
          "status" in result &&
          (result as { status?: string }).status === "waiting_for_dependency";
        if (waitingForDependency) {
          const delayMs = parseInt(
            process.env.PIPELINE_DEPENDENCY_RECHECK_MS ?? "5000",
            10
          );
          console.log(
            `[agent.pipeline] dependencies pending; delayed ${delayMs}ms task=${taskId}`
          );
          await delayPipelineJobForDependencies(job, delayMs);
        }
        if (queued) {
          const meta = result as { creativeIds?: string[]; creativeId?: string };
          const count = meta.creativeIds?.length ?? (meta.creativeId ? 1 : 0);
          console.log(
            `[agent.pipeline] planning complete — ${count} ffmpeg.render job(s) queued task=${taskId} (videos not ready yet)`
          );
        } else {
          console.log(`[agent.pipeline] finished task=${taskId}`);
        }
      }
      if (job.name === "agent.story_execution") {
        const { assertPhase1ExecutionLocked } = await import("@ceo-agent/shared");
        assertPhase1ExecutionLocked();

        const { executionJobId } = job.data as { executionJobId: string };
        console.log(`[agent.story_execution] start job=${executionJobId}`);
        const { runExecutionJob } = await import("@ceo-agent/agents");
        await runExecutionJob(executionJobId);
        console.log(`[agent.story_execution] finished job=${executionJobId}`);
      }
    },
    { connection, prefix, concurrency, lockDuration: agentLockMs, ...workerOpts }
  );

  const assetAnalysisWorker = new Worker(
    QUEUE_NAMES.ASSET_ANALYSIS,
    async (job) => {
      if (job.name !== "asset.analysis") return;
      const data = job.data as { assetId: string; workspaceId: string };
      console.log(
        `[asset-analysis] start job=${job.id} asset=${data.assetId} attempt=${job.attemptsMade + 1}`
      );
      const result = await processAssetAnalysisJob(data, job.attemptsMade + 1);
      console.log(
        `[asset-analysis] ${result.status} job=${job.id} asset=${data.assetId}`
      );
    },
    {
      connection,
      prefix,
      concurrency: Math.max(1, Math.min(concurrency, 3)),
      lockDuration: agentLockMs,
      ...workerOpts,
    }
  );

  const probeWorker = new Worker(
    QUEUE_NAMES.PROBE,
    async (job) => {
      if (job.name !== "ffmpeg.probe") return;
      const { assetId, storagePath } = job.data as {
        assetId: string;
        storagePath: string;
      };

      const db = getDb();
      const workDir = join(tmpdir(), `probe-${assetId}`);
      await mkdir(workDir, { recursive: true });

      try {
        const localPath = join(workDir, "input.bin");
        await downloadStorageFile(storagePath, localPath);

        const probe = await probeVideo(localPath);
        const [assetRow] = await db
          .select()
          .from(schema.assets)
          .where(eq(schema.assets.id, assetId))
          .limit(1);
        const meta = (assetRow?.metadata ?? {}) as Record<string, unknown>;
        const filename = String(meta.originalFilename ?? storagePath.split("/").pop() ?? "");
        const hasAudio = await mediaHasAudio(localPath);
        const finishedAdRisk = assessFinishedAdRisk({
          type: "video",
          filename,
          width: probe.width,
          height: probe.height,
          durationSec: probe.durationSec,
          hasAudio,
        });

        if (probe.durationSec > MAX_UPLOAD_DURATION_SEC) {
          await db
            .update(schema.assets)
            .set({
              metadata: {
                ...meta,
                codec: probe.codec,
                rejected: true,
                reason: `Video exceeds ${MAX_UPLOAD_DURATION_SEC}s limit`,
                finishedAdRisk,
              },
            })
            .where(eq(schema.assets.id, assetId));
          throw new Error(`Video duration ${probe.durationSec.toFixed(1)}s exceeds ${MAX_UPLOAD_DURATION_SEC}s MVP limit`);
        }

        // Auto-compress large uploads to ≤480MB so all downstream reads stay fast.
        const { size: rawBytes } = await stat(localPath);
        let finalFileSizeBytes = rawBytes;
        let compressedMeta: Record<string, unknown> = {};
        if (rawBytes > MAX_PROCESSED_SIZE_BYTES) {
          const originalMB = (rawBytes / 1024 / 1024).toFixed(0);
          console.log(`[probe] ${assetId} is ${originalMB}MB — compressing to ≤480MB…`);
          const compressedPath = join(workDir, "compressed.mp4");
          const result = await compressSourceVideo(localPath, compressedPath, probe.durationSec);
          const compressedMB = (result.outputBytes / 1024 / 1024).toFixed(0);
          console.log(`[probe] compressed ${originalMB}MB → ${compressedMB}MB — re-uploading…`);
          await uploadStorageFile(storagePath, compressedPath, "video/mp4");
          finalFileSizeBytes = result.outputBytes;
          compressedMeta = { compressedFromBytes: rawBytes };
        }

        await db
          .update(schema.assets)
          .set({
            durationSec: String(probe.durationSec),
            width: probe.width,
            height: probe.height,
            fileSizeBytes: finalFileSizeBytes,
            metadata: { ...meta, codec: probe.codec, finishedAdRisk, ...compressedMeta },
          })
          .where(eq(schema.assets.id, assetId));

        // Resolve campaign via refs (PD-036) or legacy campaignId
        let campaignIdForLimits = assetRow?.campaignId ?? null;
        if (!campaignIdForLimits && assetRow?.workspaceId) {
          const [ref] = await db
            .select({ campaignId: schema.campaignAssetRefs.campaignId })
            .from(schema.campaignAssetRefs)
            .where(eq(schema.campaignAssetRefs.assetId, assetId))
            .limit(1);
          campaignIdForLimits = ref?.campaignId ?? null;
        }

        if (campaignIdForLimits && assetRow?.workspaceId) {
          const campaignAssets = await getCampaignAssets(
            db,
            campaignIdForLimits,
            assetRow.workspaceId
          );
          const combined = sumUploadVideoDurationSec(campaignAssets);
          const combinedCheck = validateCombinedVideoDurationSec(combined);
          if (!combinedCheck.ok) {
            await db
              .update(schema.assets)
              .set({
                metadata: {
                  ...meta,
                  codec: probe.codec,
                  rejected: true,
                  reason: combinedCheck.error,
                  finishedAdRisk,
                },
              })
              .where(eq(schema.assets.id, assetId));
            throw new Error(combinedCheck.error);
          }
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    { connection, prefix, concurrency: 5, lockDuration: 5 * 60 * 1000, ...workerOpts }
  );

  const renderWorker = new Worker(
    QUEUE_NAMES.RENDER,
    async (job) => {
      if (job.name !== "ffmpeg.render") return;
      const data = job.data as { taskId: string; creativeId: string };
      console.log(
        `[ffmpeg.render] start job=${job.id} task=${data.taskId} creative=${data.creativeId} attempt=${job.attemptsMade + 1}`
      );
      await processRenderJob({
        ...(job.data as Parameters<typeof processRenderJob>[0]),
        retryAttempt: job.attemptsMade + 1,
      });
    },
    { connection, prefix, concurrency: renderConcurrency, lockDuration: renderLockMs, ...workerOpts }
  );

  const exportWorker = new Worker(
    QUEUE_NAMES.EXPORT,
    async (job) => {
      if (job.name === "ffmpeg.export_task") {
        await processTaskExportJob(
          job.data as {
            taskId: string;
            workspaceId: string;
            orgId: string;
            campaignId: string;
            platforms: string[];
          }
        );
        return;
      }

      if (job.name !== "ffmpeg.export") return;
      const data = job.data as {
        creativeId: string;
        workspaceId: string;
        orgId: string;
        campaignId: string;
        platforms: string[];
      };

      const db = getDb();
      const [creative] = await db
        .select()
        .from(schema.creatives)
        .where(eq(schema.creatives.id, data.creativeId))
        .limit(1);
      if (!creative) throw new Error("Creative not found");

      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, data.campaignId))
        .limit(1);

      const variants = (creative.copyVariants ?? []) as CopyVariant[];
      const exportPack = runPublishAgent({
        creativeId: data.creativeId,
        platforms: (data.platforms.length ? data.platforms : campaign?.platforms ?? ["tiktok"]) as Platform[],
        copyVariants: variants,
        selectedCopyId: creative.selectedCopyId ?? variants[0]?.id ?? "v1",
        videoFile: "video_9x16_1080p.mp4",
        coverFile: "cover.jpg",
      });

      const workDir = join(tmpdir(), `export-${data.creativeId}`);
      await mkdir(workDir, { recursive: true });

      try {
        const exportPath = creative.videoExportUrl ?? creative.videoUrl;
        if (!exportPath) throw new Error("No video URL on creative");

        const videoLocal = join(workDir, "video_9x16_1080p.mp4");
        const response = await fetch(exportPath);
        if (!response.ok) {
          throw new Error(
            `Failed to download video for export (${response.status}). Check storage bucket is public or worker can access Supabase.`
          );
        }
        await writeFile(videoLocal, Buffer.from(await response.arrayBuffer()));

        if (creative.coverUrl) {
          const coverLocal = join(workDir, "cover.jpg");
          const coverRes = await fetch(creative.coverUrl);
          if (coverRes.ok) {
            await writeFile(coverLocal, Buffer.from(await coverRes.arrayBuffer()));
          }
        }

        await mkdir(join(workDir, "copy"), { recursive: true });
        const copyZipEntries: { path: string; name: string }[] = [];
        for (const platform of Object.keys(exportPack.platforms)) {
          const p = exportPack.platforms[platform]!;
          const plain = platformPublishCopyText(platform, p);
          if (!plain.trim()) continue;

          const txtPath = join(workDir, "copy", `${platform}_variant.txt`);
          await writeFile(txtPath, encodeCopyExportBody(plain, "txt"));
          copyZipEntries.push({
            path: txtPath,
            name: `export/copy/${platform}_variant.txt`,
          });

          const docPath = join(workDir, "copy", `${platform}_variant.doc`);
          const docHtml = plainTextToDocHtml(plain, `${platform} copy`);
          await writeFile(docPath, encodeCopyExportBody(docHtml, "doc"));
          copyZipEntries.push({
            path: docPath,
            name: `export/copy/${platform}_variant.doc`,
          });
        }

        const credit = musicCreditFor(creative.editPlan);
        await writeFile(
          join(workDir, "metadata.json"),
          JSON.stringify({ ...exportPack, musicCredit: credit }, null, 2)
        );

        await writeFile(
          join(workDir, "CREDITS.txt"),
          `EmberOS — Music Credits\nCreative: ${data.creativeId}\n\n${credit.line}` +
            `${credit.licenseUrl ? `\nLicense: ${credit.licenseUrl}` : ""}\n\n` +
            `Note: CC-BY tracks require crediting the artist when you publish.\n`
        );

        const zipLocal = join(workDir, "pack.zip");
        const zipFiles: { path: string; name: string }[] = [];
        for (const entry of [
          { path: join(workDir, "video_9x16_1080p.mp4"), name: "export/video_9x16_1080p.mp4" },
          { path: join(workDir, "cover.jpg"), name: "export/cover.jpg" },
          ...copyZipEntries,
          { path: join(workDir, "metadata.json"), name: "export/metadata.json" },
          { path: join(workDir, "CREDITS.txt"), name: "export/CREDITS.txt" },
        ]) {
          try {
            await access(entry.path);
            zipFiles.push(entry);
          } catch {
            // skip missing files
          }
        }

        await createExportZip(zipFiles, zipLocal);
        if (!zipFiles.some((f) => f.name.includes("video_9x16"))) {
          throw new Error("Export ZIP missing video file");
        }

        const packPath = STORAGE_PATHS.exportPack(
          data.workspaceId,
          data.campaignId,
          data.creativeId
        );
        await uploadStorageFile(packPath, zipLocal, "application/zip");

        const exportPackUrl = publicStorageUrl(packPath);

        await db.insert(schema.publishJobs).values({
          orgId: data.orgId,
          workspaceId: data.workspaceId,
          creativeId: data.creativeId,
          platform: "export",
          status: "export_ready",
          exportPackUrl,
        });

        await db
          .update(schema.creatives)
          .set({ status: "exported", platformAdaptations: exportPack.platforms })
          .where(eq(schema.creatives.id, data.creativeId));

        await db
          .update(schema.campaigns)
          .set({ status: "export_ready" })
          .where(eq(schema.campaigns.id, data.campaignId));

        console.log(`[ffmpeg.export] done creative=${data.creativeId} url=${exportPackUrl}`);
      } catch (exportErr) {
        const message = exportErr instanceof Error ? exportErr.message : "Export failed";
        try {
          await db.insert(schema.publishJobs).values({
            orgId: data.orgId,
            workspaceId: data.workspaceId,
            creativeId: data.creativeId,
            platform: "export",
            status: "export_failed",
            exportPackUrl: null,
          });
        } catch {
          // ignore duplicate logging failures
        }
        throw new Error(message);
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    { connection, prefix, concurrency, lockDuration: 15 * 60 * 1000, ...workerOpts }
  );

  agentWorker.on("failed", async (job, err) => {
    console.error(`Agent job ${job?.id} failed:`, err);
    if (job?.name !== "agent.pipeline") return;

    const maxAttempts = job.opts.attempts ?? 3;
    if (job.attemptsMade < maxAttempts) return;

    const taskId = (job.data as { taskId?: string })?.taskId;
    if (!taskId) return;

    const db = getDb();
    const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    // Pipeline catch already applied failPipelineExecution (retrying|failed).
    if (
      !task ||
      task.status === "failed" ||
      task.status === "completed" ||
      task.status === "retrying"
    ) {
      return;
    }

    const message = formatAgentPipelineError(err);
    const progress = (task.stepProgress ?? {}) as Record<string, { status?: string }>;
    const stepId = resolveAgentFailureStep(message, progress);
    await markTaskStepFailed(taskId, stepId, message);
  });
  renderWorker.on("stalled", (jobId) => {
    console.warn(`[ffmpeg.render] stalled job=${jobId} — lock expired or worker unresponsive`);
  });
  renderWorker.on("completed", (job) => {
    const data = job.data as { taskId?: string; creativeId?: string };
    console.log(
      `[ffmpeg.render] queue job=${job.id} completed task=${data.taskId} creative=${data.creativeId}`
    );
  });
  renderWorker.on("failed", async (job, err) => {
    const data = job?.data as { taskId?: string; creativeId?: string } | undefined;
    console.error(
      `[ffmpeg.render] failed job=${job?.id} task=${data?.taskId} creative=${data?.creativeId}:`,
      err
    );
    const taskId = (job?.data as { taskId?: string })?.taskId;
    if (taskId) {
      await markTaskStepFailed(
        taskId,
        "ffmpeg_render",
        err instanceof Error ? err.message : "Render failed"
      );
    }
  });
  exportWorker.on("failed", (job, err) => console.error(`Export job ${job?.id} failed:`, err));
  assetAnalysisWorker.on("failed", (job, err) =>
    console.error(`Asset analysis job ${job?.id} failed:`, err)
  );

  console.log(
    `Workers started: agent (concurrency=${concurrency}), asset-analysis, render (concurrency=${renderConcurrency}), probe, export, provider-execution-loop`
  );

  // Production provider outbox cycle (capability-driven dispatch). No-op when empty.
  const providerLoopMs = parseInt(process.env.PROVIDER_EXECUTION_POLL_MS ?? "5000", 10);
  const providerLoop = setInterval(() => {
    void (async () => {
      try {
        const { dispatchNextProviderExecution } = await import(
          "../provider-execution-dispatch-entrypoint"
        );
        await dispatchNextProviderExecution();
      } catch (error) {
        console.warn(
          "[provider-execution] cycle error:",
          error instanceof Error ? error.message : error
        );
      }
    })();
  }, Math.max(2000, providerLoopMs));
  providerLoop.unref?.();

  return { agentWorker, assetAnalysisWorker, probeWorker, renderWorker, exportWorker };
}
