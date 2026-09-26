import { eq } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess } from "@/lib/api";
import { resolvePlatformAdminForUser } from "@/lib/platform-admin-auth";

export async function GET() {
  try {
    const user = await requireAuth();
    const db = getDb();
    const platformAdmin = await resolvePlatformAdminForUser(user);
    const isSuperAdmin = platformAdmin.status === "ACTIVE_GRANT";

    const orgMemberships = isSuperAdmin
      ? (await db.select({ org: schema.organizations }).from(schema.organizations)).map((row) => ({
          ...row,
          role: "platform_admin",
        }))
      : await db
      .select({
        org: schema.organizations,
        role: schema.organizationMembers.role,
      })
      .from(schema.organizationMembers)
      .innerJoin(schema.organizations, eq(schema.organizationMembers.orgId, schema.organizations.id))
      .where(eq(schema.organizationMembers.userId, user.id));

    const workspaceMemberships = isSuperAdmin
      ? (await db
          .select({ workspace: schema.workspaces, orgName: schema.organizations.name })
          .from(schema.workspaces)
          .innerJoin(schema.organizations, eq(schema.organizations.id, schema.workspaces.orgId)))
          .map((row) => ({ ...row, role: "platform_admin" }))
      : (await db
      .select({
        workspace: schema.workspaces,
        role: schema.workspaceMembers.role,
        orgName: schema.organizations.name,
      })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.workspaces.orgId))
      .where(eq(schema.workspaceMembers.userId, user.id)));

    return apiSuccess({
      user: { id: user.id, email: user.email },
      isSuperAdmin,
      platformAdminAssignmentId:
        platformAdmin.status === "ACTIVE_GRANT"
          ? platformAdmin.assignment.platformAdminAssignmentId
          : null,
      orgs: orgMemberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        slug: m.org.slug,
        role: m.role,
        plan: m.org.plan,
      })),
      workspaces: workspaceMemberships.map((m) => ({
        id: m.workspace.id,
        orgId: m.workspace.orgId,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        orgName: m.orgName,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
