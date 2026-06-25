import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { applyCreativeCopyPatch } from "@/lib/creative-copy-patch";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = (await request.json()) as {
      variantId: string;
      hook?: string;
      body?: string;
      cta?: string;
      tags?: string[];
      title?: string;
    };

    if (!body.variantId) {
      return apiError("variantId is required", "VALIDATION", 400);
    }

    const db = getDb();
    const [existing] = await db
      .select({ workspaceId: schema.creatives.workspaceId })
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);
    if (!existing) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(existing.workspaceId, user.id, "editor");

    const result = await applyCreativeCopyPatch(id, body);
    if ("error" in result && result.error) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "QUEUE_ERROR" ? 503 : 400;
      return apiError(result.error, result.code ?? "ERROR", status);
    }

    return apiSuccess({
      creative: result.creative,
      rerenderQueued: result.rerenderQueued ?? false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
