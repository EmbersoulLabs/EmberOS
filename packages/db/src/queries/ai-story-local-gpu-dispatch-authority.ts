import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "../client";
import { localGpuGateRetryPendingSql, localGpuGateTerminalSql } from "./ai-story-local-gpu-submit-outcomes";

export type LocalGpuPersistedDispatchSnapshot = {
  contractVersion: 1;
  actor: { userId: string; workspaceId: string; organizationPlan: string | null; platformAdminStatus: "ACTIVE_GRANT" };
  route: Record<string, unknown>;
  request: Record<string, unknown>;
  capabilities: unknown;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function localGpuDispatchExecutionIdentity(input: {
  workspaceId: string; storyId: string; sceneExecutionId: string; packageId: string; runtimeAuthorizationId: string;
}): string {
  return digest(input);
}

type Db = ReturnType<typeof getDb>;

/** The account-level Platform Superadmin entitlement for one user, if active and unrevoked. */
export async function findActiveSuperadminAssignment(db: Db, userId: string): Promise<{ platformAdminAssignmentId: string } | null> {
  const rows = await db.select({ platformAdminAssignmentId: schema.platformAdminGrants.platformAdminAssignmentId })
    .from(schema.platformAdminGrants)
    .leftJoin(schema.platformAdminRevocations, eq(
      schema.platformAdminRevocations.platformAdminAssignmentId,
      schema.platformAdminGrants.platformAdminAssignmentId,
    ))
    .where(and(
      eq(schema.platformAdminGrants.userId, userId),
      eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
      eq(schema.platformAdminGrants.status, "ACTIVE"),
      isNull(schema.platformAdminRevocations.platformAdminRevocationId),
    )).limit(1);
  return rows[0] ?? null;
}

/** Released local packages in one plan that have no bound output yet. */
export async function listReleasedLocalPackagesAwaitingOutput(db: Db, scope: { workspaceId: string; executionPlanId: string }) {
  return db.select({
    sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId,
    packageId: schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId,
    runtimeAuthorizationId: schema.aiStorySceneReleaseStates.runtimeAuthorizationId,
    executionMode: schema.aiStorySceneReleaseStates.executionMode,
    sceneOrder: schema.aiStorySceneReleaseStates.sceneOrder,
  }).from(schema.aiStorySceneReleaseStates).where(and(
    eq(schema.aiStorySceneReleaseStates.workspaceId, scope.workspaceId),
    eq(schema.aiStorySceneReleaseStates.executionPlanId, scope.executionPlanId),
    eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    or(
      eq(schema.aiStorySceneReleaseStates.executionMode, "MANUAL_LOCAL"),
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
    ),
    or(
      isNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId),
      localGpuGateRetryPendingSql(schema.aiStorySceneReleaseStates.gateProviderAttemptId),
    ),
    isNotNull(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId),
    sql`not exists (
      select 1 from ${schema.aiStoryLocalGenerationOutputs}
      where ${schema.aiStoryLocalGenerationOutputs.packageId} = ${schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId}
    )`,
  )).orderBy(asc(schema.aiStorySceneReleaseStates.sceneOrder));
}

export async function persistLocalGpuDispatchAuthority(db: Db, input: {
  idempotencyKey: string;
  orgId: string; workspaceId: string; campaignId: string; storyId: string;
  executionPlanId: string; sceneExecutionId: string; packageId: string; runtimeAuthorizationId: string;
  platformAdminAssignmentId: string; authorizedByUserId: string;
  snapshot: LocalGpuPersistedDispatchSnapshot; expiresAt: Date;
}) {
  if (input.snapshot.actor.userId !== input.authorizedByUserId || input.snapshot.actor.workspaceId !== input.workspaceId) {
    throw new Error("LOCAL_GPU_AUTHORITY_SCOPE_MISMATCH");
  }
  if ((input.snapshot.route as { runtimeAuthorizationId?: unknown }).runtimeAuthorizationId !== input.runtimeAuthorizationId) {
    throw new Error("LOCAL_GPU_RUNTIME_AUTHORIZATION_MISMATCH");
  }
  return db.transaction(async (tx) => persistLocalGpuDispatchAuthorityInTransaction(tx as unknown as Db, input));
}

type PersistInput = Parameters<typeof persistLocalGpuDispatchAuthority>[1];

