import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError } from "@/lib/auth";
import { SuperAdminError } from "@/lib/require-superadmin";
import { authorizePlatformAdminCommand } from "@/lib/platform-admin-command-authorization";
import {
  PlatformAdminGrantManagementError,
  PlatformAdminGrantManagementService,
} from "@ceo-agent/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : "platform_super_admin_revoke";
    const context = await authorizePlatformAdminCommand({
      commandType: "PLATFORM_SUPER_ADMIN_REVOKE",
      reason,
      requestId: request.headers.get("x-request-id") ?? undefined,
      idempotencyKey: request.headers.get("idempotency-key") ?? undefined,
    });
    const result = await new PlatformAdminGrantManagementService()
      .revokePlatformSuperAdmin({
        context,
        targetUserId: userId,
        reason,
      });

    return apiSuccess({
      grant: result.assignment,
      revocation: result.revocation,
      auditEvidenceId: result.auditEvent.adminAuditEventId,
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof SuperAdminError) {
      return apiError("Forbidden", "FORBIDDEN", 403);
    }
    if (error instanceof PlatformAdminGrantManagementError) {
      return apiError(error.message, error.code, error.status);
    }
    return handleApiError(error);
  }
}
