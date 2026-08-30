import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type QueryDb = Db | Tx;

export class AssetLibraryError extends Error {
  constructor(
    readonly code:
      | "ASSET_REFERENCE_DENIED"
      | "ASSET_STORY_NOT_FOUND"
      | "ASSET_STORY_VERSION_CONFLICT",
    message: string
  ) {
    super(message);
    this.name = "AssetLibraryError";
  }
}

export function assetSearchCondition(query: string) {
  const q = `%${query.trim().toLowerCase()}%`;
  return or(
    sql`lower(coalesce(${schema.assets.displayName}, '')) like ${q}`,
    sql`lower(coalesce(${schema.assets.originalFilename}, '')) like ${q}`,
    sql`lower(coalesce(${schema.assets.metadata}->>'originalFilename', '')) like ${q}`
  );
}

export async function assertAssetsInWorkspace(
  db: QueryDb,
  identity: { orgId: string; workspaceId: string },
  assetIds: readonly string[]
): Promise<void> {
  const unique = [...new Set(assetIds)];
  if (unique.length === 0) return;
  const rows = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(and(
      eq(schema.assets.orgId, identity.orgId),
      eq(schema.assets.workspaceId, identity.workspaceId),
      inArray(schema.assets.id, unique),
      isNull(schema.assets.deletedAt)
    ));
  if (rows.length !== unique.length) {
    throw new AssetLibraryError(
      "ASSET_REFERENCE_DENIED",
      "One or more Asset references are outside the authorized Workspace"
    );
  }
}

export async function assertAssetStoriesInWorkspace(
  db: QueryDb,
  identity: { orgId: string; workspaceId: string },
  storyIds: readonly string[],
  readyOnly = false
): Promise<void> {
  const unique = [...new Set(storyIds)];
  if (unique.length === 0) return;
  const conditions = [
    eq(schema.stories.orgId, identity.orgId),
    eq(schema.stories.workspaceId, identity.workspaceId),
    inArray(schema.stories.id, unique),
    isNull(schema.stories.deletedAt),
  ];
  if (readyOnly) conditions.push(eq(schema.stories.status, "ready"));
  const rows = await db.select({ id: schema.stories.id }).from(schema.stories).where(and(...conditions));
  if (rows.length !== unique.length) {
    throw new AssetLibraryError("ASSET_REFERENCE_DENIED", "One or more Asset Stories are not eligible for this Campaign");
  }
}

export async function replaceAssetStoryAssets(
  db: QueryDb,
  input: { storyId: string; orgId: string; workspaceId: string; assetIds: readonly string[] }
): Promise<void> {
  await assertAssetsInWorkspace(db, input, input.assetIds);
  await db.delete(schema.storyAssets).where(eq(schema.storyAssets.storyId, input.storyId));
  if (input.assetIds.length > 0) {
    await db.insert(schema.storyAssets).values(
      input.assetIds.map((assetId, sortOrder) => ({ storyId: input.storyId, assetId, sortOrder }))
    );
  }
}

export async function loadAssetStory(
  db: QueryDb,
  input: { storyId: string; orgId: string; workspaceId: string }
) {
  const [story] = await db
    .select()
    .from(schema.stories)
    .where(and(
      eq(schema.stories.id, input.storyId),
      eq(schema.stories.orgId, input.orgId),
      eq(schema.stories.workspaceId, input.workspaceId),
      isNull(schema.stories.deletedAt)
    ))
    .limit(1);
  if (!story) return null;
  const links = await db
    .select({ asset: schema.assets, sortOrder: schema.storyAssets.sortOrder })
    .from(schema.storyAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.storyAssets.assetId))
    .where(and(
      eq(schema.storyAssets.storyId, story.id),
      eq(schema.assets.orgId, input.orgId),
      eq(schema.assets.workspaceId, input.workspaceId),
      isNull(schema.assets.deletedAt)
    ))
    .orderBy(asc(schema.storyAssets.sortOrder));
  return { ...story, assets: links.map(({ asset, sortOrder }) => ({ ...asset, sortOrder })) };
}

export async function findSameWorkspaceAssetByContentHash(
  db: QueryDb,
  input: { orgId: string; workspaceId: string; contentHash: string; excludeAssetId?: string }
) {
  const conditions = [
    eq(schema.assets.orgId, input.orgId),
    eq(schema.assets.workspaceId, input.workspaceId),
    eq(schema.assets.contentHash, input.contentHash),
    isNull(schema.assets.deletedAt),
  ];
  if (input.excludeAssetId) conditions.push(sql`${schema.assets.id} <> ${input.excludeAssetId}`);
  const [asset] = await db.select().from(schema.assets).where(and(...conditions)).limit(1);
  return asset ?? null;
}
