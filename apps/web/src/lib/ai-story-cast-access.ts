import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

export async function resolveAiStoryCastApiScope(campaignId: string, storyId: string, mutation: boolean) {
  const user = await requireAuth(); const db = getDb();
  const [story] = await db.select().from(schema.aiStories).where(and(eq(schema.aiStories.id, storyId), eq(schema.aiStories.campaignId, campaignId))).limit(1);
  if (!story) return null;
  await authorizeAiStoryAccess({ user, orgId: story.orgId, workspaceId: story.workspaceId, minRole: mutation ? "operator" : "client_viewer" });
  return { db, scope: { orgId: story.orgId, workspaceId: story.workspaceId, campaignId, storyId, actorUserId: user.id } };
}
