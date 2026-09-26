import {
  getOrganizationPlan,
  requireWorkspaceRole,
} from "@ceo-agent/db";
import {
  asOrganizationsPlanCompatibilityProjection,
  type WorkspaceRole,
} from "@ceo-agent/shared";
import { planMappingIncludesCapability } from "@ceo-agent/shared/server";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";
import { requireWorkspaceResourceAuthority } from "@/lib/workspace-resource-authority";
import { requireControlledSelfUseWorkspaceOperator } from "@/lib/controlled-self-use-workspace-access";

export type AiStoryAccessAuthorization =
  | { readonly allowedBy: "ACTIVE_PLATFORM_ADMIN" }
  | { readonly allowedBy: "AGENCY_PLAN_CAPABILITY" };

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
  readonly getOrganizationPlan: typeof getOrganizationPlan;
};

const defaultDependencies: AiStoryAccessDependencies = {
  requireWorkspaceRole,
  resolvePlatformAdmin: resolvePlatformAdminForUser,
  getOrganizationPlan,
};

/**
 * Canonical AI Story product-entry authorization.
 *
 * ACTIVE persistent Platform Admin authority is an explicit operational
 * override. Agency product class uses the versioned plan capability mapping
 * against organizations.plan as a compatibility projection only — not Stripe
 * or subscription authority. Other customer classes cannot enter AI Story,
 * even with an explicit entitlement. Browser claims are never consulted.
 */
export async function authorizeAiStoryAccess(
  input: {
    readonly user: { readonly id: string; readonly email?: string | null };
    readonly orgId: string;
    readonly workspaceId: string;
    readonly minRole: WorkspaceRole;
    readonly request?: Request;
  },
  dependencies: AiStoryAccessDependencies = defaultDependencies
): Promise<AiStoryAccessAuthorization> {
  const platformAdmin = await dependencies.resolvePlatformAdmin({
    id: input.user.id,
    email: input.user.email ?? undefined,
  });
  if (platformAdmin.status === "ACTIVE_GRANT") {
    if (input.request) {
      if (process.env.AI_STORY_PROVIDER_DISPATCH_MODE === "allowlisted_self_use") {
        await requireControlledSelfUseWorkspaceOperator({
          request: input.request,
          userId: input.user.id,
          workspaceId: input.workspaceId,
          capabilityKey: "ai_story.plan",
          providerKey: "openai",
        });
      } else {
        await requireWorkspaceResourceAuthority({
          request: input.request,
          userId: input.user.id,
          resourceWorkspaceId: input.workspaceId,
        });
      }
    }
    return { allowedBy: "ACTIVE_PLATFORM_ADMIN" };
  }

  if (input.request) {
    await requireWorkspaceResourceAuthority({
      request: input.request,
      userId: input.user.id,
      resourceWorkspaceId: input.workspaceId,
    });
  }

  const membership = await dependencies.requireWorkspaceRole(
    input.workspaceId,
    input.user.id,
    input.minRole
  );
  if (membership.orgId !== input.orgId || membership.workspaceId !== input.workspaceId) {
    throw new AiStoryAccessDeniedError();
  }

  const plan = await dependencies.getOrganizationPlan(input.orgId);
  const compatibility = asOrganizationsPlanCompatibilityProjection(plan);
  if (planMappingIncludesCapability(compatibility.normalizedPlan, "ai_story.access")) {
    return { allowedBy: "AGENCY_PLAN_CAPABILITY" };
  }

  throw new AiStoryAccessDeniedError();
}
