import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import type { StepProgress } from "@ceo-agent/shared";
import {
  assertMandatoryGatesComplete,
  evaluateMandatoryGates,
  type MandatoryGateInput,
} from "./mandatory-gates";
import {
  FinalizationPipeline,
  readFinalizationResult,
  recordedGate,
  resolveFinalizationResult,
  type GateResult,
} from "./finalization-pipeline";

export interface ReviewFinalizationInput {
  taskId: string;
  campaignId: string;
  orgId: string;
  workspaceId: string;
  creativeIds: string[];
  finalOutputReferences: string[];
  progress: StepProgress;
}

/** Commits the Review-visible state only after callers have passed all gates. */
export async function commitReviewFinalization(
  input: ReviewFinalizationInput
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [lockedTask] = await tx
      .select({
        campaignId: schema.tasks.campaignId,
        orgId: schema.tasks.orgId,
        workspaceId: schema.tasks.workspaceId,
        stepProgress: schema.tasks.stepProgress,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, input.taskId))
      .for("update")
      .limit(1);
    if (!lockedTask) throw new Error("Finalization Task does not exist");
    if (
      lockedTask.campaignId !== input.campaignId ||
      lockedTask.orgId !== input.orgId ||
      lockedTask.workspaceId !== input.workspaceId
    ) {
      throw new Error("Finalization scope does not match persisted Task");
    }

    const candidate = readFinalizationResult(
      input.progress.finalization_pipeline?.output
    );
    const persistedProgress =
      (lockedTask.stepProgress as StepProgress | null) ?? {};
    const persisted = persistedProgress.finalization_pipeline?.output;
    if (persisted) {
      resolveFinalizationResult(persisted, candidate);
      return;
    }

    const committedProgress: StepProgress = {
      ...persistedProgress,
      ...input.progress,
      finalization_pipeline: {
        status: "completed",
        completedAt: candidate.timestamp,
        output: candidate,
      },
    };

    const persistedOutputReferences: string[] = [];
    for (const creativeId of input.creativeIds) {
      const [creative] = await tx
        .select({
          id: schema.creatives.id,
          renderStatus: schema.creatives.renderStatus,
          videoUrl: schema.creatives.videoUrl,
        })
        .from(schema.creatives)
        .where(
          and(
            eq(schema.creatives.id, creativeId),
            eq(schema.creatives.taskId, input.taskId),
            eq(schema.creatives.workspaceId, input.workspaceId)
          )
        )
        .limit(1);
      if (
        !creative ||
        creative.renderStatus !== "preview_ready" ||
        !creative.videoUrl
      ) {
        throw new Error(
          `Finalization output is not ready for Creative ${creativeId}`
        );
      }
      persistedOutputReferences.push(creative.videoUrl);

      const [existingReview] = await tx
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
      if (!existingReview) {
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
    if (
      [...persistedOutputReferences].sort().join("\n") !==
      [...input.finalOutputReferences].sort().join("\n")
    ) {
      throw new Error(
        "Finalization output references do not match persisted Creatives"
      );
    }
    await tx
      .update(schema.tasks)
      .set({
        status: "completed",
        completedAt: new Date(),
        stepProgress: committedProgress,
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

  const gateIds = [
    "validation",
    "compliance",
    "marketing_score",
    "creative_registration",
    "output_readiness",
  ] as const;
  const gateResults = gateIds.map<GateResult>((gateId) => ({
    gateId,
    status: gates.every(
      (gate) => !evaluateMandatoryGates(gate).missing.includes(gateId)
    )
      ? "PASS"
      : "FAIL",
    warnings: [],
    provenance: ["mandatory-gates"],
  }));
  const candidateFinalization = await new FinalizationPipeline().execute({
    taskId: input.taskId,
    campaignId: input.campaignId,
    finalOutputReferences: input.finalOutputReferences,
    inputCheckpoint: "VIDEO_RENDER_COMPLETE",
    gates: gateResults.map(recordedGate),
  });
  const existingFinalization = input.progress.finalization_pipeline?.output;
  const finalization = existingFinalization
    ? resolveFinalizationResult(existingFinalization, candidateFinalization)
    : candidateFinalization;
  const progress: StepProgress = {
    ...input.progress,
    finalization_pipeline: {
      status: "completed",
      completedAt: finalization.timestamp,
      output: finalization,
    },
  };
  await commit({ ...input, progress });
}
