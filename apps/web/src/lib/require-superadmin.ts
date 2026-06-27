import { requireAuth } from "@/lib/auth";
import { isSuperAdminUser } from "@/lib/superadmin";

export async function requireSuperAdmin() {
  const user = await requireAuth();
  if (!isSuperAdminUser(user)) {
    throw new SuperAdminError();
  }
  return user;
}

export class SuperAdminError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "SuperAdminError";
  }
}
