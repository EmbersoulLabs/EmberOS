import { and, eq, isNull } from "drizzle-orm";
import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function PATCH(
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

    const body = (await request.json()) as { displayName?: string };
    const displayName = body.displayName?.trim();
    if (!displayName) {
      return apiError("displayName is required", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [updated] = await db
      .update(schema.assets)
      .set({ displayName, updatedAt: new Date() })
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, workspaceId),
          isNull(schema.assets.deletedAt)
        )
      )
      .returning();

    if (!updated) return apiError("Asset not found", "NOT_FOUND", 404);
    return apiSuccess({ asset: updated });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Soft delete only — storage retained (Sprint 0002 / Codex task). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, assetId } = await params;
    if (!isUuid(workspaceId) || !isUuid(assetId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const db = getDb();
    const [updated] = await db
      .update(schema.assets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.assets.id, assetId),
          eq(schema.assets.workspaceId, workspaceId),
          isNull(schema.assets.deletedAt)
        )
      )
      .returning();

    if (!updated) return apiError("Asset not found", "NOT_FOUND", 404);
    return apiSuccess({ asset: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
