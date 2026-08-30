/**
 * Sprint 4 Phase B / B1 — Platform Administration contracts (browser-safe shapes).
 *
 * PLATFORM ROLE ≠ ORGANIZATION ROLE ≠ WORKSPACE ROLE ≠ COMMERCIAL ENTITLEMENT
 *
 * Trusted AdminCommandContext construction lives in platform-admin-command.ts
 * (server-only). Browser JSON must never become a trusted context.
 */
import { z } from "zod";

export const PLATFORM_ADMIN_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

/** V1 persistent platform role vocabulary. */
export const PLATFORM_ROLES = ["PLATFORM_SUPER_ADMIN"] as const;
export const PlatformRoleSchema = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRoleSchema>;

export const PlatformAdminAssignmentStatusSchema = z.enum([
  "ACTIVE",
  "REVOKED",
]);
export type PlatformAdminAssignmentStatus = z.infer<
  typeof PlatformAdminAssignmentStatusSchema
>;

/**
 * Immutable Platform Admin grant/assignment fact (contract shape only).
 * Persistence is Phase B2+.
 */
export const PlatformAdminAssignmentSchema = z
  .object({
    contractVersion: z.literal(PLATFORM_ADMIN_CONTRACT_VERSION),
    platformAdminAssignmentId: UuidSchema,
    userId: UuidSchema,
    platformRole: PlatformRoleSchema,
    status: PlatformAdminAssignmentStatusSchema,
    grantedAt: IsoDatetimeSchema,
    grantedByUserId: UuidSchema.nullable(),
    reason: NonEmptyTextSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type PlatformAdminAssignment = z.infer<typeof PlatformAdminAssignmentSchema>;

export const PlatformAdminRevocationSchema = z
  .object({
    contractVersion: z.literal(PLATFORM_ADMIN_CONTRACT_VERSION),
    platformAdminRevocationId: UuidSchema,
    /** Targets one specific assignment — does not delete history. */
    platformAdminAssignmentId: UuidSchema,
    userId: UuidSchema,
    platformRole: PlatformRoleSchema,
    revokedAt: IsoDatetimeSchema,
    revokedByUserId: UuidSchema,
    reason: NonEmptyTextSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type PlatformAdminRevocation = z.infer<typeof PlatformAdminRevocationSchema>;

export const AdminAuditEventTypeSchema = z.enum([
  "COMMAND_ACCEPTED",
  "COMMAND_SUCCEEDED",
  "COMMAND_FAILED",
]);
export type AdminAuditEventType = z.infer<typeof AdminAuditEventTypeSchema>;

export const AdminAuditCommandStatusSchema = z.enum([
  "ACCEPTED",
  "SUCCEEDED",
  "FAILED",
]);
export type AdminAuditCommandStatus = z.infer<typeof AdminAuditCommandStatusSchema>;

/**
 * Safe reference — never store secrets, signed URLs, tokens, or raw provider payloads.
 */
export const AdminAuditSafeReferenceSchema = z
  .object({
    kind: NonEmptyTextSchema,
    id: NonEmptyTextSchema.optional(),
    digest: IntegrityHashSchema.optional(),
  })
  .strict();

export type AdminAuditSafeReference = z.infer<typeof AdminAuditSafeReferenceSchema>;

export const AdminAuditEventSchema = z
  .object({
    contractVersion: z.literal(PLATFORM_ADMIN_CONTRACT_VERSION),
    adminAuditEventId: UuidSchema,
    commandId: UuidSchema,
    eventType: AdminAuditEventTypeSchema,
    commandStatus: AdminAuditCommandStatusSchema,
    actorUserId: UuidSchema,
    platformAdminAssignmentId: UuidSchema,
    platformRole: PlatformRoleSchema,
    action: NonEmptyTextSchema,
    targetType: NonEmptyTextSchema,
    targetId: NonEmptyTextSchema,
    orgId: UuidSchema.nullable(),
    workspaceId: UuidSchema.nullable(),
    reason: NonEmptyTextSchema,
    beforeReference: AdminAuditSafeReferenceSchema.nullable(),
    afterReference: AdminAuditSafeReferenceSchema.nullable(),
    requestId: NonEmptyTextSchema,
    idempotencyKey: NonEmptyTextSchema,
    payloadDigest: IntegrityHashSchema,
    createdAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type AdminAuditEvent = z.infer<typeof AdminAuditEventSchema>;

const FORBIDDEN_AUDIT_PAYLOAD_KEYS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "signedUrl",
  "signed_url",
  "stripeSecret",
  "apiKey",
  "api_key",
  "secret",
  "rawProviderPayload",
  "providerPayload",
] as const;

/**
 * Strip known secret-bearing keys from an audit payload before digesting.
 * Does not claim completeness for nested provider dumps — callers must not
 * pass secrets into Admin audit payloads.
 */
export function redactAdminAuditPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (
      FORBIDDEN_AUDIT_PAYLOAD_KEYS.some(
        (forbidden) => forbidden.toLowerCase() === key.toLowerCase()
      )
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function parsePlatformAdminAssignment(
  value: unknown
): PlatformAdminAssignment {
  return PlatformAdminAssignmentSchema.parse(value);
}

export function parsePlatformAdminRevocation(
  value: unknown
): PlatformAdminRevocation {
  return PlatformAdminRevocationSchema.parse(value);
}

export function parseAdminAuditEvent(value: unknown): AdminAuditEvent {
  return AdminAuditEventSchema.parse(value);
}

/**
 * Untrusted browser-facing claim shape. NEVER treat as AdminCommandContext.
 * Server must resolve actor + active assignment independently.
 */
export const BrowserAdminCommandClaimSchema = z
  .object({
    requestId: NonEmptyTextSchema,
    idempotencyKey: NonEmptyTextSchema,
    reason: NonEmptyTextSchema,
    commandType: NonEmptyTextSchema,
    targetOrgId: UuidSchema.optional(),
    targetWorkspaceId: UuidSchema.optional(),
    /** Forged roles in browser claims are ignored by trusted constructors. */
    claimedPlatformRole: PlatformRoleSchema.optional(),
    claimedPlatformAdminAssignmentId: UuidSchema.optional(),
  })
  .strict();

export type BrowserAdminCommandClaim = z.infer<typeof BrowserAdminCommandClaimSchema>;
