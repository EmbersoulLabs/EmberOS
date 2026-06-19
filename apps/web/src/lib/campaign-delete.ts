import { eq, and, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";

type Db = ReturnType<typeof getDb>;

/** Remove dependent rows that block campaign cascade delete in Postgres. */
export async function deleteCampaignCascade(
  db: Db,
  campaignId: string,
  workspaceId: string
): Promise<void> {
  const tasks = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(
      and(eq(schema.tasks.campaignId, campaignId), eq(schema.tasks.workspaceId, workspaceId))
    );

  const creatives = await db
    .select({ id: schema.creatives.id })
    .from(schema.creatives)
    .where(
      and(eq(schema.creatives.campaignId, campaignId), eq(schema.creatives.workspaceId, workspaceId))
    );

  const taskIds = tasks.map((t) => t.id);
  const creativeIds = creatives.map((c) => c.id);

  if (taskIds.length > 0) {
    await db.delete(schema.agentLogs).where(inArray(schema.agentLogs.taskId, taskIds));
  }
  if (creativeIds.length > 0) {
    await db
      .delete(schema.clientInvites)
      .where(inArray(schema.clientInvites.creativeId, creativeIds));
  }

  await db
    .delete(schema.campaigns)
    .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.workspaceId, workspaceId)));
}
