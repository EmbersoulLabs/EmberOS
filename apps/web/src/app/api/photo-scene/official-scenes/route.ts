import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { PhotoSceneOutputPresetIdSchema } from "@ceo-agent/shared";
import {
  listPublishedOfficialScenesForPicker,
  mapOfficialSceneApiError,
  refuseTenantCatalogWrite,
} from "@/lib/photo-scene-official-scenes";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const url = new URL(request.url);
    const presetRaw = url.searchParams.get("preset") ?? undefined;
    const category = url.searchParams.get("category") ?? undefined;
    const preset = presetRaw ? PhotoSceneOutputPresetIdSchema.parse(presetRaw) : undefined;
    const db = getDb();
    const [membership] = await db
      .select({ workspaceId: schema.workspaceMembers.workspaceId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.userId, user.id))
      .limit(1);
    if (!membership) return apiError("Forbidden", "FORBIDDEN", 403);
    await requireWorkspaceRole(membership.workspaceId, user.id, "client_viewer");
    const scenes = await listPublishedOfficialScenesForPicker(db, { presetId: preset, category });
    return apiSuccess({ scenes, marketingImageCreated: false });
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return apiError("Invalid output preset", "PRESET_INCOMPATIBLE", 400);
    }
    try {
      const mapped = mapOfficialSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}

export async function POST() {
  try {
    await requireAuth();
    refuseTenantCatalogWrite();
  } catch (error) {
    try {
      const mapped = mapOfficialSceneApiError(error);
      return apiError(mapped.message, mapped.code, mapped.status);
    } catch {
      return handleApiError(error);
    }
  }
}

export async function PUT() {
  return POST();
}

export async function DELETE() {
  return POST();
}
