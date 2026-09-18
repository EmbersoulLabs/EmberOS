import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import {
  PHOTO_SCENE_EXTRACTION_CONTRACT,
  PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
  PHOTO_SCENE_EXTRACTION_POLICY,
  photoSceneMetadata,
} from "@ceo-agent/shared";
import { fingerprintPhotoSceneExtractionIdentityV1 } from "@ceo-agent/shared/photo-scene-extraction.server";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const executionSpies = vi.hoisted(() => ({
  enqueue: vi.fn(),
  sign: vi.fn().mockRejectedValue(new Error("BLOCKED_TEST_ONLY_SIGNING")),
}));

vi.mock("@ceo-agent/queue", () => ({
  enqueuePhotoSceneExtract: executionSpies.enqueue,
}));

vi.mock("@/lib/asset-signed-delivery", () => ({
  signPrivateCampaignAsset: executionSpies.sign,
}));

import { requestProductExtraction } from "../apps/web/src/lib/photo-scene-extraction";

describe.skipIf(!RUN_DB_INTEGRATION).sequential(
  "Photo Scene reused derivative Campaign authorization convergence",
  () => {
    let sql: Sql;
    let fixture: RlsTestFixture;
    let originalFetch: typeof globalThis.fetch;
    let networkAttempts = 0;
    const currentCampaignId = crypto.randomUUID();
    const sourceAssetId = crypto.randomUUID();
    const derivativeAssetId = crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const sourceContentHash = `sha256:${"a".repeat(64)}`;
    const derivativeContentHash = `sha256:${"d".repeat(64)}`;
    let fingerprint = "";

    beforeAll(async () => {
      executionSpies.enqueue.mockClear();
      executionSpies.sign.mockClear();
      originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(async () => {
        networkAttempts += 1;
        throw new Error("BLOCKED_EXTERNAL_NETWORK_IN_DB_CERTIFICATION");
      }) as typeof globalThis.fetch;

      sql = createIntegrationSql();
      fixture = await seedRlsFixture(sql);
      fingerprint = fingerprintPhotoSceneExtractionIdentityV1({
        version: PHOTO_SCENE_EXTRACTION_CONTRACT_VERSION,
        contract: PHOTO_SCENE_EXTRACTION_CONTRACT,
        operation: "product_extraction",
        policy: PHOTO_SCENE_EXTRACTION_POLICY,
        workspaceId: fixture.workspaceAId,
        sourceContentHash,
      });

      await sql`
        INSERT INTO campaigns (id, org_id, workspace_id, name, platforms, status)
        VALUES (
          ${currentCampaignId}, ${fixture.orgId}, ${fixture.workspaceAId},
          ${"Current Campaign"}, ${["tiktok"]}, ${"draft"}
        )
      `;
      await sql`
        INSERT INTO assets (
          id, org_id, workspace_id, campaign_id, type, storage_path,
          mime_type, content_hash, status, metadata
        ) VALUES
          (
            ${sourceAssetId}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, ${"image"},
            ${`${fixture.workspaceAId}/library/${sourceAssetId}.png`},
            ${"image/png"}, ${sourceContentHash}, ${"ready"},
            ${sql.json({ photoScene: photoSceneMetadata("product_source") } as never)}
          ),
          (
            ${derivativeAssetId}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, ${"image"},
            ${`${fixture.workspaceAId}/library/${derivativeAssetId}.png`},
            ${"image/png"}, ${derivativeContentHash}, ${"ready"},
            ${sql.json({
              photoScene: photoSceneMetadata("extracted_product", {
                sourceAssetId,
                sourceContentHash,
                operation: "product_extraction",
                generationId,
                generationFingerprint: fingerprint,
              }),
            } as never)}
          )
      `;
      await sql`
        INSERT INTO photo_scene_generations (
          id, org_id, workspace_id, campaign_id, operation, status,
          source_asset_id, source_content_hash, input_capsule,
          input_fingerprint, output_asset_id, attempt_count, created_by,
          completed_at
        ) VALUES (
          ${generationId}, ${fixture.orgId}, ${fixture.workspaceAId},
          ${fixture.campaignAId}, ${"product_extraction"}, ${"ready"},
          ${sourceAssetId}, ${sourceContentHash}, ${sql.json({} as never)},
          ${fingerprint}, ${derivativeAssetId}, 1, ${fixture.userAId}, now()
        )
      `;
      await sql`
        INSERT INTO campaign_asset_refs (campaign_id, asset_id)
        VALUES
          (${fixture.campaignAId}, ${sourceAssetId}),
          (${fixture.campaignAId}, ${derivativeAssetId}),
          (${currentCampaignId}, ${sourceAssetId})
      `;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      if (!sql || !fixture) return;
      await closeDb();
      await sql`DELETE FROM campaign_asset_refs WHERE asset_id IN (${sourceAssetId}, ${derivativeAssetId})`;
      await sql`DELETE FROM photo_scene_generations WHERE id = ${generationId}`;
      await sql`DELETE FROM assets WHERE id IN (${sourceAssetId}, ${derivativeAssetId})`;
      await sql`DELETE FROM campaigns WHERE id = ${currentCampaignId}`;
      await cleanupRlsFixture(sql, fixture);
      await sql.end();
    });

    it("authorizes one exact READY derivative for the current Campaign without execution", async () => {
      const db = getDb();
      const [campaign] = await db
        .select()
        .from(schema.campaigns)
        .where(eq(schema.campaigns.id, currentCampaignId))
        .limit(1);
      const [generationBefore] = await db
        .select()
        .from(schema.photoSceneGenerations)
        .where(eq(schema.photoSceneGenerations.id, generationId))
        .limit(1);
      const [derivativeBefore] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, derivativeAssetId))
        .limit(1);
      const generationCountBefore = await db
        .select({ id: schema.photoSceneGenerations.id })
        .from(schema.photoSceneGenerations)
        .where(
          and(
            eq(schema.photoSceneGenerations.workspaceId, fixture.workspaceAId),
            eq(schema.photoSceneGenerations.sourceAssetId, sourceAssetId)
          )
        );
      const refsBefore = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM campaign_asset_refs
        WHERE campaign_id = ${currentCampaignId} AND asset_id = ${derivativeAssetId}
      `;
      expect(refsBefore[0]?.count).toBe("0");

      const first = await requestProductExtraction(db, {
        campaign: campaign!,
        sourceAssetId,
        userId: fixture.userAId,
      });
      const second = await requestProductExtraction(db, {
        campaign: campaign!,
        sourceAssetId,
        userId: fixture.userAId,
      });

      expect(first).toMatchObject({ status: 200, dto: { id: generationId, reused: true } });
      expect(second).toMatchObject({ status: 200, dto: { id: generationId, reused: true } });
      const refsAfter = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM campaign_asset_refs
        WHERE campaign_id = ${currentCampaignId} AND asset_id = ${derivativeAssetId}
      `;
      expect(refsAfter[0]?.count).toBe("1");

      const [generationAfter] = await db
        .select()
        .from(schema.photoSceneGenerations)
        .where(eq(schema.photoSceneGenerations.id, generationId))
        .limit(1);
      const [derivativeAfter] = await db
        .select()
        .from(schema.assets)
        .where(eq(schema.assets.id, derivativeAssetId))
        .limit(1);
      const generationCountAfter = await db
        .select({ id: schema.photoSceneGenerations.id })
        .from(schema.photoSceneGenerations)
        .where(
          and(
            eq(schema.photoSceneGenerations.workspaceId, fixture.workspaceAId),
            eq(schema.photoSceneGenerations.sourceAssetId, sourceAssetId)
          )
        );
      expect(generationAfter).toEqual(generationBefore);
      expect(derivativeAfter).toEqual(derivativeBefore);
      expect(generationCountAfter).toEqual(generationCountBefore);
      expect(executionSpies.enqueue).not.toHaveBeenCalled();
      expect(networkAttempts).toBe(0);
      expect(executionSpies.sign).toHaveBeenCalled();
    });
  }
);
