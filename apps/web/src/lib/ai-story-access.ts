import {
  EntitlementRepositoryImpl,
  requireWorkspaceRole,
} from "@ceo-agent/db";
import {
  effectiveProjectionHasCapability,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";

export type AiStoryAccessAuthorization =
  | { readonly allowedBy: "ACTIVE_PLATFORM_ADMIN" }
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
  readonly now: () => string;
};

const defaultDependencies: AiStoryAccessDependencies = {
  requireWorkspaceRole,
  resolvePlatformAdmin: resolvePlatformAdminForUser,
  get entitlementRepository() {
    return new EntitlementRepositoryImpl();
  },
  now: () => new Date().toISOString(),
};

/**
 * Canonical AI Story product-entry authorization.
 *
 * ACTIVE persistent Platform Admin authority is an explicit operational
 * override. All customer access requires workspace membership followed by a
 * canonical entitlement rebuild and ai_story.access in the resulting
 * projection. Browser claims and organizations.plan are never consulted.
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
