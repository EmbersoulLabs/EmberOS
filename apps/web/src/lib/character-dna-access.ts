import { eq } from "drizzle-orm";
import {
  assertNoImageGenerationForCharacterDna,
  resolveCharacterDnaAnalysisProvider,
} from "@ceo-agent/agents";
import { AiStoryCharacterDnaService, getDb, schema } from "@ceo-agent/db";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { requireAuth } from "@/lib/auth";
import { loadWorkspacePrivateAssetBytes } from "@/lib/character-virtualizer-access";

export async function characterDnaContext(workspaceId: string, mutation: boolean) {
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
    service: new AiStoryCharacterDnaService(db),
    scope: { orgId: workspace.orgId, workspaceId, actorUserId: user.id },
  };
}

export async function analyzeCharacterDnaBytes(workspaceId: string, storagePath: string | null | undefined) {
  const provider = resolveCharacterDnaAnalysisProvider();
  const bytes = storagePath ? await loadWorkspacePrivateAssetBytes(workspaceId, storagePath).catch(() => null) : null;
  return async (input: {
    sourceAssetId: string;
    sourceContentHash: string;
    imageDataUrl: string;
    createdAt: string;
  }) => {
    const imageDataUrl = bytes
      ? `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`
      : input.imageDataUrl;
    const result = await provider.analyzeCharacter({ ...input, imageDataUrl });
    assertNoImageGenerationForCharacterDna(result);
    return result;
  };
}
