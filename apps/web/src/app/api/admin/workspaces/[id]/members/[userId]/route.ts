import { requireSuperAdmin, SuperAdminError } from "@/lib/require-superadmin";
import { handleApiError, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import {
  updateWorkspaceMemberRoleAdmin,
  removeWorkspaceMemberAdmin,
} from "@/lib/admin-members";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id, userId } = await params;
    const body = await request.json();
    const { role } = body as { role?: string };

    if (!role) {
      return apiError("role is required", "VALIDATION_ERROR", 400);
    }

    const result = await updateWorkspaceMemberRoleAdmin(
      id,
      userId,
      role as import("@ceo-agent/shared").WorkspaceRole
    );

    if ("error" in result) {
      return apiError(result.error, result.code, result.code === "NOT_FOUND" ? 404 : 400);
    }

    return apiSuccess({ ok: true });
  } catch (error) {
    if (error instanceof SuperAdminError) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    if (error instanceof AuthError) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    return handleApiError(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id, userId } = await params;

    const result = await removeWorkspaceMemberAdmin(id, userId);

    if ("error" in result) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "LAST_ADMIN" ? 409 : 400;
      return apiError(result.error, result.code, status);
    }

    return apiSuccess({ ok: true });
  } catch (error) {
    if (error instanceof SuperAdminError) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    if (error instanceof AuthError) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }
    return handleApiError(error);
  }
}
