/**
 * Sprint 4 Phase D — Credits & Settlement repositories + accounting service.
 *
 * Wallet = projection. Ledger = authority. Reservation identity immutable.
 * Settlement / Release / Product Usage = append-only, idempotent, replay-safe.
 * No Commercial Authorization / Execute / browser wallet mutation.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  assertTrustedAdminCommandContext,
  buildCreditLedgerEntry,
  buildCreditRelease,
  buildCreditReservation,
  buildCreditSettlement,
  buildCreditWallet,
  projectCreditWalletFromFacts,
  sha256CanonicalIntegrityHash,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import {
  CreditReservationSchema,
  parseCreditLedgerEntry,
  parseCreditRelease,
  parseCreditReservation,
  parseCreditSettlement,
  parseCreditWallet,
  parseProductUsageEvent,
  type CreditLedgerEntry,
  type CreditRelease,
  type CreditReservation,
  type CreditSettlement,
  type CreditWallet,
  type ProductUsageEvent,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  isUniqueViolation,
} from "./billing-account";
import type { AcceptOrConvergeResult } from "./platform-admin";

type Db = ReturnType<typeof getDb>;

export type CreditsAccountingErrorCode =
  | "CREDITS_NOT_FOUND"
  | "CREDITS_INSUFFICIENT"
  | "CREDITS_RESERVATION_INVALID"
  | "CREDITS_ALREADY_TERMINAL"
  | "CREDITS_ORG_INVALID"
  | "CREDITS_IDENTITY_CONFLICT"
  | "CREDITS_TRUST_REQUIRED";

export class CreditsAccountingError extends Error {
  readonly status: number;

  constructor(
    readonly code: CreditsAccountingErrorCode,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "CreditsAccountingError";
    this.status =
      status ??
      (code === "CREDITS_NOT_FOUND"
        ? 404
        : code === "CREDITS_INSUFFICIENT" ||
            code === "CREDITS_RESERVATION_INVALID" ||
            code === "CREDITS_ALREADY_TERMINAL"
          ? 409
          : code === "CREDITS_TRUST_REQUIRED"
            ? 403
            : 409);
  }
}

function withReservationStatus(
  reservation: CreditReservation,
  status: CreditReservation["status"]
): CreditReservation {
  const withoutHash = {
    contractVersion: reservation.contractVersion,
    creditReservationId: reservation.creditReservationId,
    creditWalletId: reservation.creditWalletId,
    orgId: reservation.orgId,
    workspaceId: reservation.workspaceId,
    amount: reservation.amount,
    currencyUnit: reservation.currencyUnit,
    status,
    pricingRuleKey: reservation.pricingRuleKey,
    pricingRuleVersion: reservation.pricingRuleVersion,
    executionIdentity: reservation.executionIdentity,
    createdAt: reservation.createdAt,
  };
  return CreditReservationSchema.parse({
    ...withoutHash,
    integrityHash: sha256CanonicalIntegrityHash(withoutHash),
  });
}


function requireTrusted(context: unknown): TrustedAdminCommandContext {
  assertTrustedAdminCommandContext(context);
  return context;
}

async function assertOrgExists(db: Db, orgId: string): Promise<void> {
  const rows = await db
    .select({ id: schema.organizations.id })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  if (!rows[0]) {
    throw new CreditsAccountingError(
      "CREDITS_ORG_INVALID",
      "Organization does not exist for credits",
      403
    );
  }
}

// ---------------------------------------------------------------------------
// Wallet Repository
// ---------------------------------------------------------------------------

export interface CreditWalletRepository {
  getByOrgId(orgId: string): Promise<CreditWallet | null>;
  getByWalletId(id: string): Promise<CreditWallet | null>;
  ensureWallet(orgId: string, projectedAt: string): Promise<CreditWallet>;
  upsertProjection(wallet: CreditWallet): Promise<CreditWallet>;
}

export class CreditWalletRepositoryImpl implements CreditWalletRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByOrgId(orgId: string): Promise<CreditWallet | null> {
    const rows = await this.db
      .select()
      .from(schema.creditWallets)
      .where(eq(schema.creditWallets.orgId, orgId))
      .limit(1);
    return rows[0] ? parseCreditWallet(rows[0].wallet) : null;
  }

  async getByWalletId(id: string): Promise<CreditWallet | null> {
    const rows = await this.db
      .select()
      .from(schema.creditWallets)
      .where(eq(schema.creditWallets.creditWalletId, id))
      .limit(1);
    return rows[0] ? parseCreditWallet(rows[0].wallet) : null;
  }

  async ensureWallet(orgId: string, projectedAt: string): Promise<CreditWallet> {
    await assertOrgExists(this.db, orgId);
    const existing = await this.getByOrgId(orgId);
    if (existing) return existing;
    const wallet = buildCreditWallet({
      orgId,
      availableBalance: 0,
      reservedBalance: 0,
      projectedAt,
    });
    try {
      await this.db.insert(schema.creditWallets).values({
        creditWalletId: wallet.creditWalletId,
        orgId: wallet.orgId,
        availableBalance: wallet.availableBalance,
        reservedBalance: wallet.reservedBalance,
        currencyUnit: wallet.currencyUnit,
        projectedAt: new Date(wallet.projectedAt),
        integrityHash: wallet.integrityHash,
        contractVersion: wallet.contractVersion,
        wallet,
      });
      return wallet;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getByOrgId(orgId);
      if (!raced) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Credit Wallet unique conflict without readable row"
        );
      }
      return raced;
    }
  }

  async upsertProjection(wallet: CreditWallet): Promise<CreditWallet> {
    const existing = await this.getByOrgId(wallet.orgId);
    const values = {
      creditWalletId: wallet.creditWalletId,
      orgId: wallet.orgId,
      availableBalance: wallet.availableBalance,
      reservedBalance: wallet.reservedBalance,
      currencyUnit: wallet.currencyUnit,
      projectedAt: new Date(wallet.projectedAt),
      integrityHash: wallet.integrityHash,
      contractVersion: wallet.contractVersion,
      wallet,
    };
    if (!existing) {
      await this.db.insert(schema.creditWallets).values(values);
      return wallet;
    }
    await this.db
      .update(schema.creditWallets)
      .set(values)
      .where(eq(schema.creditWallets.orgId, wallet.orgId));
    return wallet;
  }
}

// ---------------------------------------------------------------------------
// Ledger Repository
// ---------------------------------------------------------------------------

export interface CreditLedgerRepository {
  getById(id: string): Promise<CreditLedgerEntry | null>;
  getByIdempotencyKey(
    creditWalletId: string,
    idempotencyKey: string
  ): Promise<CreditLedgerEntry | null>;
  listByOrgId(orgId: string): Promise<readonly CreditLedgerEntry[]>;
  listByWalletId(creditWalletId: string): Promise<readonly CreditLedgerEntry[]>;
  acceptOrConverge(
    entry: CreditLedgerEntry
  ): Promise<AcceptOrConvergeResult<CreditLedgerEntry>>;
}

export class CreditLedgerRepositoryImpl implements CreditLedgerRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getById(id: string): Promise<CreditLedgerEntry | null> {
    const rows = await this.db
      .select()
      .from(schema.creditLedgerEntries)
      .where(eq(schema.creditLedgerEntries.creditLedgerEntryId, id))
      .limit(1);
    return rows[0] ? parseCreditLedgerEntry(rows[0].entry) : null;
  }

  async getByIdempotencyKey(
    creditWalletId: string,
    idempotencyKey: string
  ): Promise<CreditLedgerEntry | null> {
    const rows = await this.db
      .select()
      .from(schema.creditLedgerEntries)
      .where(
        and(
          eq(schema.creditLedgerEntries.creditWalletId, creditWalletId),
          eq(schema.creditLedgerEntries.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return rows[0] ? parseCreditLedgerEntry(rows[0].entry) : null;
  }

  async listByOrgId(orgId: string): Promise<readonly CreditLedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.creditLedgerEntries)
      .where(eq(schema.creditLedgerEntries.orgId, orgId))
      .orderBy(desc(schema.creditLedgerEntries.createdAt));
    return rows.map((row) => parseCreditLedgerEntry(row.entry));
  }

  async listByWalletId(
    creditWalletId: string
  ): Promise<readonly CreditLedgerEntry[]> {
    const rows = await this.db
      .select()
      .from(schema.creditLedgerEntries)
      .where(eq(schema.creditLedgerEntries.creditWalletId, creditWalletId))
      .orderBy(desc(schema.creditLedgerEntries.createdAt));
    return rows.map((row) => parseCreditLedgerEntry(row.entry));
  }

  async acceptOrConverge(
    entry: CreditLedgerEntry
  ): Promise<AcceptOrConvergeResult<CreditLedgerEntry>> {
    const byId = await this.getById(entry.creditLedgerEntryId);
    if (byId) {
      if (byId.integrityHash !== entry.integrityHash) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Conflicting Credit Ledger Entry identity"
        );
      }
      return { value: byId, replayed: true };
    }
    const byKey = await this.getByIdempotencyKey(
      entry.creditWalletId,
      entry.idempotencyKey
    );
    if (byKey) {
      if (byKey.integrityHash !== entry.integrityHash) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Conflicting Credit Ledger idempotency replay"
        );
      }
      return { value: byKey, replayed: true };
    }

    try {
      await this.db.insert(schema.creditLedgerEntries).values({
        creditLedgerEntryId: entry.creditLedgerEntryId,
        creditWalletId: entry.creditWalletId,
        orgId: entry.orgId,
        entryType: entry.entryType,
        amount: entry.amount,
        currencyUnit: entry.currencyUnit,
        reason: entry.reason,
        actorUserId: entry.actorUserId,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        pricingRuleKey: entry.pricingRuleKey,
        pricingRuleVersion: entry.pricingRuleVersion,
        idempotencyKey: entry.idempotencyKey,
        createdAt: new Date(entry.createdAt),
        integrityHash: entry.integrityHash,
        contractVersion: entry.contractVersion,
        entry,
      });
      return { value: entry, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced =
        (await this.getById(entry.creditLedgerEntryId)) ??
        (await this.getByIdempotencyKey(
          entry.creditWalletId,
          entry.idempotencyKey
        ));
      if (!raced) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Credit Ledger unique conflict without readable row"
        );
      }
      return { value: raced, replayed: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Reservation Repository
// ---------------------------------------------------------------------------

export interface CreditReservationRepository {
  getById(id: string): Promise<CreditReservation | null>;
  listByOrgId(orgId: string): Promise<readonly CreditReservation[]>;
  listOpenByWalletId(
    creditWalletId: string
  ): Promise<readonly CreditReservation[]>;
  acceptOrConverge(
    reservation: CreditReservation
  ): Promise<AcceptOrConvergeResult<CreditReservation>>;
  updateStatus(
    reservation: CreditReservation
  ): Promise<CreditReservation>;
}

export class CreditReservationRepositoryImpl
  implements CreditReservationRepository
{
  constructor(private readonly db: Db = getDb()) {}

  async getById(id: string): Promise<CreditReservation | null> {
    const rows = await this.db
      .select()
      .from(schema.creditReservations)
      .where(eq(schema.creditReservations.creditReservationId, id))
      .limit(1);
    return rows[0] ? parseCreditReservation(rows[0].reservation) : null;
  }

  async listByOrgId(orgId: string): Promise<readonly CreditReservation[]> {
    const rows = await this.db
      .select()
      .from(schema.creditReservations)
      .where(eq(schema.creditReservations.orgId, orgId))
      .orderBy(desc(schema.creditReservations.createdAt));
    return rows.map((row) => parseCreditReservation(row.reservation));
  }

  async listOpenByWalletId(
    creditWalletId: string
  ): Promise<readonly CreditReservation[]> {
    const rows = await this.db
      .select()
      .from(schema.creditReservations)
      .where(
        and(
          eq(schema.creditReservations.creditWalletId, creditWalletId),
          inArray(schema.creditReservations.status, ["PENDING", "ACCEPTED"])
        )
      );
    return rows.map((row) => parseCreditReservation(row.reservation));
  }

  async acceptOrConverge(
    reservation: CreditReservation
  ): Promise<AcceptOrConvergeResult<CreditReservation>> {
    const existing = await this.getById(reservation.creditReservationId);
    if (existing) {
      if (
        existing.amount !== reservation.amount ||
        existing.creditWalletId !== reservation.creditWalletId
      ) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Conflicting Credit Reservation identity"
        );
      }
      return { value: existing, replayed: true };
    }

    if (reservation.executionIdentity) {
      const byExec = await this.db
        .select()
        .from(schema.creditReservations)
        .where(
          and(
            eq(
              schema.creditReservations.creditWalletId,
              reservation.creditWalletId
            ),
            eq(
              schema.creditReservations.executionIdentity,
              reservation.executionIdentity
            )
          )
        )
        .limit(1);
      if (byExec[0]) {
        return {
          value: parseCreditReservation(byExec[0].reservation),
          replayed: true,
        };
      }
    }

    try {
      await this.db.insert(schema.creditReservations).values({
        creditReservationId: reservation.creditReservationId,
        creditWalletId: reservation.creditWalletId,
        orgId: reservation.orgId,
        workspaceId: reservation.workspaceId,
        amount: reservation.amount,
        currencyUnit: reservation.currencyUnit,
        status: reservation.status,
        pricingRuleKey: reservation.pricingRuleKey,
        pricingRuleVersion: reservation.pricingRuleVersion,
        executionIdentity: reservation.executionIdentity,
        createdAt: new Date(reservation.createdAt),
        integrityHash: reservation.integrityHash,
        contractVersion: reservation.contractVersion,
        reservation,
      });
      return { value: reservation, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getById(reservation.creditReservationId);
      if (!raced) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Credit Reservation unique conflict without readable row"
        );
      }
      return { value: raced, replayed: true };
    }
  }

  async updateStatus(
    reservation: CreditReservation
  ): Promise<CreditReservation> {
    await this.db
      .update(schema.creditReservations)
      .set({
        status: reservation.status,
        integrityHash: reservation.integrityHash,
        reservation,
      })
      .where(
        eq(
          schema.creditReservations.creditReservationId,
          reservation.creditReservationId
        )
      );
    return reservation;
  }
}

// ---------------------------------------------------------------------------
// Settlement / Release / Usage
// ---------------------------------------------------------------------------

export interface CreditSettlementRepository {
  getById(id: string): Promise<CreditSettlement | null>;
  getByReservationId(
    creditReservationId: string
  ): Promise<CreditSettlement | null>;
  listByOrgId(orgId: string): Promise<readonly CreditSettlement[]>;
  acceptOrConverge(
    settlement: CreditSettlement
  ): Promise<AcceptOrConvergeResult<CreditSettlement>>;
}

export class CreditSettlementRepositoryImpl
  implements CreditSettlementRepository
{
  constructor(private readonly db: Db = getDb()) {}

  async getById(id: string): Promise<CreditSettlement | null> {
    const rows = await this.db
      .select()
      .from(schema.creditSettlements)
      .where(eq(schema.creditSettlements.creditSettlementId, id))
      .limit(1);
    return rows[0] ? parseCreditSettlement(rows[0].settlement) : null;
  }

  async getByReservationId(
    creditReservationId: string
  ): Promise<CreditSettlement | null> {
    const rows = await this.db
      .select()
      .from(schema.creditSettlements)
      .where(
        eq(schema.creditSettlements.creditReservationId, creditReservationId)
      )
      .limit(1);
    return rows[0] ? parseCreditSettlement(rows[0].settlement) : null;
  }

  async listByOrgId(orgId: string): Promise<readonly CreditSettlement[]> {
    const rows = await this.db
      .select()
      .from(schema.creditSettlements)
      .where(eq(schema.creditSettlements.orgId, orgId))
      .orderBy(desc(schema.creditSettlements.settledAt));
    return rows.map((row) => parseCreditSettlement(row.settlement));
  }

  async acceptOrConverge(
    settlement: CreditSettlement
  ): Promise<AcceptOrConvergeResult<CreditSettlement>> {
    const byReservation = await this.getByReservationId(
      settlement.creditReservationId
    );
    if (byReservation) {
      return { value: byReservation, replayed: true };
    }
    const byId = await this.getById(settlement.creditSettlementId);
    if (byId) return { value: byId, replayed: true };

    try {
      await this.db.insert(schema.creditSettlements).values({
        creditSettlementId: settlement.creditSettlementId,
        creditWalletId: settlement.creditWalletId,
        orgId: settlement.orgId,
        creditReservationId: settlement.creditReservationId,
        creditLedgerEntryId: settlement.creditLedgerEntryId,
        amount: settlement.amount,
        currencyUnit: settlement.currencyUnit,
        billableEffectReference: settlement.billableEffectReference,
        pricingRuleKey: settlement.pricingRuleKey,
        pricingRuleVersion: settlement.pricingRuleVersion,
        settledAt: new Date(settlement.settledAt),
        integrityHash: settlement.integrityHash,
        contractVersion: settlement.contractVersion,
        settlement,
      });
      return { value: settlement, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced =
        (await this.getByReservationId(settlement.creditReservationId)) ??
        (await this.getById(settlement.creditSettlementId));
      if (!raced) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Credit Settlement unique conflict without readable row"
        );
      }
      return { value: raced, replayed: true };
    }
  }
}

export interface CreditReleaseRepository {
  getByReservationId(
    creditReservationId: string
  ): Promise<CreditRelease | null>;
  listByOrgId(orgId: string): Promise<readonly CreditRelease[]>;
  acceptOrConverge(
    release: CreditRelease
  ): Promise<AcceptOrConvergeResult<CreditRelease>>;
}

export class CreditReleaseRepositoryImpl implements CreditReleaseRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByReservationId(
    creditReservationId: string
  ): Promise<CreditRelease | null> {
    const rows = await this.db
      .select()
      .from(schema.creditReleases)
      .where(eq(schema.creditReleases.creditReservationId, creditReservationId))
      .limit(1);
    return rows[0] ? parseCreditRelease(rows[0].releaseBody) : null;
  }

  async listByOrgId(orgId: string): Promise<readonly CreditRelease[]> {
    const rows = await this.db
      .select()
      .from(schema.creditReleases)
      .where(eq(schema.creditReleases.orgId, orgId))
      .orderBy(desc(schema.creditReleases.releasedAt));
    return rows.map((row) => parseCreditRelease(row.releaseBody));
  }

  async acceptOrConverge(
    release: CreditRelease
  ): Promise<AcceptOrConvergeResult<CreditRelease>> {
    const existing = await this.getByReservationId(release.creditReservationId);
    if (existing) return { value: existing, replayed: true };

    try {
      await this.db.insert(schema.creditReleases).values({
        creditReleaseId: release.creditReleaseId,
        creditWalletId: release.creditWalletId,
        orgId: release.orgId,
        creditReservationId: release.creditReservationId,
        reason: release.reason,
        releasedAt: new Date(release.releasedAt),
        actorUserId: release.actorUserId,
        integrityHash: release.integrityHash,
        contractVersion: release.contractVersion,
        releaseBody: release,
      });
      return { value: release, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getByReservationId(release.creditReservationId);
      if (!raced) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Credit Release unique conflict without readable row"
        );
      }
      return { value: raced, replayed: true };
    }
  }
}

export interface ProductUsageRepository {
  listByOrgId(orgId: string): Promise<readonly ProductUsageEvent[]>;
  acceptOrConverge(
    event: ProductUsageEvent
  ): Promise<AcceptOrConvergeResult<ProductUsageEvent>>;
}

export class ProductUsageRepositoryImpl implements ProductUsageRepository {
  constructor(private readonly db: Db = getDb()) {}

  async listByOrgId(orgId: string): Promise<readonly ProductUsageEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.productUsageEvents)
      .where(eq(schema.productUsageEvents.orgId, orgId))
      .orderBy(desc(schema.productUsageEvents.occurredAt));
    return rows.map((row) => parseProductUsageEvent(row.event));
  }

  async acceptOrConverge(
    event: ProductUsageEvent
  ): Promise<AcceptOrConvergeResult<ProductUsageEvent>> {
    const byId = await this.db
      .select()
      .from(schema.productUsageEvents)
      .where(
        eq(schema.productUsageEvents.productUsageEventId, event.productUsageEventId)
      )
      .limit(1);
    if (byId[0]) {
      return { value: parseProductUsageEvent(byId[0].event), replayed: true };
    }

    const byExec = await this.db
      .select()
      .from(schema.productUsageEvents)
      .where(
        and(
          eq(schema.productUsageEvents.orgId, event.orgId),
          eq(
            schema.productUsageEvents.executionIdentity,
            event.executionIdentity
          ),
          eq(schema.productUsageEvents.capabilityKey, event.capabilityKey)
        )
      )
      .limit(1);
    if (byExec[0]) {
      return { value: parseProductUsageEvent(byExec[0].event), replayed: true };
    }

    try {
      await this.db.insert(schema.productUsageEvents).values({
        productUsageEventId: event.productUsageEventId,
        orgId: event.orgId,
        workspaceId: event.workspaceId,
        capabilityKey: event.capabilityKey,
        executionIdentity: event.executionIdentity,
        pricingRuleKey: event.pricingRuleKey,
        pricingRuleVersion: event.pricingRuleVersion,
        commercialAuthorizationId: event.commercialAuthorizationId,
        quantity: event.quantity,
        occurredAt: new Date(event.occurredAt),
        integrityHash: event.integrityHash,
        contractVersion: event.contractVersion,
        event,
      });
      return { value: event, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db
        .select()
        .from(schema.productUsageEvents)
        .where(
          and(
            eq(schema.productUsageEvents.orgId, event.orgId),
            eq(
              schema.productUsageEvents.executionIdentity,
              event.executionIdentity
            ),
            eq(schema.productUsageEvents.capabilityKey, event.capabilityKey)
          )
        )
        .limit(1);
      if (!raced[0]) {
        throw new CreditsAccountingError(
          "CREDITS_IDENTITY_CONFLICT",
          "Product Usage unique conflict without readable row"
        );
      }
      return { value: parseProductUsageEvent(raced[0].event), replayed: true };
    }
  }
}

// ---------------------------------------------------------------------------
// Admin read facade
// ---------------------------------------------------------------------------

export class CreditsAdminReadRepositoryImpl {
  constructor(
    private readonly wallets = new CreditWalletRepositoryImpl(),
    private readonly ledger = new CreditLedgerRepositoryImpl(),
    private readonly reservations = new CreditReservationRepositoryImpl(),
    private readonly settlements = new CreditSettlementRepositoryImpl(),
    private readonly releases = new CreditReleaseRepositoryImpl(),
    private readonly usage = new ProductUsageRepositoryImpl()
  ) {}

  async readOrg(
    context: TrustedAdminCommandContext,
    orgId: string
  ): Promise<{
    wallet: CreditWallet | null;
    ledger: readonly CreditLedgerEntry[];
    reservations: readonly CreditReservation[];
    settlements: readonly CreditSettlement[];
    releases: readonly CreditRelease[];
    usage: readonly ProductUsageEvent[];
  }> {
    requireTrusted(context);
    return {
      wallet: await this.wallets.getByOrgId(orgId),
      ledger: await this.ledger.listByOrgId(orgId),
      reservations: await this.reservations.listByOrgId(orgId),
      settlements: await this.settlements.listByOrgId(orgId),
      releases: await this.releases.listByOrgId(orgId),
      usage: await this.usage.listByOrgId(orgId),
    };
  }
}

// ---------------------------------------------------------------------------
// Accounting service (exactly-once reserve / settle / release)
// ---------------------------------------------------------------------------

export class CreditsAccountingService {
  constructor(
    private readonly wallets = new CreditWalletRepositoryImpl(),
    private readonly ledger = new CreditLedgerRepositoryImpl(),
    private readonly reservations = new CreditReservationRepositoryImpl(),
    private readonly settlements = new CreditSettlementRepositoryImpl(),
    private readonly releases = new CreditReleaseRepositoryImpl(),
    private readonly usage = new ProductUsageRepositoryImpl()
  ) {}

  async rebuildWallet(orgId: string, projectedAt: string): Promise<CreditWallet> {
    const wallet = await this.wallets.ensureWallet(orgId, projectedAt);
    const entries = await this.ledger.listByWalletId(wallet.creditWalletId);
    const open = await this.reservations.listOpenByWalletId(
      wallet.creditWalletId
    );
    const projected = projectCreditWalletFromFacts({
      orgId,
      creditWalletId: wallet.creditWalletId,
      ledgerEntries: entries,
      reservations: open,
      projectedAt,
    });
    return this.wallets.upsertProjection(projected);
  }

  async appendLedgerEntry(
    entry: CreditLedgerEntry
  ): Promise<AcceptOrConvergeResult<CreditLedgerEntry>> {
    const accepted = await this.ledger.acceptOrConverge(entry);
    await this.rebuildWallet(entry.orgId, entry.createdAt);
    return accepted;
  }

  /**
   * Reserve with sufficiency check before persist (exactly-once via identity).
   */
  async reserveCredits(input: {
    orgId: string;
    workspaceId?: string | null;
    amount: number;
    pricingRuleKey?: string | null;
    pricingRuleVersion?: string | null;
    executionIdentity?: string | null;
    createdAt: string;
    identitySeed?: string;
  }): Promise<{
    reservation: CreditReservation;
    wallet: CreditWallet;
    replayed: boolean;
  }> {
    const wallet = await this.wallets.ensureWallet(input.orgId, input.createdAt);
    const candidate = buildCreditReservation({
      creditWalletId: wallet.creditWalletId,
      orgId: input.orgId,
      workspaceId: input.workspaceId,
      amount: input.amount,
      status: "ACCEPTED",
      pricingRuleKey: input.pricingRuleKey,
      pricingRuleVersion: input.pricingRuleVersion,
      executionIdentity: input.executionIdentity,
      createdAt: input.createdAt,
      identitySeed: input.identitySeed,
    });

    const existing = await this.reservations.getById(
      candidate.creditReservationId
    );
    if (existing) {
      return {
        reservation: existing,
        wallet: await this.rebuildWallet(input.orgId, input.createdAt),
        replayed: true,
      };
    }
    if (candidate.executionIdentity) {
      const open = await this.reservations.listByOrgId(input.orgId);
      const match = open.find(
        (r) =>
          r.executionIdentity === candidate.executionIdentity &&
          r.creditWalletId === candidate.creditWalletId
      );
      if (match) {
        return {
          reservation: match,
          wallet: await this.rebuildWallet(input.orgId, input.createdAt),
          replayed: true,
        };
      }
    }

    const projected = await this.rebuildWallet(input.orgId, input.createdAt);
    if (projected.availableBalance < input.amount) {
      throw new CreditsAccountingError(
        "CREDITS_INSUFFICIENT",
        "Insufficient available credits for reservation"
      );
    }

    const accepted = await this.reservations.acceptOrConverge(candidate);
    const rebuilt = await this.rebuildWallet(input.orgId, input.createdAt);
    return {
      reservation: accepted.value,
      wallet: rebuilt,
      replayed: accepted.replayed,
    };
  }

  async settle(input: {
    creditReservationId: string;
    billableEffectReference: string;
    settledAt: string;
    amount?: number;
  }): Promise<{
    settlement: CreditSettlement;
    ledgerEntry: CreditLedgerEntry;
    wallet: CreditWallet;
    replayed: boolean;
  }> {
    const reservation = await this.reservations.getById(
      input.creditReservationId
    );
    if (!reservation) {
      throw new CreditsAccountingError(
        "CREDITS_NOT_FOUND",
        "Credit Reservation not found"
      );
    }
    if (reservation.status === "RELEASED") {
      throw new CreditsAccountingError(
        "CREDITS_RESERVATION_INVALID",
        "Cannot settle a released reservation"
      );
    }

    const existing = await this.settlements.getByReservationId(
      reservation.creditReservationId
    );
    if (existing) {
      const ledgerEntry = await this.ledger.getById(existing.creditLedgerEntryId);
      if (!ledgerEntry) {
        throw new CreditsAccountingError(
          "CREDITS_NOT_FOUND",
          "Settlement ledger entry missing"
        );
      }
      return {
        settlement: existing,
        ledgerEntry,
        wallet: await this.rebuildWallet(reservation.orgId, input.settledAt),
        replayed: true,
      };
    }

    if (reservation.status !== "ACCEPTED" && reservation.status !== "PENDING") {
      throw new CreditsAccountingError(
        "CREDITS_ALREADY_TERMINAL",
        "Reservation is not open for settlement"
      );
    }

    const amount = input.amount ?? reservation.amount;
    if (amount > reservation.amount) {
      throw new CreditsAccountingError(
        "CREDITS_RESERVATION_INVALID",
        "Settlement amount exceeds reservation"
      );
    }

    const ledgerEntry = buildCreditLedgerEntry({
      creditWalletId: reservation.creditWalletId,
      orgId: reservation.orgId,
      entryType: "SETTLEMENT_DEBIT",
      amount: -amount,
      reason: `settle:${reservation.creditReservationId}`,
      referenceType: "credit_reservation",
      referenceId: reservation.creditReservationId,
      pricingRuleKey: reservation.pricingRuleKey,
      pricingRuleVersion: reservation.pricingRuleVersion,
      idempotencyKey: `settle:${reservation.creditReservationId}:${input.billableEffectReference}`,
      createdAt: input.settledAt,
    });
    const acceptedLedger = await this.ledger.acceptOrConverge(ledgerEntry);

    const settlement = buildCreditSettlement({
      creditWalletId: reservation.creditWalletId,
      orgId: reservation.orgId,
      creditReservationId: reservation.creditReservationId,
      creditLedgerEntryId: acceptedLedger.value.creditLedgerEntryId,
      amount,
      billableEffectReference: input.billableEffectReference,
      pricingRuleKey: reservation.pricingRuleKey,
      pricingRuleVersion: reservation.pricingRuleVersion,
      settledAt: input.settledAt,
    });
    const acceptedSettlement = await this.settlements.acceptOrConverge(
      settlement
    );

    await this.reservations.updateStatus(
      withReservationStatus(reservation, "SETTLED")
    );

    const wallet = await this.rebuildWallet(reservation.orgId, input.settledAt);
    return {
      settlement: acceptedSettlement.value,
      ledgerEntry: acceptedLedger.value,
      wallet,
      replayed: acceptedSettlement.replayed && acceptedLedger.replayed,
    };
  }

  async release(input: {
    creditReservationId: string;
    reason: string;
    releasedAt: string;
    actorUserId?: string | null;
  }): Promise<{
    release: CreditRelease;
    wallet: CreditWallet;
    replayed: boolean;
  }> {
    const reservation = await this.reservations.getById(
      input.creditReservationId
    );
    if (!reservation) {
      throw new CreditsAccountingError(
        "CREDITS_NOT_FOUND",
        "Credit Reservation not found"
      );
    }

    const existing = await this.releases.getByReservationId(
      reservation.creditReservationId
    );
    if (existing) {
      return {
        release: existing,
        wallet: await this.rebuildWallet(reservation.orgId, input.releasedAt),
        replayed: true,
      };
    }

    if (reservation.status === "SETTLED") {
      throw new CreditsAccountingError(
        "CREDITS_ALREADY_TERMINAL",
        "Cannot release a settled reservation"
      );
    }
    if (reservation.status === "RELEASED") {
      throw new CreditsAccountingError(
        "CREDITS_ALREADY_TERMINAL",
        "Reservation already released"
      );
    }

    const release = buildCreditRelease({
      creditWalletId: reservation.creditWalletId,
      orgId: reservation.orgId,
      creditReservationId: reservation.creditReservationId,
      reason: input.reason,
      releasedAt: input.releasedAt,
      actorUserId: input.actorUserId,
    });
    const accepted = await this.releases.acceptOrConverge(release);
    await this.reservations.updateStatus(
      withReservationStatus(reservation, "RELEASED")
    );

    const wallet = await this.rebuildWallet(reservation.orgId, input.releasedAt);
    return {
      release: accepted.value,
      wallet,
      replayed: accepted.replayed,
    };
  }

  async recordProductUsage(
    event: ProductUsageEvent
  ): Promise<AcceptOrConvergeResult<ProductUsageEvent>> {
    return this.usage.acceptOrConverge(event);
  }
}
