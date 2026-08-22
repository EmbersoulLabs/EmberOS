import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import {
  ExecutionPlanRouteNotFoundError,
  ExecutionPlanRouteValidationError,
} from "@/lib/ai-story-execution-plan-access";

export class AmbiguousCurrentExecutionPlanError extends Error {
  readonly code = "EXECUTION_PLAN_IDENTITY_CONFLICT";
  readonly status = 409;

  constructor() {
    super("Current Execution Plan authority is ambiguous");
    this.name = "AmbiguousCurrentExecutionPlanError";
  }
}

/**
 * Read-only current-plan discovery. The canonical identity is the exact current
 * Story Version plus its current approved Animation Package. Ambiguity fails
 * closed; this function never compiles or persists a plan.
 */
export async function discoverCurrentExecutionPlan(input: {
  userId: string;
  campaignId: string;
  storyId: string;
}) {
  if (!isUuid(input.campaignId) || !isUuid(input.storyId)) {
    throw new ExecutionPlanRouteValidationError("Invalid id");
  }

  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, input.campaignId))
    .limit(1);
  if (!campaign) throw new ExecutionPlanRouteNotFoundError("Campaign not found");

  await authorizeAiStoryAccess({
    user: { id: input.userId },
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    minRole: "client_viewer",
  });

  const loaded = await loadCampaignAiStory(
    db,
    input.campaignId,
    input.storyId,
    campaign.workspaceId
  );
  const currentVersionId = loaded?.story.currentVersionId;
  if (!loaded || !currentVersionId) {
    if (!loaded) throw new ExecutionPlanRouteNotFoundError("AI Story not found");
    return { executionPlan: null } as const;
  }

  const [currentPackage] = await db
    .select({ id: schema.aiStoryAnimationPackages.id })
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.orgId, campaign.orgId),
        eq(schema.aiStoryAnimationPackages.workspaceId, campaign.workspaceId),
        eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
        eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, currentVersionId),
        eq(schema.aiStoryAnimationPackages.status, "ready_for_execution")
      )
    )
    .orderBy(
      desc(schema.aiStoryAnimationPackages.approvedAt),
      desc(schema.aiStoryAnimationPackages.createdAt),
      desc(schema.aiStoryAnimationPackages.id)
    )
    .limit(1);

  if (!currentPackage) return { executionPlan: null } as const;

  const plans = await db
    .select({
      id: schema.aiStoryExecutionPlans.id,
      status: schema.aiStoryExecutionPlans.status,
      storyVersionId: schema.aiStoryExecutionPlans.storyVersionId,
      animationPackageId: schema.aiStoryExecutionPlans.animationPackageId,
      compiledAt: schema.aiStoryExecutionPlans.compiledAt,
    })
    .from(schema.aiStoryExecutionPlans)
    .where(
      and(
        eq(schema.aiStoryExecutionPlans.orgId, campaign.orgId),
        eq(schema.aiStoryExecutionPlans.workspaceId, campaign.workspaceId),
        eq(schema.aiStoryExecutionPlans.campaignId, input.campaignId),
        eq(schema.aiStoryExecutionPlans.storyId, input.storyId),
        eq(schema.aiStoryExecutionPlans.storyVersionId, currentVersionId),
        eq(schema.aiStoryExecutionPlans.animationPackageId, currentPackage.id)
      )
    )
    .orderBy(
      desc(schema.aiStoryExecutionPlans.compiledAt),
      desc(schema.aiStoryExecutionPlans.createdAt),
      desc(schema.aiStoryExecutionPlans.id)
    )
    .limit(2);

  if (plans.length > 1) throw new AmbiguousCurrentExecutionPlanError();
  const plan = plans[0];
  if (!plan) return { executionPlan: null } as const;

  const scenes = await db
    .select({ id: schema.aiStorySceneExecutions.id })
    .from(schema.aiStorySceneExecutions)
    .where(
      and(
        eq(schema.aiStorySceneExecutions.executionPlanId, plan.id),
        eq(schema.aiStorySceneExecutions.workspaceId, campaign.workspaceId),
        eq(schema.aiStorySceneExecutions.storyId, input.storyId)
      )
    );

  return {
    executionPlan: {
      executionPlanId: plan.id,
      status: plan.status,
      storyVersionId: plan.storyVersionId,
      animationPackageId: plan.animationPackageId,
      sceneIntentCount: scenes.length,
      compiledAt: plan.compiledAt.toISOString(),
    },
  } as const;
}
