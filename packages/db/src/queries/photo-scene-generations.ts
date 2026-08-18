import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "../client";

type Db = ReturnType<typeof getDb>;

export async function insertPhotoSceneGeneration(
  db: Db,
  values: typeof schema.photoSceneGenerations.$inferInsert
) {
  const [row] = await db.insert(schema.photoSceneGenerations).values(values).returning();
  return row;
}

export async function getPhotoSceneGeneration(
  db: Db,
  generationId: string,
  workspaceId: string
) {
  const [row] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.id, generationId),
        eq(schema.photoSceneGenerations.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function findReusablePhotoSceneExtraction(
  db: Db,
  input: { workspaceId: string; fingerprint: string }
) {
  const [row] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.operation, "product_extraction"),
        eq(schema.photoSceneGenerations.inputFingerprint, input.fingerprint),
        eq(schema.photoSceneGenerations.status, "ready")
      )
    )
    .orderBy(desc(schema.photoSceneGenerations.completedAt), desc(schema.photoSceneGenerations.createdAt))
    .limit(1);
  return row ?? null;
}

export async function findInflightPhotoSceneExtraction(
  db: Db,
  input: { workspaceId: string; fingerprint: string }
) {
  const queued = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.operation, "product_extraction"),
        eq(schema.photoSceneGenerations.inputFingerprint, input.fingerprint),
        eq(schema.photoSceneGenerations.status, "processing")
      )
    )
    .limit(1);
  if (queued[0]) return queued[0];
  const [pending] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.operation, "product_extraction"),
        eq(schema.photoSceneGenerations.inputFingerprint, input.fingerprint),
        eq(schema.photoSceneGenerations.status, "queued")
      )
    )
    .limit(1);
  return pending ?? null;
}

export async function latestCampaignPhotoSceneExtraction(
  db: Db,
  input: { workspaceId: string; campaignId: string }
) {
  const [row] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.campaignId, input.campaignId),
        eq(schema.photoSceneGenerations.operation, "product_extraction")
      )
    )
    .orderBy(desc(schema.photoSceneGenerations.updatedAt), desc(schema.photoSceneGenerations.createdAt))
    .limit(1);
  return row ?? null;
}

export async function findInflightPhotoSceneMarketing(
  db: Db,
  input: { workspaceId: string; fingerprint: string }
) {
  const processing = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.operation, "marketing_image"),
        eq(schema.photoSceneGenerations.inputFingerprint, input.fingerprint),
        eq(schema.photoSceneGenerations.status, "processing")
      )
    )
    .limit(1);
  if (processing[0]) return processing[0];
  const [queued] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.operation, "marketing_image"),
        eq(schema.photoSceneGenerations.inputFingerprint, input.fingerprint),
        eq(schema.photoSceneGenerations.status, "queued")
      )
    )
    .limit(1);
  return queued ?? null;
}

export async function latestCampaignPhotoSceneMarketing(
  db: Db,
  input: { workspaceId: string; campaignId: string }
) {
  const [row] = await db
    .select()
    .from(schema.photoSceneGenerations)
    .where(
      and(
        eq(schema.photoSceneGenerations.workspaceId, input.workspaceId),
        eq(schema.photoSceneGenerations.campaignId, input.campaignId),
        eq(schema.photoSceneGenerations.operation, "marketing_image")
      )
    )
    .orderBy(desc(schema.photoSceneGenerations.updatedAt), desc(schema.photoSceneGenerations.createdAt))
    .limit(1);
  return row ?? null;
}
