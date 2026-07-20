import { eq, and } from "drizzle-orm";
import {
  createWorkspaceWithBusinessProfile,
  getDb,
  requireOrganizationMembership,
  schema,
} from "@ceo-agent/db";
import { CreateWorkspaceBusinessLedSchema, isUuid } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const orgId = searchParams.get("orgId");

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

/**
 * PD-012: business-led Workspace creation.
 * Body: { orgId, businessName, country, industry, locale? }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return apiError("Invalid JSON body", "VALIDATION_ERROR", 400);
    }

    const parsed = CreateWorkspaceBusinessLedSchema.safeParse(body);
    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid workspace creation request";
      return apiError(message, "VALIDATION_ERROR", 400);
    }

    const { orgId, businessName, country, industry, locale } = parsed.data;

    const orgMember = await requireOrganizationMembership(orgId, user.id);

    const { workspace, businessProfile } = await createWorkspaceWithBusinessProfile({
      orgId: orgMember.orgId,
      userId: user.id,
      businessName,
      country,
      industry,
      locale,
    });

    return apiSuccess(
      {
        workspace,
        businessProfile: {
          id: businessProfile.id,
          workspaceId: businessProfile.workspaceId,
          companyName: businessProfile.companyName,
          country: businessProfile.country,
          industryId: businessProfile.industryId,
          industryDisplayName: businessProfile.industryDisplayName,
        },
        redirectTo: `/w/${workspace.slug}/settings/business-profile`,
      },
      201
    );
  } catch (error) {
    return handleApiError(error);
  }
}