async function persistLocalGpuDispatchAuthorityInTransaction(db: Db, input: PersistInput) {
  const preflight = await db.select({
    packageId: schema.aiStoryLocalGenerationPackages.packageId,
    releaseMode: schema.aiStorySceneReleaseStates.executionMode,
    releaseState: schema.aiStorySceneReleaseStates.releaseState,
    revocationId: schema.platformAdminRevocations.platformAdminRevocationId,
  }).from(schema.aiStoryLocalGenerationPackages)
    .innerJoin(schema.aiStorySceneReleaseStates, and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, schema.aiStoryLocalGenerationPackages.packageId),
      eq(schema.aiStorySceneReleaseStates.runtimeAuthorizationId, schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId),
    ))
    .innerJoin(schema.platformAdminGrants, and(
      eq(schema.platformAdminGrants.platformAdminAssignmentId, input.platformAdminAssignmentId),
      eq(schema.platformAdminGrants.userId, input.authorizedByUserId),
      eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
      eq(schema.platformAdminGrants.status, "ACTIVE"),
    ))
    .leftJoin(schema.platformAdminRevocations, eq(schema.platformAdminRevocations.platformAdminAssignmentId, input.platformAdminAssignmentId))
    .where(and(
      eq(schema.aiStoryLocalGenerationPackages.packageId, input.packageId),
      eq(schema.aiStoryLocalGenerationPackages.orgId, input.orgId),
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.campaignId, input.campaignId),
      eq(schema.aiStoryLocalGenerationPackages.storyId, input.storyId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      eq(schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId, input.runtimeAuthorizationId),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    )).limit(1);
  if (!preflight[0] || preflight[0].revocationId || !["MANUAL_LOCAL", "LOCAL_GPU"].includes(preflight[0].releaseMode)) {
    throw new Error("LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED");
  }
  // Exact released-package CAS. The canonical Execute path creates a MANUAL_LOCAL
  // ledger first; explicit server-side Superadmin selection is the only transition
  // to LOCAL_GPU. Replays are accepted, while stale packages cannot be promoted.
  const transitioned = await db.update(schema.aiStorySceneReleaseStates).set({
    executionMode: "LOCAL_GPU",
    updatedAt: new Date(),
  }).where(and(
    eq(schema.aiStorySceneReleaseStates.workspaceId, input.workspaceId),
    eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
    eq(schema.aiStorySceneReleaseStates.runtimeAuthorizationId, input.runtimeAuthorizationId),
    eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, input.packageId),
    eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    or(
      eq(schema.aiStorySceneReleaseStates.executionMode, "MANUAL_LOCAL"),
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
    ),
  )).returning({ sceneExecutionId: schema.aiStorySceneReleaseStates.sceneExecutionId });
  if (transitioned.length !== 1) throw new Error("LOCAL_GPU_SCENE_RELEASE_NOT_ELIGIBLE");
  const verified = await db.select({
    packageId: schema.aiStoryLocalGenerationPackages.packageId,
    packageWorkspaceId: schema.aiStoryLocalGenerationPackages.workspaceId,
    packageStoryId: schema.aiStoryLocalGenerationPackages.storyId,
    packagePlanId: schema.aiStoryLocalGenerationPackages.executionPlanId,
    packageRuntimeAuthorizationId: schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId,
    releaseMode: schema.aiStorySceneReleaseStates.executionMode,
    releaseState: schema.aiStorySceneReleaseStates.releaseState,
    grantId: schema.platformAdminGrants.platformAdminAssignmentId,
    revocationId: schema.platformAdminRevocations.platformAdminRevocationId,
  }).from(schema.aiStoryLocalGenerationPackages)
    .innerJoin(schema.aiStorySceneReleaseStates, and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, input.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, schema.aiStoryLocalGenerationPackages.packageId),
      eq(schema.aiStorySceneReleaseStates.runtimeAuthorizationId, schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId),
    ))
    .innerJoin(schema.platformAdminGrants, and(
      eq(schema.platformAdminGrants.platformAdminAssignmentId, input.platformAdminAssignmentId),
      eq(schema.platformAdminGrants.userId, input.authorizedByUserId),
      eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
      eq(schema.platformAdminGrants.status, "ACTIVE"),
    ))
    .leftJoin(schema.platformAdminRevocations, eq(schema.platformAdminRevocations.platformAdminAssignmentId, input.platformAdminAssignmentId))
    .where(and(
      eq(schema.aiStoryLocalGenerationPackages.packageId, input.packageId),
      eq(schema.aiStoryLocalGenerationPackages.orgId, input.orgId),
      eq(schema.aiStoryLocalGenerationPackages.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGenerationPackages.campaignId, input.campaignId),
      eq(schema.aiStoryLocalGenerationPackages.storyId, input.storyId),
      eq(schema.aiStoryLocalGenerationPackages.executionPlanId, input.executionPlanId),
      eq(schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId, input.runtimeAuthorizationId),
    )).limit(1);
  const authority = verified[0];
  if (!authority || authority.revocationId || authority.releaseMode !== "LOCAL_GPU" || authority.releaseState !== "RELEASED") {
    throw new Error("LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED");
  }
  const identity = localGpuDispatchExecutionIdentity({
    workspaceId: input.workspaceId, storyId: input.storyId, sceneExecutionId: input.sceneExecutionId,
    packageId: input.packageId, runtimeAuthorizationId: input.runtimeAuthorizationId,
  });
  const fingerprint = digest({ identity, assignment: input.platformAdminAssignmentId, snapshot: input.snapshot });
  const now = new Date();
  const reusable = await reuseOrRenewDispatchAuthority(db, { ...input, identity, fingerprint, now });
  if (reusable) return reusable;
  const inserted = await db.insert(schema.aiStoryLocalGpuDispatchAuthorities).values({
    dispatchAuthorityId: randomUUID(), authorityFingerprint: fingerprint, idempotencyKey: input.idempotencyKey,
    orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId, storyId: input.storyId,
    executionPlanId: input.executionPlanId, sceneExecutionId: input.sceneExecutionId, packageId: input.packageId,
    runtimeAuthorizationId: input.runtimeAuthorizationId, platformAdminAssignmentId: input.platformAdminAssignmentId,
    authorizedByUserId: input.authorizedByUserId, executionIdentity: identity, dispatchSnapshot: input.snapshot,
    authorizedAt: now, expiresAt: input.expiresAt,
  }).onConflictDoNothing().returning();
  if (inserted[0]) return { ...inserted[0], replayed: false };
  // A concurrent request for the same execution identity won the insert.
  const concurrent = await reuseOrRenewDispatchAuthority(db, { ...input, identity, fingerprint, now });
  if (concurrent) return concurrent;
  throw new Error("LOCAL_GPU_IDEMPOTENCY_CONFLICT");
}

