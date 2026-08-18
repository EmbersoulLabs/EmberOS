/**
 * Sprint 4 Phase B / B1 — Trusted AdminCommandContext (server-only).
 *
 * Browser JSON is NOT a trusted AdminCommandContext.
 * Forged role / assignment claims are discarded; only server-resolved
 * PlatformAdminAssignment evidence is accepted.
 */
import { z } from "zod";
import {
  PLATFORM_ADMIN_CONTRACT_VERSION,
  PlatformRoleSchema,
  type BrowserAdminCommandClaim,
  type PlatformAdminAssignment,
  type PlatformRole,
  BrowserAdminCommandClaimSchema,
} from "./platform-admin";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IsoDatetimeSchema = z.string().datetime();

const TrustedAdminCommandContextBrand: unique symbol = Symbol(
  "TrustedAdminCommandContext"
);

export const AdminCommandContextFieldsSchema = z
  .object({
    contractVersion: z.literal(PLATFORM_ADMIN_CONTRACT_VERSION),
    actorUserId: UuidSchema,
    platformAdminAssignmentId: UuidSchema,
    platformRole: PlatformRoleSchema,
    requestId: NonEmptyTextSchema,
    idempotencyKey: NonEmptyTextSchema,
    reason: NonEmptyTextSchema,
    commandType: NonEmptyTextSchema,
    targetOrgId: UuidSchema.nullable(),
    targetWorkspaceId: UuidSchema.nullable(),
    authenticatedAt: IsoDatetimeSchema,
    integrityHash: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>"),
  })
  .strict();

export type AdminCommandContextFields = z.infer<typeof AdminCommandContextFieldsSchema>;

/**
 * Trusted server-side command context. Construct only via
 * `createTrustedAdminCommandContext`.
 */
export type TrustedAdminCommandContext = AdminCommandContextFields & {
  readonly [TrustedAdminCommandContextBrand]: true;
};

export class AdminCommandContextTrustError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AdminCommandContextTrustError";
    this.code = code;
  }
}

function brandTrusted(
  fields: AdminCommandContextFields
): TrustedAdminCommandContext {
  return Object.freeze({
    ...fields,
    [TrustedAdminCommandContextBrand]: true as const,
  }) as TrustedAdminCommandContext;
}

export function isTrustedAdminCommandContext(
  value: unknown
): value is TrustedAdminCommandContext {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [TrustedAdminCommandContextBrand]?: unknown })[
      TrustedAdminCommandContextBrand
    ] === true
  );
}

export function assertTrustedAdminCommandContext(
  value: unknown
): asserts value is TrustedAdminCommandContext {
  if (!isTrustedAdminCommandContext(value)) {
    throw new AdminCommandContextTrustError(
      "ADMIN_COMMAND_CONTEXT_UNTRUSTED",
      "Value is not a TrustedAdminCommandContext"
    );
  }
}

/**
 * Explicitly reject treating arbitrary browser JSON as trusted context.
 */
export function rejectBrowserAdminCommandContext(
  value: unknown
): never {
  // Parse claim only to prove shape awareness — never brand it.
  BrowserAdminCommandClaimSchema.safeParse(value);
  throw new AdminCommandContextTrustError(
    "ADMIN_COMMAND_CONTEXT_BROWSER_FORGERY",
    "Browser JSON cannot become TrustedAdminCommandContext"
  );
}

export type CreateTrustedAdminCommandContextInput = {
  /** Server-resolved authenticated user id (from session / JWT). */
  actorUserId: string;
  /** Server-resolved ACTIVE Platform Admin assignment for actorUserId. */
  activeAssignment: PlatformAdminAssignment;
  requestId: string;
  idempotencyKey: string;
  reason: string;
  commandType: string;
  targetOrgId?: string | null;
  targetWorkspaceId?: string | null;
  authenticatedAt: string;
  /**
   * Optional untrusted browser claim. Claimed role/assignment are ignored.
   * requestId/idempotency/reason/commandType from claim may be used only when
   * not already provided by the server caller.
   */
  browserClaim?: BrowserAdminCommandClaim | null;
};

/**
 * Build a trusted AdminCommandContext from server-resolved actor evidence.
 * Forged browser role claims never override `activeAssignment`.
 */
export function createTrustedAdminCommandContext(
  input: CreateTrustedAdminCommandContextInput
): TrustedAdminCommandContext {
  if (input.activeAssignment.status !== "ACTIVE") {
    throw new AdminCommandContextTrustError(
      "PLATFORM_ADMIN_ASSIGNMENT_INACTIVE",
      "Platform Admin assignment must be ACTIVE"
    );
  }
  if (input.activeAssignment.userId !== input.actorUserId) {
    throw new AdminCommandContextTrustError(
      "PLATFORM_ADMIN_ASSIGNMENT_ACTOR_MISMATCH",
      "Platform Admin assignment userId must match authenticated actor"
    );
  }

  const claim = input.browserClaim
    ? BrowserAdminCommandClaimSchema.parse(input.browserClaim)
    : null;

  // Discard forged identity claims.
  if (
    claim?.claimedPlatformRole &&
    claim.claimedPlatformRole !== input.activeAssignment.platformRole
  ) {
    // Ignored — do not throw solely on mismatch; server assignment wins.
  }
  if (
    claim?.claimedPlatformAdminAssignmentId &&
    claim.claimedPlatformAdminAssignmentId !==
      input.activeAssignment.platformAdminAssignmentId
  ) {
    // Ignored.
  }

  const fieldsWithoutHash = {
    contractVersion: PLATFORM_ADMIN_CONTRACT_VERSION,
    actorUserId: input.actorUserId,
    platformAdminAssignmentId: input.activeAssignment.platformAdminAssignmentId,
    platformRole: input.activeAssignment.platformRole as PlatformRole,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
    reason: input.reason,
    commandType: input.commandType,
    targetOrgId: input.targetOrgId ?? null,
    targetWorkspaceId: input.targetWorkspaceId ?? null,
    authenticatedAt: input.authenticatedAt,
  };

  const integrityHash = sha256CanonicalIntegrityHash(fieldsWithoutHash);
  const fields = AdminCommandContextFieldsSchema.parse({
    ...fieldsWithoutHash,
    integrityHash,
  });

  return brandTrusted(fields);
}

export function buildAdminCommandId(context: TrustedAdminCommandContext): string {
  assertTrustedAdminCommandContext(context);
  return deterministicUuidFromFingerprint("admin-command", context.integrityHash);
}

export function buildAdminAuditEventIntegrityHash(payload: unknown): string {
  return sha256CanonicalIntegrityHash(payload);
}
