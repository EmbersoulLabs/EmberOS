import { and, eq, isNull, sql } from "drizzle-orm";
import { AnimationPackagePayloadSchema, type StoryReviewDecision } from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { ExecutionPlanReviewRepository } from "./ai-story-execution-plan-review";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;
type AnimationPackageRow = typeof schema.aiStoryAnimationPackages.$inferSelect;

export class AnimationPackageApprovalConvergenceError extends Error {
  readonly status = 409;

  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AnimationPackageApprovalConvergenceError";
  }
}

export type AnimationPackageApprovalProjectionState =
  | "CURRENT"
  | "MISSING_RECOVERABLE";

function isHistoricalExecutionMaterializationPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  const authority = root.authority;
  return (
    root.contractVersion === "ai-story-execution-materialization.v1" &&
    Boolean(authority) &&
    typeof authority === "object" &&
    !Array.isArray(authority) &&
    (authority as Record<string, unknown>).contractVersion ===
      "ai-story-execution-materialization.v1"
  );
}

/**
 * Execution Review facts are the immutable execution-approval authority.
 * Animation Package approved_by/approved_at are a planning approval projection.
 * A completely absent historical projection may be recovered from the stronger,
 * exact Execution Plan Story Review. Partial metadata is an authority conflict.
 */
export function certifyAnimationPackageApprovalProjection(input: {
  readonly packageStatus: string;
  readonly packagePayload: unknown;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly reviewStatus: string;
  readonly storyDecision: StoryReviewDecision | null;
}): AnimationPackageApprovalProjectionState {
  if (
    input.reviewStatus !== "APPROVED" ||
    input.storyDecision?.decision !== "APPROVED"
  ) {
    throw new AnimationPackageApprovalConvergenceError(
      "CANONICAL_EXECUTION_REVIEW_NOT_APPROVED",
      "The exact Execution Plan has no canonical approved Story Review"
    );
  }
  if (input.packageStatus !== "ready_for_execution") {
    throw new AnimationPackageApprovalConvergenceError(
      "ANIMATION_PACKAGE_NOT_READY",
      "The exact Animation Package is not ready_for_execution"
    );
  }

  const fullPayload = AnimationPackagePayloadSchema.safeParse(input.packagePayload);
  if (fullPayload.success && fullPayload.data.status !== "ready_for_execution") {
    throw new AnimationPackageApprovalConvergenceError(
      "ANIMATION_PACKAGE_APPROVAL_STATE_MISMATCH",
      "Animation Package row and full planning payload approval states disagree"
    );
  }
  const historicalPayload = isHistoricalExecutionMaterializationPayload(
    input.packagePayload
  );
  if (!fullPayload.success && !historicalPayload) {
    throw new AnimationPackageApprovalConvergenceError(
      "ANIMATION_PACKAGE_PAYLOAD_INVALID",
      "Animation Package is neither a canonical planning payload nor a recognized historical execution materialization"
    );
  }

  const hasApprover = input.approvedBy !== null;
  const hasTimestamp = input.approvedAt !== null;
  if (hasApprover !== hasTimestamp) {
    throw new AnimationPackageApprovalConvergenceError(
      "ANIMATION_PACKAGE_APPROVAL_PROJECTION_CONFLICT",
      "Animation Package approval projection is partial or conflicting"
    );
  }
  if (
    historicalPayload &&
    hasApprover &&
    (input.approvedBy !== input.storyDecision.reviewedBy ||
      input.approvedAt?.toISOString() !== input.storyDecision.reviewedAt)
  ) {
    throw new AnimationPackageApprovalConvergenceError(
      "ANIMATION_PACKAGE_APPROVAL_PROJECTION_CONFLICT",
      "Historical Animation Package projection conflicts with its canonical approved Review fact"
    );
  }
  return hasApprover ? "CURRENT" : "MISSING_RECOVERABLE";
}

export type ConvergedAnimationPackageApproval = {
  readonly animationPackage: AnimationPackageRow;
  readonly storyDecision: StoryReviewDecision;
  readonly recovered: boolean;
};