/**
 * One authority row exists per execution identity. A live row (or one whose release
 * already holds a deterministic job gate) is replayed. An expired row that never
 * dispatched is renewed in place so the package cannot be stranded by the TTL.
 */
async function reuseOrRenewDispatchAuthority(db: Db, input: PersistInput & { identity: string; fingerprint: string; now: Date }) {
  const rows = await db.select({ authority: schema.aiStoryLocalGpuDispatchAuthorities, gate: schema.aiStorySceneReleaseStates.gateProviderAttemptId })
    .from(schema.aiStoryLocalGpuDispatchAuthorities)
    .innerJoin(schema.aiStorySceneReleaseStates, eq(
      schema.aiStorySceneReleaseStates.sceneExecutionId,
      schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId,
    ))
    .where(and(
      eq(schema.aiStoryLocalGpuDispatchAuthorities.workspaceId, input.workspaceId),
      eq(schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId, input.sceneExecutionId),
      eq(schema.aiStoryLocalGpuDispatchAuthorities.packageId, input.packageId),
      eq(schema.aiStoryLocalGpuDispatchAuthorities.runtimeAuthorizationId, input.runtimeAuthorizationId),
    )).limit(1);
  const existing = rows[0];
  if (!existing) {
    const keyed = await db.select({ executionIdentity: schema.aiStoryLocalGpuDispatchAuthorities.executionIdentity })
      .from(schema.aiStoryLocalGpuDispatchAuthorities).where(and(
        eq(schema.aiStoryLocalGpuDispatchAuthorities.workspaceId, input.workspaceId),
        eq(schema.aiStoryLocalGpuDispatchAuthorities.idempotencyKey, input.idempotencyKey),
      )).limit(1);
    if (keyed[0] && keyed[0].executionIdentity !== input.identity) throw new Error("LOCAL_GPU_IDEMPOTENCY_CONFLICT");
    return null;
  }
  const authority = existing.authority;
  if (authority.executionIdentity !== input.identity) throw new Error("LOCAL_GPU_EXECUTION_IDENTITY_MISMATCH");
  if (authority.status !== "ACTIVE" || authority.revokedAt) throw new Error("LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED");
  if (authority.expiresAt > input.now) return { ...authority, replayed: true };
  if (existing.gate !== null) {
    const [pending] = await db.execute<{ pending: boolean }>(sql`select ${localGpuGateRetryPendingSql(sql`${existing.gate}`)} as pending`);
    if (!pending?.pending) return { ...authority, replayed: true };
  }
  const renewed = await db.update(schema.aiStoryLocalGpuDispatchAuthorities).set({
    authorityFingerprint: input.fingerprint,
    platformAdminAssignmentId: input.platformAdminAssignmentId,
    authorizedByUserId: input.authorizedByUserId,
    dispatchSnapshot: input.snapshot,
    authorizedAt: input.now,
    expiresAt: input.expiresAt,
  }).where(and(
    eq(schema.aiStoryLocalGpuDispatchAuthorities.dispatchAuthorityId, authority.dispatchAuthorityId),
    eq(schema.aiStoryLocalGpuDispatchAuthorities.status, "ACTIVE"),
    lte(schema.aiStoryLocalGpuDispatchAuthorities.expiresAt, input.now),
    isNull(schema.aiStoryLocalGpuDispatchAuthorities.revokedAt),
  )).returning();
  if (renewed[0]) return { ...renewed[0], replayed: false };
  const current = await db.select().from(schema.aiStoryLocalGpuDispatchAuthorities)
    .where(eq(schema.aiStoryLocalGpuDispatchAuthorities.dispatchAuthorityId, authority.dispatchAuthorityId)).limit(1);
  if (!current[0] || current[0].status !== "ACTIVE" || current[0].revokedAt) throw new Error("LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED");
  return { ...current[0], replayed: true };
}

