import { eq } from "drizzle-orm";
import { resolveCharacterVirtualizationRuntime } from "@ceo-agent/agents";
import { AiStoryCharacterVirtualizerError, AiStoryCharacterVirtualizerService, getDb, schema } from "@ceo-agent/db";
import { isPhotoSceneTenantStoragePath, isPublicUrlStorageIdentity } from "@ceo-agent/shared";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { requireAuth } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function storageBucket() {
  return process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
}

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

export function characterVirtualizerExecutionOptions(workspaceId: string) {
  const runtime = resolveCharacterVirtualizationRuntime();
  if (runtime.mode !== "creative-image") {
    return { provider: runtime.provider };
  }
  return {
    provider: runtime.provider,
    loadSourceBytes: async (input: { storagePath: string; contentHash: string; mimeType: string }) =>
      loadWorkspacePrivateAssetBytes(workspaceId, input.storagePath),
    persistOutputBytes: async (input: { storagePath: string; bytes: Buffer; mimeType: string }) =>
      persistWorkspacePrivateAssetBytes(workspaceId, input),
  };
}

export async function loadWorkspacePrivateAssetBytes(workspaceId: string, storagePath: string) {
  assertPrivateWorkspaceObject(workspaceId, storagePath);
  const { data, error } = await createAdminClient().storage.from(storageBucket()).download(storagePath);
  if (error || !data) {
    throw new AiStoryCharacterVirtualizerError(
      "SOURCE_PORTRAIT_BYTES_REQUIRED",
      "Source portrait bytes are not available in this Workspace."
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

export async function persistWorkspacePrivateAssetBytes(
  workspaceId: string,
  input: { storagePath: string; bytes: Buffer; mimeType: string }
) {
  assertPrivateWorkspaceObject(workspaceId, input.storagePath);
  const { error } = await createAdminClient().storage.from(storageBucket()).upload(input.storagePath, input.bytes, {
    upsert: false,
    contentType: input.mimeType,
  });
  if (error) {
    throw new AiStoryCharacterVirtualizerError(
      "VIRTUAL_OUTPUT_PERSIST_FAILED",
      "Virtual Character output could not be stored."
    );
  }
}

function assertPrivateWorkspaceObject(workspaceId: string, storagePath: string) {
  if (isPublicUrlStorageIdentity(storagePath) || !isPhotoSceneTenantStoragePath(workspaceId, storagePath)) {
    throw new AiStoryCharacterVirtualizerError(
      "REUSABLE_CHARACTER_WORKSPACE_SCOPE_GATE",
      "Character Virtualizer Workspace authority does not resolve"
    );
  }
}
