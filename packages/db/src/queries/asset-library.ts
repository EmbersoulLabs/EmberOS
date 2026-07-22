import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { getDb } from "@ceo-agent/db";
import { schema } from "@ceo-agent/db";

type Db = ReturnType<typeof getDb>;

type AssetRow = typeof schema.assets.$inferSelect;

const MEDIA_REFS_AUTHORITATIVE_KEY = "mediaReferencesAuthoritative";

export function shouldUseLegacyCampaignAssetFallback(
  resolvedAssetCount: number,
  campaignMetadata: unknown
): boolean {
  if (resolvedAssetCount > 0) return false;
  if (!campaignMetadata || typeof campaignMetadata !== "object") return true;
  return (
    (campaignMetadata as Record<string, unknown>)[MEDIA_REFS_AUTHORITATIVE_KEY] !== true
  );
}

/**
 * Resolve campaign media from PD-036 references:
 * - campaign_asset_refs
 * - campaign_story_refs → ordered story_assets
 * - legacy assets.campaign_id fallback for pre-migration rows only; scheduled for removal
 *   after historical data and consumers have fully migrated to reference tables
 */
export async function getCampaignAssets(
  db: Db,
  campaignId: string,
  workspaceId: string
): Promise<AssetRow[]> {
  const byId = new Map<string, AssetRow>();

  const [campaign] = await db
    .select({ metadata: schema.campaigns.metadata })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .limit(1);

  const directRefs = await db
    .select({ asset: schema.assets, sortOrder: schema.campaignAssetRefs.sortOrder })
    .from(schema.campaignAssetRefs)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.campaignAssetRefs.assetId))
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, campaignId),
        eq(schema.assets.workspaceId, workspaceId),
        isNull(schema.assets.deletedAt)
      )
    )
    .orderBy(asc(schema.campaignAssetRefs.sortOrder));

  for (const row of directRefs) {
    byId.set(row.asset.id, row.asset);
  }

  const storyRefs = await db
    .select({ storyId: schema.campaignStoryRefs.storyId })
    .from(schema.campaignStoryRefs)
    .innerJoin(schema.stories, eq(schema.stories.id, schema.campaignStoryRefs.storyId))
    .where(
      and(
        eq(schema.campaignStoryRefs.campaignId, campaignId),
        eq(schema.stories.workspaceId, workspaceId),
        eq(schema.stories.status, "ready"),
        isNull(schema.stories.deletedAt)
      )
    );

  if (storyRefs.length > 0) {
    const storyIds = storyRefs.map((r) => r.storyId);
    const storyAssets = await db
      .select({ asset: schema.assets, sortOrder: schema.storyAssets.sortOrder, storyId: schema.storyAssets.storyId })
      .from(schema.storyAssets)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.storyAssets.assetId))
      .where(
        and(
          inArray(schema.storyAssets.storyId, storyIds),
          eq(schema.assets.workspaceId, workspaceId),
          isNull(schema.assets.deletedAt)
        )
      )
      .orderBy(asc(schema.storyAssets.sortOrder));

    for (const row of storyAssets) {
      if (!byId.has(row.asset.id)) byId.set(row.asset.id, row.asset);
    }
  }

  if (shouldUseLegacyCampaignAssetFallback(byId.size, campaign?.metadata)) {
    const legacy = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.campaignId, campaignId),
          eq(schema.assets.workspaceId, workspaceId),
          isNull(schema.assets.deletedAt)
        )
      );
    for (const asset of legacy) byId.set(asset.id, asset);
  }

  return Array.from(byId.values());
}

export async function attachAssetsToCampaign(
  db: Db,
  campaignId: string,
  assetIds: string[],
  startSort = 0
): Promise<void> {
  if (assetIds.length === 0) return;
  await db
    .insert(schema.campaignAssetRefs)
    .values(
      assetIds.map((assetId, index) => ({
        campaignId,
        assetId,
        sortOrder: startSort + index,
      }))
    )
    .onConflictDoNothing();
}

