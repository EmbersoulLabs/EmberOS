import { eq } from "drizzle-orm";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, schema } from "@ceo-agent/db";
import { runPublishAgent } from "@ceo-agent/agents";
import {
  STORAGE_PATHS,
  getBgmTrackById,
  buildTaskContentPack,
  contentPackToCsv,
  contentPackToJson,
  type CopyVariant,
  type EditPlan,
  type MarketingContentPackage,
  type Platform,
  type StepProgress,
  type TaskExportResolution,
} from "@ceo-agent/shared";
import { pickVideoUrlForExport } from "@ceo-agent/agents";
import { createExportZip } from "../ffmpeg/pipeline";
import { uploadStorageFile, publicStorageUrl } from "../storage";

export interface TaskExportJobData {
  taskId: string;
  workspaceId: string;
  orgId: string;
  campaignId: string;
  platforms: string[];
  resolution?: TaskExportResolution;
}

export type MusicCredit = { line: string; licenseUrl?: string };

/** Build a publishable music attribution line for a clip from its edit plan. */
export function musicCreditFor(editPlan: unknown): MusicCredit {
  const audio = (editPlan as EditPlan | null)?.audio;
  if (!audio) return { line: "No background music" };

  const ext = audio.bgmExternal;
  if (ext?.audioUrl) {
    return {
      line: ext.attribution ?? `"${ext.name}"${ext.artist ? ` by ${ext.artist}` : ""} (${ext.source})`,
      licenseUrl: ext.licenseUrl,
    };
  }

  if (audio.bgm && audio.bgm !== "none") {
    const track = getBgmTrackById(audio.bgm);
    if (track) {
      return {
        line: track.attribution ?? `"${track.name}" (built-in library)`,
        licenseUrl: track.licenseUrl,
      };
    }
  }

  return { line: "No background music" };
}

async function downloadUrlToFile(url: string, localPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
}

