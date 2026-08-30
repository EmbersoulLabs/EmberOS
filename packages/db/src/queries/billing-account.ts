/**
 * Sprint 4 Phase B3 — Billing Account persistence.
 */
import { eq } from "drizzle-orm";
import {
  parseBillingAccount,
  type BillingAccount,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";
import type { AcceptOrConvergeResult } from "./platform-admin";

type Db = ReturnType<typeof getDb>;

export type CommercialPersistenceErrorCode =
  | "COMMERCIAL_IDENTITY_CONFLICT"
  | "COMMERCIAL_NOT_FOUND"
  | "COMMERCIAL_ORG_INVALID"
  | "COMMERCIAL_OWNERSHIP_INVALID";

export class CommercialPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: CommercialPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CommercialPersistenceError";
    this.status =
      code === "COMMERCIAL_NOT_FOUND"
        ? 404
        : code === "COMMERCIAL_ORG_INVALID" ||
            code === "COMMERCIAL_OWNERSHIP_INVALID"
          ? 403
          : 409;
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if ((current as { code?: unknown }).code === "23505") return true;
      current =
        (current as { cause?: unknown }).cause ??
        (current as { originalError?: unknown }).originalError;
      continue;
    }
    break;
  }
  return false;
}

function equivalence(account: BillingAccount): unknown {
  return {
    billingAccountId: account.billingAccountId,
    orgId: account.orgId,
    externalCustomerReference: account.externalCustomerReference,
    createdAt: account.createdAt,
    integrityHash: account.integrityHash,
  };
}

function assertEquivalent(existing: BillingAccount, requested: BillingAccount): void {
  if (
    existing.billingAccountId !== requested.billingAccountId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(equivalence(existing)) !==
      canonicalPersistenceHash(equivalence(requested))
  ) {
    throw new CommercialPersistenceError(
      "COMMERCIAL_IDENTITY_CONFLICT",
      "Conflicting Billing Account identity replay rejected"
    );
  }
}

export interface BillingAccountRepository {
  getByBillingAccountId(id: string): Promise<BillingAccount | null>;
  getByOrgId(orgId: string): Promise<BillingAccount | null>;
  getByExternalCustomerReference(
    externalCustomerReference: string
  ): Promise<BillingAccount | null>;
  createOrConverge(
    account: BillingAccount
  ): Promise<AcceptOrConvergeResult<BillingAccount>>;
}

export class BillingAccountRepositoryImpl implements BillingAccountRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByBillingAccountId(id: string): Promise<BillingAccount | null> {
    const rows = await this.db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.billingAccountId, id))
      .limit(1);
    return rows[0] ? parseBillingAccount(rows[0].account) : null;
  }

  async getByOrgId(orgId: string): Promise<BillingAccount | null> {
    const rows = await this.db
      .select()
      .from(schema.billingAccounts)
      .where(eq(schema.billingAccounts.orgId, orgId))
      .limit(1);
    return rows[0] ? parseBillingAccount(rows[0].account) : null;
  }

  async getByExternalCustomerReference(
    externalCustomerReference: string
  ): Promise<BillingAccount | null> {
    const rows = await this.db
      .select()
      .from(schema.billingAccounts)
      .where(
        eq(
          schema.billingAccounts.externalCustomerReference,
          externalCustomerReference
        )
      )
      .limit(1);
    return rows[0] ? parseBillingAccount(rows[0].account) : null;
  }

  private async assertOrgExists(orgId: string): Promise<void> {
    const rows = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, orgId))
      .limit(1);
    if (!rows[0]) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_ORG_INVALID",
        "Organization does not exist for Billing Account"
      );
    }
  }

  async createOrConverge(
    account: BillingAccount
  ): Promise<AcceptOrConvergeResult<BillingAccount>> {
    await this.assertOrgExists(account.orgId);

    const byId = await this.getByBillingAccountId(account.billingAccountId);
    if (byId) {
      assertEquivalent(byId, account);
      return { value: byId, replayed: true };
    }
    const byOrg = await this.getByOrgId(account.orgId);
    if (byOrg) {
      assertEquivalent(byOrg, account);
      return { value: byOrg, replayed: true };
    }

    try {
      await this.db.insert(schema.billingAccounts).values({
        billingAccountId: account.billingAccountId,
        orgId: account.orgId,
        externalCustomerReference: account.externalCustomerReference,
        createdAt: new Date(account.createdAt),
        integrityHash: account.integrityHash,
        contractVersion: account.contractVersion,
        account,
      });
      return { value: account, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced =
        (await this.getByBillingAccountId(account.billingAccountId)) ??
        (await this.getByOrgId(account.orgId));
      if (!raced) {
        throw new CommercialPersistenceError(
          "COMMERCIAL_IDENTITY_CONFLICT",
          "Billing Account unique conflict without readable row"
        );
      }
      assertEquivalent(raced, account);
      return { value: raced, replayed: true };
    }
  }
}

export { isUniqueViolation };
