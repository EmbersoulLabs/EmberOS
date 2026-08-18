/**
 * Sprint 4 Phase B / B1 — Billing Account + Subscription contracts.
 *
 * Provider-neutral. Stripe-specific normalization belongs to Phase C.
 * SubscriptionProjection is a read model — not mutable browser state.
 */
import { z } from "zod";

export const COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

export const BillingAccountSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION),
    billingAccountId: UuidSchema,
    orgId: UuidSchema,
    /** Provider-neutral external customer identity (e.g. Stripe customer id later). */
    externalCustomerReference: NonEmptyTextSchema.nullable(),
    createdAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type BillingAccount = z.infer<typeof BillingAccountSchema>;

/**
 * Provider-neutral subscription source identity.
 * Does not embed Stripe SDK types.
 */
export const SubscriptionSourceIdentitySchema = z
  .object({
    provider: NonEmptyTextSchema,
    externalSubscriptionId: NonEmptyTextSchema,
    externalCustomerId: NonEmptyTextSchema.nullable(),
  })
  .strict();

export type SubscriptionSourceIdentity = z.infer<
  typeof SubscriptionSourceIdentitySchema
>;

/** Normalized subscription status vocabulary (provider-neutral). */
export const SUBSCRIPTION_STATUSES = [
  "NONE",
  "INCOMPLETE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "PAUSED",
  "CANCELED",
  "UNPAID",
  "UNKNOWN",
] as const;

export const SubscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

/**
 * Canonical commercial eligibility for capabilities derived from a subscription
 * plan. Other entitlement sources retain their own grant/revocation authority.
 */
export const PLAN_CAPABILITY_ENTITLED_SUBSCRIPTION_STATUSES = [
  "ACTIVE",
  "TRIALING",
] as const satisfies readonly SubscriptionStatus[];

const PLAN_CAPABILITY_ENTITLED_SUBSCRIPTION_STATUS_SET = new Set<SubscriptionStatus>(
  PLAN_CAPABILITY_ENTITLED_SUBSCRIPTION_STATUSES
);

export function subscriptionStatusAllowsPlanCapabilities(
  status: SubscriptionStatus
): boolean {
  return PLAN_CAPABILITY_ENTITLED_SUBSCRIPTION_STATUS_SET.has(status);
}

export const SubscriptionEventSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION),
    subscriptionEventId: UuidSchema,
    billingAccountId: UuidSchema,
    orgId: UuidSchema,
    source: SubscriptionSourceIdentitySchema,
    eventType: NonEmptyTextSchema,
    occurredAt: IsoDatetimeSchema,
    acceptedAt: IsoDatetimeSchema,
    payloadDigest: IntegrityHashSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type SubscriptionEvent = z.infer<typeof SubscriptionEventSchema>;

/**
 * Read-only subscription projection. Browser must not mutate status.
 * Admin must not manually force ACTIVE without verified source events.
 */
export const SubscriptionProjectionSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION),
    subscriptionProjectionId: UuidSchema,
    billingAccountId: UuidSchema,
    orgId: UuidSchema,
    status: SubscriptionStatusSchema,
    /** Product plan key when known (agency/pro/free/…) — not organizations.plan authority. */
    planKey: NonEmptyTextSchema.nullable(),
    source: SubscriptionSourceIdentitySchema.nullable(),
    currentPeriodStart: IsoDatetimeSchema.nullable(),
    currentPeriodEnd: IsoDatetimeSchema.nullable(),
    projectedAt: IsoDatetimeSchema,
    sourceEventId: UuidSchema.nullable(),
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type SubscriptionProjection = z.infer<typeof SubscriptionProjectionSchema>;

export function parseBillingAccount(value: unknown): BillingAccount {
  return BillingAccountSchema.parse(value);
}

export function parseSubscriptionEvent(value: unknown): SubscriptionEvent {
  return SubscriptionEventSchema.parse(value);
}

export function parseSubscriptionProjection(
  value: unknown
): SubscriptionProjection {
  return SubscriptionProjectionSchema.parse(value);
}
