/**
 * Sprint 4 Phase B2 — Platform Admin authorization for web server routes.
 *
 * SUPERADMIN_EMAILS is bootstrap-only. Normal /admin API access requires an
 * ACTIVE persistent Platform Admin grant.
 */
import { requireAuth } from "@/lib/auth";
import {
  PlatformAdminRepositoryImpl,
  acceptBootstrapPlatformAdminGrant,
  rejectBrowserPlatformAdminClaim,
  requireActivePlatformAdminAssignment,
  resolvePlatformAdminAccess,
  type PlatformAdminResolution,
} from "@ceo-agent/db";
import type { PlatformAdminAssignment } from "@ceo-agent/shared";
import type { User } from "@supabase/supabase-js";

/** @deprecated Use resolvePlatformAdminForUser — email allowlist is bootstrap-only. */
export function getSuperAdminEmails(): Set<string> {
  return new Set(
    (process.env.SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** @deprecated Email allowlist alone must not authorize Admin APIs after bootstrap. */
export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getSuperAdminEmails().has(email.toLowerCase());
}

/** @deprecated Prefer resolvePlatformAdminForUser / requirePlatformAdmin. */
export function isSuperAdminUser(user: Pick<User, "email"> | null | undefined): boolean {
  return isSuperAdminEmail(user?.email);
}

export async function resolvePlatformAdminForUser(
  user: Pick<User, "id" | "email">
): Promise<PlatformAdminResolution> {
  const repository = new PlatformAdminRepositoryImpl();
  return resolvePlatformAdminAccess({
    userId: user.id,
    email: user.email,
    repository,
  });
}

/**
 * True only when an ACTIVE persistent Platform Admin grant exists for the user.
 * Bootstrap eligibility alone is false.
 */
export async function hasActivePlatformAdminGrant(
  user: Pick<User, "id" | "email">
): Promise<boolean> {
  const resolution = await resolvePlatformAdminForUser(user);
  return resolution.status === "ACTIVE_GRANT";
}

export async function requirePlatformAdmin(): Promise<{
  user: User;
  assignment: PlatformAdminAssignment;
}> {
  const user = await requireAuth();
  const repository = new PlatformAdminRepositoryImpl();
  const assignment = await requireActivePlatformAdminAssignment({
    userId: user.id,
    email: user.email,
    repository,
  });
  return { user, assignment };
}

/**
 * Bootstrap the first persistent Platform Super Admin grant for an allowlisted email.
 * After the first grant exists, this fails closed.
 */
export async function bootstrapPlatformAdminIfEligible(input: {
  user: Pick<User, "id" | "email">;
  reason: string;
}): Promise<PlatformAdminAssignment> {
  const repository = new PlatformAdminRepositoryImpl();
  return acceptBootstrapPlatformAdminGrant({
    userId: input.user.id,
    email: input.user.email,
    reason: input.reason,
    repository,
  });
}

export function rejectForgedBrowserPlatformAdminContext(value: unknown): never {
  return rejectBrowserPlatformAdminClaim(value);
}
