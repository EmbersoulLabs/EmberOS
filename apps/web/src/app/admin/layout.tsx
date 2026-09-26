import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin-auth";

export const runtime = "nodejs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect("/workspaces");
  }
  return children;
}