export async function processTaskExportJob(data: TaskExportJobData): Promise<void> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, data.taskId)).limit(1);
  if (!task) throw new Error("Task not found");

  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, data.campaignId))
    .limit(1);

  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, data.taskId))
    .orderBy(schema.creatives.createdAt);

  if (creatives.length === 0) throw new Error("No creatives for task");

  const resolution: TaskExportResolution = data.resolution ?? "720p";

  const workDir = join(tmpdir(), `export-task-${data.taskId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const zipFiles: { path: string; name: string }[] = [];
    const platforms = (data.platforms.length ? data.platforms : campaign?.platforms ?? ["tiktok"]) as Platform[];
    const musicCredits: { clip: number; credit: MusicCredit }[] = [];

    for (let i = 0; i < creatives.length; i++) {
      const creative = creatives[i]!;
      const clipNum = i + 1;
      const videoUrl = pickVideoUrlForExport(creative, resolution);
      if (!videoUrl) {
        throw new Error(
          resolution === "2k"
            ? `Clip ${clipNum} 2K render is not ready`
            : resolution === "1080p"
              ? `Clip ${clipNum} 1080p render is not ready`
              : `Clip ${clipNum} preview video is not ready`
        );
      }

      const videoLocal = join(workDir, `clip_${clipNum}.mp4`);
      await downloadUrlToFile(videoUrl, videoLocal);
      zipFiles.push({
        path: videoLocal,
        name: `clips/clip_${clipNum}.mp4`,
      });

      if (creative.coverUrl) {
        const coverLocal = join(workDir, `cover_${clipNum}.jpg`);
        try {
          await downloadUrlToFile(creative.coverUrl, coverLocal);
          zipFiles.push({ path: coverLocal, name: `clips/cover_${clipNum}.jpg` });
        } catch {
          // cover optional
        }
      }

      const variants = (creative.copyVariants ?? []) as CopyVariant[];
      const exportPack = runPublishAgent({
        creativeId: creative.id,
        platforms,
        copyVariants: variants,
        selectedCopyId: creative.selectedCopyId ?? variants[0]?.id ?? "clip-1",
        videoFile: `clip_${clipNum}.mp4`,
        coverFile: `cover_${clipNum}.jpg`,
      });

      await mkdir(join(workDir, "copy"), { recursive: true });
      for (const platform of Object.keys(exportPack.platforms)) {
        const p = exportPack.platforms[platform]!;
        const content =
          platform === "xiaohongshu"
            ? `# ${p.title}\n\n${p.body}\n\n${(p.tags ?? []).join(" ")}`
            : `${p.caption}\n\n${(p.hashtags ?? []).join(" ")}`;
        const copyPath = join(workDir, "copy", `clip_${clipNum}_${platform}.md`);
        await writeFile(copyPath, content);
        zipFiles.push({ path: copyPath, name: `copy/clip_${clipNum}_${platform}.md` });
      }

      const credit = musicCreditFor(creative.editPlan);
      musicCredits.push({ clip: clipNum, credit });

      const metaPath = join(workDir, `clip_${clipNum}_metadata.json`);
      await writeFile(
        metaPath,
        JSON.stringify({ ...exportPack, musicCredit: credit }, null, 2)
      );
      zipFiles.push({ path: metaPath, name: `metadata/clip_${clipNum}.json` });

      await db
        .update(schema.creatives)
        .set({ status: "exported", platformAdaptations: exportPack.platforms })
        .where(eq(schema.creatives.id, creative.id));
    }

    const creditsBody = musicCredits
      .map(({ clip, credit }) =>
        credit.licenseUrl
          ? `Clip ${clip}: ${credit.line}\n          License: ${credit.licenseUrl}`
          : `Clip ${clip}: ${credit.line}`
      )
      .join("\n");

    const creditsPath = join(workDir, "CREDITS.txt");
    await writeFile(
      creditsPath,
      `EmberOS — Music Credits\nTask: ${data.taskId}\n\n${creditsBody}\n\n` +
        `Note: Creative Commons (CC-BY) tracks require crediting the artist when you publish.\n` +
        `Include the relevant line above in your post caption or video description.\n`
    );
    zipFiles.push({ path: creditsPath, name: "CREDITS.txt" });

    const readmePath = join(workDir, "README.txt");
    await writeFile(
      readmePath,
      `EmberOS Auto Clip Export\nResolution: ${resolution}\nClips: ${creatives.length}\nTask: ${data.taskId}\n\n` +
        `Music credits — see CREDITS.txt\n${creditsBody}\n`
    );
    zipFiles.push({ path: readmePath, name: "README.txt" });

    const contentPackage = (
      (task.stepProgress as StepProgress)?.content_generate?.output as MarketingContentPackage | undefined
    );
    const contentPack = buildTaskContentPack({
      taskId: data.taskId,
      campaignId: data.campaignId,
      contentPackage,
      creatives,
    });
    await mkdir(join(workDir, "content-pack"), { recursive: true });
    const jsonPath = join(workDir, "content-pack", "content_pack.json");
    await writeFile(jsonPath, contentPackToJson(contentPack));
    zipFiles.push({ path: jsonPath, name: "content-pack/content_pack.json" });

    const csvPath = join(workDir, "content-pack", "captions.csv");
    await writeFile(csvPath, contentPackToCsv(contentPack));
    zipFiles.push({ path: csvPath, name: "content-pack/captions.csv" });

    const zipLocal = join(workDir, "pack.zip");
    const filesToZip: { path: string; name: string }[] = [];
    for (const entry of zipFiles) {
      try {
        await access(entry.path);
        filesToZip.push(entry);
      } catch {
        // skip missing optional files
      }
    }

    if (!filesToZip.some((f) => f.name.endsWith(".mp4"))) {
      throw new Error("Export ZIP missing video files");
    }

    await createExportZip(filesToZip, zipLocal);

    const packPath = STORAGE_PATHS.taskExportPack(data.workspaceId, data.campaignId, data.taskId);
    await uploadStorageFile(packPath, zipLocal, "application/zip");
    const exportPackUrl = publicStorageUrl(packPath);

    const progress = { ...((task.stepProgress as Record<string, unknown>) ?? {}) };
    progress.export_pack = {
      status: "completed",
      completedAt: new Date().toISOString(),
      output: { exportPackUrl, clipCount: creatives.length, resolution },
    };

    const requestOutput = progress.export_request?.output as Record<string, unknown> | undefined;
    if (requestOutput) {
      progress.export_request = {
        ...(progress.export_request as Record<string, unknown>),
        status: "completed",
        completedAt: new Date().toISOString(),
        output: { ...requestOutput, status: "completed", resolution },
      };
    }

    await db
      .update(schema.tasks)
      .set({ stepProgress: progress, currentStep: "export_pack" })
      .where(eq(schema.tasks.id, data.taskId));

    await db
      .update(schema.campaigns)
      .set({ status: "export_ready" })
      .where(eq(schema.campaigns.id, data.campaignId));

    console.log(`[ffmpeg.export_task] done task=${data.taskId} url=${exportPackUrl}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
