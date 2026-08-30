/**
 * Sprint 4 Phase B / B1 — organizations.plan compatibility boundary.
 *
 * organizations.plan is a COMPATIBILITY_PROJECTION only.
 * It is NOT Subscription authority, Entitlement authority, or Commercial
 * Execution Authorization authority.
 *
 * Keep the physical column. Preserve legacy export paywall helpers in billing.ts.
 * Do not seed canonical Subscription / Entitlement state from this field.
 */
import { z } from "zod";

export const ORGANIZATIONS_PLAN_AUTHORITY = "COMPATIBILITY_PROJECTION" as const;

export const ORGANIZATIONS_PLAN_COMPATIBILITY_CONTRACT_VERSION = "1" as const;

/**
 * Known legacy plan string vocabulary used by organizations.plan / export paywall.
 * Not a SubscriptionProjection status and not an Entitlement source.
 */
export const OrganizationsPlanCompatibilityValueSchema = z.enum([
  "free",
  "pro",
  "agency",
  "enterprise",
  "paid",
  "starter",
]);

export type OrganizationsPlanCompatibilityValue = z.infer<
  typeof OrganizationsPlanCompatibilityValueSchema
>;

export const OrganizationsPlanCompatibilityProjectionSchema = z
  .object({
    contractVersion: z.literal(ORGANIZATIONS_PLAN_COMPATIBILITY_CONTRACT_VERSION),
    authority: z.literal(ORGANIZATIONS_PLAN_AUTHORITY),
    /** Raw organizations.plan column value (legacy). */
    plan: z.string().min(1),
    normalizedPlan: OrganizationsPlanCompatibilityValueSchema.or(z.literal("unknown")),
  })
  .strict();

export type OrganizationsPlanCompatibilityProjection = z.infer<
  typeof OrganizationsPlanCompatibilityProjectionSchema
>;

export function normalizeOrganizationsPlanCompatibilityValue(
  plan: string | null | undefined
): OrganizationsPlanCompatibilityValue | "unknown" {
  if (!plan) return "unknown";
  const normalized = plan.trim().toLowerCase();
  const parsed = OrganizationsPlanCompatibilityValueSchema.safeParse(normalized);
  return parsed.success ? parsed.data : "unknown";
}

/**
 * Wrap a legacy organizations.plan value so callers must acknowledge
 * COMPATIBILITY_PROJECTION authority.
 */
export function asOrganizationsPlanCompatibilityProjection(
  plan: string | null | undefined
): OrganizationsPlanCompatibilityProjection {
  const raw = (plan ?? "free").trim() || "free";
  return OrganizationsPlanCompatibilityProjectionSchema.parse({
    contractVersion: ORGANIZATIONS_PLAN_COMPATIBILITY_CONTRACT_VERSION,
    authority: ORGANIZATIONS_PLAN_AUTHORITY,
    plan: raw,
    normalizedPlan: normalizeOrganizationsPlanCompatibilityValue(raw),
  });
}

/**
 * Type-level / runtime guard: commercial code must not treat this as
 * SubscriptionProjection or EffectiveEntitlementProjection.
 */
export function assertOrganizationsPlanIsCompatibilityOnly(
  projection: OrganizationsPlanCompatibilityProjection
): void {
  if (projection.authority !== ORGANIZATIONS_PLAN_AUTHORITY) {
    throw new Error("organizations.plan authority must remain COMPATIBILITY_PROJECTION");
  }
}
