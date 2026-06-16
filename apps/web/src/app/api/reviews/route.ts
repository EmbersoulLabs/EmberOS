import { eq, and } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const status = searchParams.get("status") ?? "pending";

    if (!workspaceId) return apiError("workspaceId is required", "VALIDATION_ERROR");
    await requireWorkspaceRole(workspaceId, user.id, "reviewer");

    const db = getDb();
    const reviews = await db
      .select({
        review: schema.reviews,
        creative: schema.creatives,
        campaign: schema.campaigns,
      })
      .from(schema.reviews)
      .innerJoin(schema.creatives, eq(schema.reviews.creativeId, schema.creatives.id))
      .innerJoin(schema.campaigns, eq(schema.creatives.campaignId, schema.campaigns.id))
      .where(
        and(
          eq(schema.reviews.workspaceId, workspaceId),
          eq(schema.reviews.decision, status)
        )
      );

    return apiSuccess({ reviews });
  } catch (error) {
    return handleApiError(error);
  }
}
