/**
 * Sprint 4 Phase B2 — Deterministic Platform Admin / Audit fact builders (server-only).
 * Does not change B1 contract shapes.
 */
import {
  PLATFORM_ADMIN_CONTRACT_VERSION,
  PlatformAdminAssignmentSchema,
  PlatformAdminRevocationSchema,
  AdminAuditEventSchema,
  type PlatformAdminAssignment,
  type PlatformAdminRevocation,
  type AdminAuditEvent,
  type AdminAuditSafeReference,
  type AdminAuditEventType,
  type AdminAuditCommandStatus,
  type PlatformRole,
} from "./platform-admin";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export type BuildPlatformAdminAssignmentInput = {
  userId: string;
  platformRole?: PlatformRole;
  grantedAt: string;
  grantedByUserId?: string | null;
  reason: string;
  /** Optional stable seed for bootstrap identity (e.g. userId). */
  identitySeed?: string;
};

export function buildPlatformAdminAssignment(
  input: BuildPlatformAdminAssignmentInput
): PlatformAdminAssignment {
  const platformRole = input.platformRole ?? "PLATFORM_SUPER_ADMIN";
  const identitySeed = input.identitySeed ?? `${input.userId}:${platformRole}:${input.grantedAt}`;
  const platformAdminAssignmentId = deterministicUuidFromFingerprint(
    "platform-admin-assignment",
    identitySeed
  );
  const withoutHash = {
    contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
    platformAdminAssignmentId,
    userId: input.userId,
    platformRole,
    status: "ACTIVE" as const,
    grantedAt: input.grantedAt,
    grantedByUserId: input.grantedByUserId ?? null,
    reason: input.reason,
  };
  const integrityHash = sha256CanonicalIntegrityHash(withoutHash);
  return PlatformAdminAssignmentSchema.parse({ ...withoutHash, integrityHash });
}

export type BuildPlatformAdminRevocationInput = {
  assignment: PlatformAdminAssignment;
  revokedAt: string;
  revokedByUserId: string;
  reason: string;
};

export function buildPlatformAdminRevocation(
  input: BuildPlatformAdminRevocationInput
): PlatformAdminRevocation {
  const platformAdminRevocationId = deterministicUuidFromFingerprint(
    "platform-admin-revocation",
    `${input.assignment.platformAdminAssignmentId}:${input.revokedAt}`
  );
  const withoutHash = {
    contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
    platformAdminRevocationId,
    platformAdminAssignmentId: input.assignment.platformAdminAssignmentId,
    userId: input.assignment.userId,
    platformRole: input.assignment.platformRole,
    revokedAt: input.revokedAt,
    revokedByUserId: input.revokedByUserId,
    reason: input.reason,
  };
  const integrityHash = sha256CanonicalIntegrityHash(withoutHash);
  return PlatformAdminRevocationSchema.parse({ ...withoutHash, integrityHash });
}

export type BuildAdminAuditEventInput = {
  commandId: string;
  eventType: AdminAuditEventType;
  commandStatus: AdminAuditCommandStatus;
  actorUserId: string;
  platformAdminAssignmentId: string;
  platformRole?: PlatformRole;
  action: string;
  targetType: string;
  targetId: string;
  orgId?: string | null;
  workspaceId?: string | null;
  reason: string;
  beforeReference?: AdminAuditSafeReference | null;
  afterReference?: AdminAuditSafeReference | null;
  requestId: string;
  idempotencyKey: string;
  payloadDigest: string;
  createdAt: string;
};

export function buildAdminAuditEvent(
  input: BuildAdminAuditEventInput
): AdminAuditEvent {
  const adminAuditEventId = deterministicUuidFromFingerprint(
    "admin-audit-event",
    `${input.commandId}:${input.eventType}:${input.idempotencyKey}`
  );
  const withoutHash = {
    contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
    adminAuditEventId,
    commandId: input.commandId,
    eventType: input.eventType,
    commandStatus: input.commandStatus,
    actorUserId: input.actorUserId,
    platformAdminAssignmentId: input.platformAdminAssignmentId,
    platformRole: input.platformRole ?? "PLATFORM_SUPER_ADMIN",
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    orgId: input.orgId ?? null,
    workspaceId: input.workspaceId ?? null,
    reason: input.reason,
    beforeReference: input.beforeReference ?? null,
    afterReference: input.afterReference ?? null,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    payloadDigest: input.payloadDigest,
    createdAt: input.createdAt,
  };
  const integrityHash = sha256CanonicalIntegrityHash(withoutHash);
  return AdminAuditEventSchema.parse({ ...withoutHash, integrityHash });
}
