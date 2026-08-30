import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isUuid } from "@ceo-agent/shared";
import { mapPhotoSceneApiError, readProductExtraction } from "@/lib/photo-scene-extraction";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ generationId: string }> }
) {
  try {
    const user = await requireAuth();
    const { generationId } = await params;
    if (!isUuid(generationId)) return apiError("Invalid generation id", "VALIDATION_ERROR", 400);

    const db = getDb();
    const [generation] = await db
      .select()
      .from(schema.photoSceneGenerations)
      .where(eq(schema.photoSceneGenerations.id, generationId))
      .limit(1);
    if (!generation) return apiError("Generation not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(generation.workspaceId, user.id, "client_viewer");

    const dto = await readProductExtraction(db, {
      generationId: generation.id,
      workspaceId: generation.workspaceId,
      orgId: generation.orgId,
    });
    return apiSuccess(dto);
  } catch (error) {
    try {
      const mapped = mapPhotoSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}
