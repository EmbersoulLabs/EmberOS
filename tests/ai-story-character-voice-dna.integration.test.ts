import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryCharacterVoiceDnaPersistenceError,
  AiStoryCharacterVoiceDnaService,
  AiStoryReusableCharacterService,
  closeDb,
  getDb,
  loadReusableCharacterVoiceIdentity,
} from "@ceo-agent/db";
import type { AiStoryCharacterVoiceDna, VoiceDnaBuildInput } from "@ceo-agent/shared";
import { AiStoryCharacterVoiceDnaError } from "@ceo-agent/shared";
import { buildAiStoryCharacterVoiceDna } from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const HASH = `sha256:${"a".repeat(64)}`;

const identity = {
  name: "Alicia",
  identityCore: {
    identityDescription: "Alicia is a synthetic restaurant spokesperson.",
    faceIdentityDescription: "Oval face, dark brown eyes, defined brows, medium nose, closed-lip smile.",
    bodyIdentityDescription: "Average adult height with balanced shoulders.",
    distinctiveVisualFacts: ["small beauty mark near the left eye"],
    mustPreserve: ["face identity", "body proportions", "beauty mark"],
    mustNeverChange: ["canonical face identity"],
  },
  defaultLook: { wardrobe: "white outfit", makeup: "natural", accessories: null, hairstyle: "shoulder length", hairColor: "dark brown" },
  mutableLookPolicy: { wardrobeAllowed: true, makeupAllowed: true, accessoriesAllowed: true, hairstyleAllowed: true, hairColorAllowed: false },
  canonicalAssets: [] as Array<{ assetId: string; role: "IDENTITY_MASTER" }>,
};

