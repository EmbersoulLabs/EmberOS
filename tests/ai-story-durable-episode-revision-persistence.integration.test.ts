import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryCharacterAuthorityService,
  AiStoryEpisodeRevisionPersistenceError,
  AiStoryEpisodeRevisionPersistenceService,
  AiStoryOutlineAuthorityService,
  AiStoryScriptAuthorityService,
  closeDb,
  persistAiStoryEpisodeRevision,
} from "@ceo-agent/db";
import { AiStoryScriptVersionSchema } from "@ceo-agent/shared";
import {
  buildAiStoryOutlineVersion,
  buildAiStoryScriptVersion,
  compileAiStoryCharacterDialoguePerformanceAuthority,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";
import { buildAssemblyV2Fixture } from "./helpers/ai-story-assembly-v2-fixture";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const BEFORE = "这个看起来真的不错。";
const AFTER = "这个看起来蛮不错的。";
const CREATED_AT = "2026-09-21T16:00:00.000Z";
const PRODUCT = "b2000000-0000-4000-8000-000000000009";
const PRODUCT_ASSET = "b2000000-0000-4000-8000-000000000010";
const NEXT_PRODUCT = "b2000000-0000-4000-8000-000000000019";
const NEXT_ASSET = "b2000000-0000-4000-8000-000000000020";

type Seeded = {
  assembly: ReturnType<typeof buildAssemblyV2Fixture>;
  script: ReturnType<typeof AiStoryScriptVersionSchema.parse>;
  dialogueEntryId: string;
  characterId: string;
  scope: {
    orgId: string;
    workspaceId: string;
    campaignId: string;
    storyId: string;
    actorUserId: string;
  };
};

describeIntegration("AI Story durable Episode revision persistence", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let dialogue: Seeded;

  async function seedEpisode(base: number, workspace: "A" | "B" = "A"): Promise<Seeded> {
    const workspaceId = workspace === "A" ? fixture.workspaceAId : fixture.workspaceBId;
    const campaignId = workspace === "A" ? fixture.campaignAId : fixture.campaignBId;
    const actorUserId = workspace === "A" ? fixture.userAId : fixture.userBId;
    const assembly = buildAssemblyV2Fixture({
      sources: Array.from({ length: 6 }, (_, index) => ({
        path: `fixture://durable-revision/${base}/${index}.mp4`,
        hash: `sha256:${(base + index).toString(16).padStart(64, "0")}`,
        durationMs: 8000,
        width: 480,
        height: 854,
        frameRate: 24,
      })),
      entries: [
        { sourceIndex: 0, role: "ESTABLISH", durationSeconds: 3 },
        { sourceIndex: 1, role: "ACTION", durationSeconds: 3 },
        { sourceIndex: 2, role: "DETAIL", durationSeconds: 3 },
        { sourceIndex: 3, role: "DISCOVERY", durationSeconds: 3 },
        { sourceIndex: 4, role: "REACTION", durationSeconds: 3 },
        { sourceIndex: 5, role: "CTA", durationSeconds: 3 },
      ],
      nativeAudioSourceIndexes: [3],
      profileId: "CORE",
      outputWidth: 480,
      outputHeight: 854,
      base,
    });
    const productUnits = [assembly.units[2]!, assembly.units[3]!];
    for (const unit of productUnits) {
      unit.sourceAuthority.productAuthorityIds.push(PRODUCT);
      unit.sourceAuthority.productSourceAssetIds.push(PRODUCT_ASSET);
      unit.inheritedContinuity.productAuthorityIds.push(PRODUCT);
    }
    const storyId = assembly.editorialPlan.storyId;
    const storyVersionId = assembly.editorialPlan.storyVersionId;
    const characterId = assembly.units[3]!.sourceAuthority.characterIds[0]!;
    const dialogueEntryId = assembly.units[3]!.nativeDialogueEntryIds![0]!;
    const beatId = `b2000000-0000-4000-8000-${(base + 14).toString().padStart(12, "0")}`;
    const unitId = `b2000000-0000-4000-8000-${(base + 15).toString().padStart(12, "0")}`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status) values(${storyId}::uuid,${fixture.orgId}::uuid,${workspaceId}::uuid,${campaignId}::uuid,'Durable revision','Idea','draft')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at,frozen_by) values(${storyVersionId}::uuid,${storyId}::uuid,1,${sql.json({ title: "Legacy", summary: "", objective: "", targetAudience: "", tone: "", estimatedDuration: "", story: { opening: "", development: "", ending: "" }, keyMessages: [], cta: "", assetReferences: [], warnings: [] })},now(),${actorUserId}::uuid)`;
    await sql`update ai_stories set current_version_id=${storyVersionId}::uuid where id=${storyId}::uuid`;
    const charScope = { orgId: fixture.orgId, workspaceId, campaignId, actorUserId };
    const character = await new AiStoryCharacterAuthorityService().add(
      charScope,
      { name: "Host", identity: "Local host", appearance: "Casual", personality: "Warm", emotionalArc: "Discovery", relationships: [], visualAssetIds: [] },
      characterId,
      "2026-09-21T15:00:00.000Z"
    );
    const characterRef = {
      authorityType: "CHARACTER" as const,
      authorityId: characterId,
      authorityVersionId: character.characterVersionId,
      authorityFingerprint: character.fingerprint,
    };
    const scope = {
      orgId: fixture.orgId,
      workspaceId,
      campaignId,
      storyId,
      storyVersionId,
      actorUserId,
      requireCurrentFrozenStoryVersion: true,
    };
    const outline = buildAiStoryOutlineVersion({
      storyId,
      storyVersionId,
      orgId: fixture.orgId,
      workspaceId,
      version: 1,
      profile: { profileId: "CORE", profileVersion: 1 },
      premise: "A host reacts to packed food",
      coreClaim: "The food looks appealing",
      storyUnits: [{ storyUnitId: unitId, order: 0, purpose: "Discovery", summary: "Host speaks", requiredBeatIds: [beatId] }],
      beats: [{
        id: beatId,
        storyUnitId: unitId,
        order: 0,
        classification: "MAJOR",
        name: "Reaction",
        purpose: "Speak the line",
        summary: "Host comments on the food",
        required: true,
        ownershipPolicy: "EXCLUSIVE",
        authorityReferences: [characterRef],
      }],
      hooks: [],
      setupPayoffs: [],
      requiredSceneOutcomes: [],
      authorityReferences: [characterRef],
      upstreamAuthorityId: `${campaignId}:${storyVersionId}`,
      supersedesOutlineVersionId: null,
      createdBy: actorUserId,
      createdAt: "2026-09-21T15:10:00.000Z",
    });
    const outlines = new AiStoryOutlineAuthorityService();
    await outlines.propose(scope, outline);
    await outlines.validate(scope, outline.outlineVersionId);
    await outlines.approve(scope, outline.outlineVersionId);
    const frozenOutline = await outlines.freeze(scope, outline.outlineVersionId);
    const draft = buildAiStoryScriptVersion({
      storyId,
      storyVersionId,
      outlineVersionId: outline.outlineVersionId,
      orgId: fixture.orgId,
      workspaceId,
      version: 1,
      profileId: "CORE",
      profileVersion: 1,
      outlineSourceHash: frozenOutline.sourceHash,
      semanticInputFingerprint: `sha256:${"e".repeat(64)}`,
      scenes: [{
        scriptSceneId: assembly.units[3]!.sceneId,
        order: 0,
        outlineBeatClaims: [{ outlineBeatId: beatId, claim: "Host reacts to the food" }],
        sceneFunction: "DEMONSTRATE",
        sceneFunctionRegistryVersion: 1,
        sceneStateIn: [],
        sceneStateDeltas: [],
        sceneStateOut: [],
        entries: [
          {
            entryId: `b2000000-0000-4000-8000-${(base + 300).toString().padStart(12, "0")}`,
            order: 0,
            durationRange: { minSeconds: 1, maxSeconds: 2 },
            type: "ACTION",
            subjectId: characterId,
            action: "The host looks at the packed food.",
            storyEffect: "Motivates the spoken line.",
          },
          {
            entryId: dialogueEntryId,
            order: 1,
            durationRange: { minSeconds: 2, maxSeconds: 5 },
            type: "DIALOGUE",
            speakerId: characterId,
            line: BEFORE,
            deliveryOrSubtext: "Friendly local discovery",
            language: "zh-MY",
          },
        ],
        characterIds: [characterId],
        locationIds: [],
        propIds: [],
        assetIds: [],
        productAuthorityRefs: [],
        targetDurationRange: { minSeconds: 4, maxSeconds: 8 },
        mustKeep: ["Exact dialogue"],
        mustAvoid: ["Camera direction"],
        newInformation: ["The food looks appealing"],
        newEvidence: ["Observable proof"],
        newActionOutcomes: ["Host speaks"],
        productEvidence: [],
      }],
      authorityReferences: [characterRef],
      supersedesScriptVersionId: null,
      createdBy: actorUserId,
      createdAt: "2026-09-21T15:20:00.000Z",
    });
    const scripts = new AiStoryScriptAuthorityService();
    await scripts.propose(scope, draft);
    await scripts.validate(scope, draft.scriptVersionId);
    await scripts.approve(scope, draft.scriptVersionId);
    const frozen = await scripts.freeze(scope, draft.scriptVersionId);
    const script = AiStoryScriptVersionSchema.parse(frozen);
    for (const unit of assembly.units) {
      unit.sourceAuthority.scriptVersionId = script.scriptVersionId;
    }
    return {
      assembly,
      script,
      dialogueEntryId,
      characterId,
      scope: { orgId: fixture.orgId, workspaceId, campaignId, storyId, actorUserId },
    };
  }

  function snapshot(seeded: Seeded, rest: Record<string, unknown> = {}) {
    const dialogueAuthority = compileAiStoryCharacterDialoguePerformanceAuthority({
      script: seeded.script,
      generationUnit: seeded.assembly.units[3]!,
      scriptSceneId: seeded.assembly.units[3]!.sceneId,
      dialogueEntryId: seeded.dialogueEntryId,
      primaryLocale: "zh-MY",
      secondaryLocales: [],
      codeSwitchPolicy: { mode: "DISABLED", allowedLocales: [] },
      deliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
      performanceIntent: "Friendly spontaneous discovery",
      emotionIntent: "Pleasantly surprised",
      speechIntensity: "NATURAL",
      paceIntent: "NATURAL",
    });
    return {
      script: seeded.script,
      units: seeded.assembly.units,
      generationPlans: seeded.assembly.generationPlans,
      editorialPlan: seeded.assembly.editorialPlan,
      acceptedSourceMedia: seeded.assembly.acceptedSourceMedia,
      assemblyCompileInput: seeded.assembly.compileInput,
      acceptedGenerationUnitIds: seeded.assembly.units.map((unit) => unit.generationUnitId),
      createdBy: seeded.scope.actorUserId,
      createdAt: CREATED_AT,
      commercialAuthorizationStatus: "REQUIRED" as const,
      nativeDialogueAuthorities: [dialogueAuthority],
      aspectRatio: "9:16" as const,
      resolution: "480p" as const,
      durationSecondsByUnitId: Object.fromEntries(
        seeded.assembly.units.map((unit) => [unit.generationUnitId, 8])
      ),
      ...rest,
    };
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-outline-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-script-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-episode-revision-persistence-v1.sql"), "utf8"));
    await sql.unsafe("GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT,INSERT,UPDATE ON workspace_members,ai_story_outline_versions,ai_story_script_versions,ai_story_episode_revisions,ai_story_episode_revision_current,ai_story_editorial_plan_versions,ai_story_reference_binding_versions,ai_story_revision_stale_authorities TO authenticated");
    dialogue = await seedEpisode(20_000);
  }, 60_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`delete from ai_story_revision_stale_authorities where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_episode_revision_current where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_editorial_plan_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_reference_binding_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_episode_revisions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_script_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_outline_versions where org_id=${fixture.orgId}::uuid`;
    await sql.begin(async (tx) => {
      await tx`delete from ai_story_character_versions where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_characters where org_id=${fixture.orgId}::uuid`;
    });
    await sql`delete from ai_story_versions where story_id in (select id from ai_stories where org_id=${fixture.orgId}::uuid)`;
    await sql`delete from ai_stories where org_id=${fixture.orgId}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("DURABLE_REVISION_SCHEMA exists with RLS", async () => {
    const tables = [
      "ai_story_episode_revisions",
      "ai_story_episode_revision_current",
      "ai_story_editorial_plan_versions",
      "ai_story_reference_binding_versions",
      "ai_story_revision_stale_authorities",
    ];
    for (const table of tables) {
      const [row] = await sql<{ enabled: boolean }[]>`select relrowsecurity enabled from pg_class where oid=${table}::regclass`;
      expect(row?.enabled).toBe(true);
    }
  });

  it("DIALOGUE_SCRIPT_VERSION_PERSISTENCE and sibling preservation", async () => {
    const unit4 = dialogue.assembly.units[3]!.generationUnitId;
    const persisted = await persistAiStoryEpisodeRevision({
      scope: dialogue.scope,
      snapshot: snapshot(dialogue, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: dialogue.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: dialogue.dialogueEntryId,
          previousText: BEFORE,
          nextText: AFTER,
        },
      }),
      expectedScriptVersionId: dialogue.script.scriptVersionId,
      expectedStoryVersionId: dialogue.script.storyVersionId,
      expectedEditorialPlanId: dialogue.assembly.editorialPlan.editorialPlanId,
      idempotencyKey: "dialogue-v1",
    });
    expect(persisted.providerCalls).toBe(0);
    expect(persisted.spendAuthorizationCreated).toBe(false);
    expect(persisted.persisted).toBe(true);
    expect(persisted.lineage.previousScriptVersionId).toBe(dialogue.script.scriptVersionId);
    expect(persisted.lineage.newScriptVersionId).not.toBe(dialogue.script.scriptVersionId);
    expect(persisted.current.scriptVersionId).toBe(persisted.lineage.newScriptVersionId);
    const [oldRow] = await sql<{ line: string; status: string }[]>`
      select script#>>'{scenes,0,entries,1,line}' as line, status
      from ai_story_script_versions where script_version_id=${dialogue.script.scriptVersionId}::uuid`;
    expect(oldRow?.line).toBe(BEFORE);
    expect(oldRow?.status).toBe("SUPERSEDED");
    const [newRow] = await sql<{ line: string; status: string }[]>`
      select script#>>'{scenes,0,entries,1,line}' as line, status
      from ai_story_script_versions where script_version_id=${persisted.lineage.newScriptVersionId}::uuid`;
    expect(newRow?.line).toBe(AFTER);
    expect(newRow?.status).toBe("FROZEN");
    const stale = persisted.staleAuthorities.filter((item) => item.authorityType === "GENERATION_UNIT");
    expect(stale.find((item) => item.authorityId === unit4)?.status).toBe("STALE");
    const preserved = stale.filter((item) => item.status === "VALID").map((item) => item.authorityId);
    expect(preserved.sort()).toEqual(
      dialogue.assembly.units.map((unit) => unit.generationUnitId).filter((id) => id !== unit4).sort()
    );
    expect(persisted.staleAuthorities.some((item) => item.authorityType === "ASSEMBLY" && item.status === "STALE")).toBe(true);
    expect(persisted.impact.requiresProviderExecution).toBe(true);
    expect(persisted.commercialAuthorizationStatus).toBe("REQUIRED");
    expect(persisted.executionPlan.retryAuthorizationIds).toEqual([]);
    expect(persisted.obsoleteRetryAuthorizationIds).toEqual([]);
    dialogue = { ...dialogue, script: persisted.nextScript ?? dialogue.script };
  });

  it("PROCESS_RESTART_DURABILITY reloads canonical current from PostgreSQL", async () => {
    await closeDb();
    const reloaded = await new AiStoryEpisodeRevisionPersistenceService().readCurrent(dialogue.scope);
    expect(reloaded?.current.scriptVersionId).toBeTruthy();
    expect(reloaded?.current.scriptVersionId).not.toBe(
      (await sql<{ id: string }[]>`select script_version_id as id from ai_story_script_versions where story_id=${dialogue.scope.storyId}::uuid and version=1`)[0]?.id
    );
    expect(reloaded?.staleAuthorities.length).toBeGreaterThan(0);
    expect(reloaded?.requiresProviderExecution).toBe(true);
    expect(reloaded?.providerCalls).toBe(0);
    const history = await new AiStoryEpisodeRevisionPersistenceService().history(dialogue.scope);
    expect(history).toHaveLength(1);
  });

  it("HISTORICAL_SCRIPT_IMMUTABILITY keeps v1 text", async () => {
    const [oldRow] = await sql<{ line: string }[]>`
      select script#>>'{scenes,0,entries,1,line}' as line
      from ai_story_script_versions where story_id=${dialogue.scope.storyId}::uuid and version=1`;
    expect(oldRow?.line).toBe(BEFORE);
  });

  it("PACING_EDITORIAL_VERSION_PERSISTENCE is provider-free", async () => {
    const seeded = await seedEpisode(21_000);
    const persisted = await persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "ADJUST_PACING",
        target: { kind: "EPISODE_PACING" },
        requestedChange: {
          kind: "EPISODE_PACING",
          previousPacing: "NATURAL",
          nextPacing: "FAST",
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
      expectedStoryVersionId: seeded.script.storyVersionId,
      expectedEditorialPlanId: seeded.assembly.editorialPlan.editorialPlanId,
    });
    expect(persisted.providerCalls).toBe(0);
    expect(persisted.impact.requiresProviderExecution).toBe(false);
    expect(persisted.lineage.newEditorialPlanId).not.toBe(seeded.assembly.editorialPlan.editorialPlanId);
    expect(persisted.current.scriptVersionId).toBe(seeded.script.scriptVersionId);
    expect(persisted.staleAuthorities.filter((item) => item.authorityType === "GENERATION_UNIT" && item.status === "STALE")).toHaveLength(0);
    expect(persisted.staleAuthorities.some((item) => item.authorityType === "ASSEMBLY" && item.status === "STALE")).toBe(true);
    expect(persisted.status).toBe("REASSEMBLY_REQUIRED");
    const [editorial] = await sql<{ version: number; status: string }[]>`
      select version, status from ai_story_editorial_plan_versions
      where editorial_plan_id=${persisted.lineage.newEditorialPlanId}::uuid`;
    expect(editorial?.status).toBe("FROZEN");
    expect(editorial?.version).toBeGreaterThan(1);
  });

  it("ENDING_STORY_VERSION_PERSISTENCE keeps historical Story readable", async () => {
    const seeded = await seedEpisode(22_000);
    const previousStory = seeded.script.storyVersionId;
    const persisted = await persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "ADJUST_ENDING",
        target: { kind: "ENDING" },
        requestedChange: {
          kind: "ENDING_INTENT",
          previousIntent: "brand-focused ending",
          nextIntent: "stronger CTA",
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
      expectedStoryVersionId: previousStory,
      expectedEditorialPlanId: seeded.assembly.editorialPlan.editorialPlanId,
    });
    expect(persisted.current.storyVersionId).not.toBe(previousStory);
    const [oldStory] = await sql<{ id: string; intent: string | null }[]>`
      select id, source_context_snapshot->>'endingIntent' as intent
      from ai_story_versions where id=${previousStory}::uuid`;
    expect(oldStory?.id).toBe(previousStory);
    expect(oldStory?.intent ?? null).toBeNull();
    const [newStory] = await sql<{ intent: string }[]>`
      select source_context_snapshot->>'endingIntent' as intent
      from ai_story_versions where id=${persisted.current.storyVersionId}::uuid`;
    expect(newStory?.intent).toBe("stronger CTA");
    const staleUnits = persisted.staleAuthorities.filter((item) => item.authorityType === "GENERATION_UNIT" && item.status === "STALE");
    expect(staleUnits.length).toBeGreaterThan(0);
    expect(staleUnits.length).toBeLessThan(6);
  });

  it("REFERENCE_BINDING_VERSION_PERSISTENCE stale-marks exact dependents", async () => {
    const seeded = await seedEpisode(23_000);
    const persisted = await persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "REPLACE_REFERENCE",
        target: { kind: "REFERENCE_BINDING", referenceKind: "PRODUCT", authorityId: PRODUCT },
        requestedChange: {
          kind: "REFERENCE_BINDING",
          referenceKind: "PRODUCT",
          previousAuthorityId: PRODUCT,
          nextAuthorityId: NEXT_PRODUCT,
          previousSourceAssetId: PRODUCT_ASSET,
          nextSourceAssetId: NEXT_ASSET,
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
      expectedStoryVersionId: seeded.script.storyVersionId,
      expectedEditorialPlanId: seeded.assembly.editorialPlan.editorialPlanId,
    });
    expect(persisted.lineage.newReferenceBindingId).toBeTruthy();
    const staleIds = persisted.staleAuthorities
      .filter((item) => item.authorityType === "GENERATION_UNIT" && item.status === "STALE")
      .map((item) => item.authorityId)
      .sort();
    expect(staleIds).toEqual([seeded.assembly.units[2]!.generationUnitId, seeded.assembly.units[3]!.generationUnitId].sort());
    const [oldBinding] = await sql<{ status: string; authority: string }[]>`
      select status, authority_id::text as authority from ai_story_reference_binding_versions
      where story_id=${seeded.scope.storyId}::uuid and version=1`;
    expect(oldBinding?.status).toBe("SUPERSEDED");
    expect(oldBinding?.authority).toBe(PRODUCT);
    const [newBinding] = await sql<{ status: string; asset: string | null }[]>`
      select status, source_asset_id::text as asset from ai_story_reference_binding_versions
      where reference_binding_id=${persisted.lineage.newReferenceBindingId}::uuid`;
    expect(newBinding?.status).toBe("CURRENT");
    expect(newBinding?.asset).toBe(NEXT_ASSET);
  });

  it("OPTIMISTIC_CONCURRENCY_CONFLICT refuses stale source versions", async () => {
    const seeded = await seedEpisode(24_000);
    await persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: seeded.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: seeded.dialogueEntryId,
          previousText: BEFORE,
          nextText: AFTER,
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
    });
    await expect(persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: seeded.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: seeded.dialogueEntryId,
          previousText: BEFORE,
          nextText: "另一个版本。",
        },
        createdAt: "2026-09-21T16:05:00.000Z",
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
    })).rejects.toMatchObject({ code: "REVISION_SOURCE_VERSION_CONFLICT" });
    const scripts = await sql<{ version: number }[]>`select version from ai_story_script_versions where story_id=${seeded.scope.storyId}::uuid`;
    expect(scripts).toHaveLength(2);
  });

  it("IDEMPOTENT_REVISION_MUTATION returns the first persisted result", async () => {
    const seeded = await seedEpisode(25_000);
    const input = {
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: seeded.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: seeded.dialogueEntryId,
          previousText: BEFORE,
          nextText: AFTER,
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
      idempotencyKey: "same-dialogue-once",
    };
    const first = await persistAiStoryEpisodeRevision(input);
    const second = await persistAiStoryEpisodeRevision(input);
    expect(second.revisionId).toBe(first.revisionId);
    expect(second.lineage.newScriptVersionId).toBe(first.lineage.newScriptVersionId);
    const revisions = await sql<{ n: number }[]>`select count(*)::int as n from ai_story_episode_revisions where story_id=${seeded.scope.storyId}::uuid`;
    expect(revisions[0]?.n).toBe(1);
    const scripts = await sql<{ n: number }[]>`select count(*)::int as n from ai_story_script_versions where story_id=${seeded.scope.storyId}::uuid`;
    expect(scripts[0]?.n).toBe(2);
  });

  it("TENANT_ISOLATION denies cross-workspace revision writes", async () => {
    const other = await seedEpisode(26_000, "B");
    await expect(persistAiStoryEpisodeRevision({
      scope: { ...other.scope, actorUserId: fixture.userAId, workspaceId: fixture.workspaceAId, campaignId: fixture.campaignAId },
      snapshot: snapshot(other, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: other.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: other.dialogueEntryId,
          previousText: BEFORE,
          nextText: AFTER,
        },
      }),
    })).rejects.toBeInstanceOf(AiStoryEpisodeRevisionPersistenceError);
    const revisions = await sql<{ n: number }[]>`select count(*)::int as n from ai_story_episode_revisions where story_id=${other.scope.storyId}::uuid`;
    expect(revisions[0]?.n).toBe(0);
  });

  it("TRANSACTION_ATOMICITY rolls back versions when pointer advance cannot complete", async () => {
    const seeded = await seedEpisode(27_000);
    await expect(persistAiStoryEpisodeRevision({
      scope: seeded.scope,
      snapshot: snapshot(seeded, {
        revisionType: "EDIT_DIALOGUE",
        target: { kind: "DIALOGUE_ENTRY", entryId: seeded.dialogueEntryId },
        requestedChange: {
          kind: "DIALOGUE_TEXT",
          entryId: seeded.dialogueEntryId,
          previousText: BEFORE,
          nextText: AFTER,
        },
      }),
      expectedScriptVersionId: seeded.script.scriptVersionId,
      failAfterVersionInsert: true,
    })).rejects.toMatchObject({ code: "REVISION_TRANSACTION_FORCED_FAILURE" });
    const scripts = await sql<{ status: string; version: number }[]>`
      select status, version from ai_story_script_versions where story_id=${seeded.scope.storyId}::uuid order by version`;
    expect(scripts).toEqual([{ status: "FROZEN", version: 1 }]);
    const current = await sql<{ n: number }[]>`select count(*)::int as n from ai_story_episode_revision_current where story_id=${seeded.scope.storyId}::uuid`;
    expect(current[0]?.n).toBe(0);
    const revisions = await sql<{ n: number }[]>`select count(*)::int as n from ai_story_episode_revisions where story_id=${seeded.scope.storyId}::uuid`;
    expect(revisions[0]?.n).toBe(0);
  });
});
