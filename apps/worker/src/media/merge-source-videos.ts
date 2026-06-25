import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
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

  const assets = await db
    .select()
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.campaignId, task.campaignId),
        eq(schema.assets.workspaceId, task.workspaceId)
      )
    )
    .orderBy(asc(schema.assets.createdAt));

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
    await concatVideoFiles(localPaths, mergedPath, workDir);
    const probe = await probeVideo(mergedPath);

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
      metadata: {
        merged: true,
        mergedFrom: uploadVideos.map((asset) => asset.id),
        originalFilename: "merged-source.mp4",
      },
    });

    console.log(
      `[merge-source] campaign=${task.campaignId} merged ${uploadVideos.length} clips → ${probe.durationSec.toFixed(1)}s`
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
