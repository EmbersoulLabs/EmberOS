import { sql } from "drizzle-orm";
import {
  buildCreditLedgerEntry,
  buildEntitlementGrant,
} from "@ceo-agent/shared/server";
import { getDb } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";
import {
  CreditLedgerRepositoryImpl,
  CreditReservationRepositoryImpl,
  CreditsAccountingService,
  CreditWalletRepositoryImpl,
} from "./credits";
import { EntitlementRepositoryImpl } from "./entitlement";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type ControlledSelfUseEnvironment = "STAGING" | "PRODUCTION";
export type ControlledSelfUseCapability =
  | "campaign.generate"
  | "ai_story.plan"
  | "ai_story.execute";
export type ControlledSelfUseProvider = "openai" | "seedance";

export type ControlledSelfUseAuthority = {
  authorityId: string;
  environment: ControlledSelfUseEnvironment;
  organizationId: string;
  status: "ACTIVE" | "DISABLED" | "REVOKED";
  maxUsdPerExecution: string;
  dailyCapUsd: string;
  maxAutomaticRetries: number;
  allowedProviders: ControlledSelfUseProvider[];
  allowedCapabilities: ControlledSelfUseCapability[];
  authorizedBy: string;
  createdAt: Date;
};

export type ControlledSelfUseReservation = {
  reservationId: string;
  authorityId: string;
  organizationId: string;
  workspaceId: string;
  capabilityKey: ControlledSelfUseCapability;
  executionIdentity: string;
  providerKey: ControlledSelfUseProvider;
  reservedCostUsd: string;
  settledCostUsd: string | null;
  retryOrdinal: number;
  status: "RESERVED" | "SUBMITTED" | "SETTLED" | "RELEASED";
  budgetDay: string;
  providerRequestId: string | null;
  createdAt: Date;
};

export class ControlledSelfUseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ControlledSelfUseError";
  }
}

export const EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID =
  "52519c8c-4011-478f-bf09-34e087e4bbdd" as const;

export function isControlledSelfUseDispatchMode(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.AI_STORY_PROVIDER_DISPATCH_MODE === "allowlisted_self_use";
}

const row = <T>(value: unknown): T | null =>
  ((value as T[])[0] ?? null);
const money = (value: string | number) => Math.round(Number(value) * 100);
const usd = (value: number) => (value / 100).toFixed(2);

function authorityFromRow(value: Record<string, unknown>): ControlledSelfUseAuthority {
  return {
    authorityId: String(value.authority_id),
    environment: value.environment as ControlledSelfUseEnvironment,
    organizationId: String(value.organization_id),
    status: value.status as ControlledSelfUseAuthority["status"],
    maxUsdPerExecution: String(value.max_usd_per_execution),
    dailyCapUsd: String(value.daily_cap_usd),
    maxAutomaticRetries: Number(value.max_automatic_retries),
    allowedProviders: value.allowed_providers as ControlledSelfUseProvider[],
    allowedCapabilities: value.allowed_capabilities as ControlledSelfUseCapability[],
    authorizedBy: String(value.authorized_by),
    createdAt: new Date(String(value.created_at)),
  };
}

function reservationFromRow(value: Record<string, unknown>): ControlledSelfUseReservation {
  return {
    reservationId: String(value.reservation_id),
    authorityId: String(value.authority_id),
    organizationId: String(value.organization_id),
    workspaceId: String(value.workspace_id),
    capabilityKey: value.capability_key as ControlledSelfUseCapability,
    executionIdentity: String(value.execution_identity),
    providerKey: value.provider_key as ControlledSelfUseProvider,
    reservedCostUsd: String(value.reserved_cost_usd),
    settledCostUsd: value.settled_cost_usd === null ? null : String(value.settled_cost_usd),
    retryOrdinal: Number(value.retry_ordinal),
    status: value.status as ControlledSelfUseReservation["status"],
    budgetDay: String(value.budget_day),
    providerRequestId: value.provider_request_id === null ? null : String(value.provider_request_id),
    createdAt: new Date(String(value.created_at)),
  };
}

