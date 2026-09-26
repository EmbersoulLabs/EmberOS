import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

export async function requireSuperAdmin() {
  try {
    return await requirePlatformAdmin();
  } catch {
    throw new SuperAdminError();
  }
}

export class SuperAdminError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "SuperAdminError";
  }
}
