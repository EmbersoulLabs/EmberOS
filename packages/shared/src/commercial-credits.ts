/**
 * Sprint 4 Phase B / B1 — Credit domain contracts (CONTRACTS ONLY).
 *
 * - Wallet balance is a projection, not directly edited authority
 * - Ledger entries are immutable accounting facts
 * - Reservation has stable identity
 * - Settlement references accepted reservation / billable effect
 * - Release is explicit evidence
 *
 * NO SQL / persistence / balance mutation / reservation runtime in B1.
 */
import { z } from "zod";

export const COMMERCIAL_CREDIT_CONTRACT_VERSION = "1" as const;

const UuidSchema = z.string().uuid();
const NonEmptyTextSchema = z.string().trim().min(1);
const IntegrityHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected sha256:<64 hex>");
const IsoDatetimeSchema = z.string().datetime();

export const CreditWalletSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_CREDIT_CONTRACT_VERSION),
    creditWalletId: UuidSchema,
    orgId: UuidSchema,
    /**
     * Projection only — never mutate directly.
     * Authority is the immutable ledger + reservations/settlements.
     */
    availableBalance: z.number().int(),
    reservedBalance: z.number().int().nonnegative(),
    currencyUnit: z.literal("credit"),
    projectedAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CreditWallet = z.infer<typeof CreditWalletSchema>;

export const CREDIT_LEDGER_ENTRY_TYPES = [
  "GRANT",
  "COMPENSATION",
  "CORRECTION",
  "PROMOTIONAL",
  "REVERSAL",
  "SETTLEMENT_DEBIT",
  "RELEASE_CREDIT",
] as const;

export const CreditLedgerEntryTypeSchema = z.enum(CREDIT_LEDGER_ENTRY_TYPES);
export type CreditLedgerEntryType = z.infer<typeof CreditLedgerEntryTypeSchema>;

export const CreditLedgerEntrySchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_CREDIT_CONTRACT_VERSION),
    creditLedgerEntryId: UuidSchema,
    creditWalletId: UuidSchema,
    orgId: UuidSchema,
    entryType: CreditLedgerEntryTypeSchema,
    /** Signed amount in credit units (positive credit / negative debit). */
    amount: z.number().int(),
    currencyUnit: z.literal("credit"),
    reason: NonEmptyTextSchema,
    actorUserId: UuidSchema.nullable(),
    referenceType: NonEmptyTextSchema.nullable(),
    referenceId: NonEmptyTextSchema.nullable(),
    /** Pricing Rule reference — never compute pricing inside the ledger. */
    pricingRuleKey: NonEmptyTextSchema.nullable(),
    pricingRuleVersion: NonEmptyTextSchema.nullable(),
    idempotencyKey: NonEmptyTextSchema,
    createdAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CreditLedgerEntry = z.infer<typeof CreditLedgerEntrySchema>;

export const CreditReservationStatusSchema = z.enum([
  "PENDING",
  "ACCEPTED",
  "SETTLED",
  "RELEASED",
]);
export type CreditReservationStatus = z.infer<
  typeof CreditReservationStatusSchema
>;

export const CreditReservationSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_CREDIT_CONTRACT_VERSION),
    creditReservationId: UuidSchema,
    creditWalletId: UuidSchema,
    orgId: UuidSchema,
    workspaceId: UuidSchema.nullable(),
    amount: z.number().int().positive(),
    currencyUnit: z.literal("credit"),
    status: CreditReservationStatusSchema,
    pricingRuleKey: NonEmptyTextSchema.nullable(),
    pricingRuleVersion: NonEmptyTextSchema.nullable(),
    executionIdentity: NonEmptyTextSchema.nullable(),
    createdAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CreditReservation = z.infer<typeof CreditReservationSchema>;

export const CreditSettlementSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_CREDIT_CONTRACT_VERSION),
    creditSettlementId: UuidSchema,
    creditWalletId: UuidSchema,
    orgId: UuidSchema,
    /** Settlement must reference an accepted reservation. */
    creditReservationId: UuidSchema,
    creditLedgerEntryId: UuidSchema,
    amount: z.number().int().positive(),
    currencyUnit: z.literal("credit"),
    billableEffectReference: NonEmptyTextSchema,
    pricingRuleKey: NonEmptyTextSchema.nullable(),
    pricingRuleVersion: NonEmptyTextSchema.nullable(),
    settledAt: IsoDatetimeSchema,
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CreditSettlement = z.infer<typeof CreditSettlementSchema>;

export const CreditReleaseSchema = z
  .object({
    contractVersion: z.literal(COMMERCIAL_CREDIT_CONTRACT_VERSION),
    creditReleaseId: UuidSchema,
    creditWalletId: UuidSchema,
    orgId: UuidSchema,
    creditReservationId: UuidSchema,
    reason: NonEmptyTextSchema,
    releasedAt: IsoDatetimeSchema,
    actorUserId: UuidSchema.nullable(),
    integrityHash: IntegrityHashSchema,
  })
  .strict();

export type CreditRelease = z.infer<typeof CreditReleaseSchema>;

export function parseCreditWallet(value: unknown): CreditWallet {
  return CreditWalletSchema.parse(value);
}

export function parseCreditLedgerEntry(value: unknown): CreditLedgerEntry {
  return CreditLedgerEntrySchema.parse(value);
}

export function parseCreditReservation(value: unknown): CreditReservation {
  return CreditReservationSchema.parse(value);
}

export function parseCreditSettlement(value: unknown): CreditSettlement {
  return CreditSettlementSchema.parse(value);
}

export function parseCreditRelease(value: unknown): CreditRelease {
  return CreditReleaseSchema.parse(value);
}
