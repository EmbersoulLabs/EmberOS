/**
 * Sprint 4 Phase B3 — Subscription Event + Projection persistence.
 *
 * Events are append-only. Projections are rebuildable server-owned read models.
 */
import { desc, eq } from "drizzle-orm";
import {
  parseSubscriptionEvent,
  parseSubscriptionProjection,
  type SubscriptionEvent,
  type SubscriptionProjection,
  type SubscriptionStatus,
} from "@ceo-agent/shared";
import {
  buildSubscriptionProjection,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";
import {
  CommercialPersistenceError,
  isUniqueViolation,
} from "./billing-account";
import type { AcceptOrConvergeResult } from "./platform-admin";

type Db = ReturnType<typeof getDb>;

function eventEquivalence(event: SubscriptionEvent): unknown {
  return {
    subscriptionEventId: event.subscriptionEventId,
    billingAccountId: event.billingAccountId,
    orgId: event.orgId,
    source: event.source,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    acceptedAt: event.acceptedAt,
    payloadDigest: event.payloadDigest,
    integrityHash: event.integrityHash,
  };
}

function assertEquivalentEvent(
  existing: SubscriptionEvent,
  requested: SubscriptionEvent
): void {
  if (
    existing.subscriptionEventId !== requested.subscriptionEventId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(eventEquivalence(existing)) !==
      canonicalPersistenceHash(eventEquivalence(requested))
  ) {
    throw new CommercialPersistenceError(
      "COMMERCIAL_IDENTITY_CONFLICT",
      "Conflicting Subscription Event identity replay rejected"
    );
  }
}

/** Map provider-neutral event types into projection status when possible. */
export function deriveSubscriptionStatusFromEventType(
  eventType: string
): SubscriptionStatus {
  const normalized = eventType.trim().toUpperCase();
  const map: Record<string, SubscriptionStatus> = {
    NONE: "NONE",
    INCOMPLETE: "INCOMPLETE",
    TRIALING: "TRIALING",
    ACTIVE: "ACTIVE",
    PAST_DUE: "PAST_DUE",
    PAUSED: "PAUSED",
    CANCELED: "CANCELED",
    CANCELLED: "CANCELED",
    UNPAID: "UNPAID",
    UNKNOWN: "UNKNOWN",
    SUBSCRIPTION_ACTIVE: "ACTIVE",
    SUBSCRIPTION_TRIALING: "TRIALING",
    SUBSCRIPTION_PAST_DUE: "PAST_DUE",
    SUBSCRIPTION_CANCELED: "CANCELED",
    SUBSCRIPTION_PAUSED: "PAUSED",
    SUBSCRIPTION_UNPAID: "UNPAID",
    SUBSCRIPTION_INCOMPLETE: "INCOMPLETE",
  };
  return map[normalized] ?? "UNKNOWN";
}

export interface SubscriptionRepository {
  getEventById(id: string): Promise<SubscriptionEvent | null>;
  listEventsByOrgId(orgId: string): Promise<readonly SubscriptionEvent[]>;
  listEventsByBillingAccountId(
    billingAccountId: string
  ): Promise<readonly SubscriptionEvent[]>;
  acceptOrConvergeEvent(
    event: SubscriptionEvent
  ): Promise<AcceptOrConvergeResult<SubscriptionEvent>>;
  getProjectionByOrgId(orgId: string): Promise<SubscriptionProjection | null>;
  getProjectionByBillingAccountId(
    billingAccountId: string
  ): Promise<SubscriptionProjection | null>;
  upsertProjection(
    projection: SubscriptionProjection
  ): Promise<AcceptOrConvergeResult<SubscriptionProjection>>;
  /**
   * Rebuild projection from a verified accepted event (+ optional plan key).
   */
  rebuildProjectionFromEvent(input: {
    event: SubscriptionEvent;
    planKey?: string | null;
    projectedAt: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
  }): Promise<SubscriptionProjection>;
  /**
   * Deterministic rebuild from all accepted events for a billing account
   * (occurredAt ascending; last event wins status/source).
   */
  rebuildProjectionFromEvents(input: {
    billingAccountId: string;
    projectedAt: string;
    planKey?: string | null;
  }): Promise<SubscriptionProjection | null>;
}

export class SubscriptionRepositoryImpl implements SubscriptionRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getEventById(id: string): Promise<SubscriptionEvent | null> {
    const rows = await this.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.subscriptionEventId, id))
      .limit(1);
    return rows[0] ? parseSubscriptionEvent(rows[0].event) : null;
  }

  async listEventsByOrgId(
    orgId: string
  ): Promise<readonly SubscriptionEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.orgId, orgId))
      .orderBy(desc(schema.subscriptionEvents.acceptedAt));
    return rows.map((row) => parseSubscriptionEvent(row.event));
  }

  async listEventsByBillingAccountId(
    billingAccountId: string
  ): Promise<readonly SubscriptionEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.subscriptionEvents)
      .where(eq(schema.subscriptionEvents.billingAccountId, billingAccountId))
      .orderBy(desc(schema.subscriptionEvents.acceptedAt));
    return rows.map((row) => parseSubscriptionEvent(row.event));
  }

  async acceptOrConvergeEvent(
    event: SubscriptionEvent
  ): Promise<AcceptOrConvergeResult<SubscriptionEvent>> {
    const account = await this.db
      .select()
      .from(schema.billingAccounts)
      .where(
        eq(schema.billingAccounts.billingAccountId, event.billingAccountId)
      )
      .limit(1);
    if (!account[0]) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_NOT_FOUND",
        "Billing Account missing for Subscription Event"
      );
    }
    if (account[0].orgId !== event.orgId) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_OWNERSHIP_INVALID",
        "Subscription Event orgId does not match Billing Account"
      );
    }

    const existing = await this.getEventById(event.subscriptionEventId);
    if (existing) {
      assertEquivalentEvent(existing, event);
      return { value: existing, replayed: true };
    }

    try {
      await this.db.insert(schema.subscriptionEvents).values({
        subscriptionEventId: event.subscriptionEventId,
        billingAccountId: event.billingAccountId,
        orgId: event.orgId,
        sourceProvider: event.source.provider,
        sourceExternalSubscriptionId: event.source.externalSubscriptionId,
        sourceExternalCustomerId: event.source.externalCustomerId,
        eventType: event.eventType,
        occurredAt: new Date(event.occurredAt),
        acceptedAt: new Date(event.acceptedAt),
        payloadDigest: event.payloadDigest,
        integrityHash: event.integrityHash,
        contractVersion: event.contractVersion,
        event,
      });
      return { value: event, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db
        .select()
        .from(schema.subscriptionEvents)
        .where(
          eq(
            schema.subscriptionEvents.sourceProvider,
            event.source.provider
          )
        )
        .limit(50);
      const match = raced.find((row) => {
        const parsed = parseSubscriptionEvent(row.event);
        return (
          parsed.source.externalSubscriptionId ===
            event.source.externalSubscriptionId &&
          parsed.eventType === event.eventType &&
          parsed.payloadDigest === event.payloadDigest
        );
      });
      if (!match) {
        const byId = await this.getEventById(event.subscriptionEventId);
        if (!byId) {
          throw new CommercialPersistenceError(
            "COMMERCIAL_IDENTITY_CONFLICT",
            "Subscription Event unique conflict without readable row"
          );
        }
        assertEquivalentEvent(byId, event);
        return { value: byId, replayed: true };
      }
      const parsed = parseSubscriptionEvent(match.event);
      assertEquivalentEvent(parsed, event);
      return { value: parsed, replayed: true };
    }
  }

  async getProjectionByOrgId(
    orgId: string
  ): Promise<SubscriptionProjection | null> {
    const rows = await this.db
      .select()
      .from(schema.subscriptionProjections)
      .where(eq(schema.subscriptionProjections.orgId, orgId))
      .limit(1);
    return rows[0] ? parseSubscriptionProjection(rows[0].projection) : null;
  }

  async getProjectionByBillingAccountId(
    billingAccountId: string
  ): Promise<SubscriptionProjection | null> {
    const rows = await this.db
      .select()
      .from(schema.subscriptionProjections)
      .where(
        eq(schema.subscriptionProjections.billingAccountId, billingAccountId)
      )
      .limit(1);
    return rows[0] ? parseSubscriptionProjection(rows[0].projection) : null;
  }

  async upsertProjection(
    projection: SubscriptionProjection
  ): Promise<AcceptOrConvergeResult<SubscriptionProjection>> {
    const existing = await this.getProjectionByOrgId(projection.orgId);
    if (
      existing &&
      existing.integrityHash === projection.integrityHash &&
      existing.subscriptionProjectionId === projection.subscriptionProjectionId
    ) {
      return { value: existing, replayed: true };
    }

    const values = {
      subscriptionProjectionId: projection.subscriptionProjectionId,
      billingAccountId: projection.billingAccountId,
      orgId: projection.orgId,
      status: projection.status,
      planKey: projection.planKey,
      sourceProvider: projection.source?.provider ?? null,
      sourceExternalSubscriptionId:
        projection.source?.externalSubscriptionId ?? null,
      sourceExternalCustomerId: projection.source?.externalCustomerId ?? null,
      currentPeriodStart: projection.currentPeriodStart
        ? new Date(projection.currentPeriodStart)
        : null,
      currentPeriodEnd: projection.currentPeriodEnd
        ? new Date(projection.currentPeriodEnd)
        : null,
      projectedAt: new Date(projection.projectedAt),
      sourceEventId: projection.sourceEventId,
      integrityHash: projection.integrityHash,
      contractVersion: projection.contractVersion,
      projection,
    };

    if (!existing) {
      try {
        await this.db.insert(schema.subscriptionProjections).values(values);
        return { value: projection, replayed: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await this.getProjectionByOrgId(projection.orgId);
        if (!raced) {
          throw new CommercialPersistenceError(
            "COMMERCIAL_IDENTITY_CONFLICT",
            "Subscription Projection unique conflict without readable row"
          );
        }
        // Fall through to update path when identity differs (rebuild).
      }
    }

    await this.db
      .update(schema.subscriptionProjections)
      .set(values)
      .where(eq(schema.subscriptionProjections.orgId, projection.orgId));
    return { value: projection, replayed: false };
  }

  async rebuildProjectionFromEvent(input: {
    event: SubscriptionEvent;
    planKey?: string | null;
    projectedAt: string;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
  }): Promise<SubscriptionProjection> {
    const accepted = await this.acceptOrConvergeEvent(input.event);
    const projection = buildSubscriptionProjection({
      billingAccountId: accepted.value.billingAccountId,
      orgId: accepted.value.orgId,
      status: deriveSubscriptionStatusFromEventType(accepted.value.eventType),
      planKey: input.planKey ?? null,
      source: accepted.value.source,
      currentPeriodStart: input.currentPeriodStart ?? null,
      currentPeriodEnd: input.currentPeriodEnd ?? null,
      projectedAt: input.projectedAt,
      sourceEventId: accepted.value.subscriptionEventId,
    });
    const upserted = await this.upsertProjection(projection);
    return upserted.value;
  }

  async rebuildProjectionFromEvents(input: {
    billingAccountId: string;
    projectedAt: string;
    planKey?: string | null;
  }): Promise<SubscriptionProjection | null> {
    const events = await this.listEventsByBillingAccountId(
      input.billingAccountId
    );
    if (events.length === 0) return null;

    const chronological = [...events].sort((a, b) => {
      const byOccurred = a.occurredAt.localeCompare(b.occurredAt);
      if (byOccurred !== 0) return byOccurred;
      return a.subscriptionEventId.localeCompare(b.subscriptionEventId);
    });
    const latest = chronological[chronological.length - 1]!;
    return this.rebuildProjectionFromEvent({
      event: latest,
      planKey: input.planKey ?? null,
      projectedAt: input.projectedAt,
    });
  }
}
