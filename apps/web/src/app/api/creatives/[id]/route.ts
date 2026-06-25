import { eq, asc } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { applyCreativeCopyPatch } from "@/lib/creative-copy-patch";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "client_viewer");

    const [campaign] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, creative.campaignId))
      .limit(1);

    const reviews = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.creativeId, id));

    const siblingCreatives = creative.taskId
      ? await db
          .select({ id: schema.creatives.id, renderStatus: schema.creatives.renderStatus })
          .from(schema.creatives)
          .where(eq(schema.creatives.taskId, creative.taskId))
          .orderBy(asc(schema.creatives.createdAt))
      : [];

    return apiSuccess({ creative, campaign, reviews, siblingCreatives, clipIndex: siblingCreatives.findIndex((c) => c.id === id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();

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
