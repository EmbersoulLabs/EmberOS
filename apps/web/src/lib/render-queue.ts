import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { enqueueRender } from "@ceo-agent/queue";

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

export async function enqueuePreviewSubtitleRerender(creativeId: string) {
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
    mode: "subtitles_only",
  });
}
