import { and, eq, isNull } from "drizzle-orm";
import { assertAssetsInWorkspace, getDb, loadAssetStory, replaceAssetStoryAssets, requireWorkspaceRole, schema } from "@ceo-agent/db";
import { AssetStoryUpdateBodySchema, isUuid } from "@ceo-agent/shared";
import { apiError, apiSuccess } from "@/lib/api";
import { handleApiError, requireAuth } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "client_viewer");
    const story = await loadAssetStory(getDb(), { storyId, orgId: member.orgId, workspaceId });
    return story ? apiSuccess({ story }) : apiError("Asset Story not found", "NOT_FOUND", 404);
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const parsed = AssetStoryUpdateBodySchema.safeParse(await request.json());
    if (!parsed.success) return apiError("Invalid Asset Story update", "VALIDATION_ERROR", 400);
    const db = getDb();
    const updated = await db.transaction(async (tx) => {
      const existing = await loadAssetStory(tx, { storyId, orgId: member.orgId, workspaceId });
      if (!existing) return "NOT_FOUND" as const;
      if (existing.version !== parsed.data.expectedVersion) return "CONFLICT" as const;
      const assetIds = parsed.data.assetIds ?? existing.assets.map((asset) => asset.id);
      await assertAssetsInWorkspace(tx, { orgId: member.orgId, workspaceId }, assetIds);
      const requestedCover = parsed.data.coverAssetId === undefined ? existing.coverAssetId : parsed.data.coverAssetId;
      const coverAssetId = requestedCover && assetIds.includes(requestedCover) ? requestedCover : assetIds[0] ?? null;
      const [row] = await tx.update(schema.stories).set({
        name: parsed.data.name ?? existing.name,
        description: parsed.data.description ?? existing.description,
        status: parsed.data.status ?? existing.status,
        coverAssetId,
        version: existing.version + 1,
        updatedAt: new Date(),
      }).where(and(
        eq(schema.stories.id, storyId), eq(schema.stories.orgId, member.orgId),
        eq(schema.stories.workspaceId, workspaceId), eq(schema.stories.version, parsed.data.expectedVersion),
        isNull(schema.stories.deletedAt)
      )).returning({ id: schema.stories.id });
      if (!row) return "CONFLICT" as const;
      if (parsed.data.assetIds) await replaceAssetStoryAssets(tx, { storyId, orgId: member.orgId, workspaceId, assetIds });
      return "UPDATED" as const;
    });
    if (updated === "NOT_FOUND") return apiError("Asset Story not found", "NOT_FOUND", 404);
    if (updated === "CONFLICT") return apiError("Asset Story changed; reload before saving", "VERSION_CONFLICT", 409);
    return apiSuccess({ story: await loadAssetStory(db, { storyId, orgId: member.orgId, workspaceId }) });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; storyId: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId, storyId } = await params;
    if (!isUuid(workspaceId) || !isUuid(storyId)) return apiError("Invalid identity", "VALIDATION_ERROR", 400);
    const member = await requireWorkspaceRole(workspaceId, user.id, "operator");
    const db = getDb();
    const [campaignRef] = await db.select({ storyId: schema.campaignStoryRefs.storyId }).from(schema.campaignStoryRefs)
      .where(eq(schema.campaignStoryRefs.storyId, storyId)).limit(1);
    if (campaignRef) return apiError("Referenced Asset Stories cannot be archived", "VERSION_CONFLICT", 409);
    const [story] = await db.update(schema.stories).set({ status: "archived", deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.stories.id, storyId), eq(schema.stories.orgId, member.orgId), eq(schema.stories.workspaceId, workspaceId), isNull(schema.stories.deletedAt))).returning();
    return story ? apiSuccess({ story }) : apiError("Asset Story not found", "NOT_FOUND", 404);
  } catch (error) { return handleApiError(error); }
}
