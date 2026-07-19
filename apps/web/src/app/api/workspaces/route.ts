import { eq, and } from "drizzle-orm";
import {
  getDb,
  schema,
  ensureBusinessProfileForWorkspace,
  requireOrganizationMembership,
} from "@ceo-agent/db";
import { isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError, slugify } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

    // Optional org filter: only allowed after verifying membership in that org.
    // Super Admin does not get an implicit bypass here.
    if (orgId) {
      if (!isUuid(orgId)) {
        return apiError("orgId must be a valid UUID", "VALIDATION_ERROR", 400);
      }
      await requireOrganizationMembership(orgId, user.id);
    }

    const db = getDb();
    const results = await db
      .select({ workspace: schema.workspaces, role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .innerJoin(schema.workspaces, eq(schema.workspaceMembers.workspaceId, schema.workspaces.id))
      .where(
        orgId
          ? and(
              eq(schema.workspaceMembers.userId, user.id),
              eq(schema.workspaces.orgId, orgId)
            )
          : eq(schema.workspaceMembers.userId, user.id)
      );

    return apiSuccess({
      workspaces: results.map((w) => ({
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
    if (!isUuid(orgId)) {
      return apiError("orgId must be a valid UUID", "VALIDATION_ERROR", 400);
    }

    // Server must verify membership for the requested orgId.
    // Never trust client-supplied org ownership; do not use "any org membership".
    // Super Admin is not granted create rights here — use explicit admin APIs if needed.
    const orgMember = await requireOrganizationMembership(orgId, user.id);

    const db = getDb();
    const slug = rawSlug ?? slugify(name);
    const [workspace] = await db
      .insert(schema.workspaces)
      .values({ orgId: orgMember.orgId, name, slug, brandProfile: brandProfile ?? {} })
      .returning();

    await db.insert(schema.workspaceMembers).values({
      orgId: orgMember.orgId,
      workspaceId: workspace!.id,
      userId: user.id,
      role: "admin",
    });

    await ensureBusinessProfileForWorkspace(orgMember.orgId, workspace!.id, user.id);

    return apiSuccess({ workspace }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
