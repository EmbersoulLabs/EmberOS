import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  STAGING_EXECUTE_GRANT_REASON,
  StagingExecuteGrantAdministrationService,
  StagingExecuteGrantAdministrationError,
  closeDb,
  EntitlementRepositoryImpl,
} from "@ceo-agent/db";
import { effectiveProjectionHasCapability } from "@ceo-agent/shared";
import { buildEntitlementGrant } from "@ceo-agent/shared/server";
import {
  AiStoryExecutionDeniedError,
  authorizeAiStoryExecution,
} from "../packages/agents/src/ai-story/ai-story-execution-authorization";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

vi.setConfig({ testTimeout: 30_000 });

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("STAGING execute entitlement administration", () => {
  let sql: Sql;
  const orgId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const otherWorkspaceId = crypto.randomUUID();
  const actorUserId = crypto.randomUUID();
  const now = "2026-08-31T03:00:00.000Z";
  const target = {
    environment: "STAGING" as const,
    railwayEnvironmentName: "staging" as const,
    railwayEnvironmentId: "staging-environment-id",
    expectedRailwayEnvironmentId: "staging-environment-id",
    orgId,
    workspaceId,
    actorUserId,
    reason: STAGING_EXECUTE_GRANT_REASON,
  };

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${orgId}, 'Entitlement Admin Test', ${`ent-admin-${orgId}`}, 'free')
    `;
    await sql`
      INSERT INTO workspaces (id, org_id, name, slug)
      VALUES
        (${workspaceId}, ${orgId}, 'Target Workspace', ${`ent-target-${workspaceId}`}),
        (${otherWorkspaceId}, ${orgId}, 'Other Workspace', ${`ent-other-${otherWorkspaceId}`})
    `;
    await sql`
      INSERT INTO workspace_members (org_id, workspace_id, user_id, role)
      VALUES
        (${orgId}, ${workspaceId}, ${actorUserId}, 'admin'),
        (${orgId}, ${otherWorkspaceId}, ${actorUserId}, 'admin')
    `;
    const access = buildEntitlementGrant({
      orgId,
      workspaceId,
      capabilityKey: "ai_story.access",
      source: "INTERNAL",
      reason: "test access",
      grantedByUserId: actorUserId,
      grantedAt: now,
      identitySeed: `ent-admin-access:${workspaceId}`,
    });
    await new EntitlementRepositoryImpl().acceptOrConvergeGrant(access);
  });

  afterAll(async () => {
    await sql`DELETE FROM effective_entitlement_projections WHERE org_id = ${orgId}`;
    await sql`DELETE FROM entitlement_revocations WHERE org_id = ${orgId}`;
    await sql`DELETE FROM entitlement_grants WHERE org_id = ${orgId}`;
    await sql`DELETE FROM workspace_members WHERE org_id = ${orgId}`;
    await sql`DELETE FROM workspaces WHERE org_id = ${orgId}`;
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql.end({ timeout: 5 });
    await closeDb();
  });

  it("fails closed outside the exact acknowledged STAGING environment", async () => {
    const service = new StagingExecuteGrantAdministrationService();
    await expect(
      service.inspect(
        { ...target, railwayEnvironmentId: "wrong-environment" },
        now
      )
    ).rejects.toBeInstanceOf(StagingExecuteGrantAdministrationError);
  });

  it("grants idempotently, scopes execution, and revokes canonically", async () => {
    const service = new StagingExecuteGrantAdministrationService();
    const before = await service.inspect(target, now);
    expect(before.plan).toBe("free");
    expect(before.actorWorkspaceRole).toBe("admin");
    expect(before.accessGranted).toBe(true);
    expect(before.executeGranted).toBe(false);

    const granted = await service.grant(target, now);
    expect(granted.replayed).toBe(false);
    expect(granted.grant).toMatchObject({
      orgId,
      workspaceId,
      capabilityKey: "ai_story.execute",
      reason: STAGING_EXECUTE_GRANT_REASON,
      grantedByUserId: actorUserId,
    });
    expect(
      effectiveProjectionHasCapability(granted.projection, "ai_story.execute")
    ).toBe(true);

    const replay = await service.grant(target, "2026-08-31T03:01:00.000Z");
    expect(replay.replayed).toBe(true);
    expect(replay.grant.entitlementGrantId).toBe(
      granted.grant.entitlementGrantId
    );

    await expect(
      authorizeAiStoryExecution({
        user: { id: actorUserId },
        orgId,
        workspaceId,
        minRole: "client_viewer",
      })
    ).resolves.toMatchObject({
      accessMode: "commercial",
      settlementMode: "credits",
      authorizedBy: "EFFECTIVE_ENTITLEMENT",
    });
    await expect(
      authorizeAiStoryExecution({
        user: { id: actorUserId },
        orgId,
        workspaceId: otherWorkspaceId,
        minRole: "client_viewer",
      })
    ).rejects.toBeInstanceOf(AiStoryExecutionDeniedError);

    const revoked = await service.revoke(target, {
      grantId: granted.grant.entitlementGrantId,
      revokedAt: "2026-08-31T03:02:00.000Z",
      reason: "test revocation",
    });
    expect(
      effectiveProjectionHasCapability(revoked.projection, "ai_story.execute")
    ).toBe(false);
    expect(
      effectiveProjectionHasCapability(revoked.projection, "ai_story.access")
    ).toBe(true);
  });
});
