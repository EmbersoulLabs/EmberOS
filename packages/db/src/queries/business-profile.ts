import { and, eq, isNull } from "drizzle-orm";
import {
  BrandProfileSchema,
  businessProfileToBrandProfile,
  legacyBrandProfileToBusinessProfileUpdate,
  type BrandProfile,
  type BusinessProfileUpdate,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";

export async function getBusinessProfileByWorkspace(workspaceId: string) {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(schema.businessProfiles)
    .where(
      and(
        eq(schema.businessProfiles.workspaceId, workspaceId),
        isNull(schema.businessProfiles.deletedAt)
      )
    )
    .limit(1);
  return profile ?? null;
}

export async function ensureBusinessProfileForWorkspace(
  orgId: string,
  workspaceId: string,
  createdBy?: string
) {
  const existing = await getBusinessProfileByWorkspace(workspaceId);
  if (existing) return existing;

  const db = getDb();
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);

  if (!workspace) throw new Error("Workspace not found");

  const resolvedOrgId = orgId || workspace.orgId;
  const legacyParsed = BrandProfileSchema.safeParse(workspace.brandProfile ?? {});
  const legacySeed = legacyParsed.success
    ? legacyBrandProfileToBusinessProfileUpdate(legacyParsed.data)
    : {};

  const [profile] = await db
    .insert(schema.businessProfiles)
    .values({
      orgId: resolvedOrgId,
      workspaceId,
      createdBy: createdBy ?? null,
      updatedBy: createdBy ?? null,
      ...mapBusinessProfileUpdate(legacySeed),
    })
    .onConflictDoNothing({ target: schema.businessProfiles.workspaceId })
    .returning();

  if (profile) return profile;
  return (await getBusinessProfileByWorkspace(workspaceId))!;
}

export async function updateBusinessProfile(
  orgId: string,
  workspaceId: string,
  userId: string,
  update: BusinessProfileUpdate
) {
  const db = getDb();
  const current = await ensureBusinessProfileForWorkspace(orgId, workspaceId, userId);
  if (!current) throw new Error("Business profile not found");

  if (update.version != null && update.version !== current.version) {
    const err = new Error("Business profile version conflict");
    (err as Error & { code: string }).code = "VERSION_CONFLICT";
    throw err;
  }

  const { version: _version, ...fields } = update;
  const patch = mapBusinessProfileUpdate(fields);

  const [next] = await db
    .update(schema.businessProfiles)
    .set({
      ...patch,
      updatedBy: userId,
      updatedAt: new Date(),
      version: current.version + 1,
    })
    .where(
      and(
        eq(schema.businessProfiles.workspaceId, workspaceId),
        eq(schema.businessProfiles.version, current.version),
        isNull(schema.businessProfiles.deletedAt)
      )
    )
    .returning();

  if (!next) {
    const err = new Error("Business profile version conflict");
    (err as Error & { code: string }).code = "VERSION_CONFLICT";
    throw err;
  }

  return next;
}

function mapBusinessProfileUpdate(update: BusinessProfileUpdate) {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (key === "version") continue;
    if (value !== undefined) patch[key] = value;
  }
  return patch;
}

export async function resolveBrandProfileForWorkspace(
  orgId: string,
  workspaceId: string,
  legacyBrandProfile?: unknown
): Promise<BrandProfile> {
  const legacyParsed = BrandProfileSchema.safeParse(legacyBrandProfile ?? {});
  const legacy = legacyParsed.success ? legacyParsed.data : undefined;
  const profile = await ensureBusinessProfileForWorkspace(orgId, workspaceId);
  return businessProfileToBrandProfile(profile, legacy);
}
