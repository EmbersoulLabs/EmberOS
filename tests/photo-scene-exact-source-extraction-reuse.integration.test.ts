import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

describe.skipIf(!RUN_DB_INTEGRATION).sequential(
  "Photo Scene exact-source extraction reuse migration",
  () => {
    let sql: Sql;
    let fixture: RlsTestFixture;
    const sourceA = crypto.randomUUID();
    const sourceB = crypto.randomUUID();
    const ready = crypto.randomUUID();
    const failed = crypto.randomUUID();
    const queuedA = crypto.randomUUID();
    const queuedB = crypto.randomUUID();
    const hash = `sha256:${"a".repeat(64)}`;
    const fingerprint = `sha256:${"b".repeat(64)}`;

    beforeAll(async () => {
      sql = createIntegrationSql();
      fixture = await seedRlsFixture(sql);
      await sql`
        INSERT INTO assets (
          id, org_id, workspace_id, campaign_id, type, storage_path,
          mime_type, content_hash, status
        ) VALUES
          (
            ${sourceA}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, 'image',
            ${`${fixture.workspaceAId}/library/${sourceA}.png`},
            'image/png', ${hash}, 'ready'
          ),
          (
            ${sourceB}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, 'image',
            ${`${fixture.workspaceAId}/library/${sourceB}.png`},
            'image/png', ${hash}, 'ready'
          )
      `;
      await sql`
        INSERT INTO photo_scene_generations (
          id, org_id, workspace_id, campaign_id, operation, status,
          source_asset_id, source_content_hash, input_capsule,
          input_fingerprint, attempt_count, created_by
        ) VALUES
          (
            ${ready}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, 'product_extraction', 'ready',
            ${sourceA}, ${hash}, ${{}}, ${fingerprint}, 1, ${fixture.userAId}
          ),
          (
            ${failed}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, 'product_extraction', 'failed',
            ${sourceA}, ${hash}, ${{}}, ${fingerprint}, 1, ${fixture.userAId}
          ),
          (
            ${queuedA}, ${fixture.orgId}, ${fixture.workspaceAId},
            ${fixture.campaignAId}, 'product_extraction', 'queued',
            ${sourceA}, ${hash}, ${{}}, ${fingerprint}, 1, ${fixture.userAId}
          )
      `;
      // Recreate the certified predecessor indexes so this test proves the
      // ordered transition rather than merely reapplying desired state.
      await sql.unsafe(`
        DROP INDEX IF EXISTS photo_scene_generations_reuse_idx;
        CREATE INDEX photo_scene_generations_reuse_idx
          ON photo_scene_generations (
            workspace_id, operation, input_fingerprint, status
          );
        DROP INDEX IF EXISTS photo_scene_generations_inflight_fingerprint_idx;
        CREATE UNIQUE INDEX photo_scene_generations_inflight_fingerprint_idx
          ON photo_scene_generations (
            workspace_id, operation, input_fingerprint
          )
          WHERE status IN ('queued', 'processing');
      `);
    });

    afterAll(async () => {
      if (!sql || !fixture) return;
      await sql`DELETE FROM photo_scene_generations WHERE org_id = ${fixture.orgId}`;
      await sql`DELETE FROM assets WHERE id IN (${sourceA}, ${sourceB})`;
      await cleanupRlsFixture(sql, fixture);
      await sql.end();
    });

    it("applies without rewriting historical or current inflight rows", async () => {
      const before = await sql<{ id: string; status: string; xmin: string }[]>`
        SELECT id, status, xmin::text
        FROM photo_scene_generations
        WHERE id IN (${ready}, ${failed}, ${queuedA})
        ORDER BY id
      `;
      await sql.unsafe(
        readFileSync(
          resolve(
            process.cwd(),
            "packages/db/sql/photo-scene-exact-source-extraction-reuse-v1.sql"
          ),
          "utf8"
        )
      );
      const after = await sql<{ id: string; status: string; xmin: string }[]>`
        SELECT id, status, xmin::text
        FROM photo_scene_generations
        WHERE id IN (${ready}, ${failed}, ${queuedA})
        ORDER BY id
      `;
      expect(after).toEqual(before);
    });

    it("indexes reuse and inflight authority by exact source Asset", async () => {
      const indexes = await sql<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'photo_scene_generations_reuse_idx',
            'photo_scene_generations_inflight_fingerprint_idx'
          )
        ORDER BY indexname
      `;
      expect(indexes).toHaveLength(2);
      for (const index of indexes) {
        expect(index.indexdef).toMatch(
          /workspace_id, operation, source_asset_id, input_fingerprint/i
        );
      }
    });

    it("allows distinct source Assets with one fingerprint but blocks duplicate exact-source inflight work", async () => {
      await sql`
        INSERT INTO photo_scene_generations (
          id, org_id, workspace_id, campaign_id, operation, status,
          source_asset_id, source_content_hash, input_capsule,
          input_fingerprint, attempt_count, created_by
        ) VALUES (
          ${queuedB}, ${fixture.orgId}, ${fixture.workspaceAId},
          ${fixture.campaignAId}, 'product_extraction', 'processing',
          ${sourceB}, ${hash}, ${{}}, ${fingerprint}, 1, ${fixture.userAId}
        )
      `;
      const inflight = await sql<{ source_asset_id: string }[]>`
        SELECT source_asset_id
        FROM photo_scene_generations
        WHERE workspace_id = ${fixture.workspaceAId}
          AND operation = 'product_extraction'
          AND input_fingerprint = ${fingerprint}
          AND status IN ('queued', 'processing')
        ORDER BY source_asset_id
      `;
      expect(inflight.map((row) => row.source_asset_id)).toEqual(
        [sourceA, sourceB].sort()
      );

      await expect(
        sql`
          INSERT INTO photo_scene_generations (
            org_id, workspace_id, campaign_id, operation, status,
            source_asset_id, source_content_hash, input_capsule,
            input_fingerprint, attempt_count, created_by
          ) VALUES (
            ${fixture.orgId}, ${fixture.workspaceAId}, ${fixture.campaignAId},
            'product_extraction', 'processing', ${sourceA}, ${hash},
            ${{}}, ${fingerprint}, 1, ${fixture.userAId}
          )
        `
      ).rejects.toMatchObject({ code: "23505" });
    });
  }
);
