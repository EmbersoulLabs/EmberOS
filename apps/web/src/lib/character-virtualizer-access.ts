import { eq } from "drizzle-orm";
import { AiStoryCharacterVirtualizerService, getDb, schema } from "@ceo-agent/db";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { requireAuth } from "@/lib/auth";

export async function characterVirtualizerContext(workspaceId: string, mutation: boolean) {
  const user = await requireAuth();
  const db = getDb();
  const [workspace] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).limit(1);
  if (!workspace) return null;
  await authorizeAiStoryAccess({
    user,
    orgId: workspace.orgId,
    workspaceId,
    minRole: mutation ? "operator" : "client_viewer",
  });
  return {
    user,
    db,
    service: new AiStoryCharacterVirtualizerService(db),
    scope: { orgId: workspace.orgId, workspaceId, actorUserId: user.id },
  };
}
