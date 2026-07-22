import { and, eq, isNull } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const body = (await request.json().catch(() => ({}))) as {
      width?: number;
      height?: number;
      durationSec?: number;
      fileSizeBytes?: number;
    };

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

    const [updated] = await db
      .update(schema.assets)
      .set({
        status: "ready",
        width: body.width ?? asset.width,
        height: body.height ?? asset.height,
        durationSec:
          body.durationSec != null ? String(body.durationSec) : asset.durationSec,
        fileSizeBytes: body.fileSizeBytes ?? asset.fileSizeBytes,
        updatedAt: new Date(),
      })
      .where(eq(schema.assets.id, assetId))
      .returning();

    return apiSuccess({ asset: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
