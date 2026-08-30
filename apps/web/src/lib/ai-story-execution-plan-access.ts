/**
 * Sprint 3 Phase 2B PR 2B.4 — authorize Execution Plan under campaign/story route chain.
 * Never trusts route IDs independently. Foreign tenant IDs return NOT_FOUND (no existence leak).
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  assertExecutionPlanOwnershipChainInSingleQuery,
  getDb,
  schema,
} from "@ceo-agent/db";
import { isUuid, type WorkspaceRole } from "@ceo-agent/shared";
import { apiError } from "@/lib/api";
import { authorizeAiStoryAccess } from "@/lib/ai-story-access";

type Db = ReturnType<typeof getDb>;
export type RouteOwnershipValidationTiming = {
  readonly stage: "ownership_validation.compact_server_chain_proof";
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: 1;
  readonly roundTripCount: 1;
  readonly rowCount: number | null;
  readonly poolWaitMs: number | null;
};
export class RouteOwnershipValidationTimingRecorder {
  private startedAt: number | null = null;
  private row: RouteOwnershipValidationTiming = { stage: "ownership_validation.compact_server_chain_proof", status: "NOT_REACHED", durationMs: null, queryCount: 1, roundTripCount: 1, rowCount: null, poolWaitMs: null };
  async run(operation: () => Promise<void>): Promise<void> {
    const startedAt = performance.now();
    this.startedAt = startedAt;
    try {
      await operation();
      this.row = { ...this.row, status: "COMPLETED", durationMs: Math.round(performance.now() - startedAt), rowCount: 1 };
      this.startedAt = null;
    } catch (error) {
      this.row = { ...this.row, status: "FAILED", durationMs: Math.round(performance.now() - startedAt) };
      this.startedAt = null;
      throw error;
    }
  }
  markTimedOut(): void {
    if (this.startedAt === null) return;
    this.row = { ...this.row, status: "TIMED_OUT", durationMs: Math.round(performance.now() - this.startedAt) };
    this.startedAt = null;
  }
  snapshot(): readonly RouteOwnershipValidationTiming[] { return [this.row]; }
}
export type StoryLoadTiming = {
  readonly stage: "story_load.story_authority_current_version_read";
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: 1;
  readonly roundTripCount: 1;
  readonly rowCount: number | null;
  readonly poolWaitMs: number | null;
};
export class StoryLoadTimingRecorder {
  private startedAt: number | null = null;
  private row: StoryLoadTiming = { stage: "story_load.story_authority_current_version_read", status: "NOT_REACHED", durationMs: null, queryCount: 1, roundTripCount: 1, rowCount: null, poolWaitMs: null };
  async run<T>(operation: () => Promise<T>, rowCount: (value: T) => number): Promise<T> {
    const startedAt = performance.now();
    this.startedAt = startedAt;
    try {
      const value = await operation();
      this.row = { ...this.row, status: "COMPLETED", durationMs: Math.round(performance.now() - startedAt), rowCount: rowCount(value) };
      this.startedAt = null;
      return value;
    } catch (error) {
      this.row = { ...this.row, status: "FAILED", durationMs: Math.round(performance.now() - startedAt) };
      this.startedAt = null;
      throw error;
    }
  }
  markTimedOut(): void {
    if (this.startedAt === null) return;
    this.row = { ...this.row, status: "TIMED_OUT", durationMs: Math.round(performance.now() - this.startedAt) };
    this.startedAt = null;
  }
  snapshot(): readonly StoryLoadTiming[] { return [this.row]; }
}
export type ExecutionPlanLoadTiming = {
  readonly stage: "execution_plan_load.plan_authority_row_read";
  readonly status: "COMPLETED" | "TIMED_OUT" | "FAILED" | "NOT_REACHED";
  readonly durationMs: number | null;
  readonly queryCount: 1;
  readonly roundTripCount: 1;
  readonly rowCount: number | null;
  readonly poolWaitMs: number | null;
};
export class ExecutionPlanLoadTimingRecorder {
  private startedAt: number | null = null;
  private row: ExecutionPlanLoadTiming = { stage: "execution_plan_load.plan_authority_row_read", status: "NOT_REACHED", durationMs: null, queryCount: 1, roundTripCount: 1, rowCount: null, poolWaitMs: null };
  async run<T>(operation: () => Promise<T>, rowCount: (value: T) => number): Promise<T> {
    const startedAt = performance.now();
    this.startedAt = startedAt;
    try {
      const value = await operation();
      this.row = { ...this.row, status: "COMPLETED", durationMs: Math.round(performance.now() - startedAt), rowCount: rowCount(value) };
      this.startedAt = null;
      return value;
    } catch (error) {
      this.row = { ...this.row, status: "FAILED", durationMs: Math.round(performance.now() - startedAt) };
      this.startedAt = null;
      throw error;
    }
  }
  markTimedOut(): void {
    if (this.startedAt === null) return;
    this.row = { ...this.row, status: "TIMED_OUT", durationMs: Math.round(performance.now() - this.startedAt) };
    this.startedAt = null;
  }
  snapshot(): readonly ExecutionPlanLoadTiming[] { return [this.row]; }
}

type ExecutionPlanRouteAuthority = Pick<
  typeof schema.aiStoryExecutionPlans.$inferSelect,
  "id" | "orgId" | "workspaceId" | "campaignId" | "storyId" |
  "storyVersionId" | "animationPackageId" | "status"
>;

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
  readonly plan: ExecutionPlanRouteAuthority;
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
  readonly storyLoadTimingRecorder?: StoryLoadTimingRecorder;
  readonly executionPlanLoadTimingRecorder?: ExecutionPlanLoadTimingRecorder;
  readonly routeOwnershipValidationTimingRecorder?: RouteOwnershipValidationTimingRecorder;
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

  const storyTiming = input.storyLoadTimingRecorder ?? new StoryLoadTimingRecorder();
  const [story] = await observe("story_load", () => storyTiming.run(
    () => db
      .select({
        id: schema.aiStories.id,
        orgId: schema.aiStories.orgId,
        workspaceId: schema.aiStories.workspaceId,
        campaignId: schema.aiStories.campaignId,
        title: schema.aiStories.title,
        status: schema.aiStories.status,
        currentVersionId: schema.aiStories.currentVersionId,
        verificationFixture: sql<boolean>`coalesce(${schema.aiStoryVersions.sourceContextSnapshot} @> '{"verificationFixture": true}'::jsonb, false)`,
      })
      .from(schema.aiStories)
      .leftJoin(
        schema.aiStoryVersions,
        and(
          eq(schema.aiStoryVersions.id, schema.aiStories.currentVersionId),
          eq(schema.aiStoryVersions.storyId, schema.aiStories.id)
        )
      )
      .where(
        and(
          eq(schema.aiStories.id, storyId),
          eq(schema.aiStories.campaignId, campaignId),
          eq(schema.aiStories.workspaceId, campaign.workspaceId),
          eq(schema.aiStories.orgId, campaign.orgId),
          isNull(schema.aiStories.archivedAt)
        )
      )
      .limit(1),
    (rows) => rows.length
  ));
  if (!story) {
    throw new ExecutionPlanRouteNotFoundError("AI Story not found");
  }

  const planTiming = input.executionPlanLoadTimingRecorder ?? new ExecutionPlanLoadTimingRecorder();
  const [plan] = await observe("execution_plan_load", () => planTiming.run(
    () => db
      .select({
        id: schema.aiStoryExecutionPlans.id,
        orgId: schema.aiStoryExecutionPlans.orgId,
        workspaceId: schema.aiStoryExecutionPlans.workspaceId,
        campaignId: schema.aiStoryExecutionPlans.campaignId,
        storyId: schema.aiStoryExecutionPlans.storyId,
        storyVersionId: schema.aiStoryExecutionPlans.storyVersionId,
        animationPackageId: schema.aiStoryExecutionPlans.animationPackageId,
        status: schema.aiStoryExecutionPlans.status,
      })
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
      .limit(1),
    (rows) => rows.length
  ));

  if (!plan) {
    // Same response for missing and foreign — do not leak tenant existence.
    throw new ExecutionPlanRouteNotFoundError("Execution Plan not found");
  }

  const ownershipTiming = input.routeOwnershipValidationTimingRecorder ?? new RouteOwnershipValidationTimingRecorder();
  await observe("ownership_validation", () => ownershipTiming.run(
    () => assertExecutionPlanOwnershipChainInSingleQuery(plan, db)
  ));

  return {
    db,
    userId,
    campaignId,
    storyId,
    executionPlanId,
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    storyTitle: story.title,
    storyStatus: story.status,
    verificationFixture: story.verificationFixture,
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
