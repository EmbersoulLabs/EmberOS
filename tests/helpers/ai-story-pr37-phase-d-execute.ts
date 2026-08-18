/**
 * Sprint 3 PR 3.7 Phase D helpers — READY plan without RuntimeAuthorizedFact.
 */
import {
  AiStorySceneExecutionPersistenceRepository,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
} from "@ceo-agent/db";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
} from "./ai-story-pr32-scheduling";
import {
  makePhase2aCompilation,
  PHASE_2A_IDS,
  type Phase2aIdSet,
} from "./ai-story-phase-2a";
import { seedBillableCommercialPrerequisites } from "./commercial-billable-execute";

export { FixedSeedanceRouter, PR32_USER_A };

/**
 * Compile + approve Review + create Assembly. Does NOT authorize or schedule.
 * Seeds billable commercial prerequisites for Phase E Execute gate.
 * Use for canonical Execute integration tests.
 */
export async function prepareReadyForCanonicalExecute(input: {
  readonly purpose: string;
  readonly ids?: Phase2aIdSet;
  readonly userId?: string;
  readonly sceneOrder?: readonly number[];
  readonly seedCommercial?: boolean;
}) {
  const ids = input.ids ?? PHASE_2A_IDS;
  const userId = input.userId ?? PR32_USER_A;
  if (input.seedCommercial !== false) {
    await seedBillableCommercialPrerequisites({
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
    });
  }
  const persisted = await new AiStorySceneExecutionPersistenceRepository().persistCompilation(
    makePhase2aCompilation({
      ids,
      instructionPurpose: `${input.purpose}-${crypto.randomUUID()}`,
      sceneOrder: input.sceneOrder,
    })
  );
  const executionPlanId = persisted.plan.storyExecutionId;
  const sceneExecutionIds = persisted.intents.map(
    (intent) => intent.identity.sceneExecutionId
  );

  const review = new ExecutionPlanReviewRepository();
  await review.openReview({ executionPlanId, openedBy: userId });
  for (const sceneExecutionId of sceneExecutionIds) {
    await review.appendSceneIntentDecision({
      executionPlanId,
      sceneExecutionId,
      decision: "APPROVED",
      reviewedBy: userId,
    });
  }
  await review.appendStoryDecision({
    executionPlanId,
    decision: "APPROVED",
    reviewedBy: userId,
  });

  const assembly = await new ExecutionPlanAssemblyRepository().createOrReturnAssembly({
    executionPlanId,
    createdBy: userId,
    orderedSceneExecutionIds: sceneExecutionIds,
  });

  const ownership = {
    orgId: ids.orgId,
    workspaceId: ids.workspaceId,
    campaignId: ids.campaignId,
    storyId: ids.storyId,
    storyVersionId: ids.storyVersionId,
    animationPackageId: ids.animationPackageId,
    executionPlanId,
  };

  return {
    persisted,
    executionPlanId,
    sceneExecutionIds,
    assembly,
    ownership,
    userId,
    ids,
  };
}
