/**
 * Canonical post-bootstrap Platform Admin management.
 *
 * Every normal command requires a server-constructed TrustedAdminCommandContext
 * backed by the actor's ACTIVE persistent Platform Admin assignment. This file
 * deliberately contains no break-glass behavior.
 */
import {
  assertTrustedAdminCommandContext,
  buildAdminAuditEvent,
  buildAdminCommandId,
  buildPlatformAdminAssignment,
  buildPlatformAdminRevocation,
  sha256CanonicalIntegrityHash,
  type PlatformAdminAssignment,
  type PlatformAdminRevocation,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import type { AdminAuditRepository } from "./admin-audit";
import {
  PlatformAdminPersistenceError,
  type PlatformAdminRepository,
} from "./platform-admin";

export type PlatformAdminManagementDependencies = {
  platformAdmins: PlatformAdminRepository;
  audit: AdminAuditRepository;
  now?: () => string;
};

export class PlatformAdminManagementService {
  private readonly now: () => string;

  constructor(private readonly deps: PlatformAdminManagementDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async listForUser(
    context: TrustedAdminCommandContext,
    userId: string
  ): Promise<readonly PlatformAdminAssignment[]> {
    await this.requireActiveActor(context);
    return this.deps.platformAdmins.listGrantsForUser(userId);
  }

  async grantExistingUser(input: {
    context: TrustedAdminCommandContext;
    targetUserId: string;
  }): Promise<PlatformAdminAssignment> {
    const context = await this.requireActiveActor(input.context);
    const createdAt = this.now();
    const commandId = buildAdminCommandId(context);
    const assignment = buildPlatformAdminAssignment({
      userId: input.targetUserId,
      grantedAt: createdAt,
      grantedByUserId: context.actorUserId,
      reason: context.reason,
      identitySeed: `post-bootstrap:${context.idempotencyKey}:${input.targetUserId}`,
    });
    const payloadDigest = sha256CanonicalIntegrityHash({
      action: "PLATFORM_ADMIN_GRANT",
      targetUserId: input.targetUserId,
      assignmentId: assignment.platformAdminAssignmentId,
    });

    await this.deps.audit.acceptOrConverge(
      buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_ACCEPTED",
        commandStatus: "ACCEPTED",
        actorUserId: context.actorUserId,
        platformAdminAssignmentId: context.platformAdminAssignmentId,
        action: "PLATFORM_ADMIN_GRANT",
        targetType: "AUTH_USER",
        targetId: input.targetUserId,
        reason: context.reason,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        payloadDigest,
        createdAt,
      })
    );

    const accepted = await this.deps.platformAdmins.acceptOrConvergeGrant(
      assignment
    );

    await this.deps.audit.acceptOrConverge(
      buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_SUCCEEDED",
        commandStatus: "SUCCEEDED",
        actorUserId: context.actorUserId,
        platformAdminAssignmentId: context.platformAdminAssignmentId,
        action: "PLATFORM_ADMIN_GRANT",
        targetType: "PLATFORM_ADMIN_ASSIGNMENT",
        targetId: accepted.value.platformAdminAssignmentId,
        reason: context.reason,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        payloadDigest,
        createdAt,
      })
    );

    return accepted.value;
  }

  async revokeGrant(input: {
    context: TrustedAdminCommandContext;
    platformAdminAssignmentId: string;
  }): Promise<PlatformAdminRevocation> {
    const context = await this.requireActiveActor(input.context);
    const assignment = await this.deps.platformAdmins.getGrantByAssignmentId(
      input.platformAdminAssignmentId
    );
    if (!assignment) {
      throw new PlatformAdminPersistenceError(
        "PLATFORM_ADMIN_NOT_FOUND",
        "Cannot revoke missing Platform Admin grant"
      );
    }

    const createdAt = this.now();
    const commandId = buildAdminCommandId(context);
    const revocation = buildPlatformAdminRevocation({
      assignment,
      revokedAt: createdAt,
      revokedByUserId: context.actorUserId,
      reason: context.reason,
    });
    const payloadDigest = sha256CanonicalIntegrityHash({
      action: "PLATFORM_ADMIN_REVOKE",
      assignmentId: input.platformAdminAssignmentId,
      revocationId: revocation.platformAdminRevocationId,
    });

    await this.deps.audit.acceptOrConverge(
      buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_ACCEPTED",
        commandStatus: "ACCEPTED",
        actorUserId: context.actorUserId,
        platformAdminAssignmentId: context.platformAdminAssignmentId,
        action: "PLATFORM_ADMIN_REVOKE",
        targetType: "PLATFORM_ADMIN_ASSIGNMENT",
        targetId: input.platformAdminAssignmentId,
        reason: context.reason,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        payloadDigest,
        createdAt,
      })
    );

    const accepted = await this.deps.platformAdmins.acceptOrConvergeRevocation(
      revocation
    );

    await this.deps.audit.acceptOrConverge(
      buildAdminAuditEvent({
        commandId,
        eventType: "COMMAND_SUCCEEDED",
        commandStatus: "SUCCEEDED",
        actorUserId: context.actorUserId,
        platformAdminAssignmentId: context.platformAdminAssignmentId,
        action: "PLATFORM_ADMIN_REVOKE",
        targetType: "PLATFORM_ADMIN_REVOCATION",
        targetId: accepted.value.platformAdminRevocationId,
        reason: context.reason,
        requestId: context.requestId,
        idempotencyKey: context.idempotencyKey,
        payloadDigest,
        createdAt,
      })
    );

    return accepted.value;
  }

  private async requireActiveActor(
    context: TrustedAdminCommandContext
  ): Promise<TrustedAdminCommandContext> {
    assertTrustedAdminCommandContext(context);
    if (context.platformRole !== "PLATFORM_SUPER_ADMIN") {
      throw new PlatformAdminPersistenceError(
        "PLATFORM_ADMIN_GRANT_INACTIVE",
        "Normal Platform Admin management requires PLATFORM_SUPER_ADMIN"
      );
    }
    const active = await this.deps.platformAdmins.getActiveGrantForUser(
      context.actorUserId
    );
    if (
      !active ||
      active.status !== "ACTIVE" ||
      active.platformAdminAssignmentId !== context.platformAdminAssignmentId
    ) {
      throw new PlatformAdminPersistenceError(
        "PLATFORM_ADMIN_GRANT_INACTIVE",
        "Normal Platform Admin management requires the actor's current ACTIVE grant"
      );
    }
    return context;
  }
}
