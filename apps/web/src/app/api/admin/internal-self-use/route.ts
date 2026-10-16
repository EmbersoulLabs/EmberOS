import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";
import {
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  getDb,
  schema,
} from "@ceo-agent/db";
import { and, eq } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!organizationId || !workspaceId) {
      return apiError("organizationId and workspaceId are required", "INVALID_REQUEST", 400);
    }

    const [workspace] = await getDb().select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .innerJoin(schema.organizationMembers, and(
        eq(schema.organizationMembers.orgId, schema.workspaces.orgId),
        eq(schema.organizationMembers.userId, user.id),
        eq(schema.organizationMembers.role, "owner")
      ))
      .where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.orgId, organizationId)))
      .limit(1);
    if (!workspace) return apiError("Owned internal Workspace scope not found", "WORKSPACE_NOT_FOUND", 404);

    const service = new ControlledSelfUseAuthorityService();
    const authority = await service.assertWorkspaceEligible({
      environment: "PRODUCTION",
      organizationId,
      workspaceId,
      capabilityKey: "ai_story.plan",
      providerKey: "openai",
      actorUserId: user.id,
    });
    return apiSuccess({
      authorityId: authority.authorityId,
      organizationId,
      workspaceId,
      scopeKind: authority.scopeKind,
      inherited: true,
      maxAutomaticRetries: authority.maxAutomaticRetries,
    });
  } catch (error) {
    if (error instanceof ControlledSelfUseError) {
      return apiError(error.message, error.code, 403);
    }
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requirePlatformAdmin();
    void request;
    return apiError(
      "Global internal self-use follows active Platform Superadmin ownership; revoke the account role or Organization ownership authority instead",
      "GLOBAL_INTERNAL_SELF_USE_SCOPE",
      409
    );
  } catch (error) {
    if (error instanceof ControlledSelfUseError) return apiError(error.message, error.code, 403);
    return handleApiError(error);
  }
}
