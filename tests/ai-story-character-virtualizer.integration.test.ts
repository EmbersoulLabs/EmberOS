import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryCharacterVirtualizerError,
  AiStoryCharacterVirtualizerService,
  AiStoryReusableCharacterService,
  closeDb,
} from "@ceo-agent/db";
import { CHARACTER_SOURCE_PORTRAIT } from "@ceo-agent/shared";
import {
  MOCK_VIRTUAL_CHARACTER_PNG,
  hashCharacterVirtualizationBytes,
} from "@ceo-agent/shared/server";
import { randomUUID } from "node:crypto";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const SOURCE = "73000000-0000-4000-8000-000000000001";
const HASH = `sha256:${"b".repeat(64)}`;

describeIntegration("AI Story Character Virtualizer persistence", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let service: AiStoryCharacterVirtualizerService;
  let characters: AiStoryReusableCharacterService;
  const scope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceAId, actorUserId: fixture.userAId });
  const otherScope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceBId, actorUserId: fixture.userBId });

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    service = new AiStoryCharacterVirtualizerService();
    characters = new AiStoryReusableCharacterService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-reusable-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-virtualizer-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-virtualizer-real-provider-calls-01.sql"), "utf8"));
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_characters TO authenticated;
      GRANT SELECT,INSERT ON ai_story_character_versions TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_reusable_characters TO authenticated;
      GRANT SELECT,INSERT ON ai_story_reusable_character_versions TO authenticated;
      GRANT SELECT,INSERT ON ai_story_reusable_character_campaign_projections TO authenticated;
      GRANT SELECT,INSERT ON ai_story_episode_character_bindings TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_character_continuity_anchors TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_character_virtualization_jobs TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON assets TO authenticated;`);
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status,source,content_hash,mime_type,file_size_bytes)
      values(${SOURCE}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,null,'image',${`${fixture.workspaceAId}/library/${SOURCE}.jpg`},'ready','library_upload',${HASH},'image/jpeg',120000)`;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`delete from ai_story_character_virtualization_jobs where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_reusable_character_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_reusable_characters where org_id=${fixture.orgId}::uuid`;
    await sql`delete from assets where org_id=${fixture.orgId}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("registers source, mocks generate, accepts Alicia, versions, isolates, and preserves Character after source delete", async () => {
    const source = await service.registerSourcePortrait(scope(), SOURCE);
    expect((source.metadata as { characterAssetSemantic?: string }).characterAssetSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);

    const job = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T14:00:00.000Z",
    });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.acceptanceStatus).toBe("VIRTUAL_CHARACTER_CANDIDATE");
    expect(job.reusableCharacterId).toBeNull();
    expect(job.sourceAssetId).not.toBe(job.outputAssetId);
    expect(job.visualClass).toBe("SYNTHETIC_3D");
    expect(job.realImageProviderCalls).toBe(0);
    expect(job.seedanceVideoCalls).toBe(0);

    const accepted = await service.accept(scope(), { jobId: job.id, name: "Alicia", now: "2026-09-22T14:01:00.000Z" });
    expect(accepted.character.name).toBe("Alicia");
    expect(accepted.character.version).toBe(1);
    expect(accepted.character.canonicalAssets[0]?.role).toBe("IDENTITY_MASTER");
    expect(accepted.character.canonicalAssets[0]?.assetId).toBe(job.outputAssetId);
    expect(accepted.lineage.sourceSemantic).toBe(CHARACTER_SOURCE_PORTRAIT);
    expect(accepted.lineage.identityMasterAssetId).toBe(job.outputAssetId);

    const rejected = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      creativeDirection: "__REJECT__",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T14:02:00.000Z",
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.reusableCharacterId).toBeNull();

    const again = await service.generateAgain(scope(), {
      parentJobId: job.id,
      permissionConfirmed: true,
      costAuthorized: true,
    });
    expect(again.parentJobId).toBe(job.id);
    const v2 = await service.accept(scope(), {
      jobId: again.id,
      name: "Alicia",
      targetReusableCharacterId: accepted.character.reusableCharacterId,
      now: "2026-09-22T14:03:00.000Z",
    });
    expect(v2.character.version).toBe(2);
    const history = await characters.history(scope(), accepted.character.reusableCharacterId);
    expect(history.map((row) => row.version)).toEqual([1, 2]);
    expect(history[0]?.canonicalAssets[0]?.assetId).toBe(job.outputAssetId);
    expect(history[1]?.canonicalAssets[0]?.assetId).toBe(again.outputAssetId);

    await expect(service.readJob(otherScope(), job.id)).rejects.toBeInstanceOf(AiStoryCharacterVirtualizerError);

    const deletion = await service.evaluateAssetDeletion(scope(), SOURCE);
    expect(deletion.allowed).toBe(true);
    expect(deletion.characterPreserved).toBe(true);
    await sql`update assets set deleted_at=now(), status='archived' where id=${SOURCE}::uuid`;
    const still = await characters.readCurrent(scope(), accepted.character.reusableCharacterId);
    expect(still.canonicalAssets[0]?.assetId).toBe(again.outputAssetId);
    expect(still.name).toBe("Alicia");

    const masterDeletion = await service.evaluateAssetDeletion(scope(), again.outputAssetId!);
    expect(masterDeletion.allowed).toBe(false);
  });

  it("permits real_image_provider_calls 0 and 1 and rejects -1 and 2", async () => {
    const job = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T15:00:00.000Z",
    });
    const row = await sql<{ real_image_provider_calls: number; snapshot: { realImageProviderCalls: number } }[]>`
      select real_image_provider_calls, snapshot from ai_story_character_virtualization_jobs where job_id=${job.id}::uuid
    `;
    expect(row[0]?.real_image_provider_calls).toBe(0);
    expect(row[0]?.snapshot.realImageProviderCalls).toBe(0);

    await sql`
      update ai_story_character_virtualization_jobs
      set real_image_provider_calls = 1,
          snapshot = jsonb_set(snapshot, '{realImageProviderCalls}', '1'::jsonb)
      where job_id=${job.id}::uuid
    `;
    const updated = await sql<{ real_image_provider_calls: number; snapshot: { realImageProviderCalls: number } }[]>`
      select real_image_provider_calls, snapshot from ai_story_character_virtualization_jobs where job_id=${job.id}::uuid
    `;
    expect(updated[0]?.real_image_provider_calls).toBe(1);
    expect(updated[0]?.snapshot.realImageProviderCalls).toBe(1);

    await expect(sql`
      update ai_story_character_virtualization_jobs set real_image_provider_calls = -1 where job_id=${job.id}::uuid
    `).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      update ai_story_character_virtualization_jobs set real_image_provider_calls = 2 where job_id=${job.id}::uuid
    `).rejects.toMatchObject({ code: "23514" });
  });

  it("persists Provider success with call count 1 and rejection after execution with count 1", async () => {
    const outputHash = hashCharacterVirtualizationBytes(MOCK_VIRTUAL_CHARACTER_PNG);
    const paidSuccess = {
      providerId: "openai",
      providerModel: "gpt-image-2",
      externalPaidCall: true,
      async virtualizeCharacter() {
        return {
          ok: true as const,
          bytes: new Uint8Array(MOCK_VIRTUAL_CHARACTER_PNG),
          mimeType: "image/png" as const,
          width: 1024,
          height: 1536,
          provider: "openai",
          providerModel: "gpt-image-2",
          providerAttemptId: randomUUID(),
          contentHash: outputHash,
          realImageProviderCalls: 1 as const,
          costUsd: "0.0400",
        };
      },
    };
    const succeeded = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T15:10:00.000Z",
      provider: paidSuccess,
    });
    expect(succeeded.status).toBe("SUCCEEDED");
    expect(succeeded.realImageProviderCalls).toBe(1);
    expect(succeeded.seedanceVideoCalls).toBe(0);
    const successRow = await sql<{ real_image_provider_calls: number; snapshot: { realImageProviderCalls: number } }[]>`
      select real_image_provider_calls, snapshot from ai_story_character_virtualization_jobs where job_id=${succeeded.id}::uuid
    `;
    expect(successRow[0]?.real_image_provider_calls).toBe(successRow[0]?.snapshot.realImageProviderCalls);
    expect(successRow[0]?.real_image_provider_calls).toBe(1);

    const paidReject = {
      providerId: "openai",
      providerModel: "gpt-image-2",
      externalPaidCall: true,
      async virtualizeCharacter() {
        return {
          ok: false as const,
          code: "PROVIDER_REJECTED" as const,
          userSafeMessage: "This photo could not be turned into a virtual Character. No Character was created.",
          provider: "openai",
          providerModel: "gpt-image-2",
          providerAttemptId: randomUUID(),
          realImageProviderCalls: 1 as const,
        };
      },
    };
    const rejected = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T15:11:00.000Z",
      provider: paidReject,
    });
    expect(rejected.status).toBe("REJECTED");
    expect(rejected.realImageProviderCalls).toBe(1);
    expect(rejected.reusableCharacterId).toBeNull();
  });

  it("keeps pre-provider compile failure at 0 calls and preserves paid calls after output persist failure", async () => {
    const compileFail = {
      providerId: "openai",
      providerModel: "gpt-image-2",
      externalPaidCall: true,
      async virtualizeCharacter() {
        return {
          ok: false as const,
          code: "PROVIDER_RESULT_INVALID" as const,
          userSafeMessage: "Character creation could not be completed. No Character was created.",
          provider: "openai",
          providerModel: "gpt-image-2",
          providerAttemptId: randomUUID(),
          realImageProviderCalls: 0 as const,
        };
      },
    };
    const pre = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T15:12:00.000Z",
      provider: compileFail,
    });
    expect(pre.status).toBe("FAILED");
    expect(pre.realImageProviderCalls).toBe(0);

    const outputHash = hashCharacterVirtualizationBytes(MOCK_VIRTUAL_CHARACTER_PNG);
    const persistFail = await service.generate(scope(), {
      sourceAssetId: SOURCE,
      style: "PREMIUM_3D",
      permissionConfirmed: true,
      costAuthorized: true,
      now: "2026-09-22T15:13:00.000Z",
      provider: {
        providerId: "openai",
        providerModel: "gpt-image-2",
        externalPaidCall: true,
        async virtualizeCharacter() {
          return {
            ok: true as const,
            bytes: new Uint8Array(MOCK_VIRTUAL_CHARACTER_PNG),
            mimeType: "image/png" as const,
            width: 1024,
            height: 1536,
            provider: "openai",
            providerModel: "gpt-image-2",
            providerAttemptId: randomUUID(),
            contentHash: outputHash,
            realImageProviderCalls: 1 as const,
            costUsd: "0.0400",
          };
        },
      },
      persistOutputBytes: async () => {
        throw new Error("storage failed");
      },
    });
    expect(persistFail.status).toBe("FAILED");
    expect(persistFail.realImageProviderCalls).toBe(1);
    expect(persistFail.costUsd).toBe("0.0400");
    expect(persistFail.reusableCharacterId).toBeNull();
    expect(persistFail.reusableCharacterVersionId).toBeNull();
    expect(persistFail.acceptanceStatus).not.toBe("ACCEPTED");
    expect(persistFail.automaticRetry).toBe(false);
    expect(persistFail.outputAssetId).toBeNull();
    const persistRow = await sql<{
      real_image_provider_calls: number;
      cost_usd: string | null;
      snapshot: { realImageProviderCalls: number; costUsd: string | null };
    }[]>`
      select real_image_provider_calls, cost_usd::text as cost_usd, snapshot
      from ai_story_character_virtualization_jobs where job_id=${persistFail.id}::uuid
    `;
    expect(persistRow[0]?.real_image_provider_calls).toBe(persistRow[0]?.snapshot.realImageProviderCalls);
    expect(persistRow[0]?.real_image_provider_calls).toBe(1);
    expect(persistRow[0]?.cost_usd).toBe("0.0400");
    expect(persistRow[0]?.snapshot.costUsd).toBe("0.0400");
  });
});
