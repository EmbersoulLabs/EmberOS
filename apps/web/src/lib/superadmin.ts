import type { User } from "@supabase/supabase-js";

export function getSuperAdminEmails(): Set<string> {
  return new Set(
    (process.env.SUPERADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getSuperAdminEmails().has(email.toLowerCase());
}

export function isSuperAdminUser(user: Pick<User, "email"> | null | undefined): boolean {
  return isSuperAdminEmail(user?.email);
}
