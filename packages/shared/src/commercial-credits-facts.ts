/**
 * Sprint 4 Phase D — Deterministic credit domain fact builders (server-only).
 */
import {
  COMMERCIAL_CREDIT_CONTRACT_VERSION,
  CreditWalletSchema,
  CreditLedgerEntrySchema,
  CreditReservationSchema,
  CreditSettlementSchema,
  CreditReleaseSchema,
  type CreditWallet,
  type CreditLedgerEntry,
  type CreditLedgerEntryType,
  type CreditReservation,
  type CreditReservationStatus,
  type CreditSettlement,
  type CreditRelease,
} from "./commercial-credits";
import {
  PRODUCT_USAGE_CONTRACT_VERSION,
  ProductUsageEventSchema,
  type ProductUsageEvent,
} from "./commercial-product-usage";
import type { CapabilityKey } from "./commercial-entitlements";
import {
  deterministicUuidFromFingerprint,
  sha256CanonicalIntegrityHash,
} from "./canonical-integrity";

export function buildCreditWallet(input: {
  orgId: string;
  availableBalance: number;
  reservedBalance: number;
  projectedAt: string;
  identitySeed?: string;
}): CreditWallet {
  const creditWalletId = deterministicUuidFromFingerprint(
    "credit-wallet",
    input.identitySeed ?? `org:${input.orgId}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_CREDIT_CONTRACT_VERSION,
    creditWalletId,
    orgId: input.orgId,
    availableBalance: input.availableBalance,
    reservedBalance: input.reservedBalance,
    currencyUnit: "credit" as const,
    projectedAt: input.projectedAt,
  };
  return CreditWalletSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildCreditLedgerEntry(input: {
  creditWalletId: string;
  orgId: string;
  entryType: CreditLedgerEntryType;
  amount: number;
  reason: string;
  actorUserId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  pricingRuleKey?: string | null;
  pricingRuleVersion?: string | null;
  idempotencyKey: string;
  createdAt: string;
  identitySeed?: string;
}): CreditLedgerEntry {
  const creditLedgerEntryId = deterministicUuidFromFingerprint(
    "credit-ledger-entry",
    input.identitySeed ??
      `${input.creditWalletId}:${input.idempotencyKey}:${input.entryType}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_CREDIT_CONTRACT_VERSION,
    creditLedgerEntryId,
    creditWalletId: input.creditWalletId,
    orgId: input.orgId,
    entryType: input.entryType,
    amount: input.amount,
    currencyUnit: "credit" as const,
    reason: input.reason,
    actorUserId: input.actorUserId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    pricingRuleKey: input.pricingRuleKey ?? null,
    pricingRuleVersion: input.pricingRuleVersion ?? null,
    idempotencyKey: input.idempotencyKey,
    createdAt: input.createdAt,
  };
  return CreditLedgerEntrySchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildCreditReservation(input: {
  creditWalletId: string;
  orgId: string;
  workspaceId?: string | null;
  amount: number;
  status?: CreditReservationStatus;
  pricingRuleKey?: string | null;
  pricingRuleVersion?: string | null;
  executionIdentity?: string | null;
  createdAt: string;
  identitySeed?: string;
}): CreditReservation {
  const creditReservationId = deterministicUuidFromFingerprint(
    "credit-reservation",
    input.identitySeed ??
      `${input.creditWalletId}:${input.executionIdentity ?? "none"}:${input.createdAt}:${input.amount}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_CREDIT_CONTRACT_VERSION,
    creditReservationId,
    creditWalletId: input.creditWalletId,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    amount: input.amount,
    currencyUnit: "credit" as const,
    status: input.status ?? "ACCEPTED",
    pricingRuleKey: input.pricingRuleKey ?? null,
    pricingRuleVersion: input.pricingRuleVersion ?? null,
    executionIdentity: input.executionIdentity ?? null,
    createdAt: input.createdAt,
  };
  return CreditReservationSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildCreditSettlement(input: {
  creditWalletId: string;
  orgId: string;
  creditReservationId: string;
  creditLedgerEntryId: string;
  amount: number;
  billableEffectReference: string;
  pricingRuleKey?: string | null;
  pricingRuleVersion?: string | null;
  settledAt: string;
  identitySeed?: string;
}): CreditSettlement {
  const creditSettlementId = deterministicUuidFromFingerprint(
    "credit-settlement",
    input.identitySeed ??
      `${input.creditReservationId}:${input.billableEffectReference}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_CREDIT_CONTRACT_VERSION,
    creditSettlementId,
    creditWalletId: input.creditWalletId,
    orgId: input.orgId,
    creditReservationId: input.creditReservationId,
    creditLedgerEntryId: input.creditLedgerEntryId,
    amount: input.amount,
    currencyUnit: "credit" as const,
    billableEffectReference: input.billableEffectReference,
    pricingRuleKey: input.pricingRuleKey ?? null,
    pricingRuleVersion: input.pricingRuleVersion ?? null,
    settledAt: input.settledAt,
  };
  return CreditSettlementSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildCreditRelease(input: {
  creditWalletId: string;
  orgId: string;
  creditReservationId: string;
  reason: string;
  releasedAt: string;
  actorUserId?: string | null;
  identitySeed?: string;
}): CreditRelease {
  const creditReleaseId = deterministicUuidFromFingerprint(
    "credit-release",
    input.identitySeed ?? `${input.creditReservationId}:${input.releasedAt}`
  );
  const withoutHash = {
    contractVersion: COMMERCIAL_CREDIT_CONTRACT_VERSION,
    creditReleaseId,
    creditWalletId: input.creditWalletId,
    orgId: input.orgId,
    creditReservationId: input.creditReservationId,
    reason: input.reason,
    releasedAt: input.releasedAt,
    actorUserId: input.actorUserId ?? null,
  };
  return CreditReleaseSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

export function buildProductUsageEvent(input: {
  orgId: string;
  workspaceId?: string | null;
  capabilityKey: CapabilityKey;
  executionIdentity: string;
  pricingRuleKey?: string | null;
  pricingRuleVersion?: string | null;
  commercialAuthorizationId?: string | null;
  quantity: number;
  occurredAt: string;
  identitySeed?: string;
}): ProductUsageEvent {
  const productUsageEventId = deterministicUuidFromFingerprint(
    "product-usage-event",
    input.identitySeed ??
      `${input.orgId}:${input.executionIdentity}:${input.capabilityKey}:${input.occurredAt}`
  );
  const withoutHash = {
    contractVersion: PRODUCT_USAGE_CONTRACT_VERSION,
    productUsageEventId,
    orgId: input.orgId,
    workspaceId: input.workspaceId ?? null,
    capabilityKey: input.capabilityKey,
    executionIdentity: input.executionIdentity,
    pricingRuleKey: input.pricingRuleKey ?? null,
    pricingRuleVersion: input.pricingRuleVersion ?? null,
    commercialAuthorizationId: input.commercialAuthorizationId ?? null,
    quantity: input.quantity,
    occurredAt: input.occurredAt,
  };
  return ProductUsageEventSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}

/**
 * Rebuild wallet projection from ledger + open reservations.
 * available = sum(ledger amounts) - reserved
 * reserved = sum(ACCEPTED reservation amounts)
 */
export function projectCreditWalletFromFacts(input: {
  orgId: string;
  creditWalletId: string;
  ledgerEntries: readonly CreditLedgerEntry[];
  reservations: readonly CreditReservation[];
  projectedAt: string;
}): CreditWallet {
  const ledgerTotal = input.ledgerEntries.reduce(
    (sum, entry) => sum + entry.amount,
    0
  );
  const reservedBalance = input.reservations
    .filter((r) => r.status === "ACCEPTED" || r.status === "PENDING")
    .reduce((sum, r) => sum + r.amount, 0);
  return buildCreditWallet({
    orgId: input.orgId,
    availableBalance: ledgerTotal - reservedBalance,
    reservedBalance,
    projectedAt: input.projectedAt,
    identitySeed: `org:${input.orgId}`,
  });
}
