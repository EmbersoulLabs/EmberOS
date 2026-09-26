import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";
import { provisionFirstOrganizationForUser } from "@/lib/organization-provisioning";

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { name, slug: rawSlug } = body as { name: string; slug?: string };

    if (!name) return apiError("Name is required", "VALIDATION_ERROR");

    const platformAdmin = await resolvePlatformAdminForUser(user);
    if (platformAdmin.status === "ACTIVE_GRANT") {
      return apiError(
        "Platform Admins create or administer Organizations through the Control Plane",
        "PLATFORM_ADMIN_ORG_PROVISIONING_DENIED",
        403
      );
    }

    const result = await provisionFirstOrganizationForUser({
      userId: user.id,
      name,
      requestedSlug: rawSlug,
    });
    return apiSuccess({ organization: result.organization }, result.created ? 201 : 200);
  } catch (error) {
    return handleApiError(error);
  }
}
