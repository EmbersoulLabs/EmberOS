import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb } from "@ceo-agent/db";
import { loadCanonicalCampaignAssetAuthority } from "../apps/worker/src/ai-story-provider-asset-access";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const ASSET = "71000000-0000-4000-8000-000000000001";

describeIntegration("Worker Provider Asset Campaign authority persistence", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    await sql`
      INSERT INTO assets (
        id, org_id, workspace_id, campaign_id, type, storage_path, status, source, mime_type
      ) VALUES (
        ${ASSET}::uuid, ${fixture.orgId}::uuid, ${fixture.workspaceAId}::uuid,
        NULL, 'image', 'private/canonical-first-frame.png', 'ready', 'campaign_upload', 'image/png'
      )
    `;
    await sql`
      INSERT INTO campaign_asset_refs (campaign_id, asset_id, sort_order)
      VALUES (${fixture.campaignAId}::uuid, ${ASSET}::uuid, 0)
    `;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`DELETE FROM campaign_asset_refs WHERE asset_id = ${ASSET}::uuid`;
    await sql`DELETE FROM assets WHERE id = ${ASSET}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("authorizes a canonical Campaign reference when legacy campaign_id is null", async () => {
    await expect(
      loadCanonicalCampaignAssetAuthority({
        assetId: ASSET,
        orgId: fixture.orgId,
        workspaceId: fixture.workspaceAId,
        campaignId: fixture.campaignAId,
      })
    ).resolves.toMatchObject({
      assetId: ASSET,
      campaignId: fixture.campaignAId,
      mimeType: "image/png",
    });
  });

  it("denies missing Campaign binding and cross-scope authority", async () => {
    const base = {
      assetId: ASSET,
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      campaignId: fixture.campaignAId,
    };
    await expect(
      loadCanonicalCampaignAssetAuthority({ ...base, campaignId: fixture.campaignBId })
    ).resolves.toBeNull();
    await expect(
      loadCanonicalCampaignAssetAuthority({ ...base, workspaceId: fixture.workspaceBId })
    ).resolves.toBeNull();
    await expect(
      loadCanonicalCampaignAssetAuthority({ ...base, orgId: crypto.randomUUID() })
    ).resolves.toBeNull();

    await sql`DELETE FROM campaign_asset_refs WHERE asset_id = ${ASSET}::uuid`;
    await expect(loadCanonicalCampaignAssetAuthority(base)).resolves.toBeNull();
    await sql`
      INSERT INTO campaign_asset_refs (campaign_id, asset_id, sort_order)
      VALUES (${fixture.campaignAId}::uuid, ${ASSET}::uuid, 0)
    `;
  });
});
