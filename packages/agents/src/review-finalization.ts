import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import type { StepProgress } from "@ceo-agent/shared";
import {
  assertMandatoryGatesComplete,
  type MandatoryGateInput,
} from "./mandatory-gates";

export interface ReviewFinalizationInput {
  taskId: string;
  campaignId: string;
  orgId: string;
  workspaceId: string;
  creativeIds: string[];
  progress: StepProgress;
}

/** Commits the Review-visible state only after callers have passed all gates. */
export async function commitReviewFinalization(
  input: ReviewFinalizationInput
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const creativeId of input.creativeIds) {
      const [existing] = await tx
        .select({ id: schema.reviews.id })
        .from(schema.reviews)
        .where(
          and(
            eq(schema.reviews.creativeId, creativeId),
            eq(schema.reviews.reviewerType, "internal"),
            eq(schema.reviews.decision, "pending")
          )
        )
        .limit(1);
      if (!existing) {
        await tx.insert(schema.reviews).values({
          orgId: input.orgId,
          workspaceId: input.workspaceId,
          creativeId,
          reviewerType: "internal",
          decision: "pending",
        });
      }
      await tx
        .update(schema.creatives)
        .set({ status: "pending_internal_review", updatedAt: new Date() })
        .where(eq(schema.creatives.id, creativeId));
    }
    await tx
      .update(schema.tasks)
      .set({
        status: "completed",
        completedAt: new Date(),
        stepProgress: input.progress,
        currentStep: "human_review",
      })
      .where(eq(schema.tasks.id, input.taskId));
    await tx
      .update(schema.campaigns)
      .set({ status: "pending_internal_review" })
      .where(eq(schema.campaigns.id, input.campaignId));
  });
}

export async function finalizeReviewAfterGates(
  gates: MandatoryGateInput[],
  input: ReviewFinalizationInput,
  commit: (value: ReviewFinalizationInput) => Promise<void> =
    commitReviewFinalization
): Promise<void> {
  for (const gate of gates) assertMandatoryGatesComplete(gate);
  await commit(input);
}
