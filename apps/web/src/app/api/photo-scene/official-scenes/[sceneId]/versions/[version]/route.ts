import { getDb, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { eq } from "drizzle-orm";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { isUuid } from "@ceo-agent/shared";
import {
  mapOfficialSceneApiError,
  resolveOfficialSceneVersionForRead,
  toOfficialScenePickerDto,
} from "@/lib/photo-scene-official-scenes";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sceneId: string; version: string }> }
) {
  try {
    const user = await requireAuth();
    const { sceneId, version: versionRaw } = await params;
    const version = Number(versionRaw);
    if (!isUuid(sceneId) || !Number.isInteger(version) || version < 1) {
      return apiError("Invalid scene version", "VALIDATION_ERROR", 400);
    }
    const db = getDb();
    const [membership] = await db
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, user.id))
      .limit(1);
    if (!membership) return apiError("Forbidden", "FORBIDDEN", 403);
    await requireWorkspaceRole(membership.workspaceId, user.id, "client_viewer");
    const scene = await resolveOfficialSceneVersionForRead(db, sceneId, version);
    return apiSuccess({ scene: toOfficialScenePickerDto(scene), marketingImageCreated: false });
  } catch (error) {
    try {
      const mapped = mapOfficialSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}
