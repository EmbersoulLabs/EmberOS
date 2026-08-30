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

export const WAVE6_RECOVERY_IMPLEMENTATION_TICKET =
  "EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-02" as const;
export const WAVE6_EXPECTED_EXECUTION_AUTHORIZATION_TICKET =
  "EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-EXECUTION-03" as const;
export const WAVE6_STAGING_PROJECT = "voofxbuzpocyjzoxrpfi" as const;
export const WAVE6_ORPHAN_GRANT =
  "aa623ac7-f084-5ab8-979b-85f5177bde38" as const;
export const WAVE6_ORPHAN_USER =
  "889c58b9-581e-435d-b4bb-016fa34e407b" as const;
export const WAVE6_TARGET_EMAIL = "yanyitoo1025@gmail.com" as const;
export const WAVE6_BREAK_GLASS_ACTOR = deterministicUuidFromFingerprint(
  "wave6-staging-break-glass-operator",
  WAVE6_RECOVERY_IMPLEMENTATION_TICKET
);

type Db = ReturnType<typeof getDb>;

export type Wave6RecoveryInput = {
  environment: string;
  projectId: string;
  implementationTicketId: string;
  executionAuthorizationTicketId: string;
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

export type Wave6RecoveryStage =
  | "COMMAND_VALIDATION"
  | "TRANSACTION_BEGIN"
  | "ADVISORY_LOCK"
  | "TARGET_USER_LOOKUP"
  | "ORPHAN_PRINCIPAL_LOOKUP"
  | "ORPHAN_GRANT_LOCK"
  | "TARGET_GRANT_LOCK"
  | "REPLAY_IDENTITY_CHECK"
  | "ACTIVE_ADMIN_COUNT"
  | "AUDIT_ACCEPTED_WRITE"
  | "REVOCATION_WRITE"
  | "ORPHAN_REVOKE"
  | "TARGET_GRANT_WRITE"
  | "AUDIT_SUCCEEDED_WRITE"
  | "POSTCONDITION";

export type Wave6RecoveryTrace = {
  stage: Wave6RecoveryStage;
  transactionBeginReached: boolean;
  firstSqlStage: Wave6RecoveryStage | null;
};

export type Wave6SanitizedOperatorError = {
  correlationId: string;
  stage: Wave6RecoveryStage;
  errorClass: string;
  safeMessage: string;
  exitCode: number;
  databaseSqlState?: string;
  databaseConstraint?: string;
  databaseObjectClass?: "TABLE" | "CONSTRAINT" | "FUNCTION" | "SCHEMA";
  transactionBeginReached: boolean;
  firstSqlStage: Wave6RecoveryStage | null;
  firstSafeSqlFailureClass: string;
  timestamp: string;
};

export class Wave6RecoveryExecutionError extends Error {
  constructor(
    readonly trace: Wave6RecoveryTrace,
    readonly originalError: unknown
  ) {
    super("Wave 6 recovery execution failed");
    this.name = "Wave6RecoveryExecutionError";
  }
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,128}$/.test(value)
    ? value
    : undefined;
}

function errorFacts(error: unknown): {
  code?: string;
  constraint?: string;
  table?: string;
  schema?: string;
  routine?: string;
  message?: string;
} {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    const item = current as Record<string, unknown>;
    const facts = {
      code: safeIdentifier(item.code),
      constraint: safeIdentifier(item.constraint),
      table: safeIdentifier(item.table),
      schema: safeIdentifier(item.schema),
      routine: safeIdentifier(item.routine),
      message: typeof item.message === "string" ? item.message : undefined,
    };
    if (facts.code || facts.constraint || facts.table || facts.schema || facts.routine) {
      return facts;
    }
    current = item.cause ?? item.originalError;
  }
  return typeof error === "object" && error !== null
    ? { message: (error as { message?: string }).message }
    : {};
}

