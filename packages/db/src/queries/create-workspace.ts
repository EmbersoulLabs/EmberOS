import { and, eq } from "drizzle-orm";
import {
  deriveWorkspaceCreateDefaults,
  type CreateWorkspaceBusinessLedInput,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

export type CreateWorkspaceWithBusinessProfileResult = {
  workspace: typeof schema.workspaces.$inferSelect;
  businessProfile: typeof schema.businessProfiles.$inferSelect;
};

/**
 * PD-012 / PD-011: create Workspace + membership + Business Profile atomically.
 * Uses Drizzle transaction so a Business Profile failure rolls back the Workspace.
 */
export async function createWorkspaceWithBusinessProfile(input: {
  orgId: string;
  userId: string;
  businessName: string;
  country: string;
  industry: string;
  locale?: CreateWorkspaceBusinessLedInput["locale"];
}): Promise<CreateWorkspaceWithBusinessProfileResult> {
  const defaults = deriveWorkspaceCreateDefaults({
    businessName: input.businessName,
    country: input.country,
    industry: input.industry,
    locale: input.locale,
  });

  const db = getDb();

  return db.transaction(async (tx) => {
    let slug = defaults.baseSlug;
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? defaults.baseSlug : `${defaults.baseSlug}-${n + 1}`;
      const [existing] = await tx
        .select({ id: schema.workspaces.id })
        .from(schema.workspaces)
        .where(and(eq(schema.workspaces.orgId, input.orgId), eq(schema.workspaces.slug, candidate)))
        .limit(1);
      if (!existing) {
        slug = candidate;
        break;
      }
      if (n === 49) {
        const err = new Error("Could not allocate a unique workspace slug");
        (err as Error & { code: string }).code = "VALIDATION_ERROR";
        throw err;
      }
    }

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({
        orgId: input.orgId,
        name: defaults.workspaceName,
        slug,
        brandProfile: {},
      })
      .returning();

    if (!workspace) {
      throw new Error("Failed to create workspace");
    }

    await tx.insert(schema.workspaceMembers).values({
      orgId: input.orgId,
      workspaceId: workspace.id,
      userId: input.userId,
      role: "admin",
    });

    const [businessProfile] = await tx
      .insert(schema.businessProfiles)
      .values({
        orgId: input.orgId,
        workspaceId: workspace.id,
        companyName: defaults.workspaceName,
        country: defaults.country,
        industryId: defaults.industry.industryId,
        industryDisplayName: defaults.industry.industryDisplayName,
        industryCustomValue: defaults.industry.industryCustomValue,
        timezone: defaults.timezone,
        supportedLanguages: defaults.supportedLanguages,
        createdBy: input.userId,
        updatedBy: input.userId,
      })
      .returning();

    if (!businessProfile) {
      throw new Error("Failed to create business profile");
    }

    return { workspace, businessProfile };
  });
}
