import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError, generateToken } from "@/lib/api";
import { PORTAL_TOKEN_EXPIRY_DAYS } from "@ceo-agent/shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await requireWorkspaceRole(id, user.id, "client_viewer");

    const db = getDb();
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (!workspace) return apiError("Workspace not found", "NOT_FOUND", 404);

    const members = await db
      .select()
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.workspaceId, id));

    const campaignCount = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.workspaceId, id));

    return apiSuccess({
      workspace,
      members,
      stats: { campaigns: campaignCount.length },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    await requireWorkspaceRole(id, user.id, "admin");

    const body = await request.json();
    const { creativeId, email, expiresInDays = PORTAL_TOKEN_EXPIRY_DAYS } = body as {
      creativeId?: string;
      email?: string;
      expiresInDays?: number;
    };

    const db = getDb();
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .limit(1);

    if (!workspace) return apiError("Workspace not found", "NOT_FOUND", 404);

    const token = generateToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const [invite] = await db
      .insert(schema.clientInvites)
      .values({
        orgId: workspace.orgId,
        workspaceId: id,
        creativeId: creativeId ?? null,
        token,
        email,
        expiresAt,
        createdBy: user.id,
      })
      .returning();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const inviteUrl = `${appUrl}/portal/${token}`;

    return apiSuccess({ inviteUrl, token, expiresAt: invite!.expiresAt }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
