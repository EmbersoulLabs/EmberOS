import { eq, and, inArray } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";

type Db = ReturnType<typeof getDb>;

/**
 * Remove dependent rows that block campaign cascade delete in Postgres, or
 * — when the Campaign has any AI Story history, archived or not — soft-
 * delete the Campaign instead of hard-deleting it.
 *
 * ~40 tables behind an AI Story (character versions, canonical scenes,
 * script versions, provider cost ledgers, …) hold their own campaign_id
 * foreign key with onDelete: "restrict", independent of ai_stories.id and
 * independent of whether that Story is archived. A true hard delete of such
 * a Campaign is not possible without destroying that production history, so
 * archiving the Story first does not unblock it. Soft-deleting achieves the
 * same outcome the user wants — the Campaign disappears from every normal
 * view — without touching any of it.
 */
export async function deleteCampaignCascade(
  db: Db,
  campaignId: string,
  workspaceId: string
): Promise<void> {
  const [story] = await db
    .select({ id: schema.aiStories.id })
    .from(schema.aiStories)
    .where(and(eq(schema.aiStories.campaignId, campaignId), eq(schema.aiStories.workspaceId, workspaceId)))
    .limit(1);
  if (story) {
    await db
      .update(schema.campaigns)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.campaigns.id, campaignId), eq(schema.campaigns.workspaceId, workspaceId)));
    return;
  }

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
