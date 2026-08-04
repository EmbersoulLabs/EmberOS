/**
 * Sprint 3 Phase 2B PR 2B.3 — canonical AI Story ownership validation.
 *
 * Complements (does not replace) RLS. Authorization requires both:
 * 1) Foreign-key ownership chain integrity in the database
 * 2) Duplicated ownership columns on subordinate rows matching the Aggregate Root
 *
 * Cross-tenant / unauthorized access → 403 (*_OWNERSHIP_INVALID codes at call sites)
 * Ownership drift / column mismatch → OWNERSHIP_INTEGRITY_VIOLATION (409)
 */
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type QueryDb = Db | Tx;

export class OwnershipIntegrityViolationError extends Error {
  readonly code = "OWNERSHIP_INTEGRITY_VIOLATION";
  readonly status = 409;

  constructor(message: string) {
    super(message);
    this.name = "OwnershipIntegrityViolationError";
  }
}

export type CanonicalOwnershipColumns = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly animationPackageId: string;
};

export type PlanOwnedRow = CanonicalOwnershipColumns & {
  readonly executionPlanId: string;
};

/**
 * Fail closed when duplicated ownership columns drift from the expected Aggregate Root.
 */
export function assertOwnershipColumnsMatch(
  expected: CanonicalOwnershipColumns,
  actual: CanonicalOwnershipColumns,
  label: string
): void {
  if (
    actual.orgId !== expected.orgId ||
    actual.workspaceId !== expected.workspaceId ||
    actual.campaignId !== expected.campaignId ||
    actual.storyId !== expected.storyId ||
    actual.storyVersionId !== expected.storyVersionId ||
    actual.animationPackageId !== expected.animationPackageId
  ) {
    throw new OwnershipIntegrityViolationError(
      `${label} ownership columns do not match the Execution Plan Aggregate Root`
    );
  }
}

export function assertPlanOwnershipColumnsMatch(
  expected: PlanOwnedRow,
  actual: PlanOwnedRow,
  label: string
): void {
  assertOwnershipColumnsMatch(expected, actual, label);
  if (actual.executionPlanId !== expected.executionPlanId) {
    throw new OwnershipIntegrityViolationError(
      `${label} execution_plan_id does not match the Execution Plan Aggregate Root`
    );
  }
}

/**
 * Verify FK ownership chain for an Execution Plan row against live tenant tables.
 * Duplicated columns on the plan must resolve to a single consistent chain.
 */
export async function assertExecutionPlanOwnershipChain(
  plan: {
    readonly id: string;
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly animationPackageId: string;
  },
  db: QueryDb
): Promise<void> {
  const [organization] = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, plan.orgId))
    .limit(1);
  const [workspace] = await db
    .select({ id: schema.workspaces.id, orgId: schema.workspaces.orgId })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.id, plan.workspaceId),
        eq(schema.workspaces.orgId, plan.orgId)
      )
    )
    .limit(1);
  const [campaign] = await db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(
      and(
        eq(schema.campaigns.id, plan.campaignId),
        eq(schema.campaigns.workspaceId, plan.workspaceId),
        eq(schema.campaigns.orgId, plan.orgId)
      )
    )
    .limit(1);
  const [story] = await db
    .select({ id: schema.aiStories.id })
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, plan.storyId),
        eq(schema.aiStories.campaignId, plan.campaignId),
        eq(schema.aiStories.workspaceId, plan.workspaceId),
        eq(schema.aiStories.orgId, plan.orgId)
      )
    )
    .limit(1);
  const [version] = await db
    .select({ id: schema.aiStoryVersions.id })
    .from(schema.aiStoryVersions)
    .where(
      and(
        eq(schema.aiStoryVersions.id, plan.storyVersionId),
        eq(schema.aiStoryVersions.storyId, plan.storyId)
      )
    )
    .limit(1);
  const [animationPackage] = await db
    .select({ id: schema.aiStoryAnimationPackages.id })
    .from(schema.aiStoryAnimationPackages)
    .where(
      and(
        eq(schema.aiStoryAnimationPackages.id, plan.animationPackageId),
        eq(schema.aiStoryAnimationPackages.storyId, plan.storyId),
        eq(schema.aiStoryAnimationPackages.storyVersionId, plan.storyVersionId),
        eq(schema.aiStoryAnimationPackages.campaignId, plan.campaignId),
        eq(schema.aiStoryAnimationPackages.workspaceId, plan.workspaceId),
        eq(schema.aiStoryAnimationPackages.orgId, plan.orgId)
      )
    )
    .limit(1);

  if (!organization || !workspace || !campaign || !story || !version || !animationPackage) {
    throw new OwnershipIntegrityViolationError(
      "Execution Plan ownership chain does not resolve to Organization → Workspace → Campaign → Story → Story Version → Animation Package"
    );
  }
}

export function planOwnershipFromRow(
  plan: typeof schema.aiStoryExecutionPlans.$inferSelect
): PlanOwnedRow {
  return {
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    campaignId: plan.campaignId,
    storyId: plan.storyId,
    storyVersionId: plan.storyVersionId,
    animationPackageId: plan.animationPackageId,
    executionPlanId: plan.id,
  };
}

export function assertSceneMatchesPlan(
  plan: typeof schema.aiStoryExecutionPlans.$inferSelect,
  scene: typeof schema.aiStorySceneExecutions.$inferSelect
): void {
  assertPlanOwnershipColumnsMatch(
    planOwnershipFromRow(plan),
    {
      orgId: scene.orgId,
      workspaceId: scene.workspaceId,
      campaignId: scene.campaignId,
      storyId: scene.storyId,
      storyVersionId: scene.storyVersionId,
      animationPackageId: scene.animationPackageId,
      executionPlanId: scene.executionPlanId,
    },
    "Scene Execution"
  );
}

export function assertSnapshotMatchesWorkspace(
  expected: { readonly orgId: string; readonly workspaceId: string },
  snapshot: { readonly orgId: string; readonly workspaceId: string }
): void {
  if (
    snapshot.orgId !== expected.orgId ||
    snapshot.workspaceId !== expected.workspaceId
  ) {
    throw new OwnershipIntegrityViolationError(
      "Instruction Snapshot ownership columns do not match the Execution Plan workspace"
    );
  }
}
