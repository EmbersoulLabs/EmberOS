import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@ceo-agent/db";
import { E2E_SESSION_COOKIE, e2eLocalAuthEnabled, signE2ESession } from "@/lib/e2e-local-auth";

function hidden() {
  return NextResponse.json({ error: "Not found", code: "NOT_FOUND" }, { status: 404 });
}

export async function GET() {
  if (!e2eLocalAuthEnabled()) return hidden();
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  if (!e2eLocalAuthEnabled()) return hidden();
  const secret = request.headers.get("x-e2e-auth-secret");
  if (!secret || secret !== process.env.E2E_LOCAL_AUTH_SECRET) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { userId?: unknown } | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return NextResponse.json({ error: "Invalid user", code: "VALIDATION_ERROR" }, { status: 400 });
  }

  const db = getDb();
  const [member] = await db
    .select({ userId: schema.workspaceMembers.userId })
    .from(schema.workspaceMembers)
    .where(eq(schema.workspaceMembers.userId, userId))
    .limit(1);
  if (!member) {
    return NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 });
  }

  const token = await signE2ESession(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(E2E_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
  return response;
}
