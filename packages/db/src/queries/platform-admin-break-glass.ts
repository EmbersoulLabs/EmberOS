/**
 * Single-purpose Wave 6 Staging orphan-grant recovery repository operation.
 *
 * Authority is provided by a temporary least-privilege database role, not by
 * this module. Exact hard guards, transaction locking, deterministic facts,
 * and convergent replay prevent this from becoming a general admin path.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  buildAdminAuditEvent,
  buildPlatformAdminAssignment,
  buildPlatformAdminRevocation,
  deterministicUuidFromFingerprint,
  parsePlatformAdminAssignment,
  sha256CanonicalIntegrityHash,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

export const WAVE6_RECOVERY_TICKET =
  "EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-02" as const;
export const WAVE6_STAGING_PROJECT = "voofxbuzpocyjzoxrpfi" as const;
export const WAVE6_ORPHAN_GRANT =
  "aa623ac7-f084-5ab8-979b-85f5177bde38" as const;
export const WAVE6_ORPHAN_USER =
  "889c58b9-581e-435d-b4bb-016fa34e407b" as const;
export const WAVE6_TARGET_EMAIL = "yanyitoo1025@gmail.com" as const;
export const WAVE6_BREAK_GLASS_ACTOR = deterministicUuidFromFingerprint(
  "wave6-staging-break-glass-operator",
  WAVE6_RECOVERY_TICKET
);

type Db = ReturnType<typeof getDb>;

export type Wave6RecoveryInput = {
  environment: string;
  projectId: string;
  ticketId: string;
  orphanGrantId: string;
  orphanUserId: string;
  targetEmail: string;
  reason: string;
  occurredAt: string;
};

export type Wave6RecoveryResult = {
  orphanGrantStatus: "REVOKED";
  targetUserId: string;
  targetAssignmentId: string;
  targetGrantStatus: "ACTIVE";
  activeOrphanCount: number;
  activePlatformSuperAdminCount: number;
  replayed: boolean;
};

export class Wave6RecoveryGuardError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Wave6RecoveryGuardError";
  }
}

export function assertWave6RecoveryHardGuard(input: Wave6RecoveryInput): void {
  const checks: Array<[boolean, string]> = [
    [input.environment === "STAGING", "environment"],
    [input.projectId === WAVE6_STAGING_PROJECT, "project"],
    [input.ticketId === WAVE6_RECOVERY_TICKET, "ticket"],
    [input.orphanGrantId === WAVE6_ORPHAN_GRANT, "orphan grant"],
    [input.orphanUserId === WAVE6_ORPHAN_USER, "orphan user"],
    [input.targetEmail.toLowerCase() === WAVE6_TARGET_EMAIL, "target account"],
  ];
  const failed = checks.find(([valid]) => !valid);
  if (failed) {
    throw new Wave6RecoveryGuardError(
      "WAVE6_RECOVERY_HARD_GUARD_DENIED",
      `Wave 6 recovery denied: ${failed[1]} mismatch`
    );
  }
}

function assignmentFromRow(
  row: typeof schema.platformAdminGrants.$inferSelect
) {
  return parsePlatformAdminAssignment({ ...row.assignment, status: row.status });
}

export async function recoverWave6OrphanedPlatformAdminGrant(
  input: Wave6RecoveryInput,
  db: Db = getDb()
): Promise<Wave6RecoveryResult> {
  assertWave6RecoveryHardGuard(input);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${WAVE6_RECOVERY_TICKET}))`
    );
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.execute(sql`set local statement_timeout = '15s'`);

    const targetUsers = await tx.execute<{
      id: string;
      email_confirmed_at: Date | null;
      banned_until: Date | null;
    }>(sql`
      select id::text, email_confirmed_at, banned_until
      from auth.users
      where lower(email) = lower(${WAVE6_TARGET_EMAIL})
      limit 2
    `);
    if (targetUsers.length !== 1) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_TARGET_AUTH_USER_INVALID",
        "Expected exactly one existing Staging target Auth user"
      );
    }
    const targetUser = targetUsers[0]!;
    if (!targetUser.email_confirmed_at || targetUser.banned_until) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_TARGET_AUTH_USER_INELIGIBLE",
        "Target Auth user is unconfirmed or disabled"
      );
    }

    const orphanPrincipals = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
      from auth.users
      where id = ${WAVE6_ORPHAN_USER}::uuid
    `);
    if (Number(orphanPrincipals[0]?.count ?? -1) !== 0) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_ORPHAN_AUTH_PRINCIPAL_PRESENT",
        "Orphan principal unexpectedly exists"
      );
    }

    const orphanRows = await tx
      .select()
      .from(schema.platformAdminGrants)
      .where(
        and(
          eq(
            schema.platformAdminGrants.platformAdminAssignmentId,
            WAVE6_ORPHAN_GRANT
          ),
          eq(schema.platformAdminGrants.userId, WAVE6_ORPHAN_USER)
        )
      )
      .for("update");
    if (orphanRows.length !== 1) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_ORPHAN_GRANT_INVALID",
        "Expected exactly one certified orphan grant"
      );
    }
    const orphanRow = orphanRows[0]!;
    const orphanAssignment = assignmentFromRow(orphanRow);

    const targetAssignment = buildPlatformAdminAssignment({
      userId: targetUser.id,
      grantedAt: input.occurredAt,
      grantedByUserId: null,
      reason: input.reason,
      identitySeed: `${WAVE6_RECOVERY_TICKET}:${targetUser.id}`,
    });
    const existingTargetRows = await tx
      .select()
      .from(schema.platformAdminGrants)
      .where(
        and(
          eq(schema.platformAdminGrants.userId, targetUser.id),
          eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN")
        )
      )
      .for("update");

    if (orphanRow.status === "REVOKED") {
      const converged = existingTargetRows.find(
        (row) =>
          row.platformAdminAssignmentId ===
            targetAssignment.platformAdminAssignmentId && row.status === "ACTIVE"
      );
      if (!converged) {
        throw new Wave6RecoveryGuardError(
          "WAVE6_RECOVERY_PARTIAL_STATE",
          "Orphan is revoked but deterministic target grant is not active"
        );
      }
      return verifyResult(tx, targetUser.id, targetAssignment, true);
    }

    if (orphanRow.status !== "ACTIVE" || existingTargetRows.length !== 0) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_RECOVERY_PRECONDITION_FAILED",
        "Orphan must be ACTIVE and target must have no Platform Admin grant"
      );
    }

    const activeBefore = await tx.execute<{ count: number }>(sql`
      select count(*)::int as count
      from platform_admin_grants
      where platform_role = 'PLATFORM_SUPER_ADMIN' and status = 'ACTIVE'
    `);
    if (Number(activeBefore[0]?.count ?? -1) !== 1) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_ACTIVE_ADMIN_COUNT_INVALID",
        "Expected exactly one ACTIVE Platform Super Admin before recovery"
      );
    }

    const revocation = buildPlatformAdminRevocation({
      assignment: orphanAssignment,
      revokedAt: input.occurredAt,
      revokedByUserId: WAVE6_BREAK_GLASS_ACTOR,
      reason: input.reason,
    });
    const commandId = deterministicUuidFromFingerprint(
      "wave6-staging-break-glass-command",
      WAVE6_RECOVERY_TICKET
    );
    const requestId = `${WAVE6_RECOVERY_TICKET}:request`;
    const idempotencyKey = `${WAVE6_RECOVERY_TICKET}:once`;
    const payloadDigest = sha256CanonicalIntegrityHash({
      ticketId: WAVE6_RECOVERY_TICKET,
      orphanGrantId: WAVE6_ORPHAN_GRANT,
      targetUserId: targetUser.id,
      targetAssignmentId: targetAssignment.platformAdminAssignmentId,
      reason: input.reason,
    });
    const acceptedAudit = buildAdminAuditEvent({
      commandId,
      eventType: "COMMAND_ACCEPTED",
      commandStatus: "ACCEPTED",
      actorUserId: WAVE6_BREAK_GLASS_ACTOR,
      platformAdminAssignmentId: WAVE6_ORPHAN_GRANT,
      action: "WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY",
      targetType: "PLATFORM_ADMIN_ASSIGNMENT",
      targetId: WAVE6_ORPHAN_GRANT,
      reason: input.reason,
      beforeReference: { kind: "ORPHANED_ACTIVE_GRANT", id: WAVE6_ORPHAN_GRANT },
      requestId,
      idempotencyKey,
      payloadDigest,
      createdAt: input.occurredAt,
    });

    await tx.insert(schema.adminAuditEvents).values({
      adminAuditEventId: acceptedAudit.adminAuditEventId,
      commandId: acceptedAudit.commandId,
      eventType: acceptedAudit.eventType,
      commandStatus: acceptedAudit.commandStatus,
      actorUserId: acceptedAudit.actorUserId,
      platformAdminAssignmentId: acceptedAudit.platformAdminAssignmentId,
      platformRole: acceptedAudit.platformRole,
      action: acceptedAudit.action,
      targetType: acceptedAudit.targetType,
      targetId: acceptedAudit.targetId,
      orgId: acceptedAudit.orgId,
      workspaceId: acceptedAudit.workspaceId,
      reason: acceptedAudit.reason,
      beforeReference: acceptedAudit.beforeReference,
      afterReference: acceptedAudit.afterReference,
      requestId: acceptedAudit.requestId,
      idempotencyKey: acceptedAudit.idempotencyKey,
      payloadDigest: acceptedAudit.payloadDigest,
      createdAt: new Date(acceptedAudit.createdAt),
      integrityHash: acceptedAudit.integrityHash,
      contractVersion: acceptedAudit.contractVersion,
      event: acceptedAudit,
    });

    await tx.insert(schema.platformAdminRevocations).values({
      platformAdminRevocationId: revocation.platformAdminRevocationId,
      platformAdminAssignmentId: revocation.platformAdminAssignmentId,
      userId: revocation.userId,
      platformRole: revocation.platformRole,
      revokedAt: new Date(revocation.revokedAt),
      revokedByUserId: revocation.revokedByUserId,
      reason: revocation.reason,
      integrityHash: revocation.integrityHash,
      contractVersion: revocation.contractVersion,
      revocation,
    });
    await tx
      .update(schema.platformAdminGrants)
      .set({ status: "REVOKED" })
      .where(
        eq(
          schema.platformAdminGrants.platformAdminAssignmentId,
          WAVE6_ORPHAN_GRANT
        )
      );
    await tx.insert(schema.platformAdminGrants).values({
      platformAdminAssignmentId: targetAssignment.platformAdminAssignmentId,
      userId: targetAssignment.userId,
      platformRole: targetAssignment.platformRole,
      status: targetAssignment.status,
      grantedAt: new Date(targetAssignment.grantedAt),
      grantedByUserId: targetAssignment.grantedByUserId,
      reason: targetAssignment.reason,
      integrityHash: targetAssignment.integrityHash,
      contractVersion: targetAssignment.contractVersion,
      assignment: targetAssignment,
    });

    const succeededAudit = buildAdminAuditEvent({
      commandId,
      eventType: "COMMAND_SUCCEEDED",
      commandStatus: "SUCCEEDED",
      actorUserId: WAVE6_BREAK_GLASS_ACTOR,
      platformAdminAssignmentId: targetAssignment.platformAdminAssignmentId,
      action: "WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY",
      targetType: "PLATFORM_ADMIN_ASSIGNMENT",
      targetId: targetAssignment.platformAdminAssignmentId,
      reason: input.reason,
      beforeReference: { kind: "ORPHANED_ACTIVE_GRANT", id: WAVE6_ORPHAN_GRANT },
      afterReference: {
        kind: "ACTIVE_PLATFORM_SUPER_ADMIN",
        id: targetAssignment.platformAdminAssignmentId,
      },
      requestId,
      idempotencyKey,
      payloadDigest,
      createdAt: input.occurredAt,
    });
    await tx.insert(schema.adminAuditEvents).values({
      adminAuditEventId: succeededAudit.adminAuditEventId,
      commandId: succeededAudit.commandId,
      eventType: succeededAudit.eventType,
      commandStatus: succeededAudit.commandStatus,
      actorUserId: succeededAudit.actorUserId,
      platformAdminAssignmentId: succeededAudit.platformAdminAssignmentId,
      platformRole: succeededAudit.platformRole,
      action: succeededAudit.action,
      targetType: succeededAudit.targetType,
      targetId: succeededAudit.targetId,
      orgId: succeededAudit.orgId,
      workspaceId: succeededAudit.workspaceId,
      reason: succeededAudit.reason,
      beforeReference: succeededAudit.beforeReference,
      afterReference: succeededAudit.afterReference,
      requestId: succeededAudit.requestId,
      idempotencyKey: succeededAudit.idempotencyKey,
      payloadDigest: succeededAudit.payloadDigest,
      createdAt: new Date(succeededAudit.createdAt),
      integrityHash: succeededAudit.integrityHash,
      contractVersion: succeededAudit.contractVersion,
      event: succeededAudit,
    });

    return verifyResult(tx, targetUser.id, targetAssignment, false);
  });
}

async function verifyResult(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  targetUserId: string,
  targetAssignment: ReturnType<typeof buildPlatformAdminAssignment>,
  replayed: boolean
): Promise<Wave6RecoveryResult> {
  const [counts, orphan] = await Promise.all([
    tx.execute<{ active_count: number; orphan_count: number }>(sql`
      select
        count(*) filter (
          where platform_role = 'PLATFORM_SUPER_ADMIN' and status = 'ACTIVE'
        )::int as active_count,
        count(*) filter (
          where platform_admin_assignment_id = ${WAVE6_ORPHAN_GRANT}::uuid
            and status = 'ACTIVE'
        )::int as orphan_count
      from platform_admin_grants
    `),
    tx
      .select({ status: schema.platformAdminGrants.status })
      .from(schema.platformAdminGrants)
      .where(
        eq(
          schema.platformAdminGrants.platformAdminAssignmentId,
          WAVE6_ORPHAN_GRANT
        )
      )
      .limit(1),
  ]);
  const row = counts[0];
  if (
    orphan[0]?.status !== "REVOKED" ||
    Number(row?.active_count ?? -1) !== 1 ||
    Number(row?.orphan_count ?? -1) !== 0
  ) {
    throw new Wave6RecoveryGuardError(
      "WAVE6_RECOVERY_POSTCONDITION_FAILED",
      "Platform Admin authority did not converge to the certified post-state"
    );
  }
  return {
    orphanGrantStatus: "REVOKED",
    targetUserId,
    targetAssignmentId: targetAssignment.platformAdminAssignmentId,
    targetGrantStatus: "ACTIVE",
    activeOrphanCount: 0,
    activePlatformSuperAdminCount: 1,
    replayed,
  };
}
