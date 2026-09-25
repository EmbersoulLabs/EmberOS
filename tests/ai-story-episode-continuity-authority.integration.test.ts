import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  PgEpisodeContinuityAuthorityRepository,
  schema,
} from "@ceo-agent/db";
import {
  EpisodeContinuityAuthorityError,
  assertEpisodeContinuityConsumption,
  buildFinalStoryResultPersistenceRecord,
  materializeEpisodeContinuityAuthority,
  type EpisodeContinuityAuthority,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration =
  RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const id = (n: number) =>
  `72000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;

describeIntegration("Episode continuity PostgreSQL authority", () => {
  let sql: Sql;
  let repository: PgEpisodeContinuityAuthorityRepository;
  const schemaName = `episode_continuity_${Date.now()}`;
  const scope = {
    organizationId: id(1),
    workspaceId: id(2),
    campaignId: id(3),
    storyId: id(4),
  };
  const other = {
    organizationId: id(101),
    workspaceId: id(102),
    campaignId: id(103),
    storyId: id(104),
  };
  const userA = id(80);
  const userB = id(81);
  const storyVersionId = id(7);
  const staleStoryVersionId = id(8);
  const sceneResultId = id(61);
  const finalResult = buildFinalStoryResultPersistenceRecord({
    ownership: {
      orgId: scope.organizationId,
      workspaceId: scope.workspaceId,
      campaignId: scope.campaignId,
      storyId: scope.storyId,
      storyVersionId,
      animationPackageId: id(62),
      executionPlanId: id(63),
    },
    assemblyDefinitionId: id(64),
    assemblyJobId: id(65),
    assemblyJobIdentity: hash("c"),
    assemblyArtifactId: id(66),
    orderedSceneResultIds: [sceneResultId],
    outputMediaReference: `${scope.workspaceId}/assembly/${id(65)}/out.mp4`,
    contentHash: hash("b"),
    totalDurationMs: 8_000,
    width: 480,
    height: 854,
    frameRate: 30,
    assemblyEngineSnapshotHash: hash("d"),
    acceptedAt: "2026-09-25T09:59:00.000Z",
    projectedAt: "2026-09-25T10:00:00.000Z",
  });

  function authority(sequence: number, overrides: {
    fromEpisodeVersion?: number;
    fromEpisodeOrder?: number;
    toEpisodeOrder?: number;
    fromStoryVersionId?: string;
    resultStoryVersionId?: string;
    orderedSceneResultIds?: string[];
    dnaVersionId?: string | null;
    dnaFingerprint?: string | null;
    narrativeFact?: string;
  } = {}): EpisodeContinuityAuthority {
    const fromEpisodeOrder = overrides.fromEpisodeOrder ?? sequence;
    const fromStoryVersionId = overrides.fromStoryVersionId ?? storyVersionId;
    return materializeEpisodeContinuityAuthority({
      ...scope,
      fromEpisode: {
        episodeId: id(200 + sequence * 2),
        episodeVersion: overrides.fromEpisodeVersion ?? 1,
        episodeOrder: fromEpisodeOrder,
        storyVersionId: fromStoryVersionId,
      },
      toEpisode: {
        episodeId: id(201 + sequence * 2),
        episodeVersion: null,
        episodeOrder: overrides.toEpisodeOrder ?? fromEpisodeOrder + 1,
        storyVersionId: null,
      },
      fromEpisodeScope: scope,
      toEpisodeScope: scope,
      characterStates: [
        {
          characterId: id(10),
          characterVersionId: id(11),
          characterFingerprint: hash("e"),
          reusableCharacterId: id(12),
          reusableCharacterVersionId: id(13),
          dnaVersionId:
            overrides.dnaVersionId === undefined ? id(14) : overrides.dnaVersionId,
          dnaFingerprint:
            overrides.dnaFingerprint === undefined
              ? hash("f")
              : overrides.dnaFingerprint,
          castAuthorityRef: id(15),
          outfitState: "blue jacket",
          appearanceDelta: null,
          physicalState: "healthy",
          emotionalState: "focused",
          lastAction: "arranging flowers",
          lastDialogue: "These flowers are ready for today.",
          voiceAuthorityRef: null,
        },
      ],
      locationState: null,
      objectStates: [],
      narrativeState: {
        finalBeatId: null,
        completedBeatIds: [],
        unresolvedBeatIds: [id(40)],
        unresolvedPromises: ["promise"],
        lastDialogue: null,
        lastSpeakerId: null,
        lastAction: "exit",
        nextEpisodeRequiredFacts: [overrides.narrativeFact ?? "fact"],
      },
      visualState: null,
      audioState: null,
      createdFromResultAuthority: {
        finalStoryResultId: finalResult.finalStoryResultId,
        finalStoryResultIntegrityHash: finalResult.integrityHash,
        finalMediaContentHash: finalResult.contentHash,
        storyVersionId: overrides.resultStoryVersionId ?? fromStoryVersionId,
        orderedSceneResultIds:
          overrides.orderedSceneResultIds ?? [...finalResult.orderedSceneResultIds],
      },
      createdBy: userA,
      frozenAt: "2026-09-25T10:00:00.000Z",
    });
  }

  async function insertRaw(
    value: EpisodeContinuityAuthority,
    overrides: Partial<{
      organizationId: string;
      workspaceId: string;
      campaignId: string;
      storyId: string;
      toEpisodeOrder: number;
    }> = {}
  ): Promise<void> {
    await sql`
      insert into ai_story_episode_continuity_authorities (
        continuity_authority_id, organization_id, workspace_id, campaign_id,
        story_id, from_episode_id, from_episode_version, from_episode_order,
        from_story_version_id, to_episode_id, to_episode_version,
        to_episode_order, source_final_story_result_id, version,
        contract_version, fingerprint, authority, created_by, created_at,
        frozen_at
      ) values (
        ${value.continuityAuthorityId}::uuid,
        ${overrides.organizationId ?? value.organizationId}::uuid,
        ${overrides.workspaceId ?? value.workspaceId}::uuid,
        ${overrides.campaignId ?? value.campaignId}::uuid,
        ${overrides.storyId ?? value.storyId}::uuid,
        ${value.fromEpisode.episodeId}::uuid,
        ${value.fromEpisode.episodeVersion},
        ${value.fromEpisode.episodeOrder},
        ${value.fromEpisode.storyVersionId}::uuid,
        ${value.toEpisode.episodeId}::uuid,
        ${value.toEpisode.episodeVersion},
        ${overrides.toEpisodeOrder ?? value.toEpisode.episodeOrder},
        ${value.createdFromResultAuthority.finalStoryResultId}::uuid,
        ${value.version}, ${value.contractVersion}, ${value.fingerprint},
        ${JSON.stringify(value)}::jsonb, ${value.createdBy}::uuid,
        ${value.createdAt}::timestamptz, ${value.frozenAt}::timestamptz
      )
    `;
  }

  async function asAuthenticated<T>(
    userId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    await sql.unsafe(
      `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${userId}',false);`
    );
    try {
      return await operation();
    } finally {
      await sql.unsafe("RESET ROLE");
    }
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      CREATE SCHEMA ${schemaName};
      SET search_path TO ${schemaName}, public;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE TABLE organizations(id uuid PRIMARY KEY);
      CREATE TABLE workspaces(id uuid PRIMARY KEY);
      CREATE TABLE campaigns(id uuid PRIMARY KEY);
      CREATE TABLE workspace_members(workspace_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL);
      CREATE TABLE ai_stories(id uuid PRIMARY KEY, org_id uuid NOT NULL, workspace_id uuid NOT NULL, campaign_id uuid NOT NULL);
      CREATE TABLE ai_story_versions(id uuid PRIMARY KEY, story_id uuid NOT NULL);
      CREATE TABLE ai_story_final_story_results(final_story_result_id uuid PRIMARY KEY, result jsonb NOT NULL);
      INSERT INTO organizations VALUES ('${scope.organizationId}'), ('${other.organizationId}');
      INSERT INTO workspaces VALUES ('${scope.workspaceId}'), ('${other.workspaceId}');
      INSERT INTO campaigns VALUES ('${scope.campaignId}'), ('${other.campaignId}');
      INSERT INTO workspace_members VALUES
        ('${scope.workspaceId}','${userA}','admin'),
        ('${other.workspaceId}','${userB}','admin');
      INSERT INTO ai_stories VALUES
        ('${scope.storyId}','${scope.organizationId}','${scope.workspaceId}','${scope.campaignId}'),
        ('${other.storyId}','${other.organizationId}','${other.workspaceId}','${other.campaignId}');
      INSERT INTO ai_story_versions VALUES
        ('${storyVersionId}','${scope.storyId}'),
        ('${staleStoryVersionId}','${scope.storyId}');
    `);
    await sql`
      insert into ai_story_final_story_results (final_story_result_id, result)
      values (${finalResult.finalStoryResultId}::uuid, ${sql.json(finalResult)})
    `;
    await sql.unsafe(
      readFileSync(
        resolve(
          process.cwd(),
          "packages/db/sql/ai-story-episode-continuity-authority-v1.sql"
        ),
        "utf8"
      )
    );
    await sql.unsafe(`
      GRANT USAGE ON SCHEMA ${schemaName} TO authenticated;
      GRANT SELECT, INSERT ON ${schemaName}.ai_story_episode_continuity_authorities TO authenticated;
      GRANT SELECT ON ${schemaName}.workspace_members, ${schemaName}.ai_stories TO authenticated;
    `);
    repository = new PgEpisodeContinuityAuthorityRepository(
      drizzle(sql, { schema })
    );
  }, 30_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.unsafe(
      `RESET ROLE; RESET search_path; DROP SCHEMA IF EXISTS ${schemaName} CASCADE;`
    );
    await sql.end();
  });

  it("applies the additive relation with columns, PKs, FKs, unique constraints, indexes, RLS, and immutable triggers", async () => {
    const columns = await sql<{ name: string }[]>`
      select column_name name from information_schema.columns
      where table_schema=${schemaName} and table_name='ai_story_episode_continuity_authorities'
    `;
    const constraints = await sql<{ name: string; type: string }[]>`
      select conname name, contype type from pg_constraint
      where conrelid='ai_story_episode_continuity_authorities'::regclass
    `;
    const indexes = await sql<{ name: string }[]>`
      select indexname name from pg_indexes
      where schemaname=${schemaName} and tablename='ai_story_episode_continuity_authorities'
    `;
    const triggers = await sql<{ name: string }[]>`
      select tgname name from pg_trigger
      where tgrelid='ai_story_episode_continuity_authorities'::regclass and not tgisinternal
    `;
    const [table] = await sql<{ rls: boolean }[]>`
      select relrowsecurity rls from pg_class
      where oid='ai_story_episode_continuity_authorities'::regclass
    `;
    expect(columns.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "organization_id", "workspace_id", "campaign_id", "story_id",
        "from_episode_id", "to_episode_id", "version", "fingerprint",
        "source_final_story_result_id", "authority", "created_at", "frozen_at",
      ])
    );
    expect(constraints.filter((row) => row.type === "p")).toHaveLength(1);
    expect(constraints.filter((row) => row.type === "f")).toHaveLength(6);
    expect(constraints.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "ai_story_episode_continuity_identity_unique",
        "ai_story_episode_continuity_fingerprint_unique",
        "ai_story_episode_continuity_adjacent_check",
      ])
    );
    expect(indexes.map((row) => row.name)).toContain(
      "ai_story_episode_continuity_destination_idx"
    );
    expect(triggers.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "ai_story_episode_continuity_immutable_update",
        "ai_story_episode_continuity_immutable_delete",
      ])
    );
    expect(table?.rls).toBe(true);
  });

  it("accepts a valid adjacent Episode N to N+1 authority", async () => {
    const saved = await repository.insertOrConverge(authority(1));
    expect(saved.replayed).toBe(false);
    expect(saved.authority.toEpisode.episodeOrder).toBe(
      saved.authority.fromEpisode.episodeOrder + 1
    );
  });

  it("converges identical repeated materialization onto the frozen row", async () => {
    const value = authority(2);
    const first = await repository.insertOrConverge(value);
    const second = await repository.insertOrConverge(value);
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ authority: first.authority, replayed: true });
  });

  it("rejects conflicting immutable facts for an occupied handoff identity", async () => {
    await repository.insertOrConverge(authority(3));
    await expect(
      repository.insertOrConverge(authority(3, { narrativeFact: "different" }))
    ).rejects.toMatchObject({ code: "IMMUTABLE_CONFLICT" });
  });

  it("rejects cross-organization persistence through RLS ownership validation", async () => {
    await expect(
      asAuthenticated(userA, () =>
        insertRaw(authority(4), { organizationId: other.organizationId })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects cross-workspace persistence through RLS ownership validation", async () => {
    await expect(
      asAuthenticated(userA, () =>
        insertRaw(authority(5), { workspaceId: other.workspaceId })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects cross-Campaign persistence through RLS Story ownership validation", async () => {
    await expect(
      asAuthenticated(userA, () =>
        insertRaw(authority(6), { campaignId: other.campaignId })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects cross-Story persistence through RLS Story ownership validation", async () => {
    await expect(
      asAuthenticated(userA, () =>
        insertRaw(authority(7), { storyId: other.storyId })
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects non-adjacent Episode continuity at the PostgreSQL constraint", async () => {
    await expect(
      insertRaw(authority(8), { toEpisodeOrder: 99 })
    ).rejects.toThrow(/ai_story_episode_continuity_adjacent_check/i);
  });

  it("rejects a stale source Story/Episode version against the canonical Final Story Result", async () => {
    await expect(
      repository.insertOrConverge(
        authority(9, {
          fromStoryVersionId: staleStoryVersionId,
          resultStoryVersionId: staleStoryVersionId,
        })
      )
    ).rejects.toMatchObject({ code: "CONTINUITY_SOURCE_NOT_CANONICAL" });
  });

  it("rejects an invalid DNA version/fingerprint persistence pair", async () => {
    const value = authority(10);
    const malformed = {
      ...value,
      characterStates: [
        { ...value.characterStates[0]!, dnaVersionId: null },
      ],
    };
    await expect(
      repository.insertOrConverge(malformed as EpisodeContinuityAuthority)
    ).rejects.toThrow(/DNA version and fingerprint must be pinned together/i);
  });

  it("rejects UPDATE of frozen authority rows", async () => {
    const value = authority(11);
    await repository.insertOrConverge(value);
    await expect(sql`
      update ai_story_episode_continuity_authorities
      set version=2
      where continuity_authority_id=${value.continuityAuthorityId}::uuid
    `).rejects.toThrow(/EPISODE_CONTINUITY_AUTHORITY_IMMUTABLE/);
  });

  it("rejects DELETE of frozen authority rows", async () => {
    const value = authority(12);
    await repository.insertOrConverge(value);
    await expect(sql`
      delete from ai_story_episode_continuity_authorities
      where continuity_authority_id=${value.continuityAuthorityId}::uuid
    `).rejects.toThrow(/EPISODE_CONTINUITY_AUTHORITY_IMMUTABLE/);
  });

  it("validates canonical Final Story Result ownership and integrity", async () => {
    const valid = await repository.insertOrConverge(authority(13));
    expect(valid.authority.createdFromResultAuthority).toMatchObject({
      finalStoryResultId: finalResult.finalStoryResultId,
      finalStoryResultIntegrityHash: finalResult.integrityHash,
      finalMediaContentHash: finalResult.contentHash,
      storyVersionId: finalResult.storyVersionId,
    });
    const mismatched = authority(14);
    await expect(
      repository.insertOrConverge({
        ...mismatched,
        createdFromResultAuthority: {
          ...mismatched.createdFromResultAuthority,
          finalStoryResultIntegrityHash: hash("9"),
        },
      })
    ).rejects.toMatchObject({ code: "CONTINUITY_SOURCE_NOT_CANONICAL" });
  });

  it("validates ordered Scene Result authority exactly", async () => {
    await expect(
      repository.insertOrConverge(
        authority(15, { orderedSceneResultIds: [id(99)] })
      )
    ).rejects.toMatchObject({ code: "CONTINUITY_SOURCE_NOT_CANONICAL" });
  });

  it("loads only the exact previous Episode identity/version and destination slot", async () => {
    const value = authority(16);
    await repository.insertOrConverge(value);
    const exact = await repository.loadPreviousEpisodeContinuityAuthority({
      ...scope,
      expectedFromEpisodeId: value.fromEpisode.episodeId,
      expectedFromEpisodeVersion: value.fromEpisode.episodeVersion!,
      toEpisodeId: value.toEpisode.episodeId,
      toEpisodeOrder: value.toEpisode.episodeOrder,
    });
    const stale = await repository.loadPreviousEpisodeContinuityAuthority({
      ...scope,
      expectedFromEpisodeId: value.fromEpisode.episodeId,
      expectedFromEpisodeVersion: value.fromEpisode.episodeVersion! + 1,
      toEpisodeId: value.toEpisode.episodeId,
      toEpisodeOrder: value.toEpisode.episodeOrder,
    });
    expect(exact?.fingerprint).toBe(value.fingerprint);
    expect(stale).toBeNull();
  });

  it("fails closed when the consuming Character DNA authority differs", async () => {
    const value = authority(17);
    await repository.insertOrConverge(value);
    expect(() =>
      assertEpisodeContinuityConsumption({
        authority: value,
        expectedScope: scope,
        expectedFromEpisodeId: value.fromEpisode.episodeId,
        expectedFromEpisodeVersion: value.fromEpisode.episodeVersion!,
        toEpisode: { ...value.toEpisode, ...scope },
        characterAuthorities: [
          {
            ...value.characterStates[0]!,
            dnaFingerprint: hash("0"),
          },
        ],
        retainedUnresolvedBeatIds: value.narrativeState.unresolvedBeatIds,
      })
    ).toThrowError(
      expect.objectContaining<EpisodeContinuityAuthorityError>({
        code: "DNA_CONTINUITY_MISMATCH",
      })
    );
  });

  it("prevents an unrelated authenticated tenant from reading frozen authority rows", async () => {
    const rows = await asAuthenticated(userB, () =>
      sql<{ id: string }[]>`
        select continuity_authority_id id
        from ai_story_episode_continuity_authorities
      `
    );
    expect(rows).toEqual([]);
  });
});
