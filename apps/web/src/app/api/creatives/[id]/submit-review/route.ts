import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const { type } = body as { type: "internal" | "client" };

    const db = getDb();
    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "operator");

    const [review] = await db
      .insert(schema.reviews)
      .values({
        orgId: creative.orgId,
        workspaceId: creative.workspaceId,
        creativeId: id,
        reviewerType: type ?? "internal",
        reviewerId: user.id,
        decision: "pending",
      })
      .returning();

    const newStatus =
      type === "client" ? "pending_client_review" : "pending_internal_review";

    await db
      .update(schema.creatives)
      .set({ status: newStatus })
      .where(eq(schema.creatives.id, id));

    await db
      .update(schema.campaigns)
      .set({ status: newStatus })
      .where(eq(schema.campaigns.id, creative.campaignId));

    return apiSuccess({ review, campaignStatus: newStatus }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
