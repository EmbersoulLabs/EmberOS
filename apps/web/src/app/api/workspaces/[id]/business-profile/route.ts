import {
  ensureBusinessProfileForWorkspace,
  requireWorkspaceRole,
  updateBusinessProfile,
} from "@ceo-agent/db";
import {
  assessBusinessProfileCompletion,
  BusinessProfileUpdateSchema,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const profile = normalizeBusinessProfileRecord(
      (await ensureBusinessProfileForWorkspace(member.orgId, workspaceId, user.id)) as Record<
        string,
        unknown
      >
    );
    const completion = assessBusinessProfileCompletion(profile);

    return apiSuccess({ profile, completion });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");

    const body = await request.json();
    const parsed = BusinessProfileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.message, "VALIDATION_ERROR", 400);
    }

    try {
      const profile = normalizeBusinessProfileRecord(
        (await updateBusinessProfile(member.orgId, workspaceId, user.id, parsed.data)) as Record<
          string,
          unknown
        >
      );
      const completion = assessBusinessProfileCompletion(profile);
      return apiSuccess({ profile, completion });
    } catch (error) {
      if ((error as Error & { code?: string }).code === "VERSION_CONFLICT") {
        return apiError("Business profile was updated elsewhere", "VERSION_CONFLICT", 409);
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
