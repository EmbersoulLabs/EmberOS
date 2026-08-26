import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import { getCampaignAssets } from "../apps/web/src/lib/campaign-assets";
import { RUN_DB_INTEGRATION, createIntegrationSql, withAuthenticatedUser } from "./helpers/db-integration";

const suite = RUN_DB_INTEGRATION ? describe : describe.skip;

suite.sequential("Wave 1 Asset Library PostgreSQL authority", () => {
  let sql: Sql;
  const ids = {
    orgA: crypto.randomUUID(), orgB: crypto.randomUUID(), wsA: crypto.randomUUID(), wsB: crypto.randomUUID(),
    userA: crypto.randomUUID(), userB: crypto.randomUUID(), campaignA: crypto.randomUUID(), campaignB: crypto.randomUUID(),
    legacy: crypto.randomUUID(), libraryA: crypto.randomUUID(), libraryB: crypto.randomUUID(), storyA: crypto.randomUUID(),
  };

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    `);
    await sql.unsafe(readFileSync(resolve("packages/db/sql/asset-library-wave1-v1.sql"), "utf8"));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON assets, workspace_members TO authenticated");
    const suffix = crypto.randomUUID().slice(0, 8);
    await sql`insert into organizations(id,name,slug) values (${ids.orgA},'Asset A',${`asset-a-${suffix}`}),(${ids.orgB},'Asset B',${`asset-b-${suffix}`})`;
    await sql`insert into workspaces(id,org_id,name,slug) values (${ids.wsA},${ids.orgA},'Workspace A',${`ws-a-${suffix}`}),(${ids.wsB},${ids.orgB},'Workspace B',${`ws-b-${suffix}`})`;
    await sql`insert into workspace_members(org_id,workspace_id,user_id,role) values (${ids.orgA},${ids.wsA},${ids.userA},'admin'),(${ids.orgB},${ids.wsB},${ids.userB},'admin')`;
    await sql`insert into campaigns(id,org_id,workspace_id,name,platforms,status) values (${ids.campaignA},${ids.orgA},${ids.wsA},'Campaign A',array['tiktok'],'draft'),(${ids.campaignB},${ids.orgB},${ids.wsB},'Campaign B',array['tiktok'],'draft')`;
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,mime_type,content_hash,display_name,status,source) values
      (${ids.legacy},${ids.orgA},${ids.wsA},${ids.campaignA},'image',${`${ids.wsA}/campaigns/${ids.campaignA}/source/${ids.legacy}.png`},'image/png',${`sha256:${"1".repeat(64)}`} ,'Legacy','ready','campaign_upload'),
      (${ids.libraryA},${ids.orgA},${ids.wsA},null,'image',${`${ids.wsA}/library/${ids.libraryA}.png`},'image/png',${`sha256:${"2".repeat(64)}`} ,'Library A','ready','library_upload'),
      (${ids.libraryB},${ids.orgB},${ids.wsB},null,'image',${`${ids.wsB}/library/${ids.libraryB}.png`},'image/png',${`sha256:${"2".repeat(64)}`} ,'Library B','ready','library_upload')`;
    await sql`insert into campaign_asset_refs(campaign_id,asset_id,sort_order) values (${ids.campaignA},${ids.libraryA},0)`;
    await sql`insert into stories(id,org_id,workspace_id,name,status,cover_asset_id) values (${ids.storyA},${ids.orgA},${ids.wsA},'Launch','ready',${ids.libraryA})`;
    await sql`insert into story_assets(story_id,asset_id,sort_order) values (${ids.storyA},${ids.libraryA},0)`;
  });

  afterAll(async () => {
    await closeDb();
    if (sql) {
      await sql`delete from campaign_story_refs where campaign_id in (${ids.campaignA},${ids.campaignB})`;
      await sql`delete from story_assets where story_id = ${ids.storyA}`;
      await sql`delete from stories where id = ${ids.storyA}`;
      await sql`delete from campaign_asset_refs where campaign_id in (${ids.campaignA},${ids.campaignB})`;
      await sql`delete from assets where id in (${ids.legacy},${ids.libraryA},${ids.libraryB})`;
      await sql`delete from campaigns where id in (${ids.campaignA},${ids.campaignB})`;
      await sql`delete from workspace_members where workspace_id in (${ids.wsA},${ids.wsB})`;
      await sql`delete from workspaces where id in (${ids.wsA},${ids.wsB})`;
      await sql`delete from organizations where id in (${ids.orgA},${ids.orgB})`;
      await sql.end();
    }
  });

  it("preserves the historical Campaign source resolver and adds references without rewriting IDs", async () => {
    const assets = await getCampaignAssets(getDb(), ids.campaignA, ids.wsA);
    expect(new Set(assets.map((asset) => asset.id))).toEqual(new Set([ids.legacy, ids.libraryA]));
    const refs = await sql<{ asset_id: string }[]>`
      select asset_id from campaign_asset_refs where campaign_id=${ids.campaignA} order by sort_order,asset_id
    `;
    expect(refs.map((row) => row.asset_id)).toEqual([ids.libraryA]);
    const [legacy] = await sql<{ id: string; campaign_id: string }[]>`
      select id,campaign_id from assets where id=${ids.legacy}
    `;
    expect(legacy).toEqual({ id: ids.legacy, campaign_id: ids.campaignA });
  });

  it("enforces cross-tenant and cross-workspace reference triggers", async () => {
    await expect(sql`insert into campaign_asset_refs(campaign_id,asset_id) values (${ids.campaignA},${ids.libraryB})`).rejects.toThrow(/cross-tenant|cross-workspace/i);
    await expect(sql`insert into story_assets(story_id,asset_id) values (${ids.storyA},${ids.libraryB})`).rejects.toThrow(/cross-tenant|cross-workspace/i);
    await expect(sql`update stories set cover_asset_id=${ids.libraryB} where id=${ids.storyA}`).rejects.toThrow(/outside the authorized Workspace/i);
  });

  it("keeps same-content identities isolated by Workspace", async () => {
    const rows = await sql<{ id: string; workspace_id: string }[]>`select id,workspace_id from assets where content_hash=${`sha256:${"2".repeat(64)}`} order by workspace_id`;
    expect(rows).toHaveLength(2);
    const visible = await withAuthenticatedUser(sql, ids.userA, (tx) => tx<{ id: string }[]>`select id from assets where content_hash=${`sha256:${"2".repeat(64)}`}`);
    expect(visible.map((row) => row.id)).toEqual([ids.libraryA]);
  });

  it("preserves ordered Asset Story identity and uniqueness", async () => {
    const [story] = await sql<{ cover_asset_id: string; version: number }[]>`select cover_asset_id,version from stories where id=${ids.storyA}`;
    expect(story).toMatchObject({ cover_asset_id: ids.libraryA, version: 1 });
    await expect(sql`insert into story_assets(story_id,asset_id,sort_order) values (${ids.storyA},${ids.libraryA},1)`).rejects.toBeTruthy();
  });
});
