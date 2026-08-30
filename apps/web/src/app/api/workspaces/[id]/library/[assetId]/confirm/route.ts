import { and, eq, isNull } from "drizzle-orm";
import { findSameWorkspaceAssetByContentHash, getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isCanonicalPhotoSceneLibraryPath, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { finalizeStoredSourceAssetIdentity } from "@/lib/source-asset-content-hash";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const body = await request.json().catch(() => ({})) as { width?: number; height?: number; durationSec?: number; fileSizeBytes?: number };
    const db = getDb();
    const [asset] = await db.select().from(schema.assets).where(and(
      eq(schema.assets.id, assetId), eq(schema.assets.orgId, member.orgId),
      eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt)
    )).limit(1);
    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);
    if (!isCanonicalPhotoSceneLibraryPath(workspaceId, assetId, asset.storagePath)) {
      return apiError("Invalid private storage identity", "VALIDATION_ERROR", 400);
    }
    const [updated] = await db.update(schema.assets).set({
      width: body.width ?? asset.width,
      height: body.height ?? asset.height,
      durationSec: body.durationSec == null ? asset.durationSec : String(body.durationSec),
      fileSizeBytes: body.fileSizeBytes ?? asset.fileSizeBytes,
      status: "ready",
      updatedAt: new Date(),
    }).where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, workspaceId))).returning();
    let finalized;
    try {
      finalized = await finalizeStoredSourceAssetIdentity(db, updated);
    } catch {
      await db.update(schema.assets).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.assets.id, assetId));
      return apiError("Uploaded object could not be finalized", "STORAGE_ERROR", 422);
    }
    const duplicate = await findSameWorkspaceAssetByContentHash(db, {
      orgId: member.orgId, workspaceId, contentHash: finalized.contentHash!, excludeAssetId: finalized.id,
    });
    if (duplicate) {
      const metadata = (finalized.metadata ?? {}) as Record<string, unknown>;
      const [marked] = await db.update(schema.assets).set({
        metadata: { ...metadata, sameWorkspaceDuplicateOf: duplicate.id }, updatedAt: new Date(),
      }).where(eq(schema.assets.id, finalized.id)).returning();
      finalized = marked;
    }
    return apiSuccess({ asset: finalized, duplicateOfAssetId: duplicate?.id ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

