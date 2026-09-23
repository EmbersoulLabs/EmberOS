import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createSqlVideoAnalysisSnapshotRepository } from "@ceo-agent/db";
import {
  AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
  AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
} from "@ceo-agent/shared";
import { ensureAiStoryVideoAssetAnalysis } from "../packages/agents/src/ai-story/video-observation-service";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
  isRlsEnabled,
  seedRlsFixture,
  withAuthenticatedUser,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const hash = `sha256:${"ef".repeat(32)}`;

describeIntegration.sequential("AI Story video analysis snapshot PostgreSQL authority", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let assetId = "";

  afterAll(async () => {
    if (!sql) return;
    if (assetId) {
      await sql`ALTER TABLE ai_story_video_analysis_snapshots DISABLE TRIGGER ai_story_video_analysis_snapshots_no_mutation`;
      await sql`DELETE FROM ai_story_video_analysis_claims WHERE asset_id = ${assetId}`;
      await sql`DELETE FROM ai_story_video_analysis_snapshots WHERE asset_id = ${assetId}`;
      await sql`ALTER TABLE ai_story_video_analysis_snapshots ENABLE TRIGGER ai_story_video_analysis_snapshots_no_mutation`;
      await sql`DELETE FROM assets WHERE id = ${assetId}`;
    }
    if (fixture) {
      await sql`DELETE FROM campaigns WHERE id IN (${fixture.campaignAId}, ${fixture.campaignBId})`;
      await sql`DELETE FROM workspace_members WHERE workspace_id IN (${fixture.workspaceAId}, ${fixture.workspaceBId})`;
      await sql`DELETE FROM workspaces WHERE id IN (${fixture.workspaceAId}, ${fixture.workspaceBId})`;
      await sql`DELETE FROM organizations WHERE id = ${fixture.orgId}`;
    }
    await sql.end();
  });

  it("applies additive snapshot authority without changing existing asset rows", async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    assetId = crypto.randomUUID();
    await sql`
      INSERT INTO assets (
        id, org_id, workspace_id, type, storage_path, mime_type, duration_sec, width, height, content_hash
      ) VALUES (
        ${assetId}, ${fixture.orgId}, ${fixture.workspaceAId}, ${"video"}, ${`${fixture.workspaceAId}/clip.mp4`},
        ${"video/mp4"}, ${4}, ${720}, ${1280}, ${hash}
      )
    `;
    const before = await sql<{ assets: number }[]>`SELECT count(*)::int AS assets FROM assets`;
    const migration = readFileSync(resolve("packages/db/sql/ai-story-video-analysis-snapshot-v1.sql"), "utf8");
    await sql.unsafe(migration);
    const after = await sql<{ assets: number; content_hash: string }[]>`
      SELECT (SELECT count(*)::int FROM assets) AS assets, content_hash
      FROM assets WHERE id = ${assetId}
    `;
    expect(after[0]?.assets).toBe(before[0]?.assets);
    expect(after[0]?.content_hash).toBe(hash);
    expect(await isRlsEnabled(sql, "ai_story_video_analysis_snapshots")).toBe(true);
    expect(await isRlsEnabled(sql, "ai_story_video_analysis_claims")).toBe(true);
    const policies = await sql<{ polname: string; polcmd: string }[]>`
      SELECT pol.polname, pol.polcmd
      FROM pg_policy pol
      JOIN pg_class cls ON cls.oid = pol.polrelid
      WHERE cls.relname = 'ai_story_video_analysis_snapshots'
    `;
    expect(policies.map((policy) => policy.polcmd).sort()).toEqual(["r"]);
  });

  it("lets one claim win and reuses the stored snapshot across campaigns", async () => {
    const repository = createSqlVideoAnalysisSnapshotRepository(sql, {
      sleep: () => new Promise((resolveSleep) => setTimeout(resolveSleep, 15)),
    });
    const key = {
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      assetId,
      assetContentHash: hash,
      analysisVersion: AI_STORY_VIDEO_ASSET_ANALYSIS_VERSION,
      extractorVersion: AI_STORY_VIDEO_OBSERVATION_EXTRACTOR_VERSION,
    };
    const claims = await Promise.all([repository.tryClaim(key), repository.tryClaim(key)]);
    expect(claims.filter((claim) => claim.acquired)).toHaveLength(1);
    const winner = claims.find((claim) => claim.acquired);
    if (winner?.acquired) await repository.failClaim(winner.claimId, "TEST_RELEASE");

    let providerCalls = 0;
    const ensure = (campaignId: string) => ensureAiStoryVideoAssetAnalysis({
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      assetId,
      contentHash: hash,
      planningContext: { campaignId },
      findAsset: async (requested) => {
        const rows = await sql<{
          id: string;
          org_id: string;
          workspace_id: string;
          storage_path: string;
          content_hash: string;
          mime_type: string | null;
          type: string;
          duration_sec: string | null;
          width: number | null;
          height: number | null;
          deleted_at: Date | null;
        }[]>`
          SELECT id, org_id, workspace_id, storage_path, content_hash, mime_type, type,
                 duration_sec, width, height, deleted_at
          FROM assets
          WHERE id = ${requested.assetId}
            AND org_id = ${requested.orgId}
            AND workspace_id = ${requested.workspaceId}
            AND deleted_at IS NULL
          LIMIT 1
        `;
        const row = rows[0];
        if (!row?.content_hash || !row.duration_sec || !row.width || !row.height) return null;
        return {
          assetId: row.id,
          orgId: row.org_id,
          workspaceId: row.workspace_id,
          storagePath: row.storage_path,
          contentHash: row.content_hash,
          mimeType: row.mime_type,
          mediaType: row.type,
          durationSec: Number(row.duration_sec),
          width: row.width,
          height: row.height,
          fps: null,
          deletedAt: null,
        };
      },
      repository,
      prepareVision: async () => ({
        frames: [{ atSec: 0.5, dataUrl: "data:image/jpeg;base64,frame" }],
      }),
      extractObservation: async () => {
        providerCalls += 1;
        return {
          raw: {
            primaryActionSummary: "A person writes an invoice by hand.",
            actionReferenceStrength: true,
            actionTags: ["WRITING"],
            primaryPersonPresent: true,
          },
          providerId: "fake-observation",
          modelId: "fake-model",
          providerRequestId: null,
          costUsd: 0,
        };
      },
      now: () => "2026-09-24T00:00:00.000Z",
    });

    const [first, second] = await Promise.all([
      ensure(fixture.campaignAId),
      ensure(fixture.campaignBId),
    ]);
    const reused = await ensure(fixture.campaignAId);
    expect(providerCalls).toBe(1);
    expect(first.snapshot.id).toBe(second.snapshot.id);
    expect(reused.reused).toBe(true);
    expect(reused.providerCalls).toBe(0);
    const stored = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM ai_story_video_analysis_snapshots
      WHERE asset_id = ${assetId}
    `;
    expect(stored[0]?.count).toBe(1);

    const visibleToOwner = await withAuthenticatedUser(sql, fixture.userAId, (tx) => tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_video_analysis_snapshots WHERE asset_id = ${assetId}
    `);
    const visibleToOtherWorkspace = await withAuthenticatedUser(sql, fixture.userBId, (tx) => tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai_story_video_analysis_snapshots WHERE asset_id = ${assetId}
    `);
    expect(visibleToOwner[0]?.count).toBe(1);
    expect(visibleToOtherWorkspace[0]?.count).toBe(0);
    await expect(sql`
      UPDATE ai_story_video_analysis_snapshots
      SET provider_id = 'changed'
      WHERE asset_id = ${assetId}
    `).rejects.toThrow(/AI_STORY_VIDEO_ANALYSIS_SNAPSHOT_IMMUTABLE/);
    await expect(sql`
      DELETE FROM ai_story_video_analysis_snapshots WHERE asset_id = ${assetId}
    `).rejects.toThrow(/AI_STORY_VIDEO_ANALYSIS_SNAPSHOT_IMMUTABLE/);
  });
});
