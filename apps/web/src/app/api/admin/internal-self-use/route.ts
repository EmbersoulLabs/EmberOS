import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";
import {
  ControlledSelfUseAuthorityService,
  ControlledSelfUseError,
  BillingAccountRepositoryImpl,
  getDb,
  schema,
} from "@ceo-agent/db";
import { buildBillingAccount } from "@ceo-agent/shared/server";
import { and, eq } from "drizzle-orm";

export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : "Platform Superadmin internal self-use workspace authorization";
    if (!organizationId || !workspaceId) {
      return apiError("organizationId and workspaceId are required", "INVALID_REQUEST", 400);
    }

    const [workspace] = await getDb().select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(and(eq(schema.workspaces.id, workspaceId), eq(schema.workspaces.orgId, organizationId)))
      .limit(1);
    if (!workspace) return apiError("Workspace scope not found", "WORKSPACE_NOT_FOUND", 404);

    const now = new Date().toISOString();
    const service = new ControlledSelfUseAuthorityService();
    const provisioned = await service.provisionInternalSelfUseAuthority({
      environment: "PRODUCTION",
      organizationId,
      authorizedBy: user.id,
      reason,
      createdAt: now,
    });
    await new BillingAccountRepositoryImpl().createOrConverge(buildBillingAccount({
      orgId: organizationId,
      createdAt: now,
      identitySeed: `controlled-self-use-billing:${organizationId}`,
    }));
    const scoped = await service.authorizeInternalWorkspace({
      authorityId: provisioned.authority.authorityId,
      organizationId,
      workspaceId,
      authorizedBy: user.id,
      reason,
      createdAt: now,
    });
    return apiSuccess({
      authorityId: provisioned.authority.authorityId,
      scopeId: scoped.scopeId,
      organizationId,
      workspaceId,
      maxUsdPerExecution: provisioned.authority.maxUsdPerExecution,
      dailyCapUsd: provisioned.authority.dailyCapUsd,
      maxAutomaticRetries: provisioned.authority.maxAutomaticRetries,
      replayed: provisioned.replayed && scoped.replayed,
    }, provisioned.replayed && scoped.replayed ? 200 : 201);
  } catch (error) {
    if (error instanceof ControlledSelfUseError) {
      return apiError(error.message, error.code, 403);
    }
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
    const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
    if (!organizationId || !workspaceId) return apiError("organizationId and workspaceId are required", "INVALID_REQUEST", 400);
    const result = await new ControlledSelfUseAuthorityService().revokeInternalWorkspace({
      organizationId,
      workspaceId,
      revokedBy: user.id,
      revokedAt: new Date().toISOString(),
    });
    return apiSuccess({ ...result, organizationId, workspaceId });
  } catch (error) {
    if (error instanceof ControlledSelfUseError) return apiError(error.message, error.code, 403);
    return handleApiError(error);
  }
}
