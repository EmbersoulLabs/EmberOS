import { describe, expect, it, vi } from "vitest";
import {
  buildPlatformAdminAssignment,
  createTrustedAdminCommandContext,
  type AdminAuditEvent,
  type PlatformAdminAssignment,
  type PlatformAdminRevocation,
} from "@ceo-agent/shared/server";
import {
  PlatformAdminManagementService,
  assertWave6RecoveryHardGuard,
  WAVE6_ORPHAN_GRANT,
  WAVE6_ORPHAN_USER,
  WAVE6_RECOVERY_TICKET,
  WAVE6_STAGING_PROJECT,
  WAVE6_TARGET_EMAIL,
} from "@ceo-agent/db";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-28T00:00:00.000Z";

function actorAssignment(): PlatformAdminAssignment {
  return buildPlatformAdminAssignment({
    userId: ACTOR_ID,
    grantedAt: NOW,
    reason: "test actor",
    identitySeed: "wave6-management-test-actor",
  });
}

function context(commandType: string, idempotencyKey: string) {
  const activeAssignment = actorAssignment();
  return createTrustedAdminCommandContext({
    actorUserId: ACTOR_ID,
    activeAssignment,
    requestId: `request:${idempotencyKey}`,
    idempotencyKey,
    reason: "bounded test",
    commandType,
    authenticatedAt: NOW,
  });
}

function dependencies() {
  const grants = new Map<string, PlatformAdminAssignment>([
    [actorAssignment().platformAdminAssignmentId, actorAssignment()],
  ]);
  const revocations = new Map<string, PlatformAdminRevocation>();
  const audits = new Map<string, AdminAuditEvent>();
  return {
    grants,
    revocations,
    audits,
    platformAdmins: {
      countAcceptedGrants: vi.fn(async () => grants.size),
      hasAnyAcceptedGrant: vi.fn(async () => grants.size > 0),
      getGrantByAssignmentId: vi.fn(async (id: string) => grants.get(id) ?? null),
      getActiveGrantForUser: vi.fn(async (userId: string) =>
        [...grants.values()].find((x) => x.userId === userId && x.status === "ACTIVE") ?? null
      ),
      listGrantsForUser: vi.fn(async (userId: string) =>
        [...grants.values()].filter((x) => x.userId === userId)
      ),
      acceptOrConvergeGrant: vi.fn(async (assignment: PlatformAdminAssignment) => {
        const existing = grants.get(assignment.platformAdminAssignmentId);
        if (!existing) grants.set(assignment.platformAdminAssignmentId, assignment);
        return { value: existing ?? assignment, replayed: Boolean(existing) };
      }),
      acceptBootstrapGrant: vi.fn(),
      acceptOrConvergeRevocation: vi.fn(async (revocation: PlatformAdminRevocation) => {
        const existing = revocations.get(revocation.platformAdminAssignmentId);
        if (!existing) {
          revocations.set(revocation.platformAdminAssignmentId, revocation);
          const grant = grants.get(revocation.platformAdminAssignmentId)!;
          grants.set(grant.platformAdminAssignmentId, { ...grant, status: "REVOKED" });
        }
        return { value: existing ?? revocation, replayed: Boolean(existing) };
      }),
      getRevocationByAssignmentId: vi.fn(async (id: string) => revocations.get(id) ?? null),
    },
    audit: {
      getByAdminAuditEventId: vi.fn(async (id: string) => audits.get(id) ?? null),
      listByCommandId: vi.fn(async (id: string) =>
        [...audits.values()].filter((x) => x.commandId === id)
      ),
      listByActorUserId: vi.fn(async (id: string) =>
        [...audits.values()].filter((x) => x.actorUserId === id)
      ),
      acceptOrConverge: vi.fn(async (event: AdminAuditEvent) => {
        const existing = audits.get(event.adminAuditEventId);
        if (!existing) audits.set(event.adminAuditEventId, event);
        return { value: existing ?? event, replayed: Boolean(existing) };
      }),
    },
  };
}

describe("post-bootstrap Platform Admin management", () => {
  it("requires trusted ACTIVE actor authority and converges grant replay", async () => {
    const deps = dependencies();
    const service = new PlatformAdminManagementService({ ...deps, now: () => NOW });
    const command = context("PLATFORM_ADMIN_GRANT", "grant-target");

    const first = await service.grantExistingUser({ context: command, targetUserId: TARGET_ID });
    const second = await service.grantExistingUser({ context: command, targetUserId: TARGET_ID });

    expect(first).toEqual(second);
    expect(first.userId).toBe(TARGET_ID);
    expect(first.status).toBe("ACTIVE");
    expect(deps.grants.size).toBe(2);
    expect(deps.audits.size).toBe(2);
  });

  it("revokes through the canonical immutable revocation lifecycle", async () => {
    const deps = dependencies();
    const service = new PlatformAdminManagementService({ ...deps, now: () => NOW });
    const target = await service.grantExistingUser({
      context: context("PLATFORM_ADMIN_GRANT", "grant-for-revoke"),
      targetUserId: TARGET_ID,
    });
    const revoked = await service.revokeGrant({
      context: context("PLATFORM_ADMIN_REVOKE", "revoke-target"),
      platformAdminAssignmentId: target.platformAdminAssignmentId,
    });

    expect(revoked.platformAdminAssignmentId).toBe(target.platformAdminAssignmentId);
    expect(deps.grants.get(target.platformAdminAssignmentId)?.status).toBe("REVOKED");
    expect(deps.revocations.size).toBe(1);
  });

  it("fails closed when the actor grant is no longer ACTIVE", async () => {
    const deps = dependencies();
    const actor = actorAssignment();
    deps.grants.set(actor.platformAdminAssignmentId, { ...actor, status: "REVOKED" });
    const service = new PlatformAdminManagementService({ ...deps, now: () => NOW });

    await expect(
      service.grantExistingUser({
        context: context("PLATFORM_ADMIN_GRANT", "stale-actor"),
        targetUserId: TARGET_ID,
      })
    ).rejects.toMatchObject({ code: "PLATFORM_ADMIN_GRANT_INACTIVE" });
  });
});

describe("Wave 6 break-glass hard guard", () => {
  const valid = {
    environment: "STAGING",
    projectId: WAVE6_STAGING_PROJECT,
    ticketId: WAVE6_RECOVERY_TICKET,
    orphanGrantId: WAVE6_ORPHAN_GRANT,
    orphanUserId: WAVE6_ORPHAN_USER,
    targetEmail: WAVE6_TARGET_EMAIL,
    reason: "test",
    occurredAt: NOW,
  };

  it("accepts only the exact certified facts", () => {
    expect(() => assertWave6RecoveryHardGuard(valid)).not.toThrow();
  });

  it.each([
    ["environment", "PRODUCTION"],
    ["projectId", "wrong-project"],
    ["ticketId", "wrong-ticket"],
    ["orphanGrantId", "11111111-1111-4111-8111-111111111111"],
    ["orphanUserId", "11111111-1111-4111-8111-111111111111"],
    ["targetEmail", "other@example.com"],
  ])("denies a %s mismatch", (field, value) => {
    expect(() =>
      assertWave6RecoveryHardGuard({ ...valid, [field]: value })
    ).toThrow(/hard guard|denied|mismatch/i);
  });
});
