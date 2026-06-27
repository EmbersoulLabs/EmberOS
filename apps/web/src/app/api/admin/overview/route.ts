import { requireSuperAdmin, SuperAdminError } from "@/lib/require-superadmin";
import { handleApiError, AuthError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { fetchAdminOverview } from "@/lib/admin-overview";

export async function GET() {
  try {
    await requireSuperAdmin();
    const overview = await fetchAdminOverview();
    return apiSuccess(overview);
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
