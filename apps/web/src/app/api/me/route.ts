import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireAuth();
    const db = getDb();

    const orgMemberships = await db
      .select({
        org: schema.organizations,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.organizations, eq(schema.organizationMembers.orgId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id));

    const workspaceMemberships = await db
      .select({
        workspace: schema.workspaces,
        role: schema.workspaceMembers.role,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(eq(schema.workspaceMembers.userId, user.id));

    return apiSuccess({
      user: { id: user.id, email: user.email },
      orgs: orgMemberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
      })),
      workspaces: workspaceMemberships.map((m) => ({
        id: m.workspace.id,
        orgId: m.workspace.orgId,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
