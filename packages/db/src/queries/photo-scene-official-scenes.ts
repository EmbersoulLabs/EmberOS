import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export async function listPublishedOfficialSceneVersions(db: Db) {
  return db
    .select({
      version: schema.photoSceneOfficialSceneVersions,
      scene: schema.photoSceneOfficialScenes,
    })
    .from(schema.photoSceneOfficialSceneVersions)
    .innerJoin(
      schema.photoSceneOfficialScenes,
      eq(schema.photoSceneOfficialSceneVersions.sceneId, schema.photoSceneOfficialScenes.id)
    )
    .where(eq(schema.photoSceneOfficialSceneVersions.status, "published"));
}

export async function getOfficialSceneVersion(
  db: Db,
  sceneId: string,
  version: number
) {
  const [row] = await db
    .select({
      version: schema.photoSceneOfficialSceneVersions,
      scene: schema.photoSceneOfficialScenes,
    })
    .from(schema.photoSceneOfficialSceneVersions)
    .innerJoin(
      schema.photoSceneOfficialScenes,
      eq(schema.photoSceneOfficialSceneVersions.sceneId, schema.photoSceneOfficialScenes.id)
    )
    .where(
      and(
        eq(schema.photoSceneOfficialSceneVersions.sceneId, sceneId),
        eq(schema.photoSceneOfficialSceneVersions.version, version)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getCampaignSceneSelection(
  db: Db,
  input: { workspaceId: string; campaignId: string }
) {
  const [row] = await db
    .select()
    .from(schema.photoSceneSceneSelections)
    .where(
      and(
        eq(schema.photoSceneSceneSelections.workspaceId, input.workspaceId),
        eq(schema.photoSceneSceneSelections.campaignId, input.campaignId)
      )
    )
    .orderBy(desc(schema.photoSceneSceneSelections.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function upsertCampaignSceneSelection(
  db: Db,
  values: typeof schema.photoSceneSceneSelections.$inferInsert
) {
  const [row] = await db
    .insert(schema.photoSceneSceneSelections)
    .values(values)
    .onConflictDoUpdate({
      target: [
        schema.photoSceneSceneSelections.workspaceId,
        schema.photoSceneSceneSelections.campaignId,
      ],
      set: {
        extractedAssetId: values.extractedAssetId,
        frozenSelection: values.frozenSelection,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}
