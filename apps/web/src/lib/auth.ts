import { getAuthUser } from "@/lib/supabase/server";
import {
  OrganizationAccessError,
  TenantValidationError,
  WorkspaceAccessError,
} from "@ceo-agent/db";
import { apiError } from "@/lib/api";

export async function requireAuth() {
  const user = await getAuthUser();
  if (!user) {
    throw new AuthError();
  }
  return user;
}

export class AuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AuthError";
  }
}

/** Application error codes that may be returned to clients with their message. */
const APP_ERROR_HTTP_STATUS = {
  VALIDATION_ERROR: 400,
  ASSEMBLY_VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  AI_STORY_ACCESS_DENIED: 403,
  EXECUTION_PLAN_OWNERSHIP_INVALID: 403,
  EXECUTION_PLAN_REVIEW_OWNERSHIP_INVALID: 403,
  ASSEMBLY_OWNERSHIP_INVALID: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  PHASE1_EXECUTION_LOCKED: 409,
  EXECUTION_PLAN_IDENTITY_CONFLICT: 409,
  EXECUTION_PLAN_REVIEW_IDENTITY_CONFLICT: 409,
  EXECUTION_PLAN_REVIEW_STATE_INVALID: 409,
  OWNERSHIP_INTEGRITY_VIOLATION: 409,
  ASSEMBLY_IDENTITY_CONFLICT: 409,
  ASSEMBLY_STATE_INVALID: 409,
  ASSEMBLY_INTEGRITY_VIOLATION: 409,
  REVIEW_IDENTITY_CONFLICT: 409,
  REVIEW_STATE_CONFLICT: 409,
  SCENE_REVIEW_NOT_ELIGIBLE: 409,
  STORY_REVIEW_NOT_ELIGIBLE: 409,
} as const;

type AppErrorCode = keyof typeof APP_ERROR_HTTP_STATUS;

function isAppErrorCode(code: unknown): code is AppErrorCode {
  return typeof code === "string" && code in APP_ERROR_HTTP_STATUS;
}

/**
 * Recognized application errors only: typed classes, or Error instances whose
 * `code` is on the allowlist. Arbitrary `{ code, message }` objects (including
 * PostgreSQL errors) are treated as unexpected and sanitized to 500.
 */
function asRecognizedAppError(
  error: unknown
): { message: string; code: AppErrorCode; status: number } | null {
  if (!(error instanceof Error)) return null;
  if (!("code" in error)) return null;
  const code = (error as Error & { code: unknown }).code;
  if (!isAppErrorCode(code)) return null;
  return {
    message: error.message,
    code,
    status: APP_ERROR_HTTP_STATUS[code],
  };
}

export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }
  if (error instanceof TenantValidationError) {
    return apiError(error.message, error.code, 400);
  }
  if (error instanceof WorkspaceAccessError || error instanceof OrganizationAccessError) {
    return apiError(error.message, error.code, 403);
  }

  const recognized = asRecognizedAppError(error);
  if (recognized) {
    return apiError(recognized.message, recognized.code, recognized.status);
  }

  console.error(error);
  return apiError("Unexpected server error.", "INTERNAL_ERROR", 500);
}
