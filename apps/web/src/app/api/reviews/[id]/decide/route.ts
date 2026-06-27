import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError, generateToken } from "@/lib/api";
import { enqueueFinalRenderForCreative } from "@/lib/render-queue";
import {
  createClientInvite,
  resolveWorkspaceReviewSettings,
  syncCampaignStatusFromCreatives,
} from "@/lib/review-flow";

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

    if (!creative) {
      return apiSuccess({ review: updatedReview, creative: null });
    }

    let nextAction: string | undefined;
    let newCreativeStatus = creative.status;
    let inviteUrl: string | undefined;

    const { skipClient } = await resolveWorkspaceReviewSettings(db, review.workspaceId);

    if (decision === "approved") {
      if (review.reviewerType === "internal") {
        if (skipClient) {
          newCreativeStatus = "approved";
          nextAction = "final_render";
          await enqueueFinalRenderForCreative(creative.id);
        } else {
          newCreativeStatus = "pending_client_review";
          nextAction = "generate_client_invite";
          const { inviteUrl: url } = await createClientInvite(db, {
            orgId: review.orgId,
            workspaceId: review.workspaceId,
            creativeId: creative.id,
            token: generateToken(),
            createdBy: user.id,
          });
          inviteUrl = url;
        }
      } else {
        newCreativeStatus = "approved";
        nextAction = "final_render";
        await enqueueFinalRenderForCreative(creative.id);
      }
    } else {
      newCreativeStatus = "compliance_failed";
      nextAction = review.reviewerType === "client" ? "client_rejected" : "retry_copy_or_edit";

      if (creative.taskId) {
        const [task] = await db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.id, creative.taskId))
          .limit(1);

        if (task) {
          const progress = (task.stepProgress as Record<string, unknown>) ?? {};
          const humanReview = (progress.human_review as Record<string, unknown>) ?? {};
          await db
            .update(schema.tasks)
            .set({
              stepProgress: {
                ...progress,
                human_review: {
                  ...humanReview,
                  status: "failed",
                  completedAt: new Date().toISOString(),
                  error: comment ?? "Review rejected",
                  output: { creativeId: creative.id, reviewerType: review.reviewerType },
                },
              },
              currentStep: "human_review",
            })
            .where(eq(schema.tasks.id, task.id));
        }
      }
    }

    await db
      .update(schema.creatives)
      .set({ status: newCreativeStatus })
      .where(eq(schema.creatives.id, creative.id));

    const newCampaignStatus = await syncCampaignStatusFromCreatives(
      db,
      creative.campaignId,
      creative.workspaceId
    );

    await db
      .update(schema.campaigns)
      .set({ status: newCampaignStatus })
      .where(eq(schema.campaigns.id, creative.campaignId));

    if (decision === "approved") {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, creative.taskId))
        .limit(1);

      if (task) {
        const progress = (task.stepProgress as Record<string, unknown>) ?? {};
        const humanReview = (progress.human_review as Record<string, unknown>) ?? {};
        const exportReady = newCampaignStatus === "approved" || newCampaignStatus === "export_ready";

        await db
          .update(schema.tasks)
          .set({
            stepProgress: {
              ...progress,
              human_review: {
                ...humanReview,
                status: exportReady ? "completed" : "pending",
                completedAt: exportReady ? new Date().toISOString() : undefined,
              },
              export_ready: exportReady
                ? { status: "pending", startedAt: new Date().toISOString() }
                : { status: "pending" },
            },
            currentStep: exportReady ? "export_ready" : "human_review",
          })
          .where(eq(schema.tasks.id, task.id));
      }
    }

    return apiSuccess({
      review: updatedReview,
      creative: { ...creative, status: newCreativeStatus },
      campaignStatus: newCampaignStatus,
      nextAction,
      inviteUrl,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
