import { getAuthUser } from "@/lib/supabase/server";
import { WorkspaceAccessError } from "@ceo-agent/db";
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

export function handleApiError(error: unknown) {
  if (error instanceof AuthError) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }
  if (error instanceof WorkspaceAccessError) {
    return apiError(error.message, error.code, 403);
  }
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const e = error as { code: string; message: string };
    return apiError(e.message, e.code, e.code === "FORBIDDEN" ? 403 : 400);
  }
  console.error(error);
  return apiError(
    error instanceof Error ? error.message : "Internal server error",
    "INTERNAL_ERROR",
    500
  );
}
