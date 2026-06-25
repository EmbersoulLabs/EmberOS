import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";
import { pickVideoUrlForExport } from "@ceo-agent/agents";
import type { ClipDownloadResolution } from "@ceo-agent/shared";

export async function enqueueFinalRenderForCreative(creativeId: string) {
  const db = getDb();
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);

  if (!creative?.taskId) return null;

  await db
    .update(schema.creatives)
    .set({ renderStatus: "final_rendering", updatedAt: new Date() })
    .where(eq(schema.creatives.id, creativeId));

  return enqueueRender({
    taskId: creative.taskId,
    creativeId: creative.id,
    workspaceId: creative.workspaceId,
    orgId: creative.orgId,
    campaignId: creative.campaignId,
    mode: "final",
  });
}

export async function enqueuePreviewSubtitleRerender(
  creativeId: string,
  mode: "preview" | "subtitles_only" = "subtitles_only"
) {
  const db = getDb();
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);

  if (!creative?.taskId) return null;

  await db
    .update(schema.creatives)
    .set({ renderStatus: "preview_rendering", updatedAt: new Date() })
    .where(eq(schema.creatives.id, creativeId));

  return enqueueRender({
    taskId: creative.taskId,
    creativeId: creative.id,
    workspaceId: creative.workspaceId,
    orgId: creative.orgId,
    campaignId: creative.campaignId,
    mode,
  });
}

export async function enqueueFinalRendersForTask(taskId: string): Promise<{
  enqueued: number;
  alreadyReady: number;
  rendering: number;
}> {
  const db = getDb();
  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId));

  let enqueued = 0;
  let alreadyReady = 0;
  let rendering = 0;

  for (const creative of creatives) {
    if (creative.renderStatus === "final_ready" && creative.videoExportUrl) {
      alreadyReady += 1;
      continue;
    }
    if (creative.renderStatus === "final_rendering") {
      rendering += 1;
      continue;
    }
    if (!creative.videoUrl) continue;

    await enqueueFinalRenderForCreative(creative.id);
    enqueued += 1;
    rendering += 1;
  }

  return { enqueued, alreadyReady, rendering };
}

/** Enqueue 2k render for every clip in a task that still needs it. */
export async function enqueue2kRendersForTask(taskId: string): Promise<{
  enqueued: number;
  alreadyReady: number;
  rendering: number;
}> {
  const db = getDb();
  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.taskId, taskId));

  let enqueued = 0;
  let alreadyReady = 0;
  let rendering = 0;

  for (const creative of creatives) {
    if (pickVideoUrlForExport(creative, "2k")) {
      alreadyReady += 1;
      continue;
    }

    const progress = creative.renderProgress as {
      rendition?: string;
      phase?: string;
      error?: string;
    } | null;
    if (
      progress?.rendition === "2k" &&
      progress.phase !== "done" &&
      !progress.error
    ) {
      rendering += 1;
      continue;
    }

    if (!creative.videoUrl) continue;

    const job = await enqueueClipDownloadRender(creative.id, "2k");
    if (job) {
      enqueued += 1;
      rendering += 1;
    }
  }

  return { enqueued, alreadyReady, rendering };
}

/** Render a single clip at 1080p or 2k for direct MP4 download. */
export async function enqueueClipDownloadRender(
  creativeId: string,
  resolution: Extract<ClipDownloadResolution, "1080p" | "2k">
) {
  const db = getDb();
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, creativeId))
    .limit(1);

  if (!creative?.taskId) return null;
  if (!creative.videoUrl) return null;

  const progress = {
    percent: 0,
    phase: "queued",
    rendition: resolution,
    updatedAt: new Date().toISOString(),
  };

  if (resolution === "1080p") {
    await db
      .update(schema.creatives)
      .set({ renderStatus: "final_rendering", renderProgress: progress, updatedAt: new Date() })
      .where(eq(schema.creatives.id, creativeId));
  } else {
    await db
      .update(schema.creatives)
      .set({ renderProgress: progress, updatedAt: new Date() })
      .where(eq(schema.creatives.id, creativeId));
  }

  return enqueueRender({
    taskId: creative.taskId,
    creativeId: creative.id,
    workspaceId: creative.workspaceId,
    orgId: creative.orgId,
    campaignId: creative.campaignId,
    mode: "final",
    outputResolution: resolution,
  });
}