describeIntegration("durable Character Voice DNA authority", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let assetId: string;
  let characters: AiStoryReusableCharacterService;
  let voices: AiStoryCharacterVoiceDnaService;
  const scope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceAId, actorUserId: fixture.userAId });
  const foreignScope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceBId, actorUserId: fixture.userBId });

  function voiceInput(
    version: { reusableCharacterId: string; reusableCharacterVersionId: string; identityFingerprint: string },
    overrides: Partial<VoiceDnaBuildInput> = {}
  ): VoiceDnaBuildInput {
    return {
      status: "FROZEN",
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
      characterIdentityFingerprint: version.identityFingerprint,
      primaryLocale: "zh-MY",
      allowedSecondaryLocales: ["en-MY"],
      codeSwitchPolicy: { mode: "SCRIPT_AUTHORIZED", allowedLocales: ["zh-MY", "en-MY"] },
      voicePresentation: { genderPresentation: "FEMININE", ageRangePresentation: "YOUNG_ADULT" },
      acousticProfile: {
        register: "MID",
        pitchIntent: "MEDIUM",
        resonance: "WARM",
        brightness: "BRIGHT",
        breathiness: "NATURAL",
        texture: "natural conversational texture",
      },
      speechProfile: {
        cadence: "natural Malaysian Mandarin cadence",
        defaultPace: "NATURAL",
        pauseStyle: "NATURAL",
        emphasisStyle: "EXPRESSIVE",
        articulation: "CLEAR",
        energy: "NATURAL",
      },
      accentProfile: {
        locale: "zh-MY",
        regionalIntent: "Malaysian Mandarin",
        prohibitedStylizations: ["announcer voice"],
      },
      defaultDeliveryStyle: "MANDARIN_MY_CONVERSATIONAL",
      mustPreserve: ["Malaysian Mandarin cadence"],
      mustAvoid: ["announcer voice"],
      consistencyMode: "DESCRIPTIVE_VOICE_DNA",
      ...overrides,
    };
  }

  async function createCharacter(name: string) {
    return characters.create(scope(), {
      ...identity,
      name,
      canonicalAssets: [{ assetId, role: "IDENTITY_MASTER" }],
    });
  }

  async function insertRaw(authority: AiStoryCharacterVoiceDna, supersedesVoiceDnaId: string | null = null) {
    await sql`
      insert into ai_story_character_voice_dna_authorities (
        voice_dna_id, org_id, workspace_id, reusable_character_id, reusable_character_version_id,
        character_identity_fingerprint, voice_dna_fingerprint, contract_version, status,
        supersedes_voice_dna_id, snapshot, created_by, created_at
      ) values (
        ${authority.voiceDnaId}::uuid,
        ${authority.orgId}::uuid,
        ${authority.workspaceId}::uuid,
        ${authority.reusableCharacterId}::uuid,
        ${authority.reusableCharacterVersionId}::uuid,
        ${authority.characterIdentityFingerprint},
        ${authority.voiceDnaFingerprint},
        ${authority.contractVersion},
        ${authority.status},
        ${supersedesVoiceDnaId}::uuid,
        ${JSON.stringify(authority)}::jsonb,
        ${fixture.userAId}::uuid,
        now()
      )`;
  }

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    assetId = crypto.randomUUID();
    characters = new AiStoryReusableCharacterService();
    voices = new AiStoryCharacterVoiceDnaService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-reusable-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-voice-dna-v1.sql"), "utf8"));
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status,source,content_hash) values(${assetId}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,null,'image','alicia-voice-master.png','ready','campaign_upload',${HASH})`;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql || !fixture) return;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const removed = await sql`
        delete from ai_story_character_voice_dna_authorities as parent
        where parent.org_id = ${fixture.orgId}::uuid
          and not exists (
            select 1 from ai_story_character_voice_dna_authorities as child
            where child.supersedes_voice_dna_id = parent.voice_dna_id
          )
        returning parent.voice_dna_id`;
      if (removed.length === 0) break;
    }
    await sql.begin(async (tx) => {
      await tx`delete from ai_story_reusable_character_campaign_projections where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_reusable_character_versions where org_id=${fixture.orgId}::uuid`;
      await tx`delete from ai_story_reusable_characters where org_id=${fixture.orgId}::uuid`;
    });
    await sql`delete from campaign_asset_refs where asset_id=${assetId}::uuid`;
    await sql`delete from assets where id=${assetId}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("persists Voice DNA and reads the same authority by id and as the current version authority", async () => {
    const version = await createCharacter("Persist Alicia");
    const authority = buildAiStoryCharacterVoiceDna(voiceInput(version));
    const stored = await voices.createAuthority(scope(), authority);
    expect(stored).toEqual(authority);
    expect(await voices.readById(scope(), authority.voiceDnaId)).toEqual(authority);
    expect(await voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    })).toEqual(authority);
  });

  it("fails closed on a cross-workspace read", async () => {
    const version = await createCharacter("Scoped Alicia");
    const authority = await voices.createAuthority(scope(), buildAiStoryCharacterVoiceDna(voiceInput(version)));
    await expect(voices.readById(foreignScope(), authority.voiceDnaId)).rejects.toMatchObject({
      code: "VOICE_DNA_NOT_FOUND",
    });
    await expect(voices.readById({
      orgId: fixture.orgId,
      workspaceId: fixture.workspaceAId,
      actorUserId: fixture.userBId,
    }, authority.voiceDnaId)).rejects.toMatchObject({ code: "VOICE_DNA_WORKSPACE_SCOPE_GATE" });
    expect(await voices.readCurrentForReusableCharacterVersion(foreignScope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    })).toBeNull();
  });

  it("fails closed when Voice DNA does not match the Reusable Character version", async () => {
    const version = await createCharacter("Version Alicia");
    const mismatched = buildAiStoryCharacterVoiceDna(voiceInput(version, {
      characterIdentityFingerprint: `sha256:${"b".repeat(64)}`,
    }));
    await expect(voices.createAuthority(scope(), mismatched)).rejects.toBeInstanceOf(AiStoryCharacterVoiceDnaError);
    await expect(voices.createAuthority(scope(), buildAiStoryCharacterVoiceDna(voiceInput({
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: crypto.randomUUID(),
      identityFingerprint: version.identityFingerprint,
    })))).rejects.toMatchObject({ code: "VOICE_DNA_CHARACTER_VERSION_MISMATCH" });
    const stored = await voices.createAuthority(scope(), buildAiStoryCharacterVoiceDna(voiceInput(version)));
    const edited = await characters.edit(scope(), version.reusableCharacterId, {
      ...identity,
      name: "Version Alicia",
      canonicalAssets: [{ assetId, role: "IDENTITY_MASTER" }],
      identityCore: { ...identity.identityCore, identityDescription: "Alicia remains the same spokesperson." },
    }, version.version);
    expect(await voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: edited.reusableCharacterId,
      reusableCharacterVersionId: edited.reusableCharacterVersionId,
    })).toBeNull();
    expect((await voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    }))?.voiceDnaId).toBe(stored.voiceDnaId);
  });

  it("fails closed when the stored fingerprint does not match the snapshot", async () => {
    const version = await createCharacter("Tamper Alicia");
    const authority = buildAiStoryCharacterVoiceDna(voiceInput(version));
    const tampered: AiStoryCharacterVoiceDna = {
      ...authority,
      acousticProfile: { ...authority.acousticProfile, texture: "tampered texture" },
    };
    await insertRaw(tampered);
    await expect(voices.readById(scope(), authority.voiceDnaId)).rejects.toMatchObject({
      code: "VOICE_DNA_FINGERPRINT_MISMATCH",
    });
    await expect(voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    })).rejects.toBeInstanceOf(AiStoryCharacterVoiceDnaPersistenceError);
  });

  it("reuses an identical authority and leaves the previous row unchanged when a new authority supersedes it", async () => {
    const version = await createCharacter("Immutable Alicia");
    const original = buildAiStoryCharacterVoiceDna(voiceInput(version));
    const first = await voices.createAuthority(scope(), original);
    const again = await voices.createAuthority(scope(), original);
    expect(again).toEqual(first);
    const count = await sql<{ voice_dna_id: string }[]>`
      select voice_dna_id from ai_story_character_voice_dna_authorities
      where reusable_character_version_id = ${version.reusableCharacterVersionId}::uuid`;
    expect(count).toHaveLength(1);
    const successor = buildAiStoryCharacterVoiceDna(voiceInput(version, {
      acousticProfile: {
        ...original.acousticProfile,
        texture: "warmer close conversational texture",
      },
    }));
    await expect(voices.createAuthority(scope(), successor)).rejects.toMatchObject({
      code: "VOICE_DNA_SUPERSESSION_REQUIRED",
    });
    const before = await sql<{ snapshot: AiStoryCharacterVoiceDna; created_at: Date }[]>`
      select snapshot, created_at from ai_story_character_voice_dna_authorities
      where voice_dna_id = ${original.voiceDnaId}::uuid`;
    const created = await voices.createAuthority(scope(), successor, { supersedesVoiceDnaId: original.voiceDnaId });
    const after = await sql<{ snapshot: AiStoryCharacterVoiceDna; created_at: Date }[]>`
      select snapshot, created_at from ai_story_character_voice_dna_authorities
      where voice_dna_id = ${original.voiceDnaId}::uuid`;
    expect(after[0]?.snapshot).toEqual(before[0]?.snapshot);
    expect(new Date(after[0]!.created_at).toISOString()).toBe(new Date(before[0]!.created_at).toISOString());
    await expect(sql`
      update ai_story_character_voice_dna_authorities
      set status = 'APPROVED'
      where voice_dna_id = ${original.voiceDnaId}::uuid
    `).rejects.toThrow(/immutable/i);
    expect(created.voiceDnaId).toBe(successor.voiceDnaId);
    expect(created.voiceDnaId).not.toBe(original.voiceDnaId);
    expect((await voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    }))?.voiceDnaId).toBe(successor.voiceDnaId);
    const pinned = await voices.resolvePinnedAuthority(scope(), {
      voiceDnaId: original.voiceDnaId,
      voiceDnaFingerprint: original.voiceDnaFingerprint,
    });
    expect(pinned).toEqual(original);
    expect(pinned.voiceDnaId).not.toBe(successor.voiceDnaId);
    const loaded = await loadReusableCharacterVoiceIdentity(getDb(), scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    });
    expect(loaded?.voiceDnaId).toBe(successor.voiceDnaId);
  });

  it("returns null from the Character API loader when no Voice DNA authority exists", async () => {
    const version = await createCharacter("Silent Alicia");
    const route = readFileSync(resolve(
      process.cwd(),
      "apps/web/src/app/api/workspaces/[id]/reusable-characters/[characterId]/route.ts"
    ), "utf8");
    const page = readFileSync(resolve(
      process.cwd(),
      "apps/web/src/app/w/[slug]/characters/[characterId]/page.tsx"
    ), "utf8");
    expect(route).not.toContain("voiceIdentity: null");
    expect(route).toContain("loadReusableCharacterVoiceIdentity");
    expect(page).toContain("Primary language:");
    expect(page).toContain("Delivery identity:");
    expect(page).toContain("Voice presentation:");
    expect(page).toContain("Consistency mode:");
    expect(page).toContain("Status:");
    expect(page).toContain("Not pinned");
    expect(page).toContain("data.voiceIdentity");
    expect(await loadReusableCharacterVoiceIdentity(getDb(), scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    })).toBeNull();
  });

  it("fails closed when two current authorities exist without an explicit supersession", async () => {
    const version = await createCharacter("Ambiguous Alicia");
    const first = buildAiStoryCharacterVoiceDna(voiceInput(version));
    await voices.createAuthority(scope(), first);
    const second = buildAiStoryCharacterVoiceDna(voiceInput(version, {
      acousticProfile: { ...first.acousticProfile, texture: "second unlinked texture" },
    }));
    await insertRaw(second);
    await expect(voices.readCurrentForReusableCharacterVersion(scope(), {
      reusableCharacterId: version.reusableCharacterId,
      reusableCharacterVersionId: version.reusableCharacterVersionId,
    })).rejects.toMatchObject({ code: "VOICE_DNA_CURRENT_AMBIGUOUS" });
    expect((await voices.resolvePinnedAuthority(scope(), {
      voiceDnaId: first.voiceDnaId,
      voiceDnaFingerprint: first.voiceDnaFingerprint,
    })).voiceDnaId).toBe(first.voiceDnaId);
  });
});
