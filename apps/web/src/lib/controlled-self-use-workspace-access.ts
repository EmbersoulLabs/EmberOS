import {
  ControlledSelfUseAuthorityService,
  PlatformAdminRepositoryImpl,
  getDb,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import { and, eq } from "drizzle-orm";
import { WORKSPACE_SLUG_HEADER, WorkspaceResourceMismatchError } from "@/lib/workspace-resource-authority";

function selectedWorkspaceSlug(request: Request): string | null {
  const explicit = request.headers.get(WORKSPACE_SLUG_HEADER)?.trim();
  if (explicit) return explicit;
  const referrer = request.headers.get("referer");
  if (!referrer) return null;
  try {
    const match = new URL(referrer).pathname.match(/^\/w\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * Mutation authority for normal workspace operators or an ACTIVE Platform
 * Super Admin operating inside an explicitly selected, Production-authorized
 * Controlled Self-Use organization. It never grants customer-org mutation.
 */
export async function requireControlledSelfUseWorkspaceOperator(input: {
  request: Request;
  userId: string;
  workspaceId: string;
  capabilityKey: "campaign.generate" | "ai_story.plan" | "ai_story.execute";
  providerKey: "openai" | "seedance";
}) {
  const slug = selectedWorkspaceSlug(input.request);
  if (!slug) throw new WorkspaceResourceMismatchError();
  const db = getDb();
  const rows = await db.select({
    id: schema.workspaces.id,
    orgId: schema.workspaces.orgId,
    slug: schema.workspaces.slug,
  }).from(schema.workspaces).where(and(
    eq(schema.workspaces.id, input.workspaceId),
    eq(schema.workspaces.slug, slug)
  )).limit(1);
  const workspace = rows[0];
  if (!workspace) throw new WorkspaceResourceMismatchError();

  try {
    const membership = await requireWorkspaceRole(input.workspaceId, input.userId, "operator");
    if (membership.orgId !== workspace.orgId) throw new WorkspaceResourceMismatchError();
    return { ...workspace, accessMode: "MEMBER" as const };
  } catch {
    const grant = await new PlatformAdminRepositoryImpl().getActiveGrantForUser(input.userId);
    if (!grant) throw new WorkspaceResourceMismatchError();
    await new ControlledSelfUseAuthorityService().assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId: workspace.orgId,
      workspaceId: workspace.id,
      capabilityKey: input.capabilityKey,
      providerKey: input.providerKey,
    });
    return { ...workspace, accessMode: "CONTROLLED_SELF_USE_ADMIN" as const };
  }
}
