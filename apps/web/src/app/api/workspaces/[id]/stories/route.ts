import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import {
  assertAssetsInWorkspace,
  getDb,
  replaceStoryAssets,
  requireWorkspaceRole,
  schema,
} from "@ceo-agent/db";
import { isUuid, StoryCreateBodySchema } from "@ceo-agent/shared";
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
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "client_viewer");

    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const status = url.searchParams.get("status")?.trim() ?? "";
    const includeArchived = url.searchParams.get("includeArchived") === "1";

    const db = getDb();
    const conditions = [
      eq(schema.stories.workspaceId, workspaceId),
      isNull(schema.stories.deletedAt),
    ];
    if (status && ["draft", "ready", "archived"].includes(status)) {
      conditions.push(eq(schema.stories.status, status));
    } else if (!includeArchived) {
      conditions.push(
        or(eq(schema.stories.status, "draft"), eq(schema.stories.status, "ready"))!
      );
    }
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      conditions.push(sql`lower(${schema.stories.name}) like ${like}`);
    }

    const stories = await db
      .select()
      .from(schema.stories)
      .where(and(...conditions))
      .orderBy(sql`${schema.stories.updatedAt} desc`)
      .limit(200);

    const enriched = await Promise.all(
      stories.map(async (story) => {
        const full = await loadStoryWithAssets(db, story.id, workspaceId);
        return full ?? { ...story, assets: [] };
      })
    );

    return apiSuccess({ stories: enriched });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) {
      return apiError("workspace id must be a valid UUID", "VALIDATION_ERROR", 400);
    }
    await requireWorkspaceRole(workspaceId, user.id, "operator");

    const parsed = StoryCreateBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("Invalid story payload", "VALIDATION_ERROR", 400);
    }

    const db = getDb();
    const [workspace] = await db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) return apiError("Workspace not found", "NOT_FOUND", 404);

    const assetCheck = await assertAssetsInWorkspace(db, workspaceId, parsed.data.assetIds);
    if (!assetCheck.ok) return apiError(assetCheck.error, "VALIDATION_ERROR", 400);

    const [story] = await db
      .insert(schema.stories)
      .values({
        orgId: workspace.orgId,
        workspaceId,
        name: parsed.data.name,
        status: parsed.data.status ?? "draft",
        createdBy: user.id,
      })
      .returning();

    await replaceStoryAssets(db, story.id, parsed.data.assetIds);
    const full = await loadStoryWithAssets(db, story.id, workspaceId);
    return apiSuccess({ story: full }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