/**
 * A dispatch scope stays observable after its submit TTL once the release holds a job gate,
 * so status-only recovery continues. Scenes whose Desktop output is already bound to the
 * canonical validation path are finished from the dispatcher's point of view.
 */
function dispatchObservableCondition(now: Date) {
  return and(
    eq(schema.aiStoryLocalGpuDispatchAuthorities.status, "ACTIVE"),
    or(
      gt(schema.aiStoryLocalGpuDispatchAuthorities.expiresAt, now),
      isNotNull(schema.aiStorySceneReleaseStates.gateProviderAttemptId),
    ),
    isNull(schema.aiStoryLocalGpuDispatchAuthorities.revokedAt),
    isNull(schema.platformAdminRevocations.platformAdminRevocationId),
    eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
    eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
    sql`not ${localGpuGateTerminalSql(schema.aiStorySceneReleaseStates.gateProviderAttemptId)}`,
    sql`not exists (
      select 1 from ${schema.aiStoryLocalGenerationOutputs}
      where ${schema.aiStoryLocalGenerationOutputs.packageId} = ${schema.aiStoryLocalGpuDispatchAuthorities.packageId}
    )`,
    sql`not exists (
      select 1 from ${schema.aiStoryLocalMediaJobs}
      where ${schema.aiStoryLocalMediaJobs.packageId} = ${schema.aiStoryLocalGpuDispatchAuthorities.packageId}
        and ${schema.aiStoryLocalMediaJobs.kind} = 'VALIDATE_OUTPUT'
    )`,
  );
}