export async function convergeAnimationPackageApprovalFromCanonicalReview(
  db: QueryDb,
  input: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly animationPackageId: string;
    readonly executionPlanId: string;
  }
): Promise<ConvergedAnimationPackageApproval> {
  const run = async (tx: Tx): Promise<ConvergedAnimationPackageApproval> => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`ai-story-package-approval-convergence:${input.executionPlanId}`}))`
    );
    const [plan] = await tx
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(
        and(
          eq(schema.aiStoryExecutionPlans.id, input.executionPlanId),
          eq(schema.aiStoryExecutionPlans.orgId, input.orgId),
          eq(schema.aiStoryExecutionPlans.workspaceId, input.workspaceId),
          eq(schema.aiStoryExecutionPlans.campaignId, input.campaignId),
          eq(schema.aiStoryExecutionPlans.storyId, input.storyId),
          eq(schema.aiStoryExecutionPlans.storyVersionId, input.storyVersionId),
          eq(schema.aiStoryExecutionPlans.animationPackageId, input.animationPackageId)
        )
      )
      .limit(1)
      .for("share");
    if (!plan) {
      throw new AnimationPackageApprovalConvergenceError(
        "EXECUTION_PLAN_PACKAGE_AUTHORITY_MISMATCH",
        "Execution Plan does not bind the exact scoped Animation Package"
      );
    }

    const review = await new ExecutionPlanReviewRepository(tx as never)
      .getLogicalProjection(input.executionPlanId, tx);
    const [packageRow] = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, input.animationPackageId),
          eq(schema.aiStoryAnimationPackages.orgId, input.orgId),
          eq(schema.aiStoryAnimationPackages.workspaceId, input.workspaceId),
          eq(schema.aiStoryAnimationPackages.campaignId, input.campaignId),
          eq(schema.aiStoryAnimationPackages.storyId, input.storyId),
          eq(schema.aiStoryAnimationPackages.storyVersionId, input.storyVersionId)
        )
      )
      .limit(1)
      .for("update");
    if (!review || !packageRow) {
      throw new AnimationPackageApprovalConvergenceError(
        "APPROVAL_AUTHORITY_MISSING",
        "Exact Review or Animation Package authority is missing"
      );
    }
    const state = certifyAnimationPackageApprovalProjection({
      packageStatus: packageRow.status,
      packagePayload: packageRow.payload,
      approvedBy: packageRow.approvedBy,
      approvedAt: packageRow.approvedAt,
      reviewStatus: review.status,
      storyDecision: review.storyDecision,
    });
    const decision = review.storyDecision!;
    if (state === "CURRENT") {
      return { animationPackage: packageRow, storyDecision: decision, recovered: false };
    }

    const [updated] = await tx
      .update(schema.aiStoryAnimationPackages)
      .set({
        approvedBy: decision.reviewedBy,
        approvedAt: new Date(decision.reviewedAt),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.aiStoryAnimationPackages.id, packageRow.id),
          isNull(schema.aiStoryAnimationPackages.approvedBy),
          isNull(schema.aiStoryAnimationPackages.approvedAt)
        )
      )
      .returning();
    if (updated) {
      return { animationPackage: updated, storyDecision: decision, recovered: true };
    }

    const [raced] = await tx
      .select()
      .from(schema.aiStoryAnimationPackages)
      .where(eq(schema.aiStoryAnimationPackages.id, packageRow.id))
      .limit(1);
    if (
      !raced ||
      raced.approvedBy !== decision.reviewedBy ||
      raced.approvedAt?.toISOString() !== decision.reviewedAt
    ) {
      throw new AnimationPackageApprovalConvergenceError(
        "ANIMATION_PACKAGE_APPROVAL_PROJECTION_CONFLICT",
        "Animation Package approval projection changed to conflicting authority"
      );
    }
    return { animationPackage: raced, storyDecision: decision, recovered: false };
  };

  if (typeof (db as Partial<Db>).transaction === "function") {
    return (db as Db).transaction(run);
  }
  return run(db as Tx);
}
