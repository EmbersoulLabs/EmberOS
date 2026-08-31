/**
 * Narrow operational authority for STAGING certification entitlements.
 *
 * This is deliberately not a generic entitlement-management surface. It can
 * only grant/revoke ai_story.execute for an explicitly identified STAGING
 * organization/workspace, through the canonical append-only repositories.
 */
import { and, eq } from "drizzle-orm";
import {
  effectiveProjectionHasCapability,
  type EntitlementGrant,
  type EntitlementRevocation,
  type EffectiveEntitlementProjection,
} from "@ceo-agent/shared";
import {
  buildEntitlementGrant,
  buildEntitlementRevocation,
} from "@ceo-agent/shared/server";
import { getDb, schema } from "../client";
import {
  EntitlementRepositoryImpl,
  type EntitlementRepository,
} from "./entitlement";

type Db = ReturnType<typeof getDb>;

export const STAGING_EXECUTE_GRANT_TICKET =
  "EMBEROS-AI-STORY-STAGING-CANONICAL-EXECUTE-GRANT-APPLICATION-01" as const;
export const STAGING_EXECUTE_GRANT_REASON =
  "AI Story V1 STAGING real-provider certification" as const;
export const STAGING_EXECUTE_CAPABILITY = "ai_story.execute" as const;

export type StagingExecuteGrantTarget = {
  readonly environment: "STAGING";
  readonly railwayEnvironmentName: "staging";
  readonly railwayEnvironmentId: string;
  readonly expectedRailwayEnvironmentId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly reason: typeof STAGING_EXECUTE_GRANT_REASON;
};

export type StagingExecuteGrantInspection = {
  readonly environment: "STAGING";
  readonly orgId: string;
  readonly organizationName: string;
  readonly plan: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly workspaceSlug: string;
  readonly actorUserId: string;
  readonly actorWorkspaceRole: string;
  readonly accessGranted: boolean;
  readonly executeGranted: boolean;
  readonly activeExecuteGrant: EntitlementGrant | null;
  readonly projection: EffectiveEntitlementProjection;
};

export type StagingExecuteGrantResult = {
  readonly grant: EntitlementGrant;
  readonly projection: EffectiveEntitlementProjection;
  readonly replayed: boolean;
};

export type StagingExecuteRevokeResult = {
  readonly revocation: EntitlementRevocation;
  readonly projection: EffectiveEntitlementProjection;
  readonly replayed: boolean;
};

export class StagingExecuteGrantAdministrationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "StagingExecuteGrantAdministrationError";
  }
}

function assertStagingTarget(target: StagingExecuteGrantTarget): void {
  if (
    target.environment !== "STAGING" ||
    target.railwayEnvironmentName !== "staging" ||
    target.railwayEnvironmentId !== target.expectedRailwayEnvironmentId
  ) {
    throw new StagingExecuteGrantAdministrationError(
      "STAGING_ENVIRONMENT_GUARD_FAILED",
      "Execute entitlement administration is restricted to the acknowledged Railway STAGING environment"
    );
  }
  if (target.reason !== STAGING_EXECUTE_GRANT_REASON) {
    throw new StagingExecuteGrantAdministrationError(
      "GRANT_REASON_INVALID",
      "The certification grant reason must match the frozen administrative contract"
    );
  }
}

export class StagingExecuteGrantAdministrationService {
  constructor(
    private readonly db: Db = getDb(),
    private readonly entitlements: EntitlementRepository =
      new EntitlementRepositoryImpl(db)
  ) {}

