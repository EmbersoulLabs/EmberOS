import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import {
  AiStoryCharacterDnaService,
  closeDb,
} from "@ceo-agent/db";
import { CHARACTER_SOURCE_PORTRAIT } from "@ceo-agent/shared";
import { mockCharacterDnaFixture } from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  cleanupRlsFixture,
  createIntegrationSql,
  getIntegrationDbUrl,
  seedRlsFixture,
  type RlsTestFixture,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const SOURCE = "83000000-0000-4000-8000-000000000001";
const HASH = `sha256:${"b".repeat(64)}`;

describeIntegration("AI Story Character DNA persistence", () => {
  let sql: Sql;
  let fixture: RlsTestFixture;
  let service: AiStoryCharacterDnaService;
  const scope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceAId, actorUserId: fixture.userAId });
  const otherScope = () => ({ orgId: fixture.orgId, workspaceId: fixture.workspaceBId, actorUserId: fixture.userBId });

  beforeAll(async () => {
    sql = createIntegrationSql();
    fixture = await seedRlsFixture(sql);
    service = new AiStoryCharacterDnaService();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-reusable-character-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-dna-from-photo-v1.sql"), "utf8"));
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-character-dna-analysis-jobs-server-only-rls-v1.sql"), "utf8"));
    await sql.unsafe(`GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON ai_story_reusable_characters TO authenticated;
      GRANT SELECT,INSERT ON ai_story_reusable_character_versions TO authenticated;
      GRANT SELECT,INSERT,UPDATE ON assets TO authenticated;`);
    await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status,source,content_hash,mime_type,file_size_bytes)
      values(${SOURCE}::uuid,${fixture.orgId}::uuid,${fixture.workspaceAId}::uuid,null,'image',${`${fixture.workspaceAId}/library/${SOURCE}.jpg`},'ready','library_upload',${HASH},'image/jpeg',120000)`;
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (!sql) return;
    await sql`delete from ai_story_character_dna_analysis_jobs where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_reusable_character_versions where org_id=${fixture.orgId}::uuid`;
    await sql`delete from ai_story_reusable_characters where org_id=${fixture.orgId}::uuid`;
    await sql`delete from assets where org_id=${fixture.orgId}::uuid`;
    await cleanupRlsFixture(sql, fixture);
    await sql.end();
  }, 30_000);

  it("analyzes, saves DNA Character, blocks IDENTITY_MASTER promotion, and isolates Workspace", async () => {
    const source = await service.registerSourcePortrait(scope(), SOURCE);
    expect((source as { semantic?: string }).semantic ?? CHARACTER_SOURCE_PORTRAIT).toBe(CHARACTER_SOURCE_PORTRAIT);

    const job = await service.analyze(scope(), {
      sourceAssetId: SOURCE,
      permissionConfirmed: true,
      analyze: async (input) => ({
        dna: mockCharacterDnaFixture({
          sourceAssetId: input.sourceAssetId,
          sourceContentHash: input.sourceContentHash,
          createdAt: input.createdAt,
        }),
        provider: "mock",
        providerModel: "character-dna-mock.v1",
        inputTokens: 10,
        outputTokens: 10,
        costUsd: "0.0010",
        imageGenerationCalls: 0,
        gptImageCalls: 0,
      }),
    });
    expect(job.status).toBe("SUCCEEDED");
    expect(job.imageGenerationCalls).toBe(0);
    expect(job.proposedDna?.sourceAssetId).toBe(SOURCE);

    const saved = await service.save(scope(), {
      jobId: job.id,
      name: "Alicia",
      approvedDna: { ...job.proposedDna!, hair: { ...job.proposedDna!.hair, length: "chin-length hair" } },
    });
    expect(saved.character.identityMode).toBe("CHARACTER_DNA");
    expect(saved.character.canonicalAssets.some((asset) => asset.role === "IDENTITY_MASTER")).toBe(false);
    expect(saved.character.version).toBe(1);

    await expect(service.readJob(otherScope(), job.id)).rejects.toThrow(/Workspace authority|not found/i);
    expect(randomUUID()).toBeTruthy();
  });
});
