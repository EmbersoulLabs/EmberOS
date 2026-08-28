import {
  PlatformAdminRepositoryImpl,
  closeDb,
  recoverWave6OrphanedPlatformAdminGrant,
  resolvePlatformAdminAccess,
  WAVE6_ORPHAN_GRANT,
  WAVE6_ORPHAN_USER,
  WAVE6_RECOVERY_TICKET,
  WAVE6_STAGING_PROJECT,
  WAVE6_TARGET_EMAIL,
} from "@ceo-agent/db";

function requireRecoveryDatabaseUrl(): string {
  const value = process.env.STAGING_PLATFORM_ADMIN_RECOVERY_DATABASE_URL;
  if (!value) throw new Error("Recovery database URL is missing");
  const parsed = new URL(value);
  const identity = `${parsed.hostname}/${decodeURIComponent(parsed.username)}`;
  if (!identity.includes(WAVE6_STAGING_PROJECT)) {
    throw new Error("Recovery database URL is not bound to the certified Staging project");
  }
  if (!decodeURIComponent(parsed.username).startsWith("emberos_staging_platform_admin_recovery")) {
    throw new Error("Recovery database URL does not use the temporary recovery role");
  }
  return value;
}

async function main() {
  const databaseUrl = requireRecoveryDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  process.env.EMBEROS_ENVIRONMENT = "STAGING";

  const result = await recoverWave6OrphanedPlatformAdminGrant({
    environment: "STAGING",
    projectId: WAVE6_STAGING_PROJECT,
    ticketId: WAVE6_RECOVERY_TICKET,
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
    const message = error instanceof Error ? error.message : "Unknown recovery failure";
    process.stderr.write(`WAVE6_STAGING_RECOVERY_FAILED: ${message}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
    delete process.env.DATABASE_URL;
    delete process.env.STAGING_PLATFORM_ADMIN_RECOVERY_DATABASE_URL;
  });
