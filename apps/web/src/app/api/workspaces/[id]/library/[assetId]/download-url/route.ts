import { and, eq, isNull } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid, resolveAssetDisplayLabel } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";
import { signPrivateCampaignAsset } from "@/lib/asset-signed-delivery";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; assetId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");
    const [asset] = await getDb().select().from(schema.assets).where(and(
      eq(schema.assets.id, assetId), eq(schema.assets.orgId, member.orgId),
      eq(schema.assets.workspaceId, workspaceId), isNull(schema.assets.deletedAt)
    )).limit(1);
    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);
    const downloadUrl = await signPrivateCampaignAsset({
      workspaceId, storagePath: asset.storagePath, download: resolveAssetDisplayLabel(asset),
    });
    return apiSuccess({ downloadUrl, filename: resolveAssetDisplayLabel(asset), mimeType: asset.mimeType });
  } catch (error) {
    return handleApiError(error);
  }
}
