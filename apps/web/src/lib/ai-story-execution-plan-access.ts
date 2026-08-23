/**
 * Sprint 3 Phase 2B PR 2B.4 — authorize Execution Plan under campaign/story route chain.
 * Never trusts route IDs independently. Foreign tenant IDs return NOT_FOUND (no existence leak).
 */
import { and, eq } from "drizzle-orm";
import {
  assertExecutionPlanOwnershipChain,
  getDb,
  schema,
} from "@ceo-agent/db";
import { isUuid, type WorkspaceRole } from "@ceo-agent/shared";
import { apiError } from "@/lib/api";
import { loadCampaignAiStory } from "@/lib/ai-story-service";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

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
  readonly storyTitle: string;
  readonly storyStatus: string;
  readonly verificationFixture: boolean;
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
  readonly observeStage?: <T>(stage: "workspace_authorization" | "story_load" | "execution_plan_load" | "ownership_validation", operation: () => Promise<T>) => Promise<T>;
}): Promise<AuthorizedExecutionPlanContext> {
  const { userId, campaignId, storyId, executionPlanId, minRole } = input;
  const observe = input.observeStage ?? (async (_stage, operation) => operation());
  if (!isUuid(campaignId) || !isUuid(storyId) || !isUuid(executionPlanId)) {
    throw new ExecutionPlanRouteValidationError("Invalid id");
  }

  const db = getDb();
  const [campaign] = await observe("workspace_authorization", () => db
    .select()
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1));
  if (!campaign) {
    throw new ExecutionPlanRouteNotFoundError("Campaign not found");
  }

  await observe("workspace_authorization", () => authorizeAiStoryAccess({
    user: { id: userId },
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    minRole,
  }));

  const loaded = await observe("story_load", () => loadCampaignAiStory(db, campaignId, storyId, campaign.workspaceId));
  if (!loaded) {
    throw new ExecutionPlanRouteNotFoundError("AI Story not found");
  }

  const [plan] = await observe("execution_plan_load", () => db
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
    .limit(1));

  if (!plan) {
    // Same response for missing and foreign — do not leak tenant existence.
    throw new ExecutionPlanRouteNotFoundError("Execution Plan not found");
  }

  await observe("ownership_validation", () => assertExecutionPlanOwnershipChain(plan, db));

  return {
    db,
    userId,
    campaignId,
    storyId,
    executionPlanId,
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    storyTitle: loaded.story.title,
    storyStatus: loaded.story.status,
    verificationFixture:
      loaded.currentVersion?.sourceContextSnapshot?.verificationFixture === true,
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
