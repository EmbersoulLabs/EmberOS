/**
 * Sprint 4 Phase B3 — Deterministic commercial fact builders (server-only).
 * Preserves B1 public contract shapes.
 */
import {
  COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION,
  BillingAccountSchema,
  SubscriptionEventSchema,
  SubscriptionProjectionSchema,
  type BillingAccount,
  type SubscriptionEvent,
  type SubscriptionProjection,
  type SubscriptionSourceIdentity,
  type SubscriptionStatus,
} from "./commercial-subscription";
import {
  COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION,
  EntitlementGrantSchema,
  EntitlementRevocationSchema,
  EffectiveEntitlementProjectionSchema,
  type CapabilityKey,
  type EntitlementGrant,
  type EntitlementRevocation,
  type EntitlementSource,
  type EffectiveEntitlementEntry,
  type EffectiveEntitlementProjection,
} from "./commercial-entitlements";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export type BuildBillingAccountInput = {
  orgId: string;
  externalCustomerReference?: string | null;
  createdAt: string;
  identitySeed?: string;
};

export function buildBillingAccount(
  input: BuildBillingAccountInput
): BillingAccount {
  const billingAccountId = deterministicUuidFromFingerprint(
    "billing-account",
    input.identitySeed ?? `org:${input.orgId}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION,
    billingAccountId,
    orgId: input.orgId,
    externalCustomerReference: input.externalCustomerReference ?? null,
    createdAt: input.createdAt,
  };
  return BillingAccountSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export type BuildSubscriptionEventInput = {
  billingAccountId: string;
  orgId: string;
  source: SubscriptionSourceIdentity;
  eventType: string;
  occurredAt: string;
  acceptedAt: string;
  payloadDigest: string;
  identitySeed?: string;
};

export function buildSubscriptionEvent(
  input: BuildSubscriptionEventInput
): SubscriptionEvent {
  const subscriptionEventId = deterministicUuidFromFingerprint(
    "subscription-event",
    input.identitySeed ??
      `${input.source.provider}:${input.source.externalSubscriptionId}:${input.eventType}:${input.payloadDigest}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION,
    subscriptionEventId,
    billingAccountId: input.billingAccountId,
    orgId: input.orgId,
    source: input.source,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    acceptedAt: input.acceptedAt,
    payloadDigest: input.payloadDigest,
  };
  return SubscriptionEventSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export type BuildSubscriptionProjectionInput = {
  billingAccountId: string;
  orgId: string;
  status: SubscriptionStatus;
  planKey?: string | null;
  source?: SubscriptionSourceIdentity | null;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  projectedAt: string;
  sourceEventId?: string | null;
  identitySeed?: string;
};

export function buildSubscriptionProjection(
  input: BuildSubscriptionProjectionInput
): SubscriptionProjection {
  const subscriptionProjectionId = deterministicUuidFromFingerprint(
    "subscription-projection",
    input.identitySeed ?? `org:${input.orgId}:billing:${input.billingAccountId}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_SUBSCRIPTION_CONTRACT_VERSION,
    subscriptionProjectionId,
    billingAccountId: input.billingAccountId,
    orgId: input.orgId,
    status: input.status,
    planKey: input.planKey ?? null,
    source: input.source ?? null,
    currentPeriodStart: input.currentPeriodStart ?? null,
    currentPeriodEnd: input.currentPeriodEnd ?? null,
    projectedAt: input.projectedAt,
    sourceEventId: input.sourceEventId ?? null,
  };
  return SubscriptionProjectionSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export type BuildEntitlementGrantInput = {
  orgId: string;
  workspaceId?: string | null;
  capabilityKey: CapabilityKey;
  source: EntitlementSource;
  sourceReference?: string | null;
  reason: string;
  grantedByUserId?: string | null;
  grantedAt: string;
  expiresAt?: string | null;
  identitySeed?: string;
};

export function buildEntitlementGrant(
  input: BuildEntitlementGrantInput
): EntitlementGrant {
  const entitlementGrantId = deterministicUuidFromFingerprint(
    "entitlement-grant",
    input.identitySeed ??
      `${input.orgId}:${input.workspaceId ?? "org"}:${input.capabilityKey}:${input.source}:${input.grantedAt}:${input.reason}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION,
    entitlementGrantId,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    capabilityKey: input.capabilityKey,
    source: input.source,
    sourceReference: input.sourceReference ?? null,
    reason: input.reason,
    grantedByUserId: input.grantedByUserId ?? null,
    grantedAt: input.grantedAt,
    expiresAt: input.expiresAt ?? null,
  };
  return EntitlementGrantSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export type BuildEntitlementRevocationInput = {
  grant: EntitlementGrant;
  reason: string;
  revokedByUserId: string;
  revokedAt: string;
};

export function buildEntitlementRevocation(
  input: BuildEntitlementRevocationInput
): EntitlementRevocation {
  const entitlementRevocationId = deterministicUuidFromFingerprint(
    "entitlement-revocation",
    `${input.grant.entitlementGrantId}:${input.revokedAt}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION,
    entitlementRevocationId,
    entitlementGrantId: input.grant.entitlementGrantId,
    orgId: input.grant.orgId,
    capabilityKey: input.grant.capabilityKey,
    source: input.grant.source,
    reason: input.reason,
    revokedByUserId: input.revokedByUserId,
    revokedAt: input.revokedAt,
  };
  return EntitlementRevocationSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildEffectiveEntitlementProjection(input: {
  orgId: string;
  workspaceId?: string | null;
  entries: readonly EffectiveEntitlementEntry[];
  projectedAt: string;
}): EffectiveEntitlementProjection {
  const withoutHash = {
    contractVersion: COMMERCIAL_ENTITLEMENT_CONTRACT_VERSION,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    entries: [...input.entries],
    projectedAt: input.projectedAt,
  };
  return EffectiveEntitlementProjectionSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function effectiveEntitlementProjectionRowId(input: {
  orgId: string;
  workspaceId?: string | null;
}): string {
  return deterministicUuidFromFingerprint(
    "effective-entitlement-projection",
    `${input.orgId}:${input.workspaceId ?? "org-scope"}`
  );
}
