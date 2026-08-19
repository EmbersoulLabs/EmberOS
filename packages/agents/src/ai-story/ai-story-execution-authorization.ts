/**
 * EXEC-03 — canonical AI Story Execute product authorization.
 *
 * Selects ops/non-commercial settlement only from server-derived product class.
 * Never converts billing failure into authorization.
 * Client role / accessMode / settlementMode are ignored.
 */
import {
  AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION,
  AiStoryExecutionDeniedError,
  asOrganizationsPlanCompatibilityProjection,
  type AiStoryExecutionAuthorization,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { planMappingIncludesCapability } from "@ceo-agent/shared/server";
import {
  PlatformAdminRepositoryImpl,
  ROLE_HIERARCHY,
  WorkspaceAccessError,
  getOrganizationPlan,
  requireWorkspaceRole,
  resolvePlatformAdminAccess,
  type PlatformAdminResolution,
} from "@ceo-agent/db";

export { AiStoryExecutionDeniedError };

const WORKSPACE_ROLES = new Set<string>(Object.keys(ROLE_HIERARCHY));

export type AuthorizeAiStoryExecutionInput = {
  readonly user: { readonly id: string; readonly email?: string | null };
  readonly orgId: string;
  readonly workspaceId: string;
  readonly minRole: WorkspaceRole;
  /** Ignored. Present so tests can prove client claims are not trusted. */
  readonly clientClaims?: unknown;
};

type AuthorizeAiStoryExecutionDependencies = {
  readonly requireWorkspaceRole: typeof requireWorkspaceRole;
  readonly resolvePlatformAdmin: (user: {
    readonly id: string;
    readonly email?: string | null;
  }) => Promise<PlatformAdminResolution>;
  readonly getOrganizationPlan: typeof getOrganizationPlan;
};

const defaultDependencies: AuthorizeAiStoryExecutionDependencies = {
  requireWorkspaceRole,
  async resolvePlatformAdmin(user) {
    return resolvePlatformAdminAccess({
      userId: user.id,
      email: user.email,
      repository: new PlatformAdminRepositoryImpl(),
    });
  },
  getOrganizationPlan,
};

function deny(): never {
  throw new AiStoryExecutionDeniedError();
}

function opsAuthorization(
  authorizedBy: AiStoryExecutionAuthorization["authorizedBy"],
  reason: string
): AiStoryExecutionAuthorization {
  return {
    allowed: true,
    accessMode: "ops",
    settlementMode: "none",
    authorizedBy,
    policyVersion: AI_STORY_EXECUTION_AUTHORIZATION_POLICY_VERSION,
    reason,
    providerCostAccounting: "ALLOWED",
  };
}

/**
 * Canonical Execute product authorization.
 * Super Admin (ACTIVE grant) and Agency plan capability → ops / no settlement.
 * Free / Pro / Pro Plus and unknown classes → denied.
 */
export async function authorizeAiStoryExecution(
  input: AuthorizeAiStoryExecutionInput,
  dependencies: AuthorizeAiStoryExecutionDependencies = defaultDependencies
): Promise<AiStoryExecutionAuthorization> {
  void input.clientClaims;

  const platformAdmin = await dependencies.resolvePlatformAdmin({
    id: input.user.id,
    email: input.user.email ?? undefined,
  });

  if (platformAdmin.status === "ACTIVE_GRANT") {
    return opsAuthorization(
      "ACTIVE_PLATFORM_ADMIN",
      "Active Platform Super Admin grant authorizes ops execution without commercial settlement"
    );
  }

  let membership: { orgId: string; workspaceId: string; role: string };
  try {
    membership = await dependencies.requireWorkspaceRole(
      input.workspaceId,
      input.user.id,
      input.minRole
    );
  } catch (error) {
    if (error instanceof WorkspaceAccessError) deny();
    throw error;
  }

  if (membership.orgId !== input.orgId) deny();
  if (membership.workspaceId !== input.workspaceId) deny();
  if (!WORKSPACE_ROLES.has(membership.role)) deny();

  const plan = await dependencies.getOrganizationPlan(input.orgId);
  const compatibility = asOrganizationsPlanCompatibilityProjection(plan);
  if (
    planMappingIncludesCapability(
      compatibility.normalizedPlan,
      "ai_story.execute"
    )
  ) {
    return opsAuthorization(
      "AGENCY_PLAN_CAPABILITY",
      "Agency plan capability mapping authorizes non-commercial self-use execution"
    );
  }

  deny();
}