/** Redacts credential-bearing text before it can enter a structured report. */
export function redactWave6RecoverySensitiveText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(?:gh[opsu]_|github_pat_|vercel_|sb_(?:secret|service)_)[A-Za-z0-9._-]+/gi, "[REDACTED_SECRET]")
    .replace(/([?&](?:password|token|secret|key)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function sanitizeWave6RecoveryOperatorError(
  error: unknown,
  input: { exitCode: number; timestamp?: string }
): Wave6SanitizedOperatorError {
  const execution =
    error instanceof Wave6RecoveryExecutionError ? error : undefined;
  const trace = execution?.trace ?? {
    stage: "COMMAND_VALIDATION" as const,
    transactionBeginReached: false,
    firstSqlStage: null,
  };
  const original = execution?.originalError ?? error;
  const facts = errorFacts(original);
  const sqlState = facts.code && /^[0-9A-Z]{5}$/.test(facts.code) ? facts.code : undefined;
  const guard = original instanceof Wave6RecoveryGuardError ? original : undefined;
  const connectionFailure =
    facts.code === "ECONNREFUSED" || facts.code === "ETIMEDOUT" || facts.code === "28P01";
  const errorClass = guard?.code ??
    (facts.code === "42501" ? "DATABASE_PERMISSION_DENIED" :
      connectionFailure ? "DATABASE_CONNECTION_FAILED" :
      sqlState?.startsWith("23") ? "DATABASE_CONSTRAINT_FAILED" :
      sqlState ? "DATABASE_SQL_FAILURE" : "RECOVERY_OPERATOR_FAILURE");
  const safeMessage = guard
    ? redactWave6RecoverySensitiveText(guard.message)
    : facts.code === "42501"
      ? `Database permission denied during ${trace.stage}.`
      : connectionFailure
        ? "Database authentication or connection failed."
        : `Recovery operator failed during ${trace.stage}.`;
  const databaseConstraint = safeIdentifier(facts.constraint);
  const databaseObjectClass = databaseConstraint
    ? "CONSTRAINT" as const
    : facts.table
      ? "TABLE" as const
      : facts.schema
        ? "SCHEMA" as const
        : facts.routine
          ? "FUNCTION" as const
          : undefined;

  return {
    correlationId: `${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}:request`,
    stage: trace.stage,
    errorClass,
    safeMessage,
    exitCode: input.exitCode,
    ...(sqlState ? { databaseSqlState: sqlState } : {}),
    ...(databaseConstraint ? { databaseConstraint } : {}),
    ...(databaseObjectClass ? { databaseObjectClass } : {}),
    transactionBeginReached: trace.transactionBeginReached,
    firstSqlStage: trace.firstSqlStage,
    firstSafeSqlFailureClass: errorClass,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export class Wave6RecoveryGuardError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "Wave6RecoveryGuardError";
  }
}

export function assertWave6RecoveryHardGuard(input: Wave6RecoveryInput): void {
  const executionTicketPattern =
    /^EMBEROS-WAVE6-STAGING-PLATFORM-ADMIN-BREAK-GLASS-RECOVERY-EXECUTION-0*[1-9][0-9]*$/;
  const checks: Array<[boolean, string]> = [
    [input.environment === "STAGING", "environment"],
    [input.projectId === WAVE6_STAGING_PROJECT, "project"],
    [
      input.implementationTicketId === WAVE6_RECOVERY_IMPLEMENTATION_TICKET,
      "implementation ticket",
    ],
    [
      executionTicketPattern.test(input.executionAuthorizationTicketId),
      "execution authorization ticket format",
    ],
    [
      input.executionAuthorizationTicketId ===
        WAVE6_EXPECTED_EXECUTION_AUTHORIZATION_TICKET,
      "execution authorization ticket",
    ],
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
  const trace: Wave6RecoveryTrace = {
    stage: "COMMAND_VALIDATION",
    transactionBeginReached: false,
    firstSqlStage: null,
  };
  try {
    assertWave6RecoveryHardGuard(input);
    trace.stage = "TRANSACTION_BEGIN";

    return await db.transaction(async (tx) => {
      trace.transactionBeginReached = true;
      trace.stage = "ADVISORY_LOCK";
      trace.firstSqlStage = "ADVISORY_LOCK";
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}))`
      );
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(sql`set local statement_timeout = '15s'`);

    trace.stage = "TARGET_USER_LOOKUP";
    trace.firstSqlStage = "TARGET_USER_LOOKUP";
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

    trace.stage = "ORPHAN_PRINCIPAL_LOOKUP";
    trace.firstSqlStage = "ORPHAN_PRINCIPAL_LOOKUP";
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

    trace.stage = "ORPHAN_GRANT_LOCK";
    trace.firstSqlStage = "ORPHAN_GRANT_LOCK";
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
      identitySeed: `${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}:${targetUser.id}`,
    });
    const commandId = deterministicUuidFromFingerprint(
      "wave6-staging-break-glass-command",
      `${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}:${input.executionAuthorizationTicketId}`
    );
    const requestId = `${input.executionAuthorizationTicketId}:request`;
    const idempotencyKey =
      `${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}:${input.executionAuthorizationTicketId}:once`;
    const auditReason = [
      `implementationTicketId=${WAVE6_RECOVERY_IMPLEMENTATION_TICKET}`,
      `executionAuthorizationTicketId=${input.executionAuthorizationTicketId}`,
      `reason=${input.reason}`,
    ].join("; ");
    const payloadDigest = sha256CanonicalIntegrityHash({
      implementationTicketId: WAVE6_RECOVERY_IMPLEMENTATION_TICKET,
      executionAuthorizationTicketId: input.executionAuthorizationTicketId,
      orphanGrantId: WAVE6_ORPHAN_GRANT,
      targetUserId: targetUser.id,
      targetAssignmentId: targetAssignment.platformAdminAssignmentId,
      reason: auditReason,
    });
    trace.stage = "TARGET_GRANT_LOCK";
    trace.firstSqlStage = "TARGET_GRANT_LOCK";
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
      trace.stage = "REPLAY_IDENTITY_CHECK";
      trace.firstSqlStage = "REPLAY_IDENTITY_CHECK";
      const replayAudits = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count
        from admin_audit_events
        where action = 'WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY'
          and event_type = 'COMMAND_SUCCEEDED'
          and idempotency_key = ${idempotencyKey}
          and request_id = ${requestId}
      `);
      if (Number(replayAudits[0]?.count ?? -1) !== 1) {
        throw new Wave6RecoveryGuardError(
          "WAVE6_RECOVERY_AUTHORIZATION_REPLAY_MISMATCH",
          "Converged recovery belongs to a different execution authorization"
        );
      }
      trace.stage = "POSTCONDITION";
      trace.firstSqlStage = "POSTCONDITION";
      return verifyResult(tx, targetUser.id, targetAssignment, true);
    }

    if (orphanRow.status !== "ACTIVE" || existingTargetRows.length !== 0) {
      throw new Wave6RecoveryGuardError(
        "WAVE6_RECOVERY_PRECONDITION_FAILED",
        "Orphan must be ACTIVE and target must have no Platform Admin grant"
      );
    }

    trace.stage = "ACTIVE_ADMIN_COUNT";
    trace.firstSqlStage = "ACTIVE_ADMIN_COUNT";
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
    const acceptedAudit = buildAdminAuditEvent({
      commandId,
      eventType: "COMMAND_ACCEPTED",
      commandStatus: "ACCEPTED",
      actorUserId: WAVE6_BREAK_GLASS_ACTOR,
      platformAdminAssignmentId: WAVE6_ORPHAN_GRANT,
      action: "WAVE6_ORPHANED_PLATFORM_ADMIN_RECOVERY",
      targetType: "PLATFORM_ADMIN_ASSIGNMENT",
      targetId: WAVE6_ORPHAN_GRANT,
      reason: auditReason,
      beforeReference: { kind: "ORPHANED_ACTIVE_GRANT", id: WAVE6_ORPHAN_GRANT },
      requestId,
      idempotencyKey,
      payloadDigest,
      createdAt: input.occurredAt,
    });

    trace.stage = "AUDIT_ACCEPTED_WRITE";
    trace.firstSqlStage = "AUDIT_ACCEPTED_WRITE";
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

    trace.stage = "REVOCATION_WRITE";
    trace.firstSqlStage = "REVOCATION_WRITE";
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
    trace.stage = "ORPHAN_REVOKE";
    trace.firstSqlStage = "ORPHAN_REVOKE";
    await tx
      .update(schema.platformAdminGrants)
      .set({ status: "REVOKED" })
      .where(
        eq(
          schema.platformAdminGrants.platformAdminAssignmentId,
          WAVE6_ORPHAN_GRANT
        )
      );
    trace.stage = "TARGET_GRANT_WRITE";
    trace.firstSqlStage = "TARGET_GRANT_WRITE";
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
      reason: auditReason,
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
    trace.stage = "AUDIT_SUCCEEDED_WRITE";
    trace.firstSqlStage = "AUDIT_SUCCEEDED_WRITE";
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

    trace.stage = "POSTCONDITION";
    trace.firstSqlStage = "POSTCONDITION";
    return verifyResult(tx, targetUser.id, targetAssignment, false);
    });
  } catch (error) {
    if (error instanceof Wave6RecoveryExecutionError) throw error;
    throw new Wave6RecoveryExecutionError({ ...trace }, error);
  }
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
