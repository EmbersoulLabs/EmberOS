import "dotenv/config";
import {
  STAGING_EXECUTE_GRANT_REASON,
  StagingExecuteGrantAdministrationService,
  closeDb,
} from "../src/index";

function value(name: string): string | undefined {
  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .trim();
}

function required(name: string): string {
  const result = value(name);
  if (!result) throw new Error(`MISSING_ARGUMENT:${name}`);
  return result;
}

function safeGrant(grant: {
  entitlementGrantId: string;
  orgId: string;
  workspaceId: string | null;
  capabilityKey: string;
  source: string;
  sourceReference: string | null;
  reason: string;
  grantedByUserId: string | null;
  grantedAt: string;
  expiresAt: string | null;
  integrityHash: string;
}) {
  return grant;
}

const action = required("action").toUpperCase();
const service = new StagingExecuteGrantAdministrationService();

try {
  if (action === "RESOLVE") {
    const result = await service.resolveWorkspaceBySlug(required("workspace-slug"));
    console.log(JSON.stringify({ action, result }, null, 2));
    process.exitCode = 0;
  } else {
    const target = {
      environment: required("environment") as "STAGING",
      railwayEnvironmentName: required("railway-environment-name") as "staging",
      railwayEnvironmentId: required("railway-environment-id"),
      expectedRailwayEnvironmentId: required("expected-railway-environment-id"),
      orgId: required("org-id"),
      workspaceId: required("workspace-id"),
      actorUserId: required("actor-user-id"),
      reason: required("reason") as typeof STAGING_EXECUTE_GRANT_REASON,
    };
    const occurredAt = required("occurred-at");

    if (action === "DRY_RUN") {
      const inspection = await service.inspect(target, occurredAt);
      console.log(
        JSON.stringify(
          {
            action,
            environment: inspection.environment,
            organization: {
              id: inspection.orgId,
              name: inspection.organizationName,
              plan: inspection.plan,
            },
            workspace: {
              id: inspection.workspaceId,
              name: inspection.workspaceName,
              slug: inspection.workspaceSlug,
            },
            actor: {
              userId: inspection.actorUserId,
              workspaceRole: inspection.actorWorkspaceRole,
            },
            aiStoryAccess: inspection.accessGranted,
            aiStoryExecute: inspection.executeGranted,
            activeExecuteGrant: inspection.activeExecuteGrant
              ? safeGrant(inspection.activeExecuteGrant)
              : null,
            planMutation: false,
            roleMutation: false,
            platformAdminMutation: false,
          },
          null,
          2
        )
      );
    } else if (action === "GRANT") {
      const result = await service.grant(target, occurredAt);
      console.log(
        JSON.stringify(
          {
            action,
            grant: safeGrant(result.grant),
            effectiveCapabilities: result.projection.entries.map(
              (entry) => entry.capabilityKey
            ),
            replayed: result.replayed,
          },
          null,
          2
        )
      );
    } else if (action === "REVOKE_DRY_RUN") {
      const inspection = await service.inspect(target, occurredAt);
      const grantId = required("grant-id");
      if (
        inspection.activeExecuteGrant?.entitlementGrantId !== grantId
      ) {
        throw new Error("REVOKE_DRY_RUN_TARGET_MISMATCH");
      }
      console.log(
        JSON.stringify(
          {
            action,
            grantId,
            organizationId: inspection.orgId,
            workspaceId: inspection.workspaceId,
            capability: "ai_story.execute",
            reversible: true,
            mutationPerformed: false,
          },
          null,
          2
        )
      );
    } else if (action === "REVOKE") {
      const result = await service.revoke(target, {
        grantId: required("grant-id"),
        revokedAt: occurredAt,
        reason: required("revoke-reason"),
      });
      console.log(
        JSON.stringify(
          {
            action,
            revocation: result.revocation,
            effectiveCapabilities: result.projection.entries.map(
              (entry) => entry.capabilityKey
            ),
            replayed: result.replayed,
          },
          null,
          2
        )
      );
    } else {
      throw new Error(`UNSUPPORTED_ACTION:${action}`);
    }
  }
} finally {
  await closeDb();
}
