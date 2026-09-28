/**
 * Trusted Platform Super Admin grant lifecycle commands.
 *
 * The caller must supply a server-branded TrustedAdminCommandContext. The
 * PostgreSQL adapter re-validates the actor's ACTIVE durable assignment inside
 * the same transaction that writes the grant/revocation and audit evidence.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import {
  parseAdminAuditEvent,
  parsePlatformAdminAssignment,
  type AdminAuditEvent,
  type PlatformAdminAssignment,
  type PlatformAdminRevocation,
} from "@ceo-agent/shared";
import {
  assertTrustedAdminCommandContext,
  buildAdminAuditEvent,
  buildAdminAuditEventIntegrityHash,
  buildAdminCommandId,
  buildPlatformAdminAssignment,
  buildPlatformAdminRevocation,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export type PlatformAdminGrantManagementErrorCode =
  | "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE"
  | "PLATFORM_ADMIN_TARGET_INVALID"
  | "PLATFORM_ADMIN_TARGET_NOT_FOUND"
  | "PLATFORM_ADMIN_TARGET_NOT_ACTIVE"
  | "PLATFORM_ADMIN_LAST_ACTIVE_CANNOT_REVOKE"
  | "PLATFORM_ADMIN_COMMAND_CONFLICT";

export class PlatformAdminGrantManagementError extends Error {
  readonly status: number;

  constructor(
    readonly code: PlatformAdminGrantManagementErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PlatformAdminGrantManagementError";
    this.status =
      code === "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE" ? 403 :
      code === "PLATFORM_ADMIN_TARGET_NOT_FOUND" ? 404 :
      code === "PLATFORM_ADMIN_TARGET_INVALID" ? 400 : 409;
  }
}

export type PlatformAdminGrantCommandResult = {
  assignment: PlatformAdminAssignment;
  auditEvent: AdminAuditEvent;
  changed: boolean;
  replayed: boolean;
};

export type PlatformAdminRevokeCommandResult = {
  assignment: PlatformAdminAssignment;
  revocation: PlatformAdminRevocation;
  auditEvent: AdminAuditEvent;
  replayed: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new PlatformAdminGrantManagementError(
      "PLATFORM_ADMIN_TARGET_INVALID",
      `${field} must be a UUID`
    );
  }
}

function assignmentFromRow(
  row: typeof schema.platformAdminGrants.$inferSelect
): PlatformAdminAssignment {
  const embedded = parsePlatformAdminAssignment(row.assignment);
  return parsePlatformAdminAssignment({ ...embedded, status: row.status });
}

function auditFromRow(
  row: typeof schema.adminAuditEvents.$inferSelect
): AdminAuditEvent {
  return parseAdminAuditEvent(row.event);
}

function stateReference(assignment: PlatformAdminAssignment | null) {
  if (!assignment) return null;
  return {
    kind: `PLATFORM_SUPER_ADMIN:${assignment.status}`,
    id: assignment.platformAdminAssignmentId,
    digest: assignment.integrityHash,
  } as const;
}

function assertAuditEquivalent(existing: AdminAuditEvent, expected: AdminAuditEvent) {
  if (existing.integrityHash !== expected.integrityHash) {
    throw new PlatformAdminGrantManagementError(
      "PLATFORM_ADMIN_COMMAND_CONFLICT",
      "Idempotency key was reused with different Platform Admin command facts"
    );
  }
}

export class PlatformAdminGrantManagementService {
  constructor(private readonly db: Db = getDb()) {}

  async grantPlatformSuperAdmin(input: {
    context: TrustedAdminCommandContext;
    targetUserId: string;
    reason?: string;
    occurredAt?: string;
  }): Promise<PlatformAdminGrantCommandResult> {
    assertTrustedAdminCommandContext(input.context);
    assertUuid(input.targetUserId, "targetUserId");
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const reason = input.reason?.trim() || input.context.reason;
    const commandId = buildAdminCommandId(input.context);

    return this.db.transaction(async (tx) => {
      const actorRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(
          and(
            eq(
              schema.platformAdminGrants.platformAdminAssignmentId,
              input.context.platformAdminAssignmentId
            ),
            eq(schema.platformAdminGrants.userId, input.context.actorUserId),
            eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
            eq(schema.platformAdminGrants.status, "ACTIVE")
          )
        )
        .for("update")
        .limit(1);
      if (!actorRows[0]) {
        throw new PlatformAdminGrantManagementError(
          "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE",
          "An ACTIVE Platform Super Admin assignment is required"
        );
      }

      const targetUsers = await tx.execute<{ id: string }>(sql`
        SELECT id::text AS id
        FROM auth.users
        WHERE id = ${input.targetUserId}::uuid
        LIMIT 1
      `);
      if (!targetUsers[0]) {
        throw new PlatformAdminGrantManagementError(
          "PLATFORM_ADMIN_TARGET_NOT_FOUND",
          "Authenticated target user not found"
        );
      }

      const priorAuditRows = await tx
        .select()
        .from(schema.adminAuditEvents)
        .where(
          and(
            eq(schema.adminAuditEvents.eventType, "COMMAND_SUCCEEDED"),
            or(
              eq(schema.adminAuditEvents.commandId, commandId),
              and(
                eq(
                  schema.adminAuditEvents.idempotencyKey,
                  input.context.idempotencyKey
                ),
                eq(
                  schema.adminAuditEvents.action,
                  "PLATFORM_SUPER_ADMIN_GRANT"
                )
              )
            )
          )
        )
        .limit(1);
      if (priorAuditRows[0]) {
        const priorAudit = auditFromRow(priorAuditRows[0]);
        const assignmentId = priorAudit.afterReference?.id;
        const assignmentRows = assignmentId
          ? await tx
              .select()
              .from(schema.platformAdminGrants)
              .where(
                eq(schema.platformAdminGrants.platformAdminAssignmentId, assignmentId)
              )
              .limit(1)
          : [];
        if (!assignmentRows[0] || assignmentRows[0].userId !== input.targetUserId) {
          throw new PlatformAdminGrantManagementError(
            "PLATFORM_ADMIN_COMMAND_CONFLICT",
            "Existing command audit does not match the requested target"
          );
        }
        return {
          assignment: assignmentFromRow(assignmentRows[0]),
          auditEvent: priorAudit,
          changed: false,
          replayed: true,
        };
      }

      const targetRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(eq(schema.platformAdminGrants.userId, input.targetUserId))
        .orderBy(desc(schema.platformAdminGrants.grantedAt))
        .for("update");
      const previous = targetRows[0] ? assignmentFromRow(targetRows[0]) : null;
      const alreadyActiveRow = targetRows.find(
        (row) => row.status === "ACTIVE" && row.platformRole === "PLATFORM_SUPER_ADMIN"
      );
      const assignment = alreadyActiveRow
        ? assignmentFromRow(alreadyActiveRow)
        : buildPlatformAdminAssignment({
            userId: input.targetUserId,
            grantedAt: occurredAt,
            grantedByUserId: input.context.actorUserId,
            reason,
            identitySeed: `admin-grant:${input.targetUserId}:${input.context.idempotencyKey}`,
          });

      if (!alreadyActiveRow) {
        const inserted = await tx
          .insert(schema.platformAdminGrants)
          .values({
            platformAdminAssignmentId: assignment.platformAdminAssignmentId,
            userId: assignment.userId,
            platformRole: assignment.platformRole,
            status: assignment.status,
            grantedAt: new Date(assignment.grantedAt),
            grantedByUserId: assignment.grantedByUserId,
            reason: assignment.reason,
            integrityHash: assignment.integrityHash,
            contractVersion: assignment.contractVersion,
            assignment,
          })
          .onConflictDoNothing()
          .returning();
        if (!inserted[0]) {
          const raced = await tx
            .select()
            .from(schema.platformAdminGrants)
            .where(
              and(
                eq(schema.platformAdminGrants.userId, input.targetUserId),
                eq(schema.platformAdminGrants.status, "ACTIVE")
              )
            )
            .limit(1);
          if (!raced[0]) {
            throw new PlatformAdminGrantManagementError(
              "PLATFORM_ADMIN_COMMAND_CONFLICT",
              "Platform Admin grant conflicted without an ACTIVE converged row"
            );
          }
        }
      }

      const effectiveRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(
          and(
            eq(schema.platformAdminGrants.userId, input.targetUserId),
            eq(schema.platformAdminGrants.status, "ACTIVE")
          )
        )
        .orderBy(desc(schema.platformAdminGrants.grantedAt))
        .limit(1);
      const effective = effectiveRows[0]
        ? assignmentFromRow(effectiveRows[0])
        : assignment;

      const payloadDigest = buildAdminAuditEventIntegrityHash({
        authorityType: "PLATFORM_ADMIN_ASSIGNMENT",
        role: "PLATFORM_SUPER_ADMIN",
        targetUserId: input.targetUserId,
        previousState: previous?.status ?? "NONE",
        resultingState: "ACTIVE",
      });
      const auditEvent = buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_SUCCEEDED",
        commandStatus: "SUCCEEDED",
        actorUserId: input.context.actorUserId,
        platformAdminAssignmentId: input.context.platformAdminAssignmentId,
        action: "PLATFORM_SUPER_ADMIN_GRANT",
        targetType: "AUTH_USER",
        targetId: input.targetUserId,
        reason,
        beforeReference: stateReference(previous),
        afterReference: stateReference(effective),
        requestId: input.context.requestId,
        idempotencyKey: input.context.idempotencyKey,
        payloadDigest,
        createdAt: occurredAt,
      });

      const insertedAudit = await tx
        .insert(schema.adminAuditEvents)
        .values({
          adminAuditEventId: auditEvent.adminAuditEventId,
          commandId: auditEvent.commandId,
          eventType: auditEvent.eventType,
          commandStatus: auditEvent.commandStatus,
          actorUserId: auditEvent.actorUserId,
          platformAdminAssignmentId: auditEvent.platformAdminAssignmentId,
          platformRole: auditEvent.platformRole,
          action: auditEvent.action,
          targetType: auditEvent.targetType,
          targetId: auditEvent.targetId,
          orgId: auditEvent.orgId,
          workspaceId: auditEvent.workspaceId,
          reason: auditEvent.reason,
          beforeReference: auditEvent.beforeReference,
          afterReference: auditEvent.afterReference,
          requestId: auditEvent.requestId,
          idempotencyKey: auditEvent.idempotencyKey,
          payloadDigest: auditEvent.payloadDigest,
          createdAt: new Date(auditEvent.createdAt),
          integrityHash: auditEvent.integrityHash,
          contractVersion: auditEvent.contractVersion,
          event: auditEvent,
        })
        .onConflictDoNothing()
        .returning();
      if (!insertedAudit[0]) {
        const racedAudit = await tx
          .select()
          .from(schema.adminAuditEvents)
          .where(
            and(
              eq(schema.adminAuditEvents.eventType, "COMMAND_SUCCEEDED"),
              or(
                eq(schema.adminAuditEvents.commandId, commandId),
                and(
                  eq(
                    schema.adminAuditEvents.idempotencyKey,
                    input.context.idempotencyKey
                  ),
                  eq(
                    schema.adminAuditEvents.action,
                    "PLATFORM_SUPER_ADMIN_GRANT"
                  )
                )
              )
            )
          )
          .limit(1);
        if (!racedAudit[0]) {
          throw new PlatformAdminGrantManagementError(
            "PLATFORM_ADMIN_COMMAND_CONFLICT",
            "Grant audit conflicted without converged evidence"
          );
        }
        assertAuditEquivalent(auditFromRow(racedAudit[0]), auditEvent);
      }

      return {
        assignment: effective,
        auditEvent: insertedAudit[0] ? auditFromRow(insertedAudit[0]) : auditEvent,
        changed: !alreadyActiveRow,
        replayed: false,
      };
    });
  }

  async revokePlatformSuperAdmin(input: {
    context: TrustedAdminCommandContext;
    targetUserId: string;
    reason?: string;
    occurredAt?: string;
  }): Promise<PlatformAdminRevokeCommandResult> {
    assertTrustedAdminCommandContext(input.context);
    assertUuid(input.targetUserId, "targetUserId");
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const reason = input.reason?.trim() || input.context.reason;
    const commandId = buildAdminCommandId(input.context);

    return this.db.transaction(async (tx) => {
      const actorRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(
          and(
            eq(
              schema.platformAdminGrants.platformAdminAssignmentId,
              input.context.platformAdminAssignmentId
            ),
            eq(schema.platformAdminGrants.userId, input.context.actorUserId),
            eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
            eq(schema.platformAdminGrants.status, "ACTIVE")
          )
        )
        .for("update")
        .limit(1);
      if (!actorRows[0]) {
        throw new PlatformAdminGrantManagementError(
          "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE",
          "An ACTIVE Platform Super Admin assignment is required"
        );
      }

      const priorAuditRows = await tx
        .select()
        .from(schema.adminAuditEvents)
        .where(
          and(
            eq(schema.adminAuditEvents.eventType, "COMMAND_SUCCEEDED"),
            or(
              eq(schema.adminAuditEvents.commandId, commandId),
              and(
                eq(
                  schema.adminAuditEvents.idempotencyKey,
                  input.context.idempotencyKey
                ),
                eq(
                  schema.adminAuditEvents.action,
                  "PLATFORM_SUPER_ADMIN_REVOKE"
                )
              )
            )
          )
        )
        .limit(1);
      if (priorAuditRows[0]) {
        const priorAudit = auditFromRow(priorAuditRows[0]);
        const assignmentId = priorAudit.beforeReference?.id;
        const assignmentRows = assignmentId
          ? await tx
              .select()
              .from(schema.platformAdminGrants)
              .where(
                eq(schema.platformAdminGrants.platformAdminAssignmentId, assignmentId)
              )
              .limit(1)
          : [];
        const revocationRows = assignmentId
          ? await tx
              .select()
              .from(schema.platformAdminRevocations)
              .where(
                eq(schema.platformAdminRevocations.platformAdminAssignmentId, assignmentId)
              )
              .limit(1)
          : [];
        if (!assignmentRows[0] || !revocationRows[0]) {
          throw new PlatformAdminGrantManagementError(
            "PLATFORM_ADMIN_COMMAND_CONFLICT",
            "Existing revoke audit is missing its durable authority facts"
          );
        }
        return {
          assignment: assignmentFromRow(assignmentRows[0]),
          revocation: revocationRows[0].revocation,
          auditEvent: priorAudit,
          replayed: true,
        };
      }

      const activeRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(
          and(
            eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN"),
            eq(schema.platformAdminGrants.status, "ACTIVE")
          )
        )
        .for("update");
      const targetRow = activeRows.find((row) => row.userId === input.targetUserId);
      if (!targetRow) {
        throw new PlatformAdminGrantManagementError(
          "PLATFORM_ADMIN_TARGET_NOT_ACTIVE",
          "Target user has no ACTIVE Platform Super Admin assignment"
        );
      }
      if (activeRows.length <= 1) {
        throw new PlatformAdminGrantManagementError(
          "PLATFORM_ADMIN_LAST_ACTIVE_CANNOT_REVOKE",
          "The final ACTIVE Platform Super Admin cannot be revoked"
        );
      }

      const assignment = assignmentFromRow(targetRow);
      const revocation = buildPlatformAdminRevocation({
        assignment,
        revokedAt: occurredAt,
        revokedByUserId: input.context.actorUserId,
        reason,
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
            assignment.platformAdminAssignmentId
          )
        );

      const revokedAssignment = parsePlatformAdminAssignment({
        ...assignment,
        status: "REVOKED",
      });
      const payloadDigest = buildAdminAuditEventIntegrityHash({
        authorityType: "PLATFORM_ADMIN_REVOCATION",
        role: "PLATFORM_SUPER_ADMIN",
        targetUserId: input.targetUserId,
        previousState: "ACTIVE",
        resultingState: "REVOKED",
      });
      const auditEvent = buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_SUCCEEDED",
        commandStatus: "SUCCEEDED",
        actorUserId: input.context.actorUserId,
        platformAdminAssignmentId: input.context.platformAdminAssignmentId,
        action: "PLATFORM_SUPER_ADMIN_REVOKE",
        targetType: "AUTH_USER",
        targetId: input.targetUserId,
        reason,
        beforeReference: stateReference(assignment),
        afterReference: stateReference(revokedAssignment),
        requestId: input.context.requestId,
        idempotencyKey: input.context.idempotencyKey,
        payloadDigest,
        createdAt: occurredAt,
      });
      await tx.insert(schema.adminAuditEvents).values({
        adminAuditEventId: auditEvent.adminAuditEventId,
        commandId: auditEvent.commandId,
        eventType: auditEvent.eventType,
        commandStatus: auditEvent.commandStatus,
        actorUserId: auditEvent.actorUserId,
        platformAdminAssignmentId: auditEvent.platformAdminAssignmentId,
        platformRole: auditEvent.platformRole,
        action: auditEvent.action,
        targetType: auditEvent.targetType,
        targetId: auditEvent.targetId,
        orgId: auditEvent.orgId,
        workspaceId: auditEvent.workspaceId,
        reason: auditEvent.reason,
        beforeReference: auditEvent.beforeReference,
        afterReference: auditEvent.afterReference,
        requestId: auditEvent.requestId,
        idempotencyKey: auditEvent.idempotencyKey,
        payloadDigest: auditEvent.payloadDigest,
        createdAt: new Date(auditEvent.createdAt),
        integrityHash: auditEvent.integrityHash,
        contractVersion: auditEvent.contractVersion,
        event: auditEvent,
      });

      return {
        assignment: revokedAssignment,
        revocation,
        auditEvent,
        replayed: false,
      };
    });
  }
}
