import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { enqueueFinalRenderForCreative } from "@/lib/render-queue";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    const body = await request.json();
    const { decision, comment } = body as {
      decision: "approved" | "rejected";
      comment?: string;
    };

    const db = getDb();
    const [review] = await db
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, id))
      .limit(1);

    if (!review) return apiError("Review not found", "NOT_FOUND", 404);
    await requireWorkspaceRole(review.workspaceId, user.id, "reviewer");

    const [updatedReview] = await db
      .update(schema.reviews)
      .set({
        decision,
        comment,
        decidedAt: new Date(),
      })
      .where(eq(schema.reviews.id, id))
      .returning();

    const [creative] = await db
      .select()
      .from(schema.creatives)
      .where(eq(schema.creatives.id, review.creativeId))
      .limit(1);

    let nextAction: string | undefined;
    let newCreativeStatus = creative?.status;
    let newCampaignStatus: string | undefined;

    if (decision === "approved") {
      if (review.reviewerType === "internal") {
        newCreativeStatus = "pending_client_review";
        newCampaignStatus = "pending_client_review";
        nextAction = "generate_client_invite";
      } else {
        newCreativeStatus = "approved";
        newCampaignStatus = "approved";
        nextAction = "final_render";
      }
    } else {
      newCreativeStatus = "compliance_failed";
      newCampaignStatus = "pending_internal_review";
      nextAction = review.reviewerType === "client" ? "client_rejected" : "retry_copy_or_edit";
    }

    if (creative && newCreativeStatus) {
      await db
        .update(schema.creatives)
        .set({ status: newCreativeStatus })
        .where(eq(schema.creatives.id, creative.id));
    }

    if (creative && newCampaignStatus) {
      await db
        .update(schema.campaigns)
        .set({ status: newCampaignStatus })
        .where(eq(schema.campaigns.id, creative.campaignId));
    }

    if (decision === "approved" && review.reviewerType === "client" && creative) {
      await enqueueFinalRenderForCreative(creative.id);
    }

    return apiSuccess({
      review: updatedReview,
      creative: creative ? { ...creative, status: newCreativeStatus } : null,
      nextAction,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
