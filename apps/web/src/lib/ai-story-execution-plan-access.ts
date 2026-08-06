/**
 * Sprint 3 Phase 2B PR 2B.4 — authorize Execution Plan under campaign/story route chain.
 * Never trusts route IDs independently. Foreign tenant IDs return NOT_FOUND (no existence leak).
 */
import { and, eq } from "drizzle-orm";
import {
  assertExecutionPlanOwnershipChain,
  getDb,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import { isUuid, type WorkspaceRole } from "@ceo-agent/shared";
import { apiError } from "@/lib/api";
import { loadCampaignAiStory } from "@/lib/ai-story-service";

type Db = ReturnType<typeof getDb>;

export class ExecutionPlanRouteNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(message = "Execution Plan not found") {
    super(message);
    this.name = "ExecutionPlanRouteNotFoundError";
  }
}

export class ExecutionPlanRouteValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ExecutionPlanRouteValidationError";
  }
}

export type AuthorizedExecutionPlanContext = {
  readonly db: Db;
  readonly userId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly executionPlanId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly plan: typeof schema.aiStoryExecutionPlans.$inferSelect;
};

/**
 * Resolve campaign → story → execution plan ownership for authenticated caller.
 * Writes use operator; reads use client_viewer (or higher).
 */
export async function resolveAuthorizedExecutionPlan(input: {
  readonly userId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly executionPlanId: string;
  readonly minRole: WorkspaceRole;
}): Promise<AuthorizedExecutionPlanContext> {
  const { userId, campaignId, storyId, executionPlanId, minRole } = input;
  if (!isUuid(campaignId) || !isUuid(storyId) || !isUuid(executionPlanId)) {
    throw new ExecutionPlanRouteValidationError("Invalid id");
  }

  const db = getDb();
  const [campaign] = await db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);
  if (!campaign) {
    throw new ExecutionPlanRouteNotFoundError("Campaign not found");
  }

  await requireWorkspaceRole(campaign.workspaceId, userId, minRole);

  const loaded = await loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId);
  if (!loaded) {
    throw new ExecutionPlanRouteNotFoundError("AI Story not found");
  }

  const [plan] = await db
    .select()
    .from(schema.aiStoryExecutionPlans)
    .where(
      and(
        eq(schema.aiStoryExecutionPlans.id, executionPlanId),
        eq(schema.aiStoryExecutionPlans.campaignId, campaignId),
        eq(schema.aiStoryExecutionPlans.storyId, storyId),
        eq(schema.aiStoryExecutionPlans.workspaceId, campaign.workspaceId),
        eq(schema.aiStoryExecutionPlans.orgId, campaign.orgId)
      )
    )
    .limit(1);

  if (!plan) {
    // Same response for missing and foreign — do not leak tenant existence.
    throw new ExecutionPlanRouteNotFoundError("Execution Plan not found");
  }

  await assertExecutionPlanOwnershipChain(plan, db);

  return {
    db,
    userId,
    campaignId,
    storyId,
    executionPlanId,
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    plan,
  };
}

/** Convert route access errors to NextResponse when not using handleApiError path. */
export function executionPlanRouteErrorResponse(error: unknown) {
  if (
    error instanceof ExecutionPlanRouteNotFoundError ||
    error instanceof ExecutionPlanRouteValidationError
  ) {
    return apiError(error.message, error.code, error.status);
  }
  return null;
}