async function recordEvent(tx: Tx, input: {
  authorityId: string;
  reservationId?: string;
  eventType: string;
  actorUserId?: string;
  costUsd?: string;
  occurredAt: string;
  evidence?: Record<string, unknown>;
}) {
  const body = {
    contractVersion: "controlled-self-use-event.v1",
    authorityId: input.authorityId,
    reservationId: input.reservationId ?? null,
    eventType: input.eventType,
    actorUserId: input.actorUserId ?? null,
    costUsd: input.costUsd ?? null,
    occurredAt: input.occurredAt,
    evidence: input.evidence ?? {},
  };
  const integrityHash = canonicalPersistenceHash(body);
  const eventId = deterministicPersistenceUuid("controlled-self-use-event", body);
  await tx.execute(sql`
    insert into controlled_self_use_events (
      event_id, authority_id, reservation_id, event_type, actor_user_id,
      cost_usd, evidence, occurred_at, integrity_hash, contract_version
    ) values (
      ${eventId}::uuid, ${input.authorityId}::uuid,
      ${input.reservationId ?? null}::uuid, ${input.eventType},
      ${input.actorUserId ?? null}::uuid, ${input.costUsd ?? null}::numeric,
      ${JSON.stringify(input.evidence ?? {})}::jsonb,
      ${input.occurredAt}::timestamptz, ${integrityHash},
      'controlled-self-use-event.v1'
    ) on conflict do nothing
  `);
}

export class ControlledSelfUseAuthorityService {
  constructor(private readonly db: Db = getDb()) {}

  async provisionEmberSoulLabsAuthority(input: {
    environment: ControlledSelfUseEnvironment;
    organizationId: typeof EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID;
    authorizedBy: string;
    reason: string;
    createdAt: string;
  }): Promise<{ authority: ControlledSelfUseAuthority; replayed: boolean }> {
    if (input.organizationId !== EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID) {
      throw new ControlledSelfUseError(
        "CONTROLLED_SELF_USE_ORGANIZATION_DENIED",
        "V1 Controlled Self-Use is restricted to EmberSoulLabs"
      );
    }
    return this.db.transaction(async (tx) => {
      const adminRows = await tx.execute(sql`
        select 1 from platform_admin_grants
        where user_id = ${input.authorizedBy}::uuid
          and platform_role = 'PLATFORM_SUPER_ADMIN'
          and status = 'ACTIVE' limit 1
      `);
      if (!row(adminRows)) {
        throw new ControlledSelfUseError(
          "CONTROLLED_SELF_USE_ACTOR_DENIED",
          "Only an active persistent Platform Super Admin may provision self-use"
        );
      }
      const existingRows = await tx.execute(sql`
        select * from controlled_self_use_authorities
        where environment = ${input.environment}
          and organization_id = ${input.organizationId}::uuid
          and purpose = 'CONTROLLED_SELF_USE'
        for update
      `);
      const existing = row<Record<string, unknown>>(existingRows);
      if (existing) {
        const parsed = authorityFromRow(existing);
        if (
          parsed.maxUsdPerExecution !== "5.00" ||
          parsed.dailyCapUsd !== "10.00" ||
          parsed.maxAutomaticRetries !== 0 ||
          parsed.allowedProviders.join(",") !== "openai,seedance" ||
          parsed.allowedCapabilities.join(",") !== "campaign.generate,ai_story.plan,ai_story.execute"
        ) {
          throw new ControlledSelfUseError(
            "CONTROLLED_SELF_USE_AUTHORITY_CONFLICT",
            "Existing authority differs from the certified bounded contract"
          );
        }
        return { authority: parsed, replayed: true };
      }
      const body = {
        contractVersion: "controlled-self-use-authority.v1",
        environment: input.environment,
        organizationId: input.organizationId,
        purpose: "CONTROLLED_SELF_USE",
        maxUsdPerExecution: "5.00",
        dailyCapUsd: "10.00",
        maxAutomaticRetries: 0,
        allowedProviders: ["openai", "seedance"],
        allowedCapabilities: ["campaign.generate", "ai_story.plan", "ai_story.execute"],
        authorizedBy: input.authorizedBy,
        reason: input.reason,
        createdAt: input.createdAt,
      };
      const authorityId = deterministicPersistenceUuid("controlled-self-use-authority", body);
      const integrityHash = canonicalPersistenceHash(body);
      const inserted = await tx.execute(sql`
        insert into controlled_self_use_authorities (
          authority_id, environment, organization_id, purpose, status,
          max_usd_per_execution, daily_cap_usd, max_automatic_retries,
          allowed_providers, allowed_capabilities, authorized_by, reason,
          created_at, integrity_hash, contract_version
        ) values (
          ${authorityId}::uuid, ${input.environment}, ${input.organizationId}::uuid,
          'CONTROLLED_SELF_USE', 'ACTIVE', 5.00, 10.00, 0,
          '["openai","seedance"]'::jsonb,
          '["campaign.generate","ai_story.plan","ai_story.execute"]'::jsonb,
          ${input.authorizedBy}::uuid, ${input.reason}, ${input.createdAt}::timestamptz,
          ${integrityHash}, 'controlled-self-use-authority.v1'
        ) returning *
      `);
      await recordEvent(tx, {
        authorityId,
        eventType: "CREATED",
        actorUserId: input.authorizedBy,
        occurredAt: input.createdAt,
        evidence: { organizationId: input.organizationId, environment: input.environment },
      });
      return {
        authority: authorityFromRow(row<Record<string, unknown>>(inserted)!),
        replayed: false,
      };
    });
  }

