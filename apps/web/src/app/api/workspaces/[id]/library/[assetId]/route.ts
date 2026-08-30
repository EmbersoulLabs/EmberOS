import { and, eq, isNull } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

async function authorizedAsset(workspaceId: string, orgId: string, assetId: string) {
  const [asset] = await getDb().select().from(schema.assets).where(and(
    eq(schema.assets.id, assetId), eq(schema.assets.orgId, orgId),
    eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt)
  )).limit(1);
  return asset ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");
    const asset = await authorizedAsset(workspaceId, member.orgId, assetId);
    return asset ? apiSuccess({ asset }) : apiError("Asset not found", "NOT_FOUND", 404);
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const displayName = ((await request.json()) as { displayName?: string }).displayName?.trim();
    if (!displayName || displayName.length > 200) return apiError("Invalid display name", "VALIDATION_ERROR", 400);
    const asset = await authorizedAsset(workspaceId, member.orgId, assetId);
    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);
    const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
    const [updated] = await getDb().update(schema.assets).set({
      displayName,
      metadata: { ...metadata, displayNameSource: "manual", originalFilename: asset.originalFilename ?? metadata.originalFilename },
      updatedAt: new Date(),
    }).where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, workspaceId))).returning();
    return apiSuccess({ asset: updated });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const asset = await authorizedAsset(workspaceId, member.orgId, assetId);
    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);
    const db = getDb();
    const [[campaignRef], [storyRef]] = await Promise.all([
      db.select({ assetId: schema.campaignAssetRefs.assetId }).from(schema.campaignAssetRefs)
        .where(eq(schema.campaignAssetRefs.assetId, assetId)).limit(1),
      db.select({ assetId: schema.storyAssets.assetId }).from(schema.storyAssets)
        .where(eq(schema.storyAssets.assetId, assetId)).limit(1),
    ]);
    if (asset.campaignId || campaignRef || storyRef) {
      return apiError("Referenced Assets cannot be archived", "VERSION_CONFLICT", 409);
    }
    const [updated] = await db.update(schema.assets).set({ deletedAt: new Date(), status: "archived", updatedAt: new Date() })
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt))).returning();
    return apiSuccess({ asset: updated });
  } catch (error) { return handleApiError(error); }
}
