import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "../client";

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
  const inserted = await db.insert(schema.aiStoryLocalGpuDispatchAuthorities).values({
    dispatchAuthorityId: randomUUID(), authorityFingerprint: fingerprint, idempotencyKey: input.idempotencyKey,
    orgId: input.orgId, workspaceId: input.workspaceId, campaignId: input.campaignId, storyId: input.storyId,
    executionPlanId: input.executionPlanId, sceneExecutionId: input.sceneExecutionId, packageId: input.packageId,
    runtimeAuthorizationId: input.runtimeAuthorizationId, platformAdminAssignmentId: input.platformAdminAssignmentId,
    authorizedByUserId: input.authorizedByUserId, executionIdentity: identity, dispatchSnapshot: input.snapshot,
    authorizedAt: now, expiresAt: input.expiresAt,
  }).onConflictDoNothing().returning();
  if (inserted[0]) return inserted[0];
  const existing = await db.select().from(schema.aiStoryLocalGpuDispatchAuthorities).where(and(
    eq(schema.aiStoryLocalGpuDispatchAuthorities.workspaceId, input.workspaceId),
    eq(schema.aiStoryLocalGpuDispatchAuthorities.idempotencyKey, input.idempotencyKey),
  )).limit(1);
  if (!existing[0] || existing[0].authorityFingerprint !== fingerprint) throw new Error("LOCAL_GPU_IDEMPOTENCY_CONFLICT");
  return existing[0];
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
      eq(schema.aiStoryLocalGpuDispatchAuthorities.status, "ACTIVE"),
      gt(schema.aiStoryLocalGpuDispatchAuthorities.expiresAt, now),
      isNull(schema.aiStoryLocalGpuDispatchAuthorities.revokedAt),
      isNull(schema.platformAdminRevocations.platformAdminRevocationId),
      eq(schema.aiStorySceneReleaseStates.executionMode, "LOCAL_GPU"),
      eq(schema.aiStorySceneReleaseStates.releaseState, "RELEASED"),
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
