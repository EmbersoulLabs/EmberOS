import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  auditApprovedAnimationPackageDuplicates,
  AiStoryCanonicalSceneAuthorityService,
  AiStoryCharacterAuthorityService,
  AiStoryOutlineAuthorityService,
  AiStoryScriptAuthorityService,
  closeDb,
  getDb,
  resolveApprovedAnimationPackageForStoryVersion,
  resolveCurrentFrozenCanonicalSceneSet,
} from "@ceo-agent/db";
import {
  buildAiStoryAnimationPackageCanonicalSceneAuthorityV1,
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  canonicalAiStorySceneIdV1,
  finalizeAiStoryCanonicalScene,
} from "@ceo-agent/shared/server";
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
      character: crypto.randomUUID(),
    };
    const review = animationPackageFixture("review");
    review.scenePlan[0]!.generationAuthority = { strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" };
    let establishAuthority: (storyVersionId: string, index: number) => Promise<typeof review>;

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
      for (const file of [
        "ai-story-outline-v1.sql",
        "ai-story-character-v1.sql",
        "ai-story-script-v1.sql",
        "ai-story-scene-authority-v1.sql",
        "ai-story-canonical-scene-aggregate-lifecycle-v2.sql",
      ]) {
        await sql.unsafe(readFileSync(resolve(process.cwd(), `packages/db/sql/${file}`), "utf8"));
      }

      await sql`INSERT INTO organizations (id, name, slug) VALUES (${ids.org}, 'Approved Package Test', ${`approved-package-${ids.org.slice(0, 8)}`})`;
      await sql`INSERT INTO workspaces (id, org_id, name, slug) VALUES (${ids.workspace}, ${ids.org}, 'Approved Package Test', ${`approved-package-${ids.workspace.slice(0, 8)}`})`;
      await sql`INSERT INTO workspace_members (org_id, workspace_id, user_id, role) VALUES (${ids.org}, ${ids.workspace}, ${ids.user}, 'admin')`;
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
          (${ids.v1}, ${ids.story}, 1, ${sql.json(review.story as never)}, now()),
          (${ids.v2}, ${ids.story}, 2, ${sql.json(review.story as never)}, now()),
          (${ids.v3}, ${ids.story}, 3, ${sql.json(review.story as never)}, now()),
          (${ids.v4}, ${ids.story}, 4, ${sql.json(review.story as never)}, now())
      `;
      const character = await new AiStoryCharacterAuthorityService().add(
        { orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, actorUserId: ids.user },
        { name: "Ada", identity: "Founder", appearance: "Blue jacket", personality: "Direct", emotionalArc: "Certain", relationships: [], visualAssetIds: [] },
        ids.character,
        "2026-09-15T00:00:00.000Z"
      );
      const authority = {
        authorityType: "CHARACTER" as const,
        authorityId: ids.character,
        authorityVersionId: character.characterVersionId,
        authorityFingerprint: character.fingerprint,
      };
      let lastOutlineVersionId: string | null = null;
      let lastScriptVersionId: string | null = null;
      establishAuthority = async (storyVersionId, index) => {
        await sql`UPDATE ai_stories SET current_version_id = ${storyVersionId} WHERE id = ${ids.story}`;
        const scope = {
          orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign,
          storyId: ids.story, storyVersionId, actorUserId: ids.user,
          requireCurrentFrozenStoryVersion: true as const,
        };
        const unitId = crypto.randomUUID();
        const beatId = crypto.randomUUID();
        const scriptSceneId = crypto.randomUUID();
        const entryId = crypto.randomUUID();
        const sceneId = canonicalAiStorySceneIdV1(ids.story, storyVersionId, 0);
        const outline = buildAiStoryOutlineVersion({
          storyId: ids.story, storyVersionId, orgId: ids.org, workspaceId: ids.workspace,
          version: index + 1, profile: { profileId: "CORE", profileVersion: 1 },
          premise: "Premise", coreClaim: "Claim",
          storyUnits: [{ storyUnitId: unitId, order: 0, purpose: "Purpose", summary: "Summary", requiredBeatIds: [beatId] }],
          beats: [{ id: beatId, storyUnitId: unitId, order: 0, classification: "MAJOR", name: "Beat", purpose: "Purpose", summary: "Summary", required: true, ownershipPolicy: "EXCLUSIVE", authorityReferences: [authority] }],
          hooks: [], setupPayoffs: [], requiredSceneOutcomes: [], authorityReferences: [authority],
          upstreamAuthorityId: storyVersionId, supersedesOutlineVersionId: lastOutlineVersionId,
          createdBy: ids.user, createdAt: `2026-09-15T00:0${index + 1}:00.000Z`,
        });
        const outlines = new AiStoryOutlineAuthorityService();
        await outlines.propose(scope, outline);
        await outlines.validate(scope, outline.outlineVersionId);
        await outlines.approve(scope, outline.outlineVersionId);
        const frozenOutline = await outlines.freeze(scope, outline.outlineVersionId);
        lastOutlineVersionId = outline.outlineVersionId;
        const script = buildAiStoryScriptVersion({
          storyId: ids.story, storyVersionId, outlineVersionId: outline.outlineVersionId,
          orgId: ids.org, workspaceId: ids.workspace, version: index + 1,
          profileId: "CORE", profileVersion: 1, outlineSourceHash: frozenOutline.sourceHash,
          semanticInputFingerprint: `sha256:${"e".repeat(64)}`,
          scenes: [{
            scriptSceneId, order: 0, outlineBeatClaims: [{ outlineBeatId: beatId, claim: "Exact claim" }],
            sceneFunction: "DEMONSTRATE", sceneFunctionRegistryVersion: 1,
            sceneStateIn: [], sceneStateDeltas: [], sceneStateOut: [],
            entries: [{ entryId, order: 0, type: "ACTION", subjectId: ids.character, action: "Ada demonstrates.", storyEffect: "Evidence appears.", durationRange: { minSeconds: 4, maxSeconds: 4 } }],
            characterIds: [ids.character], locationIds: [], propIds: [], assetIds: [], productAuthorityRefs: [],
            targetDurationRange: { minSeconds: 4, maxSeconds: 4 }, mustKeep: [], mustAvoid: [],
            newInformation: [], newEvidence: [], newActionOutcomes: [], productEvidence: [],
          }],
          authorityReferences: [authority], supersedesScriptVersionId: lastScriptVersionId,
          createdBy: ids.user, createdAt: `2026-09-15T00:1${index}:00.000Z`,
        });
        const scripts = new AiStoryScriptAuthorityService();
        await scripts.propose(scope, script);
        await scripts.validate(scope, script.scriptVersionId);
        await scripts.approve(scope, script.scriptVersionId);
        await scripts.freeze(scope, script.scriptVersionId);
        lastScriptVersionId = script.scriptVersionId;
        const scene = finalizeAiStoryCanonicalScene({
          sceneId, orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign,
          storyId: ids.story, storyVersionId, scriptVersionId: script.scriptVersionId,
          version: 1, order: 0, sourceScriptSceneIds: [scriptSceneId], sourceScriptEntryIds: [entryId],
          sceneFunction: "DEMONSTRATE", sceneRole: "DEMONSTRATE", importance: "MAJOR",
          locationBinding: { scope: "EPHEMERAL_ENVIRONMENT", id: crypto.randomUUID(), storyId: ids.story, sceneId, displayName: "Studio", environmentDescription: "Studio environment", visualIdentityRequirement: "NONE" },
          locationState: { temporaryFacts: [] },
          castBindings: [{ scope: "CAMPAIGN_CHARACTER", id: ids.character, campaignId: ids.campaign, authorityVersionId: character.characterVersionId, authorityFingerprint: character.fingerprint, visualIdentityRequirement: "PREFERRED" }],
          productBindings: [], entryState: [], events: script.scenes[0]!.entries, exitState: [],
          generationAuthority: { strategy: "TEXT_TO_VIDEO", referenceSource: "REFERENCE_FREE_T2V", referenceAssetIds: [], firstFrameAssetId: null, productVisualIdentityRequirement: "NONE" },
          continuityFacts: [], timeRelation: "UNSPECIFIED", discontinuity: null,
          mustKeep: [], mustAvoid: [], lineageOperation: "CREATE", parentSceneVersionIds: [],
          createdBy: ids.user, createdAt: `2026-09-15T00:2${index}:00.000Z`,
        });
        const scenes = new AiStoryCanonicalSceneAuthorityService();
        await scenes.proposeRevisionSet(scope, [scene]);
        await scenes.transitionSet(scope, "VALIDATED");
        await scenes.transitionSet(scope, "APPROVED");
        await scenes.transitionSet(scope, "FROZEN");
        const frozenScenes = await resolveCurrentFrozenCanonicalSceneSet(getDb(), scope);
        expect(frozenScenes).toHaveLength(1);
        return {
          ...review,
          canonicalSceneAuthority: buildAiStoryAnimationPackageCanonicalSceneAuthorityV1({
            storyId: ids.story, storyVersionId, scenePlan: review.scenePlan, canonicalScenes: frozenScenes!,
          }),
        };
      };
      const reviewV1 = await establishAuthority(ids.v1, 0);
      await sql`
        INSERT INTO ai_story_animation_packages (
          id, org_id, workspace_id, campaign_id, story_id, story_version_id,
          status, payload, consistency_report
        ) VALUES
          (${ids.p1}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(reviewV1 as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p2}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(reviewV1 as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p3}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v2}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p4}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v3}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p5}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v3}, 'review', ${sql.json(review as never)}, ${sql.json(review.narrativeIntegration as never)}),
          (${ids.p6}, ${ids.org}, ${ids.workspace}, ${ids.campaign}, ${ids.story}, ${ids.v1}, 'review', ${sql.json(reviewV1 as never)}, ${sql.json(review.narrativeIntegration as never)})
      `;
    }, 120_000);

    afterAll(async () => {
      if (!sql) return;
      await closeDb();
      await sql`DELETE FROM ai_story_animation_packages WHERE story_id = ${ids.story}`;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM ai_story_canonical_scene_versions WHERE story_id = ${ids.story}`;
        await tx`DELETE FROM ai_story_canonical_scenes WHERE story_id = ${ids.story}`;
      });
      await sql`DELETE FROM ai_story_script_versions WHERE story_id = ${ids.story}`;
      await sql`DELETE FROM ai_story_outline_versions WHERE story_id = ${ids.story}`;
      await sql.begin(async (tx) => {
        await tx`DELETE FROM ai_story_character_versions WHERE character_id = ${ids.character}`;
        await tx`DELETE FROM ai_story_characters WHERE character_id = ${ids.character}`;
      });
      await sql`UPDATE ai_stories SET current_version_id = null WHERE id = ${ids.story}`;
      await sql`DELETE FROM ai_story_versions WHERE story_id = ${ids.story}`;
      await sql`DELETE FROM ai_stories WHERE id = ${ids.story}`;
      await sql`DELETE FROM campaigns WHERE id = ${ids.campaign}`;
      await sql`DELETE FROM workspace_members WHERE workspace_id = ${ids.workspace}`;
      await sql`DELETE FROM workspaces WHERE id = ${ids.workspace}`;
      await sql`DELETE FROM organizations WHERE id = ${ids.org}`;
      await sql.end();
    }, 120_000);

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

      const reviewV2 = await establishAuthority(ids.v2, 1);
      await sql`UPDATE ai_story_animation_packages SET payload = ${sql.json(reviewV2 as never)} WHERE id = ${ids.p3}`;
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
      })).rejects.toMatchObject({ code: "CURRENT_FROZEN_STORY_VERSION_REQUIRED" });

      const reviewV3 = await establishAuthority(ids.v3, 2);
      await sql`UPDATE ai_story_animation_packages SET payload = ${sql.json(reviewV3 as never)} WHERE id IN (${ids.p4}, ${ids.p5})`;
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
    }, 120_000);
  }
);
