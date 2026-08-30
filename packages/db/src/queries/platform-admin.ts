/**
 * Sprint 4 Phase B2 — Platform Admin grant/revocation persistence.
 *
 * Accept-or-converge for identical replays. Conflicting identity → fail closed.
 * Revocation appends an immutable revocation fact and materializes grant status.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  parsePlatformAdminAssignment,
  parsePlatformAdminRevocation,
  type PlatformAdminAssignment,
  type PlatformAdminRevocation,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export type PlatformAdminPersistenceErrorCode =
  | "PLATFORM_ADMIN_IDENTITY_CONFLICT"
  | "PLATFORM_ADMIN_NOT_FOUND"
  | "PLATFORM_ADMIN_ALREADY_REVOKED"
  | "PLATFORM_ADMIN_BOOTSTRAP_CLOSED"
  | "PLATFORM_ADMIN_GRANT_INACTIVE";

export class PlatformAdminPersistenceError extends Error {
  readonly status: number;

  constructor(
    readonly code: PlatformAdminPersistenceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PlatformAdminPersistenceError";
    this.status =
      code === "PLATFORM_ADMIN_NOT_FOUND"
        ? 404
        : code === "PLATFORM_ADMIN_BOOTSTRAP_CLOSED"
          ? 403
          : 409;
  }
}

export type AcceptOrConvergeResult<T> = {
  readonly value: T;
  readonly replayed: boolean;
};

export interface PlatformAdminRepository {
  countAcceptedGrants(): Promise<number>;
  hasAnyAcceptedGrant(): Promise<boolean>;
  getGrantByAssignmentId(
    platformAdminAssignmentId: string
  ): Promise<PlatformAdminAssignment | null>;
  getActiveGrantForUser(
    userId: string
  ): Promise<PlatformAdminAssignment | null>;
  listGrantsForUser(userId: string): Promise<readonly PlatformAdminAssignment[]>;
  acceptOrConvergeGrant(
    assignment: PlatformAdminAssignment
  ): Promise<AcceptOrConvergeResult<PlatformAdminAssignment>>;
  /**
   * Bootstrap-only: accept the first persistent grant when the table is empty.
   * After any accepted grant exists, this fails closed.
   */
  acceptBootstrapGrant(
    assignment: PlatformAdminAssignment
  ): Promise<AcceptOrConvergeResult<PlatformAdminAssignment>>;
  acceptOrConvergeRevocation(
    revocation: PlatformAdminRevocation
  ): Promise<AcceptOrConvergeResult<PlatformAdminRevocation>>;
  getRevocationByAssignmentId(
    platformAdminAssignmentId: string
  ): Promise<PlatformAdminRevocation | null>;
}

function toAssignment(
  row: typeof schema.platformAdminGrants.$inferSelect
): PlatformAdminAssignment {
  const parsed = parsePlatformAdminAssignment(row.assignment);
  // Materialized status wins over embedded JSON if they ever diverge.
  return parsePlatformAdminAssignment({ ...parsed, status: row.status });
}

function toRevocation(
  row: typeof schema.platformAdminRevocations.$inferSelect
): PlatformAdminRevocation {
  return parsePlatformAdminRevocation(row.revocation);
}

function grantEquivalencePayload(assignment: PlatformAdminAssignment): unknown {
  return {
    platformAdminAssignmentId: assignment.platformAdminAssignmentId,
    userId: assignment.userId,
    platformRole: assignment.platformRole,
    grantedAt: assignment.grantedAt,
    grantedByUserId: assignment.grantedByUserId,
    reason: assignment.reason,
    integrityHash: assignment.integrityHash,
  };
}

function revocationEquivalencePayload(
  revocation: PlatformAdminRevocation
): unknown {
  return {
    platformAdminRevocationId: revocation.platformAdminRevocationId,
    platformAdminAssignmentId: revocation.platformAdminAssignmentId,
    userId: revocation.userId,
    platformRole: revocation.platformRole,
    revokedAt: revocation.revokedAt,
    revokedByUserId: revocation.revokedByUserId,
    reason: revocation.reason,
    integrityHash: revocation.integrityHash,
  };
}

function assertEquivalentGrant(
  existing: PlatformAdminAssignment,
  requested: PlatformAdminAssignment
): void {
  if (
    existing.platformAdminAssignmentId !== requested.platformAdminAssignmentId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(grantEquivalencePayload(existing)) !==
      canonicalPersistenceHash(grantEquivalencePayload(requested))
  ) {
    throw new PlatformAdminPersistenceError(
      "PLATFORM_ADMIN_IDENTITY_CONFLICT",
      "Conflicting Platform Admin grant identity replay rejected"
    );
  }
}