  async setEmberSoulLabsAuthorityStatus(input: {
    authorityId: string;
    organizationId: typeof EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID;
    status: "ACTIVE" | "DISABLED" | "REVOKED";
    actorUserId: string;
    occurredAt: string;
  }): Promise<ControlledSelfUseAuthority> {
    if (input.organizationId !== EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID) {
      throw new ControlledSelfUseError("CONTROLLED_SELF_USE_ORGANIZATION_DENIED", "V1 Controlled Self-Use is restricted to EmberSoulLabs");
    }
    return this.db.transaction(async (tx) => {
      const adminRows = await tx.execute(sql`
        select 1 from platform_admin_grants
        where user_id = ${input.actorUserId}::uuid
          and platform_role = 'PLATFORM_SUPER_ADMIN'
          and status = 'ACTIVE' limit 1
      `);
      if (!row(adminRows)) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_ACTOR_DENIED", "Kill switch requires active Platform Super Admin authority");
      }
      const updated = await tx.execute(sql`
        update controlled_self_use_authorities
        set status = ${input.status},
            disabled_at = case when ${input.status} = 'DISABLED' then ${input.occurredAt}::timestamptz else disabled_at end,
            revoked_at = case when ${input.status} = 'REVOKED' then ${input.occurredAt}::timestamptz else revoked_at end
        where authority_id = ${input.authorityId}::uuid
          and organization_id = ${input.organizationId}::uuid
          and environment = 'PRODUCTION'
        returning *
      `);
      const found = row<Record<string, unknown>>(updated);
      if (!found) throw new ControlledSelfUseError("CONTROLLED_SELF_USE_DENIED", "Authority not found");
      await recordEvent(tx, {
        authorityId: input.authorityId,
        eventType: input.status === "ACTIVE" ? "ENABLED" : input.status,
        actorUserId: input.actorUserId,
        occurredAt: input.occurredAt,
      });
      return authorityFromRow(found);
    });
  }

  async getActiveAuthority(
    environment: ControlledSelfUseEnvironment,
    organizationId: string
  ): Promise<ControlledSelfUseAuthority | null> {
    const rows = await this.db.execute(sql`
      select * from controlled_self_use_authorities
      where environment = ${environment}
        and organization_id = ${organizationId}::uuid
        and purpose = 'CONTROLLED_SELF_USE'
        and status = 'ACTIVE'
      limit 1
    `);
    const found = row<Record<string, unknown>>(rows);
    return found ? authorityFromRow(found) : null;
  }

  /**
   * Create the exact, expiring commercial facts for one AI Story execution.
   * This does not create an organization subscription or durable broad
   * entitlement. The credit grant is immediately reserved for the same
   * execution identity and cannot authorize another execution.
   */
  async authorizeOneAiStoryExecution(input: {
    organizationId: string;
    workspaceId: string;
    executionIdentity: string;
    pricingRuleKey: string;
    pricingRuleVersion: string;
    creditAmount: number;
    authorizedAt: string;
  }): Promise<{
    authorityId: string;
    entitlementGrantId: string;
    creditReservationId: string;
  }> {
    if (!Number.isInteger(input.creditAmount) || input.creditAmount <= 0) {
      throw new ControlledSelfUseError(
        "CONTROLLED_SELF_USE_COMMERCIAL_INPUT_INVALID",
        "One-shot product credit amount must be a positive integer"
      );
    }
    const authority = await this.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      capabilityKey: "ai_story.execute",
      providerKey: "seedance",
    });
    const expiresAt = new Date(Date.parse(input.authorizedAt) + 15 * 60_000).toISOString();
    const grant = buildEntitlementGrant({
      orgId: input.organizationId,
      workspaceId: input.workspaceId,
      capabilityKey: "ai_story.execute",
      source: "INTERNAL",
      sourceReference: `controlled-self-use-execution:${authority.authorityId}:${input.executionIdentity}`,
      reason: "One bounded Production Controlled Self-Use AI Story execution",
      grantedByUserId: authority.authorizedBy,
      grantedAt: input.authorizedAt,
      expiresAt,
      identitySeed: `controlled-self-use:${authority.authorityId}:${input.executionIdentity}:entitlement`,
    });
    await new EntitlementRepositoryImpl(this.db).acceptOrConvergeGrant(grant);

    const wallets = new CreditWalletRepositoryImpl(this.db);
    const wallet = await wallets.ensureWallet(input.organizationId, input.authorizedAt);
    const ledger = new CreditLedgerRepositoryImpl(this.db);
    const reservations = new CreditReservationRepositoryImpl(this.db);
    const credits = new CreditsAccountingService(
      wallets,
      ledger,
      reservations
    );
    const creditGrant = buildCreditLedgerEntry({
      creditWalletId: wallet.creditWalletId,
      orgId: input.organizationId,
      entryType: "GRANT",
      amount: input.creditAmount,
      reason: "Execution-bound Production Controlled Self-Use product credits",
      actorUserId: authority.authorizedBy,
      referenceType: "controlled_self_use_execution",
      referenceId: input.executionIdentity,
      pricingRuleKey: input.pricingRuleKey,
      pricingRuleVersion: input.pricingRuleVersion,
      idempotencyKey: `controlled-self-use:${authority.authorityId}:${input.executionIdentity}:grant`,
      createdAt: input.authorizedAt,
      identitySeed: `controlled-self-use:${authority.authorityId}:${input.executionIdentity}:grant`,
    });
    await credits.appendLedgerEntry(creditGrant);
    const reserved = await credits.reserveCredits({
      orgId: input.organizationId,
      workspaceId: input.workspaceId,
      amount: input.creditAmount,
      pricingRuleKey: input.pricingRuleKey,
      pricingRuleVersion: input.pricingRuleVersion,
      executionIdentity: input.executionIdentity,
      createdAt: input.authorizedAt,
      identitySeed: `controlled-self-use:${authority.authorityId}:${input.executionIdentity}:reservation`,
    });
    return {
      authorityId: authority.authorityId,
      entitlementGrantId: grant.entitlementGrantId,
      creditReservationId: reserved.reservation.creditReservationId,
    };
  }

  async assertWorkspaceEligible(input: {
    environment: ControlledSelfUseEnvironment;
    organizationId: string;
    workspaceId: string;
    capabilityKey: ControlledSelfUseCapability;
    providerKey: ControlledSelfUseProvider;
  }): Promise<ControlledSelfUseAuthority> {
    if (
      input.environment === "PRODUCTION" &&
      input.organizationId !== EMBERSOUL_LABS_CONTROLLED_SELF_USE_ORGANIZATION_ID
    ) {
      throw new ControlledSelfUseError(
        "CONTROLLED_SELF_USE_ORGANIZATION_DENIED",
        "Production Controlled Self-Use is restricted to EmberSoulLabs"
      );
    }
    const rows = await this.db.execute(sql`
      select authority.*
      from controlled_self_use_authorities authority
      join workspaces workspace
        on workspace.id = ${input.workspaceId}::uuid
       and workspace.org_id = authority.organization_id
      where authority.environment = ${input.environment}
        and authority.organization_id = ${input.organizationId}::uuid
        and authority.purpose = 'CONTROLLED_SELF_USE'
        and authority.status = 'ACTIVE'
        and authority.allowed_capabilities ? ${input.capabilityKey}
        and authority.allowed_providers ? ${input.providerKey}
      limit 1
    `);
    const found = row<Record<string, unknown>>(rows);
    if (!found) {
      throw new ControlledSelfUseError(
        "CONTROLLED_SELF_USE_DENIED",
        "Organization/workspace is not eligible for Controlled Self-Use"
      );
    }
    return authorityFromRow(found);
  }

  async reserve(input: {
    environment: ControlledSelfUseEnvironment;
    organizationId: string;
    workspaceId: string;
    capabilityKey: ControlledSelfUseCapability;
    executionIdentity: string;
    providerKey: ControlledSelfUseProvider;
    maximumCostUsd: string;
    retryOrdinal?: number;
    actorUserId?: string;
    reservedAt: string;
  }): Promise<{ reservation: ControlledSelfUseReservation; replayed: boolean }> {
    return this.db.transaction(async (tx) => {
      const existingRows = await tx.execute(sql`
        select * from controlled_self_use_reservations
        where execution_identity = ${input.executionIdentity}
        limit 1
      `);
      const existing = row<Record<string, unknown>>(existingRows);
      if (existing) {
        const parsed = reservationFromRow(existing);
        if (
          parsed.organizationId !== input.organizationId ||
          parsed.workspaceId !== input.workspaceId ||
          parsed.capabilityKey !== input.capabilityKey ||
          parsed.providerKey !== input.providerKey ||
          parsed.reservedCostUsd !== Number(input.maximumCostUsd).toFixed(2) ||
          parsed.retryOrdinal !== (input.retryOrdinal ?? 0)
        ) {
          throw new ControlledSelfUseError(
            "CONTROLLED_SELF_USE_RESERVATION_CONFLICT",
            "Existing reservation identity has conflicting authority"
          );
        }
        return { reservation: parsed, replayed: true };
      }

      const authorityRows = await tx.execute(sql`
        select authority.*
        from controlled_self_use_authorities authority
        join workspaces workspace
          on workspace.id = ${input.workspaceId}::uuid
         and workspace.org_id = authority.organization_id
        where authority.environment = ${input.environment}
          and authority.organization_id = ${input.organizationId}::uuid
          and authority.purpose = 'CONTROLLED_SELF_USE'
        for update of authority
      `);
      const authorityRow = row<Record<string, unknown>>(authorityRows);
      if (!authorityRow) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_DENIED", "Controlled Self-Use authority is missing");
      }
      const authority = authorityFromRow(authorityRow);
      if (
        authority.status !== "ACTIVE" ||
        !authority.allowedCapabilities.includes(input.capabilityKey) ||
        !authority.allowedProviders.includes(input.providerKey)
      ) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_DENIED", "Controlled Self-Use authority is inactive or out of scope");
      }
      const retryOrdinal = input.retryOrdinal ?? 0;
      if (retryOrdinal !== 0 || retryOrdinal > authority.maxAutomaticRetries) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_RETRY_DENIED", "Automatic paid retry is not authorized");
      }
      const requestedCents = money(input.maximumCostUsd);
      if (requestedCents <= 0 || requestedCents > money(authority.maxUsdPerExecution)) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_EXECUTION_CAP_EXCEEDED", "Execution exceeds the self-use USD ceiling");
      }
      const budgetDay = input.reservedAt.slice(0, 10);
      const spendRows = await tx.execute(sql`
        select coalesce(sum(
          case when status = 'SETTLED' then settled_cost_usd else reserved_cost_usd end
        ), 0)::text as committed_usd
        from controlled_self_use_reservations
        where authority_id = ${authority.authorityId}::uuid
          and budget_day = ${budgetDay}::date
          and status in ('RESERVED', 'SUBMITTED', 'SETTLED')
      `);
      const committedCents = money(String(row<{ committed_usd: string }>(spendRows)?.committed_usd ?? "0"));
      if (committedCents + requestedCents > money(authority.dailyCapUsd)) {
        throw new ControlledSelfUseError("SELF_USE_DAILY_BUDGET_EXCEEDED", "Organization daily self-use budget is exhausted");
      }

      const body = {
        contractVersion: "controlled-self-use-reservation.v1",
        authorityId: authority.authorityId,
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        capabilityKey: input.capabilityKey,
        executionIdentity: input.executionIdentity,
        providerKey: input.providerKey,
        reservedCostUsd: usd(requestedCents),
        retryOrdinal,
        budgetDay,
        createdAt: input.reservedAt,
      };
      const reservationId = deterministicPersistenceUuid("controlled-self-use-reservation", body);
      const integrityHash = canonicalPersistenceHash(body);
      const inserted = await tx.execute(sql`
        insert into controlled_self_use_reservations (
          reservation_id, authority_id, organization_id, workspace_id,
          capability_key, execution_identity, provider_key, reserved_cost_usd,
          retry_ordinal, status, budget_day, created_at, integrity_hash, contract_version
        ) values (
          ${reservationId}::uuid, ${authority.authorityId}::uuid,
          ${input.organizationId}::uuid, ${input.workspaceId}::uuid,
          ${input.capabilityKey}, ${input.executionIdentity}, ${input.providerKey},
          ${usd(requestedCents)}::numeric, ${retryOrdinal}, 'RESERVED',
          ${budgetDay}::date, ${input.reservedAt}::timestamptz,
          ${integrityHash}, 'controlled-self-use-reservation.v1'
        ) returning *
      `);
      await recordEvent(tx, {
        authorityId: authority.authorityId,
        reservationId,
        eventType: "RESERVED",
        actorUserId: input.actorUserId,
        costUsd: usd(requestedCents),
        occurredAt: input.reservedAt,
        evidence: { capabilityKey: input.capabilityKey, executionIdentity: input.executionIdentity },
      });
      return {
        reservation: reservationFromRow(row<Record<string, unknown>>(inserted)!),
        replayed: false,
      };
    });
  }

  async getReservationById(reservationId: string): Promise<ControlledSelfUseReservation | null> {
    const rows = await this.db.execute(sql`
      select * from controlled_self_use_reservations
      where reservation_id = ${reservationId}::uuid limit 1
    `);
    const found = row<Record<string, unknown>>(rows);
    return found ? reservationFromRow(found) : null;
  }

  async getReservationByExecutionIdentity(executionIdentity: string): Promise<ControlledSelfUseReservation | null> {
    const rows = await this.db.execute(sql`
      select * from controlled_self_use_reservations
      where execution_identity = ${executionIdentity} limit 1
    `);
    const found = row<Record<string, unknown>>(rows);
    return found ? reservationFromRow(found) : null;
  }

  async markSubmitted(reservationId: string, occurredAt: string, providerRequestId?: string) {
    return this.transition(reservationId, "SUBMITTED", occurredAt, providerRequestId);
  }

  async settle(reservationId: string, actualCostUsd: string, occurredAt: string, providerRequestId?: string) {
    const result = await this.transition(reservationId, "SETTLED", occurredAt, providerRequestId, actualCostUsd);
    return result;
  }

  async release(reservationId: string, occurredAt: string) {
    return this.transition(reservationId, "RELEASED", occurredAt);
  }

  /** Settle a Campaign only from its exact durable Task and Provider usage log. */
  async settleCampaignTask(input: {
    taskId: string;
    organizationId: string;
    workspaceId: string;
    settledAt: string;
  }): Promise<ControlledSelfUseReservation> {
    const rows = await this.db.execute(sql`
      select reservation.*,
             coalesce(sum(log.cost_usd), 0)::numeric(12,2)::text as verified_cost_usd
      from controlled_self_use_reservations reservation
      join tasks task
        on task.id = ${input.taskId}::uuid
       and task.org_id = reservation.organization_id
       and task.workspace_id = reservation.workspace_id
       and reservation.execution_identity = concat('campaign-task:', task.id::text)
      left join agent_logs log
        on log.task_id = task.id
       and log.org_id = task.org_id
       and log.workspace_id = task.workspace_id
      where reservation.organization_id = ${input.organizationId}::uuid
        and reservation.workspace_id = ${input.workspaceId}::uuid
        and reservation.capability_key = 'campaign.generate'
        and reservation.provider_key = 'openai'
        and reservation.retry_ordinal = 0
      group by reservation.reservation_id
      limit 1
    `);
    const found = row<Record<string, unknown>>(rows);
    if (!found) {
      throw new ControlledSelfUseError(
        "CONTROLLED_SELF_USE_RESERVATION_MISSING",
        "Exact Campaign Task reservation authority is missing"
      );
    }
    const reservation = reservationFromRow(found);
    const verifiedCostUsd = Number(found.verified_cost_usd ?? 0).toFixed(2);
    return this.settle(
      reservation.reservationId,
      verifiedCostUsd,
      input.settledAt
    );
  }

  private async transition(
    reservationId: string,
    target: "SUBMITTED" | "SETTLED" | "RELEASED",
    occurredAt: string,
    providerRequestId?: string,
    settledCostUsd?: string
  ): Promise<ControlledSelfUseReservation> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        select * from controlled_self_use_reservations
        where reservation_id = ${reservationId}::uuid
        for update
      `);
      const currentRow = row<Record<string, unknown>>(rows);
      if (!currentRow) throw new ControlledSelfUseError("CONTROLLED_SELF_USE_RESERVATION_MISSING", "Reservation not found");
      const current = reservationFromRow(currentRow);
      if (current.status === target || (current.status === "SETTLED" && target === "SUBMITTED")) return current;
      const allowed =
        (target === "SUBMITTED" && current.status === "RESERVED") ||
        (target === "SETTLED" && ["RESERVED", "SUBMITTED"].includes(current.status)) ||
        (target === "RELEASED" && ["RESERVED", "SUBMITTED"].includes(current.status));
      if (!allowed) throw new ControlledSelfUseError("CONTROLLED_SELF_USE_RESERVATION_STATE_INVALID", "Reservation transition is not allowed");
      if (settledCostUsd && money(settledCostUsd) > money(current.reservedCostUsd)) {
        throw new ControlledSelfUseError("CONTROLLED_SELF_USE_SETTLEMENT_EXCEEDED", "Settlement exceeds reservation");
      }
      const updated = await tx.execute(sql`
        update controlled_self_use_reservations
        set status = ${target},
            provider_request_id = coalesce(${providerRequestId ?? null}, provider_request_id),
            submitted_at = case when ${target} = 'SUBMITTED' then ${occurredAt}::timestamptz else submitted_at end,
            settled_at = case when ${target} = 'SETTLED' then ${occurredAt}::timestamptz else settled_at end,
            settled_cost_usd = case when ${target} = 'SETTLED' then ${settledCostUsd ?? "0.00"}::numeric else settled_cost_usd end,
            released_at = case when ${target} = 'RELEASED' then ${occurredAt}::timestamptz else released_at end
        where reservation_id = ${reservationId}::uuid
        returning *
      `);
      await recordEvent(tx, {
        authorityId: current.authorityId,
        reservationId,
        eventType: target,
        costUsd: target === "SETTLED" ? settledCostUsd : current.reservedCostUsd,
        occurredAt,
        evidence: providerRequestId ? { providerRequestId } : {},
      });
      return reservationFromRow(row<Record<string, unknown>>(updated)!);
    });
  }
}

export type UnifiedProviderCommercialReservation = {
  reservationId: string;
  executionIdentity: string;
  orgId: string;
  workspaceId: string;
  status: string;
  settledCostUsd: string | null;
};

export async function getUnifiedProviderCommercialReservation(
  db: Db | Tx,
  reservationId: string
): Promise<UnifiedProviderCommercialReservation | null> {
  const rows = await db.execute(sql`
    select certification_reservation_id::text as reservation_id,
           execution_identity, org_id::text, workspace_id::text, status,
           settled_cost_usd::text
    from certification_commercial_reservations
    where certification_reservation_id = ${reservationId}::uuid
    union all
    select reservation_id::text, execution_identity,
           organization_id::text as org_id, workspace_id::text, status,
           settled_cost_usd::text
    from controlled_self_use_reservations
    where reservation_id = ${reservationId}::uuid
    limit 1
  `);
  const found = row<Record<string, unknown>>(rows);
  return found ? {
    reservationId: String(found.reservation_id),
    executionIdentity: String(found.execution_identity),
    orgId: String(found.org_id),
    workspaceId: String(found.workspace_id),
    status: String(found.status),
    settledCostUsd: found.settled_cost_usd === null ? null : String(found.settled_cost_usd),
  } : null;
}
