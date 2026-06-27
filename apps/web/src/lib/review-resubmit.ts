import { eq, and } from "drizzle-orm";
import type { getDb } from "@ceo-agent/db";
import { schema } from "@ceo-agent/db";
import { canSubmitCreativeForReview } from "@ceo-agent/shared";
import { syncCampaignStatusFromCreatives } from "./review-flow";

type Db = ReturnType<typeof getDb>;

export type ReviewSubmitType = "internal" | "client";

export { canSubmitCreativeForReview, latestRejectedReview } from "@ceo-agent/shared";

export async function findPendingReview(db: Db, creativeId: string) {
  const [row] = await db
    .select({ id: schema.reviews.id })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.creativeId, creativeId), eq(schema.reviews.decision, "pending")))
    .limit(1);
  return row ?? null;
}

export async function submitCreativeForReview(
  db: Db,
  params: {
    creativeId: string;
    userId: string;
    type: ReviewSubmitType;
  }
) {
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(eq(schema.creatives.id, params.creativeId))
    .limit(1);

  if (!creative) {
    return { error: "Creative not found", code: "NOT_FOUND" as const };
  }

  const pending = await findPendingReview(db, params.creativeId);
  const gate = canSubmitCreativeForReview(creative.status, Boolean(pending));
  if (!gate.ok) {
    return { error: gate.message, code: gate.code };
  }

  const reviewType = params.type ?? "internal";
  const [review] = await db
    .insert(schema.reviews)
    .values({
      orgId: creative.orgId,
      workspaceId: creative.workspaceId,
      creativeId: params.creativeId,
      reviewerType: reviewType,
      reviewerId: params.userId,
      decision: "pending",
    })
    .returning();

  const newCreativeStatus =
    reviewType === "client" ? "pending_client_review" : "pending_internal_review";

  await db
    .update(schema.creatives)
    .set({ status: newCreativeStatus, updatedAt: new Date() })
    .where(eq(schema.creatives.id, params.creativeId));

  const campaignStatus = await syncCampaignStatusFromCreatives(
    db,
    creative.campaignId,
    creative.workspaceId
  );

  await db
    .update(schema.campaigns)
    .set({ status: campaignStatus, updatedAt: new Date() })
    .where(eq(schema.campaigns.id, creative.campaignId));

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
              status: "pending",
              completedAt: undefined,
              output: { creativeId: params.creativeId, resubmittedAt: new Date().toISOString() },
            },
          },
          currentStep: "human_review",
        })
        .where(eq(schema.tasks.id, task.id));
    }
  }

  return { review, campaignStatus, creativeStatus: newCreativeStatus };
}
