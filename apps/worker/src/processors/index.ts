import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { QUEUE_NAMES, getRedisConnection } from "@ceo-agent/queue";
import { runComplianceAfterRender, runPublishAgent } from "@ceo-agent/agents";
import { runPipeline } from "@ceo-agent/agents";
import { STORAGE_PATHS } from "@ceo-agent/shared";
import { probeVideo, renderVideo, extractCover, createExportZip } from "../ffmpeg/pipeline";
import { mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { EditPlan, CopyVariant, Platform } from "@ceo-agent/shared";

const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? "2", 10);

async function getSignedUrl(storagePath: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase storage not configured");
  }

  const res = await fetch(
    `${supabaseUrl}/storage/v1/object/sign/${bucket}/${storagePath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }
  );

  if (!res.ok) {
    throw new Error(`Failed to get signed URL: ${res.statusText}`);
  }

  const data = (await res.json()) as { signedURL: string };
  return `${supabaseUrl}/storage/v1${data.signedURL}`;
}

async function uploadFile(storagePath: string, localPath: string, contentType: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";

  const fileBuffer = await readFile(localPath);
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${storagePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    throw new Error(`Upload failed: ${res.statusText}`);
  }
}

export function startWorkers() {
  const connection = getRedisConnection();

  const agentWorker = new Worker(
    QUEUE_NAMES.AGENT,
    async (job) => {
      if (job.name === "agent.pipeline") {
        const { taskId } = job.data as { taskId: string };
        await runPipeline(taskId);
      }
    },
    { connection, concurrency }
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
        const url = await getSignedUrl(storagePath);
        const localPath = join(workDir, "input.mp4");
        const response = await fetch(url);
        await writeFile(localPath, Buffer.from(await response.arrayBuffer()));

        const probe = await probeVideo(localPath);
        await db
          .update(schema.assets)
          .set({
            durationSec: String(probe.durationSec),
            width: probe.width,
            height: probe.height,
            metadata: { codec: probe.codec },
          })
          .where(eq(schema.assets.id, assetId));
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    { connection, concurrency: 5 }
  );

  const renderWorker = new Worker(
    QUEUE_NAMES.RENDER,
    async (job) => {
      if (job.name !== "ffmpeg.render") return;
      const data = job.data as {
        taskId: string;
        creativeId: string;
        workspaceId: string;
        orgId: string;
        campaignId: string;
        resolution: "preview" | "export";
      };

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
      const primaryAsset = assets.find((a) => a.type === "video") ?? assets[0];
      if (!primaryAsset) throw new Error("No source asset");

      const workDir = join(tmpdir(), `render-${data.creativeId}`);
      await mkdir(workDir, { recursive: true });

      try {
        const sourceUrl = await getSignedUrl(primaryAsset.storagePath);
        const localInput = join(workDir, "source.mp4");
        const response = await fetch(sourceUrl);
        await writeFile(localInput, Buffer.from(await response.arrayBuffer()));

        const editPlan = creative.editPlan as EditPlan;
        const outputLocal = join(workDir, "output.mp4");
        await renderVideo(localInput, editPlan, outputLocal, data.resolution);

        const storagePath =
          data.resolution === "preview"
            ? STORAGE_PATHS.preview(data.workspaceId, data.campaignId, data.creativeId)
            : STORAGE_PATHS.export(data.workspaceId, data.campaignId, data.creativeId);

        await uploadFile(storagePath, outputLocal, "video/mp4");

        const coverLocal = join(workDir, "cover.jpg");
        await extractCover(localInput, editPlan.cover.atSec, coverLocal);
        const coverPath = STORAGE_PATHS.cover(data.workspaceId, data.campaignId, data.creativeId);
        await uploadFile(coverPath, coverLocal, "image/jpeg");

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
        const videoUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${storagePath}`;
        const coverUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${coverPath}`;

        const updateData =
          data.resolution === "preview"
            ? { videoUrl, coverUrl }
            : { videoExportUrl: videoUrl };

        await db
          .update(schema.creatives)
          .set(updateData)
          .where(eq(schema.creatives.id, data.creativeId));

        if (data.resolution === "preview") {
          const db2 = getDb();
          const [task] = await db2
            .select()
            .from(schema.tasks)
            .where(eq(schema.tasks.id, data.taskId))
            .limit(1);
          if (task) {
            const progress = (task.stepProgress as Record<string, unknown>) ?? {};
            progress.ffmpeg_render = {
              status: "completed",
              completedAt: new Date().toISOString(),
            };
            await db2
              .update(schema.tasks)
              .set({ stepProgress: progress })
              .where(eq(schema.tasks.id, data.taskId));
          }
          await runComplianceAfterRender(data.taskId, data.creativeId);
        }
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    { connection, concurrency }
  );

  const exportWorker = new Worker(
    QUEUE_NAMES.EXPORT,
    async (job) => {
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
        if (exportPath) {
          const videoLocal = join(workDir, "video_9x16_1080p.mp4");
          const response = await fetch(exportPath);
          await writeFile(videoLocal, Buffer.from(await response.arrayBuffer()));
        }

        if (creative.coverUrl) {
          const coverLocal = join(workDir, "cover.jpg");
          const response = await fetch(creative.coverUrl);
          await writeFile(coverLocal, Buffer.from(await response.arrayBuffer()));
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

        await writeFile(
          join(workDir, "metadata.json"),
          JSON.stringify(exportPack, null, 2)
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
        ]) {
          try {
            await access(entry.path);
            zipFiles.push(entry);
          } catch {
            // skip missing files
          }
        }

        await createExportZip(zipFiles, zipLocal);

        const packPath = STORAGE_PATHS.exportPack(
          data.workspaceId,
          data.campaignId,
          data.creativeId
        );
        await uploadFile(packPath, zipLocal, "application/zip");

        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
        const exportPackUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${packPath}`;

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
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    },
    { connection, concurrency }
  );

  agentWorker.on("failed", (job, err) => console.error(`Agent job ${job?.id} failed:`, err));
  renderWorker.on("failed", (job, err) => console.error(`Render job ${job?.id} failed:`, err));
  exportWorker.on("failed", (job, err) => console.error(`Export job ${job?.id} failed:`, err));

  console.log("Workers started: agent, probe, render, export");
  return { agentWorker, probeWorker, renderWorker, exportWorker };
}
