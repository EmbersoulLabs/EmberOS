import { and, eq, isNull } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const db = getDb();
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, workspaceId),
          isNull(schema.assets.deletedAt)
        )
      )
      .limit(1);

    if (!asset) return apiError("Asset not found", "NOT_FOUND", 404);

    const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "campaign-assets";
    const supabase = createAdminClient();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(asset.storagePath, 60 * 15);

    if (error || !data?.signedUrl) {
      return apiError(
        error?.message ?? "Failed to create download URL",
        "STORAGE_ERROR",
        502
      );
    }

    return apiSuccess({
      downloadUrl: data.signedUrl,
      filename: asset.displayName || asset.originalFilename || "asset",
      mimeType: asset.mimeType,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
