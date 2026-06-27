import { requireSuperAdmin, SuperAdminError } from "@/lib/require-superadmin";
import { handleApiError, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { addWorkspaceMemberAdmin, listWorkspaceMembersAdmin } from "@/lib/admin-members";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const members = await listWorkspaceMembersAdmin(id);
    return apiSuccess({ members });
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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireSuperAdmin();
    const { id } = await params;
    const body = await request.json();
    const { email, role } = body as { email?: string; role?: string };

    if (!email?.trim() || !role) {
      return apiError("email and role are required", "VALIDATION_ERROR", 400);
    }

    const result = await addWorkspaceMemberAdmin(id, {
      email: email.trim(),
      role: role as import("@ceo-agent/shared").WorkspaceRole,
    });

    if ("error" in result) {
      const status =
        result.code === "NOT_FOUND" || result.code === "USER_NOT_FOUND"
          ? 404
          : result.code === "ALREADY_MEMBER"
            ? 409
            : 400;
      return apiError(result.error, result.code, status);
    }

    return apiSuccess({ member: result.member }, 201);
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
