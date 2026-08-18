/**
 * Sprint 4 Phase B2 — Trusted Platform Admin resolution (server-side).
 *
 * Browser-provided Platform Admin context is never trusted.
 * SUPERADMIN_EMAILS may bootstrap only the first persistent grant.
 * After any accepted grant exists, env bootstrap never authorizes access.
 * Revocation cannot be bypassed by environment configuration.
 */
import type { PlatformAdminAssignment } from "@ceo-agent/shared";
import { buildPlatformAdminAssignment } from "@ceo-agent/shared/server";
import {
  PlatformAdminPersistenceError,
  type PlatformAdminRepository,
} from "./platform-admin";

export type PlatformAdminResolutionStatus =
  | "ACTIVE_GRANT"
  | "BOOTSTRAP_ELIGIBLE"
  | "DENIED";

export type PlatformAdminResolution =
  | {
      status: "ACTIVE_GRANT";
      assignment: PlatformAdminAssignment;
    }
  | {
      status: "BOOTSTRAP_ELIGIBLE";
      userId: string;
      email: string;
    }
  | {
      status: "DENIED";
      reason:
        | "NO_ACTIVE_GRANT"
        | "REVOKED"
        | "BOOTSTRAP_CLOSED"
        | "EMAIL_NOT_ALLOWLISTED"
        | "MISSING_EMAIL";
    };

export function parseSuperAdminEmailAllowlist(
  raw: string | null | undefined = process.env.SUPERADMIN_EMAILS
): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isEmailInSuperAdminAllowlist(
  email: string | null | undefined,
  allowlist: Set<string> = parseSuperAdminEmailAllowlist()
): boolean {
  if (!email) return false;
  return allowlist.has(email.trim().toLowerCase());
}

/**
 * Resolve whether the authenticated user has Platform Super Admin authority.
 * Does not accept browser role claims.
 */
export async function resolvePlatformAdminAccess(input: {
  userId: string;
  email: string | null | undefined;
  repository: PlatformAdminRepository;
  allowlist?: Set<string>;
}): Promise<PlatformAdminResolution> {
  const active = await input.repository.getActiveGrantForUser(input.userId);
  if (active) {
    return { status: "ACTIVE_GRANT", assignment: active };
  }

  const grants = await input.repository.listGrantsForUser(input.userId);
  const revokedOnly =
    grants.length > 0 && grants.every((grant) => grant.status === "REVOKED");
  if (revokedOnly) {
    // Env bootstrap must not resurrect a revoked admin.
    return { status: "DENIED", reason: "REVOKED" };
  }

  const hasAny = await input.repository.hasAnyAcceptedGrant();
  if (hasAny) {
    return { status: "DENIED", reason: "BOOTSTRAP_CLOSED" };
  }

  const allowlist = input.allowlist ?? parseSuperAdminEmailAllowlist();
  if (!input.email) {
    return { status: "DENIED", reason: "MISSING_EMAIL" };
  }
  if (!isEmailInSuperAdminAllowlist(input.email, allowlist)) {
    return { status: "DENIED", reason: "EMAIL_NOT_ALLOWLISTED" };
  }

  return {
    status: "BOOTSTRAP_ELIGIBLE",
    userId: input.userId,
    email: input.email.trim().toLowerCase(),
  };
}

/**
 * Authorize normal Admin access — ACTIVE persistent grant only.
 * Bootstrap eligibility does NOT grant access until a grant is accepted.
 */
export async function requireActivePlatformAdminAssignment(input: {
  userId: string;
  email: string | null | undefined;
  repository: PlatformAdminRepository;
  allowlist?: Set<string>;
}): Promise<PlatformAdminAssignment> {
  const resolution = await resolvePlatformAdminAccess(input);
  if (resolution.status === "ACTIVE_GRANT") {
    return resolution.assignment;
  }
  throw new PlatformAdminPersistenceError(
    "PLATFORM_ADMIN_BOOTSTRAP_CLOSED",
    resolution.status === "BOOTSTRAP_ELIGIBLE"
      ? "Bootstrap eligible but no persistent Platform Admin grant accepted yet"
      : `Platform Admin access denied (${resolution.reason})`
  );
}

/**
 * Accept the first bootstrap Platform Super Admin grant.
 * Fails closed once any grant exists. Never bypasses revocation.
 */
export async function acceptBootstrapPlatformAdminGrant(input: {
  userId: string;
  email: string | null | undefined;
  reason: string;
  grantedAt?: string;
  repository: PlatformAdminRepository;
  allowlist?: Set<string>;
}): Promise<PlatformAdminAssignment> {
  const resolution = await resolvePlatformAdminAccess(input);
  if (resolution.status === "ACTIVE_GRANT") {
    return resolution.assignment;
  }
  if (resolution.status !== "BOOTSTRAP_ELIGIBLE") {
    throw new PlatformAdminPersistenceError(
      "PLATFORM_ADMIN_BOOTSTRAP_CLOSED",
      `Bootstrap Platform Admin grant denied (${resolution.reason})`
    );
  }

  const assignment = buildPlatformAdminAssignment({
    userId: input.userId,
    grantedAt: input.grantedAt ?? new Date().toISOString(),
    grantedByUserId: null,
    reason: input.reason,
    identitySeed: `bootstrap:${input.userId}`,
  });

  const accepted = await input.repository.acceptBootstrapGrant(assignment);
  return accepted.value;
}

/**
 * Reject any attempt to treat browser JSON as Platform Admin authority.
 */
export function rejectBrowserPlatformAdminClaim(value: unknown): never {
  void value;
  throw new PlatformAdminPersistenceError(
    "PLATFORM_ADMIN_BOOTSTRAP_CLOSED",
    "Browser Platform Admin claims are never trusted"
  );
}
