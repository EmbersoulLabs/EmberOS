import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { getDb, requireWorkspaceRole } from "@ceo-agent/db";
import { eq } from "drizzle-orm";
import { schema } from "@ceo-agent/db";
import { submitCreativeForReview } from "@/lib/review-resubmit";

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
      .select({ workspaceId: schema.creatives.workspaceId })
      .from(schema.creatives)
      .where(eq(schema.creatives.id, id))
      .limit(1);

    if (!creative) return apiError("Creative not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(creative.workspaceId, user.id, "operator");

    const result = await submitCreativeForReview(db, {
      creativeId: id,
      userId: user.id,
      type: type ?? "internal",
    });

    if ("error" in result && result.error) {
      const status =
        result.code === "NOT_FOUND" ? 404 : result.code === "REVIEW_PENDING" ? 409 : 400;
      return apiError(result.error, result.code ?? "VALIDATION_ERROR", status);
    }

    return apiSuccess(
      {
        review: result.review,
        campaignStatus: result.campaignStatus,
        creativeStatus: result.creativeStatus,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
