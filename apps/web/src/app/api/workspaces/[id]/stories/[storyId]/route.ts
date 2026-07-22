import { and, asc, eq, isNull } from "drizzle-orm";
import {
  assertAssetsInWorkspace,
  getDb,
  replaceStoryAssets,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import { isUuid, StoryUpdateBodySchema } from "@ceo-agent/shared";
import { requireAuth, handleApiError } from "@/lib/auth";
import { apiSuccess, apiError } from "@/lib/api";

async function loadStoryWithAssets(db: ReturnType<typeof getDb>, storyId: string, workspaceId: string) {
  const [story] = await db
    .select()
    .from(schema.stories)
    .where(
      and(
        eq(schema.stories.id, storyId),
        eq(schema.stories.workspaceId, workspaceId),
        isNull(schema.stories.deletedAt)
      )
    )
    .limit(1);
  if (!story) return null;

  const links = await db
    .select({
      asset: schema.assets,
      sortOrder: schema.storyAssets.sortOrder,
    })
    .from(schema.storyAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.storyAssets.assetId))
    .where(and(eq(schema.storyAssets.storyId, storyId), isNull(schema.assets.deletedAt)))
    .orderBy(asc(schema.storyAssets.sortOrder));

  return {
    ...story,
    assets: links.map((l) => ({ ...l.asset, sortOrder: l.sortOrder })),
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const db = getDb();
    const story = await loadStoryWithAssets(db, storyId, workspaceId);
    if (!story) return apiError("Story not found", "NOT_FOUND", 404);
    return apiSuccess({ story });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const parsed = StoryUpdateBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid story payload", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.stories)
      .where(
        and(
          eq(schema.stories.id, storyId),
          eq(schema.stories.workspaceId, workspaceId),
          isNull(schema.stories.deletedAt)
        )
      )
      .limit(1);
    if (!existing) return apiError("Story not found", "NOT_FOUND", 404);

    if (parsed.data.assetIds) {
      const assetCheck = await assertAssetsInWorkspace(db, workspaceId, parsed.data.assetIds);
      if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);
      await replaceStoryAssets(db, storyId, parsed.data.assetIds);
    }

    const [updated] = await db
      .update(schema.stories)
      .set({
        name: parsed.data.name ?? existing.name,
        status: parsed.data.status ?? existing.status,
        updatedAt: new Date(),
      })
      .where(eq(schema.stories.id, storyId))
      .returning();

    const full = await loadStoryWithAssets(db, updated.id, workspaceId);
    return apiSuccess({ story: full });
  } catch (error) {
    return handleApiError(error);
  }
}

/** Soft delete Story — does not delete Assets (PD-037). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; storyId: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) {
      return apiError("Invalid ids", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const db = getDb();
    const [updated] = await db
      .update(schema.stories)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.stories.id, storyId),
          eq(schema.stories.workspaceId, workspaceId),
          isNull(schema.stories.deletedAt)
        )
      )
      .returning();

    if (!updated) return apiError("Story not found", "NOT_FOUND", 404);
    return apiSuccess({ story: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
