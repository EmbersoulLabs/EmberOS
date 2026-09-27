import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  PlatformAdminGrantManagementError,
  PlatformAdminGrantManagementService,
  PlatformAdminRepositoryImpl,
  closeDb,
} from "@ceo-agent/db";
import {
  buildPlatformAdminAssignment,
  buildPlatformAdminRevocation,
  createTrustedAdminCommandContext,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl()
  ? describe
  : describe.skip;

describeIntegration("Platform Super Admin grant management", () => {
  let sqlClient: Sql;
  const userIds = new Set<string>();

  beforeAll(async () => {
    sqlClient = createIntegrationSql();
    await sqlClient.unsafe(
      readFileSync("packages/db/sql/platform-admin-v1.sql", "utf8")
    );
    await sqlClient.unsafe(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY
      );
    `);
  });

  afterEach(async () => {
    if (userIds.size === 0) return;
    const ids = [...userIds];
    await sqlClient`delete from admin_audit_events where actor_user_id in ${sqlClient(ids)} or target_id in ${sqlClient(ids)}`;
    await sqlClient`delete from platform_admin_revocations where user_id in ${sqlClient(ids)}`;
    await sqlClient`delete from platform_admin_grants where user_id in ${sqlClient(ids)}`;
    await sqlClient`delete from workspace_members where user_id in ${sqlClient(ids)}`;
    await sqlClient`delete from organization_members where user_id in ${sqlClient(ids)}`;
    await sqlClient`delete from auth.users where id in ${sqlClient(ids)}`;
    userIds.clear();
  });

  afterAll(async () => {
    await closeDb();
    await sqlClient?.end();
  });

  async function authUser() {
    const id = crypto.randomUUID();
    userIds.add(id);
    await sqlClient`insert into auth.users (id) values (${id}::uuid) on conflict (id) do nothing`;
    return id;
  }

  async function activeAdmin(seed: string) {
    const userId = await authUser();
    const assignment = buildPlatformAdminAssignment({
      userId,
      grantedAt: "2026-09-27T00:00:00.000Z",
      grantedByUserId: null,
      reason: `test actor ${seed}`,
      identitySeed: `test-actor:${seed}:${userId}`,
    });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);
    return { userId, assignment };
  }

  function context(
    actor: Awaited<ReturnType<typeof activeAdmin>>,
    commandType: string,
    idempotencyKey = crypto.randomUUID()
  ) {
    return createTrustedAdminCommandContext({
      actorUserId: actor.userId,
      activeAssignment: actor.assignment,
      requestId: crypto.randomUUID(),
      idempotencyKey,
      reason: `test ${commandType}`,
      commandType,
      authenticatedAt: "2026-09-27T00:01:00.000Z",
    });
  }

  it("allows an ACTIVE admin to grant with atomic durable audit and no tenant membership", async () => {
    const actor = await activeAdmin("grant");
    const targetUserId = await authUser();
    const result = await new PlatformAdminGrantManagementService()
      .grantPlatformSuperAdmin({
        context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT"),
        targetUserId,
        reason: "authorized promotion",
        occurredAt: "2026-09-27T00:02:00.000Z",
      });

    expect(result.assignment.userId).toBe(targetUserId);
    expect(result.assignment.status).toBe("ACTIVE");
    expect(result.assignment.grantedByUserId).toBe(actor.userId);
    expect(result.auditEvent.action).toBe("PLATFORM_SUPER_ADMIN_GRANT");
    expect(result.auditEvent.targetId).toBe(targetUserId);
    const rows = await sqlClient<{ grants: number; audits: number; memberships: number }[]>`
      select
        (select count(*) from platform_admin_grants where user_id=${targetUserId}::uuid)::int grants,
        (select count(*) from admin_audit_events where target_id=${targetUserId})::int audits,
        ((select count(*) from organization_members where user_id=${targetUserId}::uuid) +
         (select count(*) from workspace_members where user_id=${targetUserId}::uuid))::int memberships
    `;
    expect(rows[0]).toMatchObject({ grants: 1, audits: 1, memberships: 0 });
  });

  it("fails closed for non-admin or revoked actor without authority mutation", async () => {
    const actorUserId = await authUser();
    const targetUserId = await authUser();
    const unpersisted = buildPlatformAdminAssignment({
      userId: actorUserId,
      grantedAt: "2026-09-27T00:00:00.000Z",
      reason: "unpersisted browser-like authority",
      identitySeed: `unpersisted:${actorUserId}`,
    });
    const untrustedDurableContext = createTrustedAdminCommandContext({
      actorUserId,
      activeAssignment: unpersisted,
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      reason: "must fail",
      commandType: "PLATFORM_SUPER_ADMIN_GRANT",
      authenticatedAt: "2026-09-27T00:01:00.000Z",
    });

    await expect(new PlatformAdminGrantManagementService().grantPlatformSuperAdmin({
      context: untrustedDurableContext,
      targetUserId,
    })).rejects.toMatchObject({ code: "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE" });
    const rows = await sqlClient<{ count: number }[]>`
      select count(*)::int count from platform_admin_grants where user_id=${targetUserId}::uuid
    `;
    expect(rows[0]?.count).toBe(0);

    const active = await activeAdmin("revoked-actor");
    const revocation = buildPlatformAdminRevocation({
      assignment: active.assignment,
      revokedAt: "2026-09-27T00:02:00.000Z",
      revokedByUserId: active.userId,
      reason: "fixture revocation",
    });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeRevocation(revocation);
    await expect(new PlatformAdminGrantManagementService().grantPlatformSuperAdmin({
      context: context(active, "PLATFORM_SUPER_ADMIN_GRANT"),
      targetUserId,
    })).rejects.toMatchObject({ code: "PLATFORM_ADMIN_ACTOR_NOT_ACTIVE" });
  });

  it("converges duplicate active grants and exact command replays", async () => {
    const actor = await activeAdmin("idempotency");
    const targetUserId = await authUser();
    const key = crypto.randomUUID();
    const service = new PlatformAdminGrantManagementService();
    const first = await service.grantPlatformSuperAdmin({
      context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT", key),
      targetUserId,
      occurredAt: "2026-09-27T00:03:00.000Z",
    });
    const replay = await service.grantPlatformSuperAdmin({
      context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT", key),
      targetUserId,
      occurredAt: "2026-09-27T00:04:00.000Z",
    });
    const anotherCommand = await service.grantPlatformSuperAdmin({
      context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT"),
      targetUserId,
      occurredAt: "2026-09-27T00:05:00.000Z",
    });

    expect(replay.replayed).toBe(true);
    expect(replay.assignment.platformAdminAssignmentId)
      .toBe(first.assignment.platformAdminAssignmentId);
    expect(anotherCommand.changed).toBe(false);
    const rows = await sqlClient<{ count: number }[]>`
      select count(*)::int count from platform_admin_grants
      where user_id=${targetUserId}::uuid and status='ACTIVE'
    `;
    expect(rows[0]?.count).toBe(1);
  });

  it("re-grants a historically revoked target by appending a new generation", async () => {
    const actor = await activeAdmin("regrant");
    const targetUserId = await authUser();
    const old = buildPlatformAdminAssignment({
      userId: targetUserId,
      grantedAt: "2026-09-26T00:00:00.000Z",
      grantedByUserId: actor.userId,
      reason: "old generation",
      identitySeed: `old:${targetUserId}`,
    });
    const repository = new PlatformAdminRepositoryImpl();
    await repository.acceptOrConvergeGrant(old);
    await repository.acceptOrConvergeRevocation(buildPlatformAdminRevocation({
      assignment: old,
      revokedAt: "2026-09-26T01:00:00.000Z",
      revokedByUserId: actor.userId,
      reason: "old revocation",
    }));

    const result = await new PlatformAdminGrantManagementService()
      .grantPlatformSuperAdmin({
        context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT"),
        targetUserId,
        occurredAt: "2026-09-27T01:00:00.000Z",
      });
    expect(result.assignment.platformAdminAssignmentId)
      .not.toBe(old.platformAdminAssignmentId);
    const rows = await sqlClient<{ status: string }[]>`
      select status from platform_admin_grants where user_id=${targetUserId}::uuid order by granted_at
    `;
    expect(rows.map((row) => row.status)).toEqual(["REVOKED", "ACTIVE"]);
  });

  it("requires an ACTIVE actor for revoke, writes audit, and preserves grant history", async () => {
    const actor = await activeAdmin("revoke");
    const target = await activeAdmin("revoke-target");
    const result = await new PlatformAdminGrantManagementService()
      .revokePlatformSuperAdmin({
        context: context(actor, "PLATFORM_SUPER_ADMIN_REVOKE"),
        targetUserId: target.userId,
        reason: "authorized removal",
        occurredAt: "2026-09-27T02:00:00.000Z",
      });
    expect(result.assignment.status).toBe("REVOKED");
    expect(result.auditEvent.action).toBe("PLATFORM_SUPER_ADMIN_REVOKE");
    const rows = await sqlClient<{ grants: number; revocations: number; audits: number }[]>`
      select
        (select count(*) from platform_admin_grants where user_id=${target.userId}::uuid)::int grants,
        (select count(*) from platform_admin_revocations where user_id=${target.userId}::uuid)::int revocations,
        (select count(*) from admin_audit_events where target_id=${target.userId})::int audits
    `;
    expect(rows[0]).toMatchObject({ grants: 1, revocations: 1, audits: 1 });
  });

  it("prevents revocation of the final ACTIVE Platform Super Admin", async () => {
    const actor = await activeAdmin("last-admin");
    await expect(new PlatformAdminGrantManagementService()
      .revokePlatformSuperAdmin({
        context: context(actor, "PLATFORM_SUPER_ADMIN_REVOKE"),
        targetUserId: actor.userId,
      }))
      .rejects.toMatchObject({
        code: "PLATFORM_ADMIN_LAST_ACTIVE_CANNOT_REVOKE",
      } satisfies Partial<PlatformAdminGrantManagementError>);
  });

  it("rejects malformed and missing authenticated targets", async () => {
    const actor = await activeAdmin("invalid-target");
    const service = new PlatformAdminGrantManagementService();
    await expect(service.grantPlatformSuperAdmin({
      context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT"),
      targetUserId: "not-a-uuid",
    })).rejects.toMatchObject({ code: "PLATFORM_ADMIN_TARGET_INVALID" });
    await expect(service.grantPlatformSuperAdmin({
      context: context(actor, "PLATFORM_SUPER_ADMIN_GRANT"),
      targetUserId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "PLATFORM_ADMIN_TARGET_NOT_FOUND" });
  });
});
