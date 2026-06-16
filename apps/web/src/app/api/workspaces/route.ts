import { eq } from "drizzle-orm";
import { getDb, schema, requireWorkspaceRole } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError, slugify } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

    const db = getDb();
    let query = db
      .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(eq(schema.workspaceMembers.userId, user.id));

    const results = await query;
    const workspaces = orgId
      ? results.filter((r) => r.workspace.orgId === orgId)
      : results;

    return apiSuccess({
      workspaces: workspaces.map((w) => ({
        ...w.workspace,
        role: w.role,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const { orgId, name, slug: rawSlug, brandProfile } = body as {
      orgId: string;
      name: string;
      slug?: string;
      brandProfile?: Record<string, unknown>;
    };

    if (!orgId || !name) return apiError("orgId and name are required", "VALIDATION_ERROR");

    const db = getDb();
    const [orgMember] = await db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, user.id))
      .limit(1);

    if (!orgMember) return apiError("Not an org member", "FORBIDDEN", 403);

    const slug = rawSlug ?? slugify(name);
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ orgId, name, slug, brandProfile: brandProfile ?? {} })
      .returning();

    await db.insert(schema.workspaceMembers).values({
      orgId,
      workspaceId: workspace!.id,
      userId: user.id,
      role: "admin",
    });

    return apiSuccess({ workspace }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
