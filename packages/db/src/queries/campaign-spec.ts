import { eq, and, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { CAMPAIGN_SOFT_DELETE_RETENTION_DAYS } from "@ceo-agent/shared";
import * as schema from "../schema/index";

type Db = PostgresJsDatabase<typeof schema>;

export function softDeleteRetentionDate(from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + CAMPAIGN_SOFT_DELETE_RETENTION_DAYS);
  return d;
}

export async function softDeleteCampaign(
  db: Db,
  campaignId: string,
  workspaceId: string,
  userId: string
) {
  const now = new Date();
  const [updated] = await db
    .update(schema.campaigns)
    .set({
      deletedAt: now,
      deletedBy: userId,
      purgeAfter: softDeleteRetentionDate(now),
      updatedAt: now,
      updatedBy: userId,
    })
    .where(
      and(
        eq(schema.campaigns.id, campaignId),
        eq(schema.campaigns.workspaceId, workspaceId),
        isNull(schema.campaigns.deletedAt)
      )
    )
    .returning();
  return updated ?? null;
}

export async function duplicateCampaignRecord(
  db: Db,
  source: typeof schema.campaigns.$inferSelect,
  userId: string
) {
  const copyName = `${source.name.replace(/\s*\(Copy\)\s*$/i, "")} (Copy)`;

  const [created] = await db
    .insert(schema.campaigns)
    .values({
      orgId: source.orgId,
      workspaceId: source.workspaceId,
      companyProfileId: source.companyProfileId,
      name: copyName,
      goal: source.goal,
      platforms: source.platforms,
      industry: source.industry,
      objectives: source.objectives,
      status: "draft",
      businessStatus: "draft",
      description: source.description,
      targetAudienceOverride: source.targetAudienceOverride,
      campaignObjectiveId: source.campaignObjectiveId,
      campaignObjectiveCustom: source.campaignObjectiveCustom,
      campaignBrief: source.campaignBrief,
      outputLanguage: source.outputLanguage,
      subtitleLanguage: source.subtitleLanguage,
      ctaLanguage: source.ctaLanguage,
      hashtagLanguage: source.hashtagLanguage,
      voicePreset: source.voicePreset,
      contentStyle: source.contentStyle,
      campaignGoal: source.campaignGoal,
      bgmPreference: source.bgmPreference,
      tags: source.tags,
      folder: source.folder,
      isFavorite: false,
      assignedTo: source.assignedTo,
      externalAssetUrl: source.externalAssetUrl,
      metadata: source.metadata ?? {},
      createdBy: userId,
      updatedBy: userId,
    })
    .returning();

  return created;
}

export async function getMarketingPackageForCampaign(
  db: Db,
  campaignId: string,
  workspaceId: string
) {
  const [pkg] = await db
    .select()
    .from(schema.marketingPackages)
    .where(
      and(
        eq(schema.marketingPackages.campaignId, campaignId),
        eq(schema.marketingPackages.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return pkg ?? null;
}

/** Persist user-edited card text only — not AI generation. */
export async function saveMarketingPackageUserEdited(
  db: Db,
  campaign: typeof schema.campaigns.$inferSelect,
  userId: string,
  cardId: string,
  text: string
) {
  const existing = await getMarketingPackageForCampaign(
    db,
    campaign.id,
    campaign.workspaceId
  );
  const prev = (existing?.userEdited as Record<string, string> | null) ?? {};
  const userEdited = { ...prev, [cardId]: text };
  const now = new Date();

  if (existing) {
    const [updated] = await db
      .update(schema.marketingPackages)
      .set({ userEdited, updatedAt: now })
      .where(eq(schema.marketingPackages.id, existing.id))
      .returning();
    return updated ?? null;
  }

  const [created] = await db
    .insert(schema.marketingPackages)
    .values({
      orgId: campaign.orgId,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      userEdited,
    })
    .returning();

  if (created) {
    await db
      .update(schema.campaigns)
      .set({
        marketingPackageId: created.id,
        updatedAt: now,
        updatedBy: userId,
      })
      .where(eq(schema.campaigns.id, campaign.id));
  }

  return created ?? null;
}