/** Revalidates release identity and the still-active Superadmin grant on every Worker observation. */
export async function loadAuthorizedLocalGpuDispatch(db: Db, scope: { workspaceId: string; storyId: string; sceneExecutionId: string }) {
  const now = new Date();
  const rows = await db.select({ authority: schema.aiStoryLocalGpuDispatchAuthorities, release: schema.aiStorySceneReleaseStates })
    .from(schema.aiStoryLocalGpuDispatchAuthorities)
    .innerJoin(schema.aiStorySceneReleaseStates, and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.workspaceId, schema.aiStoryLocalGpuDispatchAuthorities.workspaceId),
      eq(schema.aiStorySceneReleaseStates.runtimeAuthorizationId, schema.aiStoryLocalGpuDispatchAuthorities.runtimeAuthorizationId),
      eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, schema.aiStoryLocalGpuDispatchAuthorities.packageId),
    ))
    .innerJoin(schema.platformAdminGrants, and(
      eq(schema.platformAdminGrants.platformAdminAssignmentId, schema.aiStoryLocalGpuDispatchAuthorities.platformAdminAssignmentId),
      eq(schema.platformAdminGrants.userId, schema.aiStoryLocalGpuDispatchAuthorities.authorizedByUserId),
      eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
      eq(schema.platformAdminGrants.status, "ACTIVE"),
    ))
    .leftJoin(schema.platformAdminRevocations, eq(
      schema.platformAdminRevocations.platformAdminAssignmentId,
      schema.aiStoryLocalGpuDispatchAuthorities.platformAdminAssignmentId,
    ))
    .where(and(
      eq(schema.aiStoryLocalGpuDispatchAuthorities.workspaceId, scope.workspaceId),
      eq(schema.aiStoryLocalGpuDispatchAuthorities.storyId, scope.storyId),
      eq(schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId, scope.sceneExecutionId),
      dispatchObservableCondition(now),
    )).limit(1);
  const row = rows[0];
  if (!row) return null;
  const identity = localGpuDispatchExecutionIdentity({ workspaceId: row.authority.workspaceId, storyId: row.authority.storyId,
    sceneExecutionId: row.authority.sceneExecutionId, packageId: row.authority.packageId,
    runtimeAuthorizationId: row.authority.runtimeAuthorizationId });
  if (identity !== row.authority.executionIdentity) throw new Error("LOCAL_GPU_EXECUTION_IDENTITY_MISMATCH");
  return { ...row.authority, existingGate: row.release.gateProviderAttemptId,
    snapshot: row.authority.dispatchSnapshot as LocalGpuPersistedDispatchSnapshot };
}

/**
 * Selects one exact scope backed by a live persisted Superadmin authority.
 * This replaces deployment-time scene allowlists; it does not create authority.
 * The scoped loader revalidates the complete immutable identity before dispatch.
 */
export async function selectNextAuthorizedLocalGpuDispatchScope(db: Db) {
  return (await selectAuthorizedLocalGpuDispatchScopes(db, 1))[0] ?? null;
}

/** Oldest-first live scopes, bounded so one slow Desktop job cannot starve later scenes. */
export async function selectAuthorizedLocalGpuDispatchScopes(db: Db, limit: number) {
  const now = new Date();
  const rows = await db.select({
    workspaceId: schema.aiStoryLocalGpuDispatchAuthorities.workspaceId,
    storyId: schema.aiStoryLocalGpuDispatchAuthorities.storyId,
    sceneExecutionId: schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId,
  }).from(schema.aiStoryLocalGpuDispatchAuthorities)
    .innerJoin(schema.aiStorySceneReleaseStates, and(
      eq(schema.aiStorySceneReleaseStates.sceneExecutionId, schema.aiStoryLocalGpuDispatchAuthorities.sceneExecutionId),
      eq(schema.aiStorySceneReleaseStates.workspaceId, schema.aiStoryLocalGpuDispatchAuthorities.workspaceId),
      eq(schema.aiStorySceneReleaseStates.runtimeAuthorizationId, schema.aiStoryLocalGpuDispatchAuthorities.runtimeAuthorizationId),
      eq(schema.aiStorySceneReleaseStates.currentLocalGenerationPackageId, schema.aiStoryLocalGpuDispatchAuthorities.packageId),
    ))
    .innerJoin(schema.platformAdminGrants, and(
      eq(schema.platformAdminGrants.platformAdminAssignmentId, schema.aiStoryLocalGpuDispatchAuthorities.platformAdminAssignmentId),
      eq(schema.platformAdminGrants.userId, schema.aiStoryLocalGpuDispatchAuthorities.authorizedByUserId),
      eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
      eq(schema.platformAdminGrants.status, "ACTIVE"),
    ))
    .leftJoin(schema.platformAdminRevocations, eq(
      schema.platformAdminRevocations.platformAdminAssignmentId,
      schema.aiStoryLocalGpuDispatchAuthorities.platformAdminAssignmentId,
    ))
    .where(dispatchObservableCondition(now))
    .orderBy(asc(schema.aiStoryLocalGpuDispatchAuthorities.authorizedAt))
    .limit(Math.max(1, Math.min(limit, 25)));
  return rows;
}
