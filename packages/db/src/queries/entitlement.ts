/**
 * Sprint 4 Phase B3 — Entitlement grant/revocation + effective projection rebuild.
 *
 * Authoritative read path:
 *   Grant/Revocation facts → rebuildEffectiveProjection → Read projection
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  parseEntitlementGrant,
  parseEntitlementRevocation,
  parseEffectiveEntitlementProjection,
  type EntitlementGrant,
  type EntitlementRevocation,
  type EffectiveEntitlementEntry,
  type EffectiveEntitlementProjection,
} from "@ceo-agent/shared";
import {
  buildEffectiveEntitlementProjection,
  buildEntitlementGrant,
  effectiveEntitlementProjectionRowId,
  listCapabilitiesForPlan,
  subscriptionStatusAllowsPlanCapabilities,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";
import {
  CommercialPersistenceError,
  isUniqueViolation,
} from "./billing-account";
import type { AcceptOrConvergeResult } from "./platform-admin";
import { SubscriptionRepositoryImpl } from "./subscription";

type Db = ReturnType<typeof getDb>;

function grantEquivalence(grant: EntitlementGrant): unknown {
  return {
    entitlementGrantId: grant.entitlementGrantId,
    orgId: grant.orgId,
    workspaceId: grant.workspaceId,
    capabilityKey: grant.capabilityKey,
    source: grant.source,
    sourceReference: grant.sourceReference,
    reason: grant.reason,
    grantedByUserId: grant.grantedByUserId,
    grantedAt: grant.grantedAt,
    expiresAt: grant.expiresAt,
    integrityHash: grant.integrityHash,
  };
}

function assertEquivalentGrant(
  existing: EntitlementGrant,
  requested: EntitlementGrant
): void {
  if (
    existing.entitlementGrantId !== requested.entitlementGrantId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(grantEquivalence(existing)) !==
      canonicalPersistenceHash(grantEquivalence(requested))
  ) {
    throw new CommercialPersistenceError(
      "COMMERCIAL_IDENTITY_CONFLICT",
      "Conflicting Entitlement Grant identity replay rejected"
    );
  }
}

function assertEquivalentRevocation(
  existing: EntitlementRevocation,
  requested: EntitlementRevocation
): void {
  if (
    existing.entitlementRevocationId !== requested.entitlementRevocationId ||
    existing.integrityHash !== requested.integrityHash
  ) {
    throw new CommercialPersistenceError(
      "COMMERCIAL_IDENTITY_CONFLICT",
      "Conflicting Entitlement Revocation identity replay rejected"
    );
  }
}

export interface EntitlementRepository {
  getGrantById(id: string): Promise<EntitlementGrant | null>;
  listGrantsByOrgId(orgId: string): Promise<readonly EntitlementGrant[]>;
  acceptOrConvergeGrant(
    grant: EntitlementGrant
  ): Promise<AcceptOrConvergeResult<EntitlementGrant>>;
  acceptOrConvergeRevocation(
    revocation: EntitlementRevocation
  ): Promise<AcceptOrConvergeResult<EntitlementRevocation>>;
  getEffectiveProjection(input: {
    orgId: string;
    workspaceId?: string | null;
  }): Promise<EffectiveEntitlementProjection | null>;
  /**
   * Rebuild authoritative effective projection from grants + revocations +
   * Subscription Projection plan mapping (PLAN source).
   */
  rebuildEffectiveProjection(input: {
    orgId: string;
    workspaceId?: string | null;
    projectedAt: string;
    now?: string;
  }): Promise<EffectiveEntitlementProjection>;
}