export async function attachStoriesToCampaign(
  db: Db,
  campaignId: string,
  storyIds: string[]
): Promise<void> {
  if (storyIds.length === 0) return;
  await db
    .insert(schema.campaignStoryRefs)
    .values(storyIds.map((storyId) => ({ campaignId, storyId })))
    .onConflictDoNothing();
}

/** Replace Campaign references so persistence exactly matches the current UI selection. */
export async function replaceCampaignMediaReferences(
  db: Db,
  campaignId: string,
  assetIds: string[],
  storyIds: string[]
): Promise<void> {
  const uniqueAssetIds = [...new Set(assetIds)];
  const uniqueStoryIds = [...new Set(storyIds)];

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.campaignAssetRefs)
      .where(eq(schema.campaignAssetRefs.campaignId, campaignId));
    await tx
      .delete(schema.campaignStoryRefs)
      .where(eq(schema.campaignStoryRefs.campaignId, campaignId));

    if (uniqueAssetIds.length > 0) {
      await tx.insert(schema.campaignAssetRefs).values(
        uniqueAssetIds.map((assetId, sortOrder) => ({
          campaignId,
          assetId,
          sortOrder,
        }))
      );
    }
    if (uniqueStoryIds.length > 0) {
      await tx.insert(schema.campaignStoryRefs).values(
        uniqueStoryIds.map((storyId) => ({ campaignId, storyId }))
      );
    }

    await tx
      .update(schema.campaigns)
      .set({
        metadata: sql`coalesce(${schema.campaigns.metadata}, '{}'::jsonb) || '{"mediaReferencesAuthoritative":true}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(schema.campaigns.id, campaignId));
  });
}

export async function replaceStoryAssets(
  db: Db,
  storyId: string,
  assetIds: string[]
): Promise<void> {
  await db.delete(schema.storyAssets).where(eq(schema.storyAssets.storyId, storyId));
  if (assetIds.length === 0) return;
  await db.insert(schema.storyAssets).values(
    assetIds.map((assetId, index) => ({
      storyId,
      assetId,
      sortOrder: index,
    }))
  );
}

export async function assertAssetsInWorkspace(
  db: Db,
  workspaceId: string,
  assetIds: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (assetIds.length === 0) return { ok: true };
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.workspaceId, workspaceId),
        inArray(schema.assets.id, assetIds),
        isNull(schema.assets.deletedAt)
      )
    );
  if (rows.length !== new Set(assetIds).size) {
    return { ok: false, error: "One or more assets were not found in this workspace" };
  }
  return { ok: true };
}

export async function assertStoriesInWorkspace(
  db: Db,
  workspaceId: string,
  storyIds: string[],
  opts?: { readyOnly?: boolean }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (storyIds.length === 0) return { ok: true };
  const conditions = [
    eq(schema.stories.workspaceId, workspaceId),
    inArray(schema.stories.id, storyIds),
    isNull(schema.stories.deletedAt),
  ];
  if (opts?.readyOnly) {
    conditions.push(eq(schema.stories.status, "ready"));
  }
  const rows = await db
    .select({ id: schema.stories.id, status: schema.stories.status })
    .from(schema.stories)
    .where(and(...conditions));
  if (rows.length !== new Set(storyIds).size) {
    return {
      ok: false,
      error: opts?.readyOnly
        ? "Only Ready Stories can be attached to a Campaign"
        : "One or more stories were not found in this workspace",
    };
  }
  return { ok: true };
}

/** Search helper: filename + story name (expandable for AI metadata later). */
export function assetSearchCondition(query: string) {
  const q = `%${query.trim().toLowerCase()}%`;
  return or(
    sql`lower(coalesce(${schema.assets.displayName}, '')) like ${q}`,
    sql`lower(coalesce(${schema.assets.originalFilename}, '')) like ${q}`,
    sql`lower(coalesce(${schema.assets.metadata}->>'originalFilename', '')) like ${q}`
  );
}
