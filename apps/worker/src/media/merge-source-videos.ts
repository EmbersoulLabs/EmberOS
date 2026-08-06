import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { attachAssetsToCampaign, getCampaignAssets, getDb, schema } from "@ceo-agent/db";
import {
  STORAGE_PATHS,
  listUploadVideoAssets,
  isMergedSourceAsset,
} from "@ceo-agent/shared";
import { concatVideoFiles } from "../ffmpeg/concat-videos";
import { probeVideo } from "../ffmpeg/pipeline";
import { downloadStorageFile, uploadStorageFile } from "../storage";

/** Concatenate multiple user uploads into one merged source video for Auto Clip. */
export async function ensureMergedSourceVideo(taskId: string): Promise<void> {
  const db = getDb();
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const assets = await getCampaignAssets(db, task.campaignId, task.workspaceId);

  if (assets.some((asset) => asset.type === "video" && isMergedSourceAsset(asset.metadata))) {
    return;
  }

  const uploadVideos = listUploadVideoAssets(assets);
  if (uploadVideos.length <= 1) return;

  const workDir = join(tmpdir(), `merge-source-${task.campaignId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const localPaths: string[] = [];
    for (let i = 0; i < uploadVideos.length; i++) {
      const asset = uploadVideos[i]!;
      const ext = asset.storagePath.split(".").pop() ?? "mp4";
      const localPath = join(workDir, `part-${i}.${ext}`);
      await downloadStorageFile(asset.storagePath, localPath);
      localPaths.push(localPath);
    }

    const mergedPath = join(workDir, "merged.mp4");
    console.log(
      `[merge-source] campaign=${task.campaignId} merging ${uploadVideos.length} clip(s) task=${taskId}`
    );
    await concatVideoFiles(localPaths, mergedPath, workDir);
    const probe = await probeVideo(mergedPath);

    const assetId = randomUUID();
    const storagePath = STORAGE_PATHS.library(task.workspaceId, assetId, "mp4");
    await uploadStorageFile(storagePath, mergedPath, "video/mp4");

    await db.insert(schema.assets).values({
      id: assetId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      type: "video",
      displayName: "merged-source.mp4",
      originalFilename: "merged-source.mp4",
      storagePath,
      mimeType: "video/mp4",
      durationSec: String(probe.durationSec),
      width: probe.width,
      height: probe.height,
      status: "ready",
      source: "system_generated",
      metadata: {
        merged: true,
        mergedFrom: uploadVideos.map((asset) => asset.id),
        originalFilename: "merged-source.mp4",
      },
    });
    await attachAssetsToCampaign(db, task.campaignId, [assetId]);

    console.log(
      `[merge-source] campaign=${task.campaignId} merged ${uploadVideos.length} clips → ${probe.durationSec.toFixed(1)}s`
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
