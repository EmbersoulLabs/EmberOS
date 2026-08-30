import {
  PlatformAdminRepositoryImpl,
  closeDb,
  recoverWave6OrphanedPlatformAdminGrant,
  resolvePlatformAdminAccess,
  WAVE6_EXPECTED_EXECUTION_AUTHORIZATION_TICKET,
  WAVE6_ORPHAN_GRANT,
  WAVE6_ORPHAN_USER,
  WAVE6_RECOVERY_IMPLEMENTATION_TICKET,
  WAVE6_STAGING_PROJECT,
  WAVE6_TARGET_EMAIL,
  sanitizeWave6RecoveryOperatorError,
} from "@ceo-agent/db";

function requireExecutionAuthorizationTicket(): string {
  const value = process.env.WAVE6_EXECUTION_AUTHORIZATION_TICKET_ID;
  if (!value) throw new Error("Execution authorization ticket is missing");
  if (value !== WAVE6_EXPECTED_EXECUTION_AUTHORIZATION_TICKET) {
    throw new Error("Execution authorization ticket is not the certified expected ticket");
  }
  return value;
}

function requireRecoveryDatabaseUrl(): string {
  const value = process.env.STAGING_PLATFORM_ADMIN_RECOVERY_DATABASE_URL;
  if (!value) throw new Error("Recovery database URL is missing");
  const parsed = new URL(value);
  const identity = `${parsed.hostname}/${decodeURIComponent(parsed.username)}`;
  const ephemeralCi =
    process.env.WAVE6_RECOVERY_ALLOW_EPHEMERAL === "1" &&
    process.env.EMBEROS_TEST_DB_ENVIRONMENT === "test" &&
    process.env.RUN_DB_INTEGRATION_TESTS === "1" &&
    ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) &&
    parsed.pathname === "/emberos_test";
  if (!ephemeralCi && !identity.includes(WAVE6_STAGING_PROJECT)) {
    throw new Error("Recovery database URL is not bound to the certified Staging project");
  }
  if (!decodeURIComponent(parsed.username).startsWith("emberos_staging_platform_admin_recovery")) {
    throw new Error("Recovery database URL does not use the temporary recovery role");
  }
  return value;
}

async function main() {
  const executionAuthorizationTicketId = requireExecutionAuthorizationTicket();
  const databaseUrl = requireRecoveryDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.EMBEROS_ENVIRONMENT = "STAGING";

  const result = await recoverWave6OrphanedPlatformAdminGrant({
    environment: "STAGING",
    projectId: WAVE6_STAGING_PROJECT,
    implementationTicketId: WAVE6_RECOVERY_IMPLEMENTATION_TICKET,
    executionAuthorizationTicketId,
    orphanGrantId: WAVE6_ORPHAN_GRANT,
    orphanUserId: WAVE6_ORPHAN_USER,
    targetEmail: WAVE6_TARGET_EMAIL,
    reason: "Recover certified orphaned Staging Platform Admin authority deadlock",
    occurredAt: new Date().toISOString(),
  });

  const resolution = await resolvePlatformAdminAccess({
    userId: result.targetUserId,
    email: WAVE6_TARGET_EMAIL,
    repository: new PlatformAdminRepositoryImpl(),
  });
  if (resolution.status !== "ACTIVE_GRANT") {
    throw new Error("Canonical resolver did not return ACTIVE_GRANT");
  }
  if (
    resolution.assignment.platformAdminAssignmentId !==
    result.targetAssignmentId
  ) {
    throw new Error("Canonical resolver returned an unexpected assignment");
  }

  process.stdout.write(
    JSON.stringify({
      recovered: true,
      orphanGrantStatus: result.orphanGrantStatus,
      targetGrantStatus: result.targetGrantStatus,
      activeOrphanCount: result.activeOrphanCount,
      activePlatformSuperAdminCount: result.activePlatformSuperAdminCount,
      resolver: resolution.status,
      replayed: result.replayed,
    }) + "\n"
  );
}

main()
  .catch((error) => {
    const sanitized = sanitizeWave6RecoveryOperatorError(error, { exitCode: 1 });
    process.stderr.write(
      JSON.stringify({ kind: "WAVE6_RECOVERY_OPERATOR_ERROR", ...sanitized }) + "\n"
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    delete process.env.DATABASE_URL;
    delete process.env.STAGING_PLATFORM_ADMIN_RECOVERY_DATABASE_URL;
    delete process.env.WAVE6_EXECUTION_AUTHORIZATION_TICKET_ID;
  });
