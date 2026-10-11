import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryAssetMatchingRepository,
  AiStoryAssetPlannerPersistenceError,
  closeDb,
} from "@ceo-agent/db";
import { AiStorySceneGroundingError } from "@ceo-agent/shared";
import { createIntegrationSql, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant, PR32_USER_A, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";

if (process.env.CI === "true" && (!RUN_DB_INTEGRATION || !getIntegrationDbUrl())) {
  throw new Error("NO_ASSET_CONFIRMATION_POSTGRES_REQUIRED_IN_CI");
}
const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("no-asset confirmation authority", () => {
  let sql: Sql;
  const ids: Phase2aIdSet = {
    orgId: randomUUID(),
    workspaceId: randomUUID(),
    campaignId: randomUUID(),
    storyId: randomUUID(),
    storyVersionId: randomUUID(),
    animationPackageId: randomUUID(),
    assetId: randomUUID(),
  };
  const staleVersionId = randomUUID();
  const unfrozenStoryId = randomUUID();
  const unfrozenVersionId = randomUUID();
  const assetStoryId = randomUUID();
  const assetVersionId = randomUUID();
  const boundAssetId = randomUUID();

  beforeAll(async () => {
    sql = createIntegrationSql();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "no-asset-confirmation");
    await sql`
      INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
      VALUES (${staleVersionId}, ${ids.storyId}, 2, ${sql.json({ title: "stale" })}, NOW())
    `;
    await sql`
      INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea)
      VALUES (${unfrozenStoryId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'Unfrozen', 'Idea')
    `;
    await sql`
      INSERT INTO ai_story_versions (id, story_id, version_number, structured_content)
      VALUES (${unfrozenVersionId}, ${unfrozenStoryId}, 1, ${sql.json({ title: "draft" })})
    `;
    await sql`UPDATE ai_stories SET current_version_id = ${unfrozenVersionId} WHERE id = ${unfrozenStoryId}`;
    await sql`
      INSERT INTO ai_stories (id, org_id, workspace_id, campaign_id, title, original_idea)
      VALUES (${assetStoryId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId}, 'Assets', 'Idea')
    `;
    await sql`
      INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
      VALUES (${assetVersionId}, ${assetStoryId}, 1, ${sql.json({ title: "assets" })}, NOW())
    `;
    await sql`UPDATE ai_stories SET current_version_id = ${assetVersionId} WHERE id = ${assetStoryId}`;
    await sql`
      INSERT INTO assets (id, org_id, workspace_id, campaign_id, type, storage_path, status)
      VALUES (
        ${boundAssetId}, ${ids.orgId}, ${ids.workspaceId}, ${ids.campaignId},
        'image', ${`${ids.workspaceId}/library/${boundAssetId}`}, 'ready'
      )
    `;
    await sql`
      INSERT INTO ai_story_asset_links (story_id, asset_id, usage_type)
      VALUES (${assetStoryId}, ${boundAssetId}, 'reference')
    `;
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM ai_story_asset_matching_results WHERE org_id = ${ids.orgId}`;
    await sql`DELETE FROM ai_story_asset_links WHERE asset_id = ${boundAssetId}`;
    await sql`DELETE FROM assets WHERE id = ${boundAssetId}`;
    await sql`DELETE FROM ai_story_versions WHERE id IN (${staleVersionId}, ${unfrozenVersionId}, ${assetVersionId})`;
    await sql`DELETE FROM ai_stories WHERE id IN (${unfrozenStoryId}, ${assetStoryId})`;
    await cleanupPr32Tenant(sql, ids);
    await sql.end();
    await closeDb();
  }, 120_000);

  const repository = () => new AiStoryAssetMatchingRepository();

  function confirm(input: {
    orgId?: string;
    workspaceId?: string;
    storyId?: string;
    storyVersionId?: string;
    confirmedBy?: string;
  }) {
    return repository().confirmNoReferenceAssets({
      orgId: input.orgId ?? ids.orgId,
      workspaceId: input.workspaceId ?? ids.workspaceId,
      storyId: input.storyId ?? ids.storyId,
      storyVersionId: input.storyVersionId ?? ids.storyVersionId,
      confirmedBy: input.confirmedBy ?? PR32_USER_A,
      confirmedAt: "2026-10-11T08:55:00.000Z",
    });
  }

  it("rejects a missing confirmation, then accepts one zero-asset result", async () => {
    await expect(repository().loadScenePlanningGroundingContext({
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
      storyId: ids.storyId,
      storyVersionId: ids.storyVersionId,
    })).rejects.toBeInstanceOf(AiStorySceneGroundingError);

    const [before] = await sql<{
      version_number: number;
      frozen_at: Date | null;
      structured_content: unknown;
    }[]>`
      select version_number, frozen_at, structured_content
      from ai_story_versions where id = ${ids.storyVersionId}
    `;
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      throw new Error("provider call is not part of no-asset confirmation");
    }) as typeof fetch;
    let result;
    try {
      result = await confirm({});
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(calls).toEqual([]);
    expect(result.assetRecommendationStatus).toBe("CONFIRMED_NO_ASSETS");
    expect(result.bindings).toEqual([]);
    expect(result.storyVersionId).toBe(ids.storyVersionId);
    expect(result.noAssetConfirmation).toMatchObject({
      storyId: ids.storyId,
      storyVersionId: ids.storyVersionId,
      confirmedBy: PR32_USER_A,
      authorityVersion: "no-asset-confirmation.v1",
    });

    const [after] = await sql<{
      version_number: number;
      frozen_at: Date | null;
      structured_content: unknown;
    }[]>`
      select version_number, frozen_at, structured_content
      from ai_story_versions where id = ${ids.storyVersionId}
    `;
    expect(after).toEqual(before);

    const repeated = await confirm({ confirmedBy: randomUUID() });
    expect(repeated.matchingResultId).toBe(result.matchingResultId);
    expect(repeated.noAssetConfirmation?.confirmedBy).toBe(PR32_USER_A);
    const [count] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from ai_story_asset_matching_results
      where story_version_id = ${ids.storyVersionId}
    `;
    expect(count?.n).toBe(1);

    const grounding = await repository().loadScenePlanningGroundingContext({
      orgId: ids.orgId,
      workspaceId: ids.workspaceId,
      storyId: ids.storyId,
      storyVersionId: ids.storyVersionId,
    });
    expect(grounding.matchingResultId).toBe(result.matchingResultId);
    expect(grounding.storyVersionId).toBe(ids.storyVersionId);
    expect(grounding.bindings).toEqual([]);
  });

  it("rejects another tenant, a stale version, an unfrozen version, and a bound asset", async () => {
    await expect(confirm({ orgId: randomUUID() })).rejects.toMatchObject({
      code: "STORY_ASSET_BINDING_SCOPE_MISMATCH",
    });
    await expect(confirm({ storyVersionId: staleVersionId })).rejects.toMatchObject({
      code: "NO_ASSET_CONFIRMATION_STALE_VERSION",
    });
    await expect(confirm({
      storyId: unfrozenStoryId,
      storyVersionId: unfrozenVersionId,
    })).rejects.toBeInstanceOf(AiStoryAssetPlannerPersistenceError);
    await expect(confirm({
      storyId: unfrozenStoryId,
      storyVersionId: unfrozenVersionId,
    })).rejects.toMatchObject({ code: "NO_ASSET_CONFIRMATION_VERSION_NOT_FROZEN" });
    await expect(confirm({
      storyId: assetStoryId,
      storyVersionId: assetVersionId,
    })).rejects.toMatchObject({ code: "NO_ASSET_CONFIRMATION_ASSETS_PRESENT" });
    const [assetRows] = await sql<{ n: number }[]>`
      select count(*)::int as n
      from ai_story_asset_matching_results
      where story_version_id = ${assetVersionId}
    `;
    expect(assetRows?.n).toBe(0);
  });
});