  async resolveWorkspaceBySlug(slug: string): Promise<{
    orgId: string;
    organizationName: string;
    plan: string;
    workspaceId: string;
    workspaceName: string;
    workspaceSlug: string;
    members: readonly { userId: string | null; role: string }[];
  }> {
    const rows = await this.db
      .select({
        orgId: schema.organizations.id,
        organizationName: schema.organizations.name,
        plan: schema.organizations.plan,
        workspaceId: schema.workspaces.id,
        workspaceName: schema.workspaces.name,
        workspaceSlug: schema.workspaces.slug,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.workspaces.orgId)
      )
      .where(eq(schema.workspaces.slug, slug));
    if (rows.length !== 1) {
      throw new StagingExecuteGrantAdministrationError(
        "TARGET_WORKSPACE_AMBIGUOUS",
        `Expected exactly one workspace for slug ${slug}; found ${rows.length}`
      );
    }
    const target = rows[0]!;
    const members = await this.db
      .select({
        userId: schema.workspaceMembers.userId,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.orgId, target.orgId),
          eq(schema.workspaceMembers.workspaceId, target.workspaceId)
        )
      );
    return { ...target, members };
  }

  async inspect(
    target: StagingExecuteGrantTarget,
    now: string
  ): Promise<StagingExecuteGrantInspection> {
    assertStagingTarget(target);
    const rows = await this.db
      .select({
        orgId: schema.organizations.id,
        organizationName: schema.organizations.name,
        plan: schema.organizations.plan,
        workspaceId: schema.workspaces.id,
        workspaceName: schema.workspaces.name,
        workspaceSlug: schema.workspaces.slug,
        actorUserId: schema.workspaceMembers.userId,
        actorWorkspaceRole: schema.workspaceMembers.role,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.organizations,
        eq(schema.organizations.id, schema.workspaces.orgId)
      )
      .innerJoin(
        schema.workspaceMembers,
        and(
          eq(schema.workspaceMembers.orgId, schema.organizations.id),
          eq(schema.workspaceMembers.workspaceId, schema.workspaces.id),
          eq(schema.workspaceMembers.userId, target.actorUserId)
        )
      )
      .where(
        and(
          eq(schema.organizations.id, target.orgId),
          eq(schema.workspaces.id, target.workspaceId)
        )
      );
    if (rows.length !== 1 || rows[0]!.actorUserId !== target.actorUserId) {
      throw new StagingExecuteGrantAdministrationError(
        "TARGET_IDENTITY_INVALID",
        "Organization, workspace, and actor membership did not resolve to one exact STAGING target"
      );
    }

    const projection = await this.entitlements.rebuildEffectiveProjection({
      orgId: target.orgId,
      workspaceId: target.workspaceId,
      projectedAt: now,
      now,
    });
    const executeEntry = projection.entries.find(
      (entry) => entry.capabilityKey === STAGING_EXECUTE_CAPABILITY
    );
    const activeExecuteGrant = executeEntry
      ? await this.entitlements.getGrantById(executeEntry.entitlementGrantId)
      : null;
    const row = rows[0]!;
    return {
      environment: "STAGING",
      orgId: row.orgId,
      organizationName: row.organizationName,
      plan: row.plan,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      workspaceSlug: row.workspaceSlug,
      actorUserId: target.actorUserId,
      actorWorkspaceRole: row.actorWorkspaceRole,
      accessGranted: effectiveProjectionHasCapability(
        projection,
        "ai_story.access"
      ),
      executeGranted: effectiveProjectionHasCapability(
        projection,
        STAGING_EXECUTE_CAPABILITY
      ),
      activeExecuteGrant,
      projection,
    };
  }

  async grant(
    target: StagingExecuteGrantTarget,
    grantedAt: string
  ): Promise<StagingExecuteGrantResult> {
    const before = await this.inspect(target, grantedAt);
    if (before.executeGranted) {
      if (
        before.activeExecuteGrant?.sourceReference ===
        `ticket:${STAGING_EXECUTE_GRANT_TICKET}`
      ) {
        return {
          grant: before.activeExecuteGrant,
          projection: before.projection,
          replayed: true,
        };
      }
      throw new StagingExecuteGrantAdministrationError(
        "DUPLICATE_ACTIVE_EXECUTE_GRANT",
        "Target already has effective ai_story.execute authority from another source"
      );
    }

    const grant = buildEntitlementGrant({
      orgId: target.orgId,
      workspaceId: target.workspaceId,
      capabilityKey: STAGING_EXECUTE_CAPABILITY,
      source: "INTERNAL",
      sourceReference: `ticket:${STAGING_EXECUTE_GRANT_TICKET}`,
      reason: target.reason,
      grantedByUserId: target.actorUserId,
      grantedAt,
      expiresAt: null,
      identitySeed: `STAGING:${target.orgId}:${target.workspaceId}:${STAGING_EXECUTE_CAPABILITY}:${STAGING_EXECUTE_GRANT_TICKET}`,
    });
    const accepted = await this.entitlements.acceptOrConvergeGrant(grant);
    const projection = await this.entitlements.rebuildEffectiveProjection({
      orgId: target.orgId,
      workspaceId: target.workspaceId,
      projectedAt: grantedAt,
      now: grantedAt,
    });
    if (!effectiveProjectionHasCapability(projection, STAGING_EXECUTE_CAPABILITY)) {
      throw new StagingExecuteGrantAdministrationError(
        "EFFECTIVE_PROJECTION_FAILED",
        "Persisted grant did not resolve through the canonical effective projection"
      );
    }
    return { grant: accepted.value, projection, replayed: accepted.replayed };
  }

  async revoke(
    target: StagingExecuteGrantTarget,
    input: { grantId: string; revokedAt: string; reason: string }
  ): Promise<StagingExecuteRevokeResult> {
    const before = await this.inspect(target, input.revokedAt);
    const grant = await this.entitlements.getGrantById(input.grantId);
    if (
      !grant ||
      grant.orgId !== target.orgId ||
      grant.workspaceId !== target.workspaceId ||
      grant.capabilityKey !== STAGING_EXECUTE_CAPABILITY
    ) {
      throw new StagingExecuteGrantAdministrationError(
        "REVOKE_TARGET_INVALID",
        "Revocation must target the exact STAGING workspace ai_story.execute grant"
      );
    }
    if (
      before.activeExecuteGrant &&
      before.activeExecuteGrant.entitlementGrantId !== grant.entitlementGrantId
    ) {
      throw new StagingExecuteGrantAdministrationError(
        "REVOKE_ACTIVE_GRANT_MISMATCH",
        "The requested grant is not the target workspace's current execute authority"
      );
    }
    const revocation = buildEntitlementRevocation({
      grant,
      reason: input.reason,
      revokedByUserId: target.actorUserId,
      revokedAt: input.revokedAt,
    });
    const accepted = await this.entitlements.acceptOrConvergeRevocation(
      revocation
    );
    const projection = await this.entitlements.rebuildEffectiveProjection({
      orgId: target.orgId,
      workspaceId: target.workspaceId,
      projectedAt: input.revokedAt,
      now: input.revokedAt,
    });
    return {
      revocation: accepted.value,
      projection,
      replayed: accepted.replayed,
    };
  }
}
