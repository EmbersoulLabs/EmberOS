import { and, eq, inArray, sql } from "drizzle-orm";
import type { CreateCampaignContext } from "@ceo-agent/shared";
import { campaignObjectiveText } from "@ceo-agent/shared";
import { getDb } from "../client";
import * as schema from "../schema/index";
import { assertAssetsInWorkspace, assertAssetStoriesInWorkspace } from "./asset-library";

type Db = ReturnType<typeof getDb>;

export type CreateCampaignCommandResult = {
  campaign: typeof schema.campaigns.$inferSelect;
  reused: boolean;
};

/**
 * Atomically creates exactly one Campaign for a Workspace-scoped idempotency key
 * and freezes authorized Workspace Asset / Asset Story references.
 */
export async function createCampaignFromContext(
  db: Db,
  input: {
    orgId: string;
    userId: string;
    context: CreateCampaignContext;
  }
): Promise<CreateCampaignCommandResult> {
  const { context } = input;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${context.workspaceId}:${context.idempotencyKey}`}))`
    );

    const [existing] = await tx
      .select()
      .from(schema.campaigns)
      .where(
        and(
          eq(schema.campaigns.orgId, input.orgId),
          eq(schema.campaigns.workspaceId, context.workspaceId),
          eq(schema.campaigns.creationIdempotencyKey, context.idempotencyKey)
        )
      )
      .limit(1);
    if (existing) return { campaign: existing, reused: true };

    const identity = { orgId: input.orgId, workspaceId: context.workspaceId };
    await assertAssetsInWorkspace(tx, identity, context.assetReferences);
    await assertAssetStoriesInWorkspace(tx, identity, context.assetStoryReferences, true);

    const storyAssetRows = context.assetStoryReferences.length
      ? await tx
          .select({ assetId: schema.storyAssets.assetId })
          .from(schema.storyAssets)
          .where(inArray(schema.storyAssets.storyId, context.assetStoryReferences))
      : [];
    const allAssetIds = [
      ...new Set([
        ...context.assetReferences,
        ...storyAssetRows.map((row) => row.assetId),
      ]),
    ];
    await assertAssetsInWorkspace(tx, identity, allAssetIds);

    const objectiveText = campaignObjectiveText(context);
    const [campaign] = await tx
      .insert(schema.campaigns)
      .values({
        orgId: input.orgId,
        workspaceId: context.workspaceId,
        name: context.name,
        goal: objectiveText,
        platforms: context.publishingPlatforms,
        campaignBrief: context.campaignBrief?.trim() || null,
        objective: context.objective,
        objectiveCustom: context.customObjective?.trim() || null,
        targetAudience: context.targetAudience,
        creationIdempotencyKey: context.idempotencyKey,
        metadata: {
          createCampaignContextVersion: 1,
          inferredLanguage: context.inferredLanguage ?? null,
        },
        createdBy: input.userId,
      })
      .returning();
    if (!campaign) throw new Error("Campaign insert did not return a row");

    if (allAssetIds.length > 0) {
      await tx.insert(schema.campaignAssetRefs).values(
        allAssetIds.map((assetId, sortOrder) => ({
          campaignId: campaign.id,
          assetId,
          sortOrder,
        }))
      );
    }
    if (context.assetStoryReferences.length > 0) {
      await tx.insert(schema.campaignStoryRefs).values(
        context.assetStoryReferences.map((storyId) => ({
          campaignId: campaign.id,
          storyId,
        }))
      );
    }

    return { campaign, reused: false };
  });
}
