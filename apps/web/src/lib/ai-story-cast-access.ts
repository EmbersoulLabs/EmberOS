import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { requireAuth } from "@/lib/auth";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

type Db = ReturnType<typeof getDb>;
type AuthUser = Awaited<ReturnType<typeof requireAuth>>;

export async function resolveAiStoryCastApiScope(
  campaignId: string,
  storyId: string,
  mutation: boolean,
  provided?: { user: AuthUser; db: Db }
) {
  const user = provided?.user ?? await requireAuth(); const db = provided?.db ?? getDb();
  const [story] = await db.select().from(schema.aiStories).where(and(eq(schema.aiStories.id, storyId), eq(schema.aiStories.campaignId, campaignId))).limit(1);
  if (!story) return null;
  await authorizeAiStoryAccess({ user, orgId: story.orgId, workspaceId: story.workspaceId, minRole: mutation ? "operator" : "client_viewer" });
  return { db, scope: { orgId: story.orgId, workspaceId: story.workspaceId, campaignId, storyId, actorUserId: user.id } };
}
