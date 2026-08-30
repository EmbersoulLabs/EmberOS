import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { assertAssetsInWorkspace, getDb, loadAssetStory, replaceAssetStoryAssets, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { AssetStoryCreateBodySchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const includeArchived = url.searchParams.get("includeArchived") === "1";
    const conditions = [eq(schema.stories.orgId, member.orgId), eq(schema.stories.workspaceId, workspaceId), isNull(schema.stories.deletedAt)];
    if (!includeArchived) conditions.push(or(eq(schema.stories.status, "draft"), eq(schema.stories.status, "ready"))!);
    if (query) conditions.push(sql`lower(${schema.stories.name}) like ${`%${query}%`}`);
    const db = getDb();
    const rows = await db.select({ id: schema.stories.id }).from(schema.stories).where(and(...conditions)).orderBy(desc(schema.stories.updatedAt)).limit(200);
    const stories = (await Promise.all(rows.map(({ id }) => loadAssetStory(db, { storyId: id, orgId: member.orgId, workspaceId })))).filter(Boolean);
    return apiSuccess({ stories });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (!isUuid(workspaceId)) return apiError("Invalid Workspace", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const parsed = AssetStoryCreateBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid Asset Story", "VALIDATION_ERROR", 400);
    const db = getDb();
    const storyId = await db.transaction(async (tx) => {
      await assertAssetsInWorkspace(tx, { orgId: member.orgId, workspaceId }, parsed.data.assetIds);
      const [story] = await tx.insert(schema.stories).values({
        orgId: member.orgId,
        workspaceId,
        name: parsed.data.name,
        description: parsed.data.description,
        status: parsed.data.status ?? "draft",
        coverAssetId: parsed.data.coverAssetId ?? parsed.data.assetIds[0] ?? null,
        createdBy: user.id,
      }).returning({ id: schema.stories.id });
      await replaceAssetStoryAssets(tx, { storyId: story.id, orgId: member.orgId, workspaceId, assetIds: parsed.data.assetIds });
      return story.id;
    });
    return apiSuccess({ story: await loadAssetStory(db, { storyId, orgId: member.orgId, workspaceId }) }, 201);
  } catch (error) { return handleApiError(error); }
}

