import { Worker } from "bullmq";
import { eq, and } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { QUEUE_NAMES, getRedisConnection, getBullmqPrefix, logQueueConfig } from "@ceo-agent/queue";
import { runPublishAgent } from "@ceo-agent/agents";
import { runPipeline, type PipelineHooks } from "@ceo-agent/agents";
import { STORAGE_PATHS, MAX_UPLOAD_DURATION_SEC, assessFinishedAdRisk, sumUploadVideoDurationSec, validateCombinedVideoDurationSec } from "@ceo-agent/shared";
import { createExportZip, probeVideo } from "../ffmpeg/pipeline";
import { processRenderJob } from "./render-handler";
import { processTaskExportJob, musicCreditFor } from "./export-handler";
import { prepareVisionFromStorage } from "../media/vision-prep";
import { ensureMergedSourceVideo } from "../media/merge-source-videos";
import { mediaHasAudio } from "../ffmpeg/probe-audio";
import {
  downloadStorageFile,
  uploadStorageFile,
  publicStorageUrl,
} from "../storage";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EditPlan, CopyVariant, Platform } from "@ceo-agent/shared";

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10);

/** Reduce Upstash command churn when queues are idle (free tier ~500k/month). */
const workerOpts = {
  drainDelay: 5000,
  settings: {
    stalledInterval: 60_000,
  },
} as const;

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
  if (!task) return;

  const progress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
  progress[stepId] = {
    status: "failed",
    error: message,
    completedAt: new Date().toISOString(),
  };

  await db
    .update(schema.tasks)
    .set({
      stepProgress: progress,
      status: "failed",
      errorMessage: message,
      completedAt: new Date(),
    })
    .where(eq(schema.tasks.id, taskId));

  await db
    .update(schema.campaigns)
    .set({ status: "failed" })
    .where(eq(schema.campaigns.id, task.campaignId));
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
        await runPipeline(taskId, pipelineHooks);
        console.log(`[agent.pipeline] done task=${taskId}`);
      }
    },
    { connection, prefix, concurrency, ...workerOpts }
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
        await db
          .update(schema.assets)
          .set({
            durationSec: String(probe.durationSec),
            width: probe.width,
            height: probe.height,
            metadata: { ...meta, codec: probe.codec, finishedAdRisk },
          })
          .where(eq(schema.assets.id, assetId));

        if (assetRow?.campaignId && assetRow.workspaceId) {
          const campaignAssets = await db
            .select()
            .from(schema.assets)
            .where(
              and(
                eq(schema.assets.campaignId, assetRow.campaignId),
                eq(schema.assets.workspaceId, assetRow.workspaceId)
              )
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
    { connection, prefix, concurrency: 5, ...workerOpts }
  );

  const renderWorker = new Worker(
    QUEUE_NAMES.RENDER,
    async (job) => {
      if (job.name !== "ffmpeg.render") return;
      console.log(`[ffmpeg.render] start creative=${(job.data as { creativeId: string }).creativeId}`);
      await processRenderJob(job.data as Parameters<typeof processRenderJob>[0]);
    },
    { connection, prefix, concurrency, ...workerOpts }
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
        for (const platform of Object.keys(exportPack.platforms)) {
          const p = exportPack.platforms[platform]!;
          const content =
            platform === "xiaohongshu"
              ? `# ${p.title}\n\n${p.body}\n\n${(p.tags ?? []).join(" ")}`
              : `${p.caption}\n\n${(p.hashtags ?? []).join(" ")}`;
          await writeFile(join(workDir, "copy", `${platform}_variant.md`), content);
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
          ...Object.keys(exportPack.platforms).map((p) => ({
            path: join(workDir, "copy", `${p}_variant.md`),
            name: `export/copy/${p}_variant.md`,
          })),
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
    { connection, prefix, concurrency, ...workerOpts }
  );

  agentWorker.on("failed", (job, err) => {
    console.error(`Agent job ${job?.id} failed:`, err);
  });
  renderWorker.on("failed", async (job, err) => {
    console.error(`Render job ${job?.id} failed:`, err);
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

  console.log("Workers started: agent, probe, render, export");
  return { agentWorker, probeWorker, renderWorker, exportWorker };
}
