import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  auditApprovedAnimationPackageDuplicates,
  closeDb,
  getDb,
  resolveApprovedAnimationPackageForStoryVersion,
} from "@ceo-agent/db";
import { approveAnimationPackage } from "../apps/web/src/lib/ai-story-planning-service";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
} from "./helpers/db-integration";

describe.skipIf(!RUN_DB_INTEGRATION).sequential(
  "current approved Animation Package PostgreSQL authority",
  () => {
    let sql: Sql;
    const ids = {
      org: crypto.randomUUID(),
      workspace: crypto.randomUUID(),
      campaign: crypto.randomUUID(),
      story: crypto.randomUUID(),
      user: crypto.randomUUID(),
      v1: crypto.randomUUID(),
      v2: crypto.randomUUID(),
      v3: crypto.randomUUID(),
      v4: crypto.randomUUID(),
      p1: crypto.randomUUID(),
      p2: crypto.randomUUID(),
      p3: crypto.randomUUID(),
      p4: crypto.randomUUID(),
      p5: crypto.randomUUID(),
      p6: crypto.randomUUID(),
    };
    const review = animationPackageFixture("review");

    beforeAll(async () => {
      sql = createIntegrationSql();
      const migration = readFileSync(
        resolve(
          process.cwd(),
          "packages/db/sql/ai-story-current-approved-animation-package-authority-v1.sql"
        ),
        "utf8"
      );
      await sql.unsafe(migration);

      await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.org}, 'Approved Package Test', ${`approved-package-${ids.org.slice(0, 8)}`})`;
      await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspace}, ${ids.org}, 'Approved Package Test', ${`approved-package-${ids.workspace.slice(0, 8)}`})`;
      await sql`INSERT INTO campaigns (id, org_id, workspace_id, name) VALUES (${ids.campaign}, ${ids.org}, ${ids.workspace}, 'Approved Package Test')`;
      await sql`
        INSERT INTO ai_stories (
          id, org_id, workspace_id, campaign_id, title, original_idea, status
        ) VALUES (
          ${ids.story}, ${ids.org}, ${ids.workspace}, ${ids.campaign},
          'Approved Package Test', 'Canonical approval', 'planning_review'
        )
      `;
      await sql`
        INSERT INTO ai_story_versions (id, story_id, version_number, structured_content, frozen_at)
        VALUES
          (${ids.v1}, ${ids.story}, 1, ${sql.json({} as never)}, now()),
          (${ids.v2}, ${ids.story}, 2, ${sql.json({} as never)}, now()),
          (${ids.v3}, ${ids.story}, 3, ${sql.json({} as never)}, now()),
          (${ids.v4}, ${ids.story}, 4, ${sql.json({} as never)}, now())
      `;
      await sql`UPDATE ai_stories SET current_version_id = ${ids.v1} WHERE id = ${ids.story}`;
      await sql`
        INSERT INTO ai_story_animation_packages (
          id, org_id, workspace_id, campaign_id, story_id, story_version_id,
          status, payload, consistency_report
        ) VALUES
          (${ids.p1}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p2}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p3}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v2}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p4}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v3}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p5}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v3}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p6}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)})
      `;
    }, 60_000);

    afterAll(async () => {
      if (!sql) return;
      await closeDb();
      await sql`DELETE FROM ai_story_animation_packages WHERE story_id = ${ids.story}`;
      await sql`UPDATE ai_stories SET current_version_id = null WHERE id = ${ids.story}`;
      await sql`DELETE FROM ai_story_versions WHERE story_id = ${ids.story}`;
      await sql`DELETE FROM ai_stories WHERE id = ${ids.story}`;
      await sql`DELETE FROM campaigns WHERE id = ${ids.campaign}`;
      await sql`DELETE FROM workspaces WHERE id = ${ids.workspace}`;
      await sql`DELETE FROM organizations WHERE id = ${ids.org}`;
      await sql.end();
    }, 60_000);

    it("enforces unique, current, idempotent, and concurrent approval authority", async () => {
      const db = getDb();
      const index = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'ai_story_animation_packages_one_ready_per_story_version_idx'
        ) AS exists
      `;
      expect(index[0]?.exists).toBe(true);
      expect(await auditApprovedAnimationPackageDuplicates(db)).toEqual([]);

      const empty = await resolveApprovedAnimationPackageForStoryVersion(db, {
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        storyVersionId: ids.v4,
      });
      expect(empty).toBeNull();

      const first = await approveAnimationPackage(db, {
        packageId: ids.p1,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        approvedBy: ids.user,
      });
      const again = await approveAnimationPackage(db, {
        packageId: ids.p1,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        approvedBy: ids.user,
      });
      expect(again).toEqual(first);
      expect(first.approvedAt).toBeTruthy();
      expect(first.approvedBy).toBe(ids.user);

      const canonicalV1 = await resolveApprovedAnimationPackageForStoryVersion(db, {
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        storyVersionId: ids.v1,
      });
      expect(canonicalV1?.id).toBe(ids.p1);
      const historicalV1Snapshot = await sql`
        SELECT * FROM ai_story_animation_packages WHERE id = ${ids.p1}
      `;
      await expect(approveAnimationPackage(db, {
        packageId: ids.p2,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        approvedBy: ids.user,
      })).rejects.toMatchObject({
        code: "ANIMATION_PACKAGE_ALREADY_APPROVED_FOR_STORY_VERSION",
      });

      await sql`UPDATE ai_stories SET current_version_id = ${ids.v2} WHERE id = ${ids.story}`;
      await approveAnimationPackage(db, {
        packageId: ids.p3,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        approvedBy: ids.user,
      });
      await expect(approveAnimationPackage(db, {
        packageId: ids.p6,
        orgId: ids.org,
        workspaceId: ids.workspace,
        campaignId: ids.campaign,
        storyId: ids.story,
        approvedBy: ids.user,
      })).rejects.toMatchObject({ code: "ANIMATION_PACKAGE_STORY_VERSION_NOT_CURRENT" });

      await sql`UPDATE ai_stories SET current_version_id = ${ids.v3} WHERE id = ${ids.story}`;
      const concurrent = await Promise.allSettled([ids.p4, ids.p5].map((packageId) =>
        approveAnimationPackage(db, {
          packageId,
          orgId: ids.org,
          workspaceId: ids.workspace,
          campaignId: ids.campaign,
          storyId: ids.story,
          approvedBy: ids.user,
        })
      ));
      expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);

      const approved = await sql<{ id: string; story_version_id: string }[]>`
        SELECT id, story_version_id
        FROM ai_story_animation_packages
        WHERE story_id = ${ids.story} AND status = 'ready_for_execution'
        ORDER BY story_version_id
      `;
      expect(approved).toHaveLength(3);
      expect(new Set(approved.map((row) => row.story_version_id))).toEqual(
        new Set([ids.v1, ids.v2, ids.v3])
      );
      expect(approved.find((row) => row.story_version_id === ids.v1)?.id).toBe(ids.p1);
      expect(approved.find((row) => row.story_version_id === ids.v2)?.id).toBe(ids.p3);
      expect(await sql`
        SELECT * FROM ai_story_animation_packages WHERE id = ${ids.p1}
      `).toEqual(historicalV1Snapshot);

      const loser = concurrent.findIndex((result) => result.status === "rejected") === 0
        ? ids.p4
        : ids.p5;
      await expect(sql`
        UPDATE ai_story_animation_packages
        SET status = 'ready_for_execution',
            payload = ${sql.json(animationPackageFixture("ready_for_execution") as never)},
            approved_at = now(), approved_by = ${ids.user}
        WHERE id = ${loser}
      `).rejects.toMatchObject({ code: "23505" });

      expect(await auditApprovedAnimationPackageDuplicates(db)).toEqual([]);
      const packageCount = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ai_story_animation_packages WHERE story_id = ${ids.story}
      `;
      expect(packageCount).toEqual([{ count: 6 }]);
    }, 60_000);
  }
);
