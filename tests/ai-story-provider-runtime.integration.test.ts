import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryProviderRuntimeRepository,
  AiStorySceneExecutionPersistenceRepository,
  closeDb,
  getDb,
} from "@ceo-agent/db";
import { sha256CanonicalIntegrityHash } from "@ceo-agent/shared/server";
import { compileImmutableSeedanceRequestFromSceneCompilation } from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import { makePhase2aCompilation, type Phase2aIdSet } from "./helpers/ai-story-phase-2a";
import { cleanupPr32Tenant, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;

describeIntegration("AI Story compiled request runtime PostgreSQL authority", () => {
  let sql: Sql;
  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
    await sql.unsafe(readFileSync(resolve(process.cwd(), "packages/db/sql/ai-story-provider-runtime-v1.sql"), "utf8"));
  }, 30_000);

  afterAll(async () => { await closeDb(); if (sql) await sql.end(); });

  it("installs additive durable authority with RLS and immutable compilation evidence", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
      where relname in ('ai_story_compiled_provider_requests','ai_story_provider_attempt_compiled_bindings')
      order by relname
    `;
    expect(rows).toEqual([
      { relname: "ai_story_compiled_provider_requests", relrowsecurity: true },
      { relname: "ai_story_provider_attempt_compiled_bindings", relrowsecurity: true },
    ]);
    const triggers = await sql<{ tgname: string }[]>`
      select tgname from pg_trigger
      where tgrelid='ai_story_compiled_provider_requests'::regclass and not tgisinternal
    `;
    expect(triggers.map((row) => row.tgname)).toContain("ai_story_compiled_request_immutable_v1");
  });

  it("keeps immutable input and operational Attempt state in separate tables", async () => {
    const columns = await sql<{ table_name: string; column_name: string }[]>`
      select table_name,column_name from information_schema.columns
      where table_name in ('ai_story_compiled_provider_requests','ai_story_provider_attempt_compiled_bindings')
        and column_name in ('compiled_request','binding','provider_task_id','request_fingerprint')
      order by table_name,column_name
    `;
    expect(columns).toEqual([
      { table_name: "ai_story_compiled_provider_requests", column_name: "compiled_request" },
      { table_name: "ai_story_compiled_provider_requests", column_name: "request_fingerprint" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "binding" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "provider_task_id" },
      { table_name: "ai_story_provider_attempt_compiled_bindings", column_name: "request_fingerprint" },
    ]);
  });

  it("round-trips exact Product material identity in durable compiled request JSON", async () => {
    const ids: Phase2aIdSet = {
      orgId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), campaignId: crypto.randomUUID(),
      storyId: crypto.randomUUID(), storyVersionId: crypto.randomUUID(),
      animationPackageId: crypto.randomUUID(), assetId: crypto.randomUUID(),
    };
    await seedPr32Tenant(sql, ids, crypto.randomUUID(), "product-material-roundtrip");
    try {
      const sourceHash = `sha256:${"a".repeat(64)}`;
      await sql`update assets set content_hash=${sourceHash} where id=${ids.assetId}::uuid`;
      const compilation = makePhase2aCompilation({ ids, sceneOrder: [0] });
      await new AiStorySceneExecutionPersistenceRepository(getDb()).persistCompilation(compilation);
      const intent = compilation.intents[0]!;
      const instructions = compilation.instructionsBySceneExecutionId[intent.identity.sceneExecutionId]!;
      const sceneId = crypto.randomUUID();
      const sceneVersionId = crypto.randomUUID();
      const generationAuthority = {
        strategy: "PRODUCT_GROUNDED_VIDEO" as const,
        referenceSource: "STORY_INHERITED" as const,
        effectiveReferenceIds: [ids.assetId], firstFrameAssetId: ids.assetId,
        productVisualIdentityRequirement: "REQUIRED" as const,
      };
      const selectionBody = {
        contractVersion: "ai-story-product-visual-material-selection.v1" as const,
        orgId: ids.orgId, workspaceId: ids.workspaceId, campaignId: ids.campaignId,
        storyId: ids.storyId, storyVersionId: ids.storyVersionId, sceneId, sceneVersionId,
        productAuthority: { productAuthorityId: ids.assetId, sourceAssetId: ids.assetId, sourceAssetContentHash: sourceHash },
        visualRequirement: { sceneRequirement: "REQUIRED" as const, effectiveGenerationRequirement: "REQUIRED" as const,
          strategy: generationAuthority.strategy, referenceSource: generationAuthority.referenceSource },
        suitability: { authorityFingerprint: sourceHash, outcome: "TRANSPARENT_BACKGROUND_CERTIFIED" as const },
        derivativeResolution: { contractVersion: "ai-story-exact-product-derivative-resolution.v1" as const,
          status: "NOT_FOUND" as const, reason: "NO_READY_EXTRACTION" as const },
        preparationCapability: { status: "NOT_CERTIFIED" as const },
        selection: "SOURCE_ASSET" as const,
        selectedMaterial: { kind: "SOURCE_ASSET" as const, assetId: ids.assetId, contentHash: sourceHash },
        reason: "SOURCE_TRANSPARENCY_CERTIFIED" as const,
      };
      const selection = { ...selectionBody,
        fingerprint: sha256CanonicalIntegrityHash({ kind: selectionBody.contractVersion, authority: selectionBody }) };
      const repository = new AiStoryProviderRuntimeRepository(getDb());
      const referenceAssets = await repository.getReferenceAssetAuthorities({
        orgId: ids.orgId, workspaceId: ids.workspaceId,
        campaignId: ids.campaignId, assetIds: [ids.assetId],
      });
      expect(referenceAssets[0]).toMatchObject({ assetId: ids.assetId, contentHash: sourceHash });
      const request = compileImmutableSeedanceRequestFromSceneCompilation({
        intent: { ...intent, identity: { ...intent.identity, sceneId, sceneVersionId }, generationAuthority },
        instructions: { ...instructions, sceneId, sceneVersionId, generationAuthority },
        authority: { qcEvaluationId: crypto.randomUUID(), qcFingerprint: sourceHash,
          qcCapabilityVersion: "test.v1", directorFingerprint: sourceHash, motionFingerprint: sourceHash },
        adapterVersion: "test.v1", compiledAt: "2026-09-01T00:00:00.000Z",
        referenceAssets,
        productMaterialSelection: selection,
      });
      await repository.acceptCompiledRequest(request);
      const loaded = await repository.getCompiledRequest(request.compiledRequestId);
      expect(loaded?.productMaterialSelection).toEqual(selection);
      expect(loaded?.referenceMappings[0]?.assetId).toBe(ids.assetId);
      expect(loaded?.requestFingerprint).toBe(request.requestFingerprint);
      const [raw] = await sql`select compiled_request -> 'productMaterialSelection' as material from ai_story_compiled_provider_requests where compiled_request_id=${request.compiledRequestId}::uuid`;
      expect(raw?.material).toEqual(selection);
    } finally {
      await cleanupPr32Tenant(sql, ids);
    }
  }, 60_000);
});
