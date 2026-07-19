import { eq, and, isNull } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole, duplicateCampaignRecord } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const db = getDb();

    const [source] = await db
      .select()
      .from(schema.campaigns)
      .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
      .limit(1);

    if (!source) return apiError("Campaign not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(source.workspaceId, user.id, "operator");

    const duplicated = await duplicateCampaignRecord(db, source, user.id);
    return apiSuccess({ campaign: duplicated }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