function assertEquivalentRevocation(
  existing: PlatformAdminRevocation,
  requested: PlatformAdminRevocation
): void {
  if (
    existing.platformAdminRevocationId !== requested.platformAdminRevocationId ||
    existing.integrityHash !== requested.integrityHash ||
    canonicalPersistenceHash(revocationEquivalencePayload(existing)) !==
      canonicalPersistenceHash(revocationEquivalencePayload(requested))
  ) {
    throw new PlatformAdminPersistenceError(
      "PLATFORM_ADMIN_IDENTITY_CONFLICT",
      "Conflicting Platform Admin revocation identity replay rejected"
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null) {
      const code = (current as { code?: unknown }).code;
      if (code === "23505") return true;
      current =
        (current as { cause?: unknown }).cause ??
        (current as { originalError?: unknown }).originalError;
      continue;
    }
    break;
  }
  return false;
}

export class PlatformAdminRepositoryImpl implements PlatformAdminRepository {
  constructor(private readonly db: Db = getDb()) {}

  async countAcceptedGrants(): Promise<number> {
    const rows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.platformAdminGrants);
    return Number(rows[0]?.count ?? 0);
  }

  async hasAnyAcceptedGrant(): Promise<boolean> {
    return (await this.countAcceptedGrants()) > 0;
  }

  async getGrantByAssignmentId(
    platformAdminAssignmentId: string
  ): Promise<PlatformAdminAssignment | null> {
    const rows = await this.db
      .select()
      .from(schema.platformAdminGrants)
      .where(
        eq(
          schema.platformAdminGrants.platformAdminAssignmentId,
          platformAdminAssignmentId
        )
      )
      .limit(1);
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async getActiveGrantForUser(
    userId: string
  ): Promise<PlatformAdminAssignment | null> {
    const rows = await this.db
      .select()
      .from(schema.platformAdminGrants)
      .where(
        and(
          eq(schema.platformAdminGrants.userId, userId),
          eq(schema.platformAdminGrants.status, "ACTIVE"),
          eq(schema.platformAdminGrants.platformRole, "PLATFORM_SUPER_ADMIN")
        )
      )
      .orderBy(desc(schema.platformAdminGrants.grantedAt))
      .limit(1);
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async listGrantsForUser(
    userId: string
  ): Promise<readonly PlatformAdminAssignment[]> {
    const rows = await this.db
      .select()
      .from(schema.platformAdminGrants)
      .where(eq(schema.platformAdminGrants.userId, userId))
      .orderBy(desc(schema.platformAdminGrants.grantedAt));
    return rows.map(toAssignment);
  }

  async acceptOrConvergeGrant(
    assignment: PlatformAdminAssignment
  ): Promise<AcceptOrConvergeResult<PlatformAdminAssignment>> {
    if (assignment.status !== "ACTIVE") {
      throw new PlatformAdminPersistenceError(
        "PLATFORM_ADMIN_GRANT_INACTIVE",
        "Only ACTIVE grants may be accepted"
      );
    }
    const existing = await this.getGrantByAssignmentId(
      assignment.platformAdminAssignmentId
    );
    if (existing) {
      assertEquivalentGrant(existing, {
        ...assignment,
        status: existing.status,
      });
      return { value: existing, replayed: true };
    }

    try {
      await this.db.insert(schema.platformAdminGrants).values({
        platformAdminAssignmentId: assignment.platformAdminAssignmentId,
        userId: assignment.userId,
        platformRole: assignment.platformRole,
        status: "ACTIVE",
        grantedAt: new Date(assignment.grantedAt),
        grantedByUserId: assignment.grantedByUserId,
        reason: assignment.reason,
        integrityHash: assignment.integrityHash,
        contractVersion: assignment.contractVersion,
        assignment,
      });
      return { value: assignment, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.getGrantByAssignmentId(
        assignment.platformAdminAssignmentId
      );
      if (!raced) {
        // Likely active (user_id, role) conflict with a different assignment id.
        const active = await this.getActiveGrantForUser(assignment.userId);
        if (active) {
          assertEquivalentGrant(active, assignment);
          return { value: active, replayed: true };
        }
        throw new PlatformAdminPersistenceError(
          "PLATFORM_ADMIN_IDENTITY_CONFLICT",
          "Platform Admin grant unique conflict without readable row"
        );
      }
      assertEquivalentGrant(raced, {
        ...assignment,
        status: raced.status,
      });
      return { value: raced, replayed: true };
    }
  }

  async acceptBootstrapGrant(
    assignment: PlatformAdminAssignment
  ): Promise<AcceptOrConvergeResult<PlatformAdminAssignment>> {
    if (await this.hasAnyAcceptedGrant()) {
      const existing = await this.getGrantByAssignmentId(
        assignment.platformAdminAssignmentId
      );
      if (existing) {
        assertEquivalentGrant(existing, {
          ...assignment,
          status: existing.status,
        });
        return { value: existing, replayed: true };
      }
      throw new PlatformAdminPersistenceError(
        "PLATFORM_ADMIN_BOOTSTRAP_CLOSED",
        "Bootstrap Platform Admin grant is closed after first accepted grant"
      );
    }

    try {
      return await this.acceptOrConvergeGrant(assignment);
    } catch (error) {
      if (await this.hasAnyAcceptedGrant()) {
        const existing = await this.getGrantByAssignmentId(
          assignment.platformAdminAssignmentId
        );
        if (existing) {
          assertEquivalentGrant(existing, {
            ...assignment,
            status: existing.status,
          });
          return { value: existing, replayed: true };
        }
        throw new PlatformAdminPersistenceError(
          "PLATFORM_ADMIN_BOOTSTRAP_CLOSED",
          "Bootstrap Platform Admin grant is closed after first accepted grant"
        );
      }
      throw error;
    }
  }

  async getRevocationByAssignmentId(
    platformAdminAssignmentId: string
  ): Promise<PlatformAdminRevocation | null> {
    const rows = await this.db
      .select()
      .from(schema.platformAdminRevocations)
      .where(
        eq(
          schema.platformAdminRevocations.platformAdminAssignmentId,
          platformAdminAssignmentId
        )
      )
      .limit(1);
    return rows[0] ? toRevocation(rows[0]) : null;
  }

  async acceptOrConvergeRevocation(
    revocation: PlatformAdminRevocation
  ): Promise<AcceptOrConvergeResult<PlatformAdminRevocation>> {
    const existingRevocation = await this.getRevocationByAssignmentId(
      revocation.platformAdminAssignmentId
    );
    if (existingRevocation) {
      assertEquivalentRevocation(existingRevocation, revocation);
      return { value: existingRevocation, replayed: true };
    }

    return this.db.transaction(async (tx) => {
      const grantRows = await tx
        .select()
        .from(schema.platformAdminGrants)
        .where(
          eq(
            schema.platformAdminGrants.platformAdminAssignmentId,
            revocation.platformAdminAssignmentId
          )
        )
        .limit(1);
      const grant = grantRows[0];
      if (!grant) {
        throw new PlatformAdminPersistenceError(
          "PLATFORM_ADMIN_NOT_FOUND",
          "Cannot revoke missing Platform Admin grant"
        );
      }
      if (grant.userId !== revocation.userId) {
        throw new PlatformAdminPersistenceError(
          "PLATFORM_ADMIN_IDENTITY_CONFLICT",
          "Revocation userId does not match grant"
        );
      }

      const priorRev = await tx
        .select()
        .from(schema.platformAdminRevocations)
        .where(
          eq(
            schema.platformAdminRevocations.platformAdminAssignmentId,
            revocation.platformAdminAssignmentId
          )
        )
        .limit(1);
      if (priorRev[0]) {
        const parsed = toRevocation(priorRev[0]);
        assertEquivalentRevocation(parsed, revocation);
        return { value: parsed, replayed: true };
      }

      try {
        await tx.insert(schema.platformAdminRevocations).values({
          platformAdminRevocationId: revocation.platformAdminRevocationId,
          platformAdminAssignmentId: revocation.platformAdminAssignmentId,
          userId: revocation.userId,
          platformRole: revocation.platformRole,
          revokedAt: new Date(revocation.revokedAt),
          revokedByUserId: revocation.revokedByUserId,
          reason: revocation.reason,
          integrityHash: revocation.integrityHash,
          contractVersion: revocation.contractVersion,
          revocation,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const raced = await tx
          .select()
          .from(schema.platformAdminRevocations)
          .where(
            eq(
              schema.platformAdminRevocations.platformAdminAssignmentId,
              revocation.platformAdminAssignmentId
            )
          )
          .limit(1);
        if (!raced[0]) {
          throw new PlatformAdminPersistenceError(
            "PLATFORM_ADMIN_IDENTITY_CONFLICT",
            "Revocation unique conflict without readable row"
          );
        }
        const parsed = toRevocation(raced[0]);
        assertEquivalentRevocation(parsed, revocation);
        return { value: parsed, replayed: true };
      }

      await tx
        .update(schema.platformAdminGrants)
        .set({ status: "REVOKED" })
        .where(
          eq(
            schema.platformAdminGrants.platformAdminAssignmentId,
            revocation.platformAdminAssignmentId
          )
        );

      return { value: revocation, replayed: false };
    });
  }
}
