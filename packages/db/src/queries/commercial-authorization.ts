/**
 * Sprint 4 Phase E — Commercial Execution Authorization persistence.
 *
 * Append-only. Idempotent accept/converge. Fail-closed conflict detection.
 * Not Subscription / Entitlement / Reservation / Pricing — references them.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  parseCommercialExecutionAuthorization,
  type CommercialExecutionAuthorization,
} from "@ceo-agent/shared";
import {
  assertTrustedAdminCommandContext,
  type TrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { isUniqueViolation } from "./billing-account";
import type { AcceptOrConvergeResult } from "./platform-admin";
import { CreditReservationRepositoryImpl } from "./credits";
import type { CreditReservation } from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export type CommercialAuthorizationErrorCode =
  | "COMMERCIAL_AUTH_NOT_FOUND"
  | "COMMERCIAL_AUTH_DENIED"
  | "COMMERCIAL_AUTH_CONFLICT"
  | "COMMERCIAL_AUTH_TRUST_REQUIRED"
  | "COMMERCIAL_AUTH_BILLING_MISSING"
  | "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID"
  | "COMMERCIAL_AUTH_ENTITLEMENT_DENIED"
  | "COMMERCIAL_AUTH_PRICING_MISSING"
  | "COMMERCIAL_AUTH_CREDITS_INSUFFICIENT";

export class CommercialAuthorizationError extends Error {
  readonly status: number;

  constructor(
    readonly code: CommercialAuthorizationErrorCode,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "CommercialAuthorizationError";
    this.status =
      status ??
      (code === "COMMERCIAL_AUTH_NOT_FOUND"
        ? 404
        : code === "COMMERCIAL_AUTH_TRUST_REQUIRED"
          ? 403
          : code === "COMMERCIAL_AUTH_DENIED" ||
              code === "COMMERCIAL_AUTH_ENTITLEMENT_DENIED" ||
              code === "COMMERCIAL_AUTH_SUBSCRIPTION_INVALID" ||
              code === "COMMERCIAL_AUTH_BILLING_MISSING" ||
              code === "COMMERCIAL_AUTH_PRICING_MISSING" ||
              code === "COMMERCIAL_AUTH_CREDITS_INSUFFICIENT"
            ? 403
            : 409);
  }
}

function requireTrusted(context: unknown): TrustedAdminCommandContext {
  assertTrustedAdminCommandContext(context);
  return context;
}

export interface CommercialAuthorizationRepository {
  getById(id: string): Promise<CommercialExecutionAuthorization | null>;
  getByExecutionIdentity(input: {
    orgId: string;
    workspaceId: string;
    capabilityKey: string;
    executionIdentity: string;
  }): Promise<CommercialExecutionAuthorization | null>;
  listByOrgId(
    orgId: string
  ): Promise<readonly CommercialExecutionAuthorization[]>;
  acceptOrConverge(
    authorization: CommercialExecutionAuthorization
  ): Promise<AcceptOrConvergeResult<CommercialExecutionAuthorization>>;
}

export class CommercialAuthorizationRepositoryImpl
  implements CommercialAuthorizationRepository
{
  constructor(private readonly db: Db = getDb()) {}

  async getById(
    id: string
  ): Promise<CommercialExecutionAuthorization | null> {
    const rows = await this.db
      .select()
      .from(schema.commercialExecutionAuthorizations)
      .where(
        eq(
          schema.commercialExecutionAuthorizations.commercialAuthorizationId,
          id
        )
      )
      .limit(1);
    return rows[0]
      ? parseCommercialExecutionAuthorization(rows[0].authorizationBody)
      : null;
  }

  async getByExecutionIdentity(input: {
    orgId: string;
    workspaceId: string;
    capabilityKey: string;
    executionIdentity: string;
  }): Promise<CommercialExecutionAuthorization | null> {
    const rows = await this.db
      .select()
      .from(schema.commercialExecutionAuthorizations)
      .where(
        and(
          eq(schema.commercialExecutionAuthorizations.orgId, input.orgId),
          eq(
            schema.commercialExecutionAuthorizations.workspaceId,
            input.workspaceId
          ),
          eq(
            schema.commercialExecutionAuthorizations.capabilityKey,
            input.capabilityKey
          ),
          eq(
            schema.commercialExecutionAuthorizations.executionIdentity,
            input.executionIdentity
          )
        )
      )
      .limit(1);
    return rows[0]
      ? parseCommercialExecutionAuthorization(rows[0].authorizationBody)
      : null;
  }

  async listByOrgId(
    orgId: string
  ): Promise<readonly CommercialExecutionAuthorization[]> {
    const rows = await this.db
      .select()
      .from(schema.commercialExecutionAuthorizations)
      .where(eq(schema.commercialExecutionAuthorizations.orgId, orgId))
      .orderBy(desc(schema.commercialExecutionAuthorizations.authorizedAt));
    return rows.map((row) =>
      parseCommercialExecutionAuthorization(row.authorizationBody)
    );
  }

  async acceptOrConverge(
    authorization: CommercialExecutionAuthorization
  ): Promise<AcceptOrConvergeResult<CommercialExecutionAuthorization>> {
    const byId = await this.getById(authorization.commercialAuthorizationId);
    if (byId) {
      if (byId.integrityHash !== authorization.integrityHash) {
        throw new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_CONFLICT",
          "Conflicting Commercial Authorization identity"
        );
      }
      return { value: byId, replayed: true };
    }

    const byExec = await this.getByExecutionIdentity({
      orgId: authorization.orgId,
      workspaceId: authorization.workspaceId,
      capabilityKey: authorization.capabilityKey,
      executionIdentity: authorization.executionIdentity,
    });
    if (byExec) {
      if (byExec.integrityHash !== authorization.integrityHash) {
        throw new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_CONFLICT",
          "Conflicting Commercial Authorization for execution identity"
        );
      }
      return { value: byExec, replayed: true };
    }

    try {
      await this.db.insert(schema.commercialExecutionAuthorizations).values({
        commercialAuthorizationId: authorization.commercialAuthorizationId,
        orgId: authorization.orgId,
        workspaceId: authorization.workspaceId,
        capabilityKey: authorization.capabilityKey,
        executionIdentity: authorization.executionIdentity,
        entitlementEvidenceId: authorization.entitlementEvidenceId,
        pricingRuleKey: authorization.pricingRuleKey,
        pricingRuleVersion: authorization.pricingRuleVersion,
        pricingRuleIntegrityHash: authorization.pricingRuleIntegrityHash,
        creditReservationId: authorization.creditReservationId,
        authorizedAt: new Date(authorization.authorizedAt),
        integrityHash: authorization.integrityHash,
        contractVersion: authorization.contractVersion,
        authorizationBody: authorization,
      });
      return { value: authorization, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced =
        (await this.getById(authorization.commercialAuthorizationId)) ??
        (await this.getByExecutionIdentity({
          orgId: authorization.orgId,
          workspaceId: authorization.workspaceId,
          capabilityKey: authorization.capabilityKey,
          executionIdentity: authorization.executionIdentity,
        }));
      if (!raced) {
        throw new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_CONFLICT",
          "Commercial Authorization unique conflict without readable row"
        );
      }
      if (raced.integrityHash !== authorization.integrityHash) {
        throw new CommercialAuthorizationError(
          "COMMERCIAL_AUTH_CONFLICT",
          "Conflicting Commercial Authorization on unique converge"
        );
      }
      return { value: raced, replayed: true };
    }
  }
}

export type CommercialAuthorizationAdminDetail = {
  authorization: CommercialExecutionAuthorization;
  executionIdentity: string;
  reservation: CreditReservation | null;
  pricingRule: {
    ruleKey: string;
    ruleVersion: string;
    integrityHash: string;
  };
  status: "AUTHORIZED";
};

export class CommercialAuthorizationAdminReadRepositoryImpl {
  constructor(
    private readonly repo: CommercialAuthorizationRepository = new CommercialAuthorizationRepositoryImpl(),
    private readonly reservations = new CreditReservationRepositoryImpl()
  ) {}

  async listForOrg(
    context: TrustedAdminCommandContext,
    orgId: string
  ): Promise<{
    items: readonly CommercialAuthorizationAdminDetail[];
    total: number;
  }> {
    requireTrusted(context);
    const authorizations = await this.repo.listByOrgId(orgId);
    const items: CommercialAuthorizationAdminDetail[] = [];
    for (const authorization of authorizations) {
      items.push(await this.toDetail(authorization));
    }
    return { items, total: items.length };
  }

  async getDetail(
    context: TrustedAdminCommandContext,
    commercialAuthorizationId: string
  ): Promise<CommercialAuthorizationAdminDetail | null> {
    requireTrusted(context);
    const authorization = await this.repo.getById(commercialAuthorizationId);
    if (!authorization) return null;
    return this.toDetail(authorization);
  }

  private async toDetail(
    authorization: CommercialExecutionAuthorization
  ): Promise<CommercialAuthorizationAdminDetail> {
    const reservation = authorization.creditReservationId
      ? await this.reservations.getById(authorization.creditReservationId)
      : null;
    return {
      authorization,
      executionIdentity: authorization.executionIdentity,
      reservation,
      pricingRule: {
        ruleKey: authorization.pricingRuleKey,
        ruleVersion: authorization.pricingRuleVersion,
        integrityHash: authorization.pricingRuleIntegrityHash,
      },
      status: "AUTHORIZED",
    };
  }
}