export class EntitlementRepositoryImpl implements EntitlementRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getGrantById(id: string): Promise<EntitlementGrant | null> {
    const rows = await this.db
      .select()
      .from(schema.entitlementGrants)
      .where(eq(schema.entitlementGrants.entitlementGrantId, id))
      .limit(1);
    return rows[0] ? parseEntitlementGrant(rows[0].grantBody) : null;
  }

  async listGrantsByOrgId(
    orgId: string
  ): Promise<readonly EntitlementGrant[]> {
    const rows = await this.db
      .select()
      .from(schema.entitlementGrants)
      .where(eq(schema.entitlementGrants.orgId, orgId))
      .orderBy(desc(schema.entitlementGrants.grantedAt));
    return rows.map((row) => parseEntitlementGrant(row.grantBody));
  }

  async acceptOrConvergeGrant(
    grant: EntitlementGrant
  ): Promise<AcceptOrConvergeResult<EntitlementGrant>> {
    const org = await this.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, grant.orgId))
      .limit(1);
    if (!org[0]) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_ORG_INVALID",
        "Organization does not exist for Entitlement Grant"
      );
    }

    const existing = await this.getGrantById(grant.entitlementGrantId);
    if (existing) {
      assertEquivalentGrant(existing, grant);
      return { value: existing, replayed: true };
    }

    try {
      await this.db.insert(schema.entitlementGrants).values({
        entitlementGrantId: grant.entitlementGrantId,
        orgId: grant.orgId,
        workspaceId: grant.workspaceId,
        capabilityKey: grant.capabilityKey,
        source: grant.source,
        sourceReference: grant.sourceReference,
        reason: grant.reason,
        grantedByUserId: grant.grantedByUserId,
        grantedAt: new Date(grant.grantedAt),
        expiresAt: grant.expiresAt ? new Date(grant.expiresAt) : null,
        integrityHash: grant.integrityHash,
        contractVersion: grant.contractVersion,
        grantBody: grant,
      });
      return { value: grant, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getGrantById(grant.entitlementGrantId);
      if (!raced) {
        throw new CommercialPersistenceError(
          "COMMERCIAL_IDENTITY_CONFLICT",
          "Entitlement Grant unique conflict without readable row"
        );
      }
      assertEquivalentGrant(raced, grant);
      return { value: raced, replayed: true };
    }
  }

  async acceptOrConvergeRevocation(
    revocation: EntitlementRevocation
  ): Promise<AcceptOrConvergeResult<EntitlementRevocation>> {
    const grant = await this.getGrantById(revocation.entitlementGrantId);
    if (!grant) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_NOT_FOUND",
        "Cannot revoke missing Entitlement Grant"
      );
    }
    if (grant.orgId !== revocation.orgId) {
      throw new CommercialPersistenceError(
        "COMMERCIAL_OWNERSHIP_INVALID",
        "Revocation orgId does not match grant"
      );
    }

    const existingRows = await this.db
      .select()
      .from(schema.entitlementRevocations)
      .where(
        eq(
          schema.entitlementRevocations.entitlementGrantId,
          revocation.entitlementGrantId
        )
      )
      .limit(1);
    if (existingRows[0]) {
      const parsed = parseEntitlementRevocation(existingRows[0].revocation);
      assertEquivalentRevocation(parsed, revocation);
      return { value: parsed, replayed: true };
    }

    try {
      await this.db.insert(schema.entitlementRevocations).values({
        entitlementRevocationId: revocation.entitlementRevocationId,
        entitlementGrantId: revocation.entitlementGrantId,
        orgId: revocation.orgId,
        capabilityKey: revocation.capabilityKey,
        source: revocation.source,
        reason: revocation.reason,
        revokedByUserId: revocation.revokedByUserId,
        revokedAt: new Date(revocation.revokedAt),
        integrityHash: revocation.integrityHash,
        contractVersion: revocation.contractVersion,
        revocation,
      });
      return { value: revocation, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db
        .select()
        .from(schema.entitlementRevocations)
        .where(
          eq(
            schema.entitlementRevocations.entitlementGrantId,
            revocation.entitlementGrantId
          )
        )
        .limit(1);
      if (!raced[0]) {
        throw new CommercialPersistenceError(
          "COMMERCIAL_IDENTITY_CONFLICT",
          "Entitlement Revocation unique conflict without readable row"
        );
      }
      const parsed = parseEntitlementRevocation(raced[0].revocation);
      assertEquivalentRevocation(parsed, revocation);
      return { value: parsed, replayed: true };
    }
  }

  async getEffectiveProjection(input: {
    orgId: string;
    workspaceId?: string | null;
  }): Promise<EffectiveEntitlementProjection | null> {
    const workspaceId = input.workspaceId ?? null;
    const rows = workspaceId
      ? await this.db
          .select()
          .from(schema.effectiveEntitlementProjections)
          .where(
            and(
              eq(schema.effectiveEntitlementProjections.orgId, input.orgId),
              eq(
                schema.effectiveEntitlementProjections.workspaceId,
                workspaceId
              )
            )
          )
          .limit(1)
      : await this.db
          .select()
          .from(schema.effectiveEntitlementProjections)
          .where(
            and(
              eq(schema.effectiveEntitlementProjections.orgId, input.orgId),
              isNull(schema.effectiveEntitlementProjections.workspaceId)
            )
          )
          .limit(1);
    return rows[0]
      ? parseEffectiveEntitlementProjection(rows[0].projection)
      : null;
  }

  async rebuildEffectiveProjection(input: {
    orgId: string;
    workspaceId?: string | null;
    projectedAt: string;
    now?: string;
  }): Promise<EffectiveEntitlementProjection> {
    const workspaceId = input.workspaceId ?? null;
    const nowMs = Date.parse(input.now ?? input.projectedAt);

    const grants = await this.listGrantsByOrgId(input.orgId);
    const scoped = grants.filter((grant) =>
      workspaceId
        ? grant.workspaceId === workspaceId || grant.workspaceId === null
        : grant.workspaceId === null
    );

    const revocationRows = await this.db
      .select()
      .from(schema.entitlementRevocations)
      .where(eq(schema.entitlementRevocations.orgId, input.orgId));
    const revoked = new Set(
      revocationRows.map((row) => row.entitlementGrantId)
    );

    const entries: EffectiveEntitlementEntry[] = [];
    const seenCapabilities = new Set<string>();
    const revokedPlanCapabilities = new Set(
      scoped
        .filter(
          (grant) =>
            grant.source === "PLAN" && revoked.has(grant.entitlementGrantId)
        )
        .map((grant) => grant.capabilityKey)
    );

    for (const grant of scoped) {
      if (revoked.has(grant.entitlementGrantId)) continue;
      if (grant.expiresAt && Date.parse(grant.expiresAt) <= nowMs) continue;
      // Non-PLAN stored grants (INTERNAL/SUPPORT/PROMOTIONAL) and explicit PLAN grants.
      if (grant.source === "PLAN") continue; // PLAN comes from subscription mapping below
      if (seenCapabilities.has(grant.capabilityKey)) continue;
      seenCapabilities.add(grant.capabilityKey);
      entries.push({
        capabilityKey: grant.capabilityKey,
        source: grant.source,
        entitlementGrantId: grant.entitlementGrantId,
        grantedAt: grant.grantedAt,
        expiresAt: grant.expiresAt,
      });
    }

    // Subscription Projection → Plan Capability Mapping → PLAN entries.
    const subscriptionRepo = new SubscriptionRepositoryImpl(this.db);
    const subscription = await subscriptionRepo.getProjectionByOrgId(
      input.orgId
    );
    if (
      subscription?.planKey &&
      subscriptionStatusAllowsPlanCapabilities(subscription.status)
    ) {
      for (const capability of listCapabilitiesForPlan(subscription.planKey)) {
        if (revokedPlanCapabilities.has(capability)) continue;
        if (seenCapabilities.has(capability)) continue;
        const planGrant = buildEntitlementGrant({
          orgId: input.orgId,
          workspaceId,
          capabilityKey: capability,
          source: "PLAN",
          sourceReference: `subscription-projection:${subscription.subscriptionProjectionId}`,
          reason: `plan-mapping:${subscription.planKey}`,
          grantedAt: subscription.projectedAt,
          identitySeed: `plan:${input.orgId}:${workspaceId ?? "org"}:${capability}:${subscription.subscriptionProjectionId}`,
        });
        seenCapabilities.add(capability);
        entries.push({
          capabilityKey: capability,
          source: "PLAN",
          entitlementGrantId: planGrant.entitlementGrantId,
          grantedAt: planGrant.grantedAt,
          expiresAt: null,
        });
      }
    }

    entries.sort((a, b) => a.capabilityKey.localeCompare(b.capabilityKey));

    const projection = buildEffectiveEntitlementProjection({
      orgId: input.orgId,
      workspaceId,
      entries,
      projectedAt: input.projectedAt,
    });

    const rowId = effectiveEntitlementProjectionRowId({
      orgId: input.orgId,
      workspaceId,
    });
    const values = {
      effectiveEntitlementProjectionId: rowId,
      orgId: input.orgId,
      workspaceId,
      projectedAt: new Date(projection.projectedAt),
      integrityHash: projection.integrityHash,
      contractVersion: projection.contractVersion,
      projection,
    };

    const existing = await this.getEffectiveProjection({
      orgId: input.orgId,
      workspaceId,
    });
    if (!existing) {
      try {
        await this.db
          .insert(schema.effectiveEntitlementProjections)
          .values(values);
        return projection;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }

    if (workspaceId) {
      await this.db
        .update(schema.effectiveEntitlementProjections)
        .set(values)
        .where(
          and(
            eq(schema.effectiveEntitlementProjections.orgId, input.orgId),
            eq(schema.effectiveEntitlementProjections.workspaceId, workspaceId)
          )
        );
    } else {
      await this.db
        .update(schema.effectiveEntitlementProjections)
        .set(values)
        .where(
          and(
            eq(schema.effectiveEntitlementProjections.orgId, input.orgId),
            isNull(schema.effectiveEntitlementProjections.workspaceId)
          )
        );
    }
    return projection;
  }
}
