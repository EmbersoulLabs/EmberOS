/**
 * Campaign-owned AI Story persistence helpers.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@ceo-agent/db";
import {
  assertAiStoryTransition,
  nextAiStoryVersionNumber,
  type AiStoryStatus,
  type AiStoryStructuredDraft,
} from "@ceo-agent/shared";

type Db = ReturnType<typeof getDb>;

export async function loadCampaignAiStory(
  db: Db,
  campaignId: string,
  storyId: string,
  workspaceId: string
) {
  const [story] = await db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.id, storyId),
        eq(schema.aiStories.campaignId, campaignId),
        eq(schema.aiStories.workspaceId, workspaceId),
        isNull(schema.aiStories.archivedAt)
      )
    )
    .limit(1);
  if (!story) return null;

  const versions = await db
    .select()
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.storyId, storyId))
    .orderBy(desc(schema.aiStoryVersions.versionNumber));

  const assetLinks = await db
    .select()
    .from(schema.aiStoryAssetLinks)
    .where(eq(schema.aiStoryAssetLinks.storyId, storyId));

  const currentVersion =
    versions.find((v) => v.id === story.currentVersionId) ?? versions[0] ?? null;

  return { story, versions, currentVersion, assetLinks };
}

export async function listCampaignAiStories(
  db: Db,
  campaignId: string,
  workspaceId: string
) {
  return db
    .select()
    .from(schema.aiStories)
    .where(
      and(
        eq(schema.aiStories.campaignId, campaignId),
        eq(schema.aiStories.workspaceId, workspaceId),
        isNull(schema.aiStories.archivedAt)
      )
    )
    .orderBy(desc(schema.aiStories.updatedAt));
}

export async function setAiStoryStatus(
  db: Db,
  storyId: string,
  from: AiStoryStatus,
  to: AiStoryStatus
) {
  assertAiStoryTransition(from, to);
  await db
    .update(schema.aiStories)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, storyId));
}

export async function replaceAiStoryAssetLinks(
  db: Db,
  storyId: string,
  assetIds: string[]
) {
  await db.delete(schema.aiStoryAssetLinks).where(eq(schema.aiStoryAssetLinks.storyId, storyId));
  if (assetIds.length === 0) return;
  await db.insert(schema.aiStoryAssetLinks).values(
    assetIds.map((assetId) => ({
      storyId,
      assetId,
      usageType: "reference" as const,
    }))
  );
}

export async function assertCampaignAssets(
  db: Db,
  campaignId: string,
  workspaceId: string,
  assetIds: string[]
) {
  if (assetIds.length === 0) return;
  const refs = await db
    .select({ assetId: schema.campaignAssetRefs.assetId })
    .from(schema.campaignAssetRefs)
    .where(
      and(
        eq(schema.campaignAssetRefs.campaignId, campaignId),
        inArray(schema.campaignAssetRefs.assetId, assetIds)
      )
    );
  const allowed = new Set(refs.map((r) => r.assetId));
  for (const id of assetIds) {
    if (!allowed.has(id)) {
      throw new Error(`Asset ${id} is not linked to this Campaign`);
    }
  }
  const assets = await db
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.workspaceId, workspaceId),
        inArray(schema.assets.id, assetIds),
        isNull(schema.assets.deletedAt)
      )
    );
  if (assets.length !== assetIds.length) {
    throw new Error("One or more assets are invalid for this workspace");
  }
}

export async function createAiStoryVersion(
  db: Db,
  input: {
    storyId: string;
    structuredContent: AiStoryStructuredDraft;
    sourceContextSnapshot: Record<string, unknown>;
    aiMetadata?: Record<string, unknown>;
    userEdited?: boolean;
    createdBy?: string | null;
  }
) {
  const existing = await db
    .select({ versionNumber: schema.aiStoryVersions.versionNumber })
    .from(schema.aiStoryVersions)
    .where(eq(schema.aiStoryVersions.storyId, input.storyId))
    .orderBy(asc(schema.aiStoryVersions.versionNumber));

  const versionNumber = nextAiStoryVersionNumber(existing);
  const [version] = await db
    .insert(schema.aiStoryVersions)
    .values({
      storyId: input.storyId,
      versionNumber,
      structuredContent: input.structuredContent,
      sourceContextSnapshot: input.sourceContextSnapshot,
      aiMetadata: input.aiMetadata ?? {},
      userEdited: input.userEdited ?? false,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (!version) throw new Error("Failed to create AI Story version");

  await db
    .update(schema.aiStories)
    .set({ currentVersionId: version.id, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, input.storyId));

  return version;
}

export async function freezeAiStoryVersion(
  db: Db,
  input: {
    storyId: string;
    versionId: string;
    frozenBy: string;
    fromStatus: AiStoryStatus;
  }
) {
  const [version] = await db
    .select()
    .from(schema.aiStoryVersions)
    .where(
      and(
        eq(schema.aiStoryVersions.id, input.versionId),
        eq(schema.aiStoryVersions.storyId, input.storyId)
      )
    )
    .limit(1);
  if (!version) throw new Error("Story version not found");
  if (version.frozenAt) {
    assertAiStoryTransition(input.fromStatus, "ready_for_animation");
    await setAiStoryStatus(db, input.storyId, input.fromStatus, "ready_for_animation");
    return version;
  }

  const [frozen] = await db
    .update(schema.aiStoryVersions)
    .set({ frozenAt: new Date(), frozenBy: input.frozenBy })
    .where(
      and(
        eq(schema.aiStoryVersions.id, input.versionId),
        isNull(schema.aiStoryVersions.frozenAt)
      )
    )
    .returning();
  if (!frozen) throw new Error("Story version is already frozen");

  assertAiStoryTransition(input.fromStatus, "approved");
  await setAiStoryStatus(db, input.storyId, input.fromStatus, "approved");
  assertAiStoryTransition("approved", "ready_for_animation");
  await setAiStoryStatus(db, input.storyId, "approved", "ready_for_animation");

  await db
    .update(schema.aiStories)
    .set({ currentVersionId: frozen.id, updatedAt: new Date() })
    .where(eq(schema.aiStories.id, input.storyId));

  return frozen;
}
