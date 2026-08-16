import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, schema } from "@ceo-agent/db";
import { STORAGE_PATHS, isMergedSourceAsset } from "@ceo-agent/shared";
import { loadTrackedCampaignTaskInputs } from "@ceo-agent/agents";
import { concatVideoFiles } from "../ffmpeg/concat-videos";
import { probeVideo } from "../ffmpeg/pipeline";
import { downloadStorageFile, uploadStorageFile } from "../storage";
import { hashSourceAssetFile } from "../source-asset-content-hash";

/** Concatenate multiple user uploads into one merged source video for Auto Clip. */
export async function ensureMergedSourceVideo(taskId: string): Promise<void> {
  const db = getDb();
  const tracked = await loadTrackedCampaignTaskInputs(taskId);
  const task = tracked.task;

  if (tracked.assets.some((asset) => asset.type === "video" && isMergedSourceAsset(asset.metadata))) {
    return;
  }

  const sourceVideos = tracked.assets.filter((asset) => asset.type === "video");
  if (sourceVideos.length <= 1) return;

  const workDir = join(tmpdir(), `merge-source-${task.campaignId}`);
  await mkdir(workDir, { recursive: true });

  try {
    const localPaths: string[] = [];
    for (let i = 0; i < sourceVideos.length; i++) {
      const asset = sourceVideos[i]!;
      const ext = asset.storagePath.split(".").pop() ?? "mp4";
      const localPath = join(workDir, `part-${i}.${ext}`);
      await downloadStorageFile(asset.storagePath, localPath);
      localPaths.push(localPath);
    }

    const mergedPath = join(workDir, "merged.mp4");
    console.log(
      `[merge-source] campaign=${task.campaignId} merging ${sourceVideos.length} clip(s) task=${taskId}`
    );
    await concatVideoFiles(localPaths, mergedPath, workDir);
    const probe = await probeVideo(mergedPath);
    const contentHash = await hashSourceAssetFile(mergedPath);

    const assetId = randomUUID();
    const storagePath = STORAGE_PATHS.source(task.workspaceId, task.campaignId, assetId, "mp4");
    await uploadStorageFile(storagePath, mergedPath, "video/mp4");

    await db.insert(schema.assets).values({
      id: assetId,
      orgId: task.orgId,
      workspaceId: task.workspaceId,
      campaignId: task.campaignId,
      type: "video",
      storagePath,
      mimeType: "video/mp4",
      durationSec: String(probe.durationSec),
      width: probe.width,
      height: probe.height,
      contentHash,
      metadata: {
        merged: true,
        mergedFrom: sourceVideos.map((asset) => asset.id),
        originalFilename: "merged-source.mp4",
      },
    });

    console.log(
      `[merge-source] campaign=${task.campaignId} merged ${sourceVideos.length} clips → ${probe.durationSec.toFixed(1)}s`
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
