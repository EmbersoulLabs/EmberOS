import {
  getBusinessProfileByWorkspace,
  requireWorkspaceRole,
  updateBusinessProfile,
} from "@ceo-agent/db";
import {
  assessBusinessProfileCompletion,
  BusinessProfileUpdateSchema,
  isUuid,
  normalizeBusinessProfileRecord,
} from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";
import { businessProfileQualityWarnings } from "@/lib/business-profile-warnings";

function profileResponse(raw: Record<string, unknown>) {
  const profile = normalizeBusinessProfileRecord(raw);
  const completion = assessBusinessProfileCompletion(profile);
  const warnings = businessProfileQualityWarnings(completion);
  return {
    profile,
    completion,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const row = await getBusinessProfileByWorkspace(workspaceId);
    if (!row) {
      return apiError("Business profile not found", "NOT_FOUND", 404);
    }

    return apiSuccess(profileResponse(row as Record<string, unknown>));
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

    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 400);
    }

    const parsed = BusinessProfileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid business profile update";
      return apiError(message, "VALIDATION_ERROR", 400);
    }

    try {
      const row = await updateBusinessProfile(
        member.orgId,
        workspaceId,
        user.id,
        parsed.data
      );
      return apiSuccess(profileResponse(row as Record<string, unknown>));
    } catch (error) {
      if ((error as Error & { code?: string }).code === "VERSION_CONFLICT") {
        return apiError(
          "Business profile was updated elsewhere",
          "VERSION_CONFLICT",
          409
        );
      }
      throw error;
    }
  } catch (error) {
    return handleApiError(error);
  }
}
