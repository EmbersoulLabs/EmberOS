import {
  EntitlementRepositoryImpl,
  getOrganizationPlan,
  requireWorkspaceRole,
} from "@ceo-agent/db";
import {
  asOrganizationsPlanCompatibilityProjection,
  effectiveProjectionHasCapability,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { planMappingIncludesCapability } from "@ceo-agent/shared/server";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";

export type AiStoryAccessAuthorization =
  | { readonly allowedBy: "ACTIVE_PLATFORM_ADMIN" }
  | { readonly allowedBy: "AGENCY_PLAN_CAPABILITY" }
  | { readonly allowedBy: "EFFECTIVE_ENTITLEMENT" };

export class AiStoryAccessDeniedError extends Error {
  readonly code = "AI_STORY_ACCESS_DENIED";

  constructor() {
    super("AI Story access denied");
    this.name = "AiStoryAccessDeniedError";
  }
}

type AiStoryAccessDependencies = {
  readonly requireWorkspaceRole: typeof requireWorkspaceRole;
  readonly resolvePlatformAdmin: typeof resolvePlatformAdminForUser;
  readonly entitlementRepository: Pick<
    EntitlementRepositoryImpl,
    "rebuildEffectiveProjection"
  >;
  readonly getOrganizationPlan: typeof getOrganizationPlan;
  readonly now: () => string;
};

const defaultDependencies: AiStoryAccessDependencies = {
  requireWorkspaceRole,
  resolvePlatformAdmin: resolvePlatformAdminForUser,
  get entitlementRepository() {
    return new EntitlementRepositoryImpl();
  },
  getOrganizationPlan,
  now: () => new Date().toISOString(),
};

/**
 * Canonical AI Story product-entry authorization.
 *
 * ACTIVE persistent Platform Admin authority is an explicit operational
 * override. Agency product class uses the versioned plan capability mapping
 * against organizations.plan as a compatibility projection only — not Stripe
 * or subscription authority. Other customer classes require workspace
 * membership plus ai_story.access in the rebuilt entitlement projection.
 * Browser claims are never consulted.
 */
export async function authorizeAiStoryAccess(
  input: {
    readonly user: { readonly id: string; readonly email?: string | null };
    readonly orgId: string;
    readonly workspaceId: string;
    readonly minRole: WorkspaceRole;
  },
  dependencies: AiStoryAccessDependencies = defaultDependencies
): Promise<AiStoryAccessAuthorization> {
  const platformAdmin = await dependencies.resolvePlatformAdmin({
    id: input.user.id,
    email: input.user.email ?? undefined,
  });
  if (platformAdmin.status === "ACTIVE_GRANT") {
    return { allowedBy: "ACTIVE_PLATFORM_ADMIN" };
  }

  const membership = await dependencies.requireWorkspaceRole(
    input.workspaceId,
    input.user.id,
    input.minRole
  );
  if (membership.orgId !== input.orgId) {
    throw new AiStoryAccessDeniedError();
  }

  const plan = await dependencies.getOrganizationPlan(input.orgId);
  const compatibility = asOrganizationsPlanCompatibilityProjection(plan);
  if (planMappingIncludesCapability(compatibility.normalizedPlan, "ai_story.access")) {
    return { allowedBy: "AGENCY_PLAN_CAPABILITY" };
  }

  const projectedAt = dependencies.now();
  const projection = await dependencies.entitlementRepository.rebuildEffectiveProjection({
    orgId: input.orgId,
    workspaceId: input.workspaceId,
    projectedAt,
    now: projectedAt,
  });

  if (!effectiveProjectionHasCapability(projection, "ai_story.access")) {
    throw new AiStoryAccessDeniedError();
  }

  return { allowedBy: "EFFECTIVE_ENTITLEMENT" };
}
