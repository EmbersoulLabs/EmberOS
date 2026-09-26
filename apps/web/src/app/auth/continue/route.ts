import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import {
  platformAdminPostAuthDestination,
  resolvePlatformAdminForUser,
} from "@/lib/platform-admin-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireAuth();
  const authority = await resolvePlatformAdminForUser(user);
  const destination = platformAdminPostAuthDestination(authority);
  return NextResponse.redirect(new URL(destination, request.url));
}
