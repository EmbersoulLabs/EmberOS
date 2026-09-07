import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
  AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
} from "@ceo-agent/shared";
import { keyframePaidAuthorizationIntegrityHash } from "@ceo-agent/shared/server";
import { PostgresAiStoryKeyframePaidAuthorizationRepository, closeDb } from "@ceo-agent/db";
import { RUN_DB_INTEGRATION, createIntegrationSql, getIntegrationDbUrl } from "./helpers/db-integration";
import { cleanupPr32Tenant, seedPr32Tenant } from "./helpers/ai-story-pr32-scheduling";

const integrationDbUrl = getIntegrationDbUrl();
if (RUN_DB_INTEGRATION && !integrationDbUrl) throw new Error("DATABASE_URL is required when RUN_DB_INTEGRATION_TESTS=1");
const describeIntegration = RUN_DB_INTEGRATION ? describe : describe.skip;

describeIntegration("AI Story keyframe paid authorization PostgreSQL authority", () => {
  let sql: Sql;
  const ids = {
    orgId: crypto.randomUUID(), workspaceId: crypto.randomUUID(), campaignId: crypto.randomUUID(),
    storyId: crypto.randomUUID(), storyVersionId: crypto.randomUUID(), animationPackageId: crypto.randomUUID(), assetId: crypto.randomUUID(),
  };
  const actor = crypto.randomUUID();

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(readFileSync(resolve(__dirname, "../packages/db/sql/ai-story-keyframe-paid-authorization-v1.sql"), "utf8"));
    await seedPr32Tenant(sql, ids, actor, "keyframe-paid-auth");
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    await sql.unsafe("ALTER TABLE ai_story_keyframe_paid_authorizations DISABLE TRIGGER ai_story_keyframe_paid_auth_immutable_v1");
    await sql`delete from ai_story_keyframe_paid_authorizations where org_id=${ids.orgId}::uuid`;
    await sql.unsafe("ALTER TABLE ai_story_keyframe_paid_authorizations ENABLE TRIGGER ai_story_keyframe_paid_auth_immutable_v1");
    await cleanupPr32Tenant(sql, ids);
    await sql.end();
  }, 120_000);

  it("persists once, preserves provenance, and rejects mutation", async () => {
    const core = {
      authorizationId: crypto.randomUUID(), contractVersion: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION,
      orgId: ids.orgId, workspaceId: ids.workspaceId, storyId: ids.storyId,
      sceneId: crypto.randomUUID(), sceneVersionId: ids.storyVersionId,
      preparationAuthorityId: "preparation-v1", preparationFingerprint: `sha256:${"a".repeat(64)}`,
      keyframeBriefFingerprint: `sha256:${"b".repeat(64)}`, authorizedProviderId: "openai", authorizedModelId: "gpt-image-2",
      maximumImageProviderCalls: 1 as const, authorizedBy: actor, authorizedAt: "2026-09-07T01:02:03.000Z",
      authorizationReason: AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON,
    };
    const fact = { ...core, deterministicIntegrityHash: keyframePaidAuthorizationIntegrityHash(core) };
    const repository = new PostgresAiStoryKeyframePaidAuthorizationRepository();
    expect(await repository.persist(fact)).toEqual(fact);
    expect(await repository.persist(fact)).toEqual(fact);
    expect(await sql`select count(*)::int as count from ai_story_keyframe_paid_authorizations where authorization_id=${fact.authorizationId}::uuid`)
      .toMatchObject([{ count: 1 }]);
    await expect(sql`update ai_story_keyframe_paid_authorizations set provider_id='changed' where authorization_id=${fact.authorizationId}::uuid`)
      .rejects.toThrow("AI_STORY_KEYFRAME_PAID_AUTHORITY_IMMUTABLE");
  });

  it("rejects any call limit other than one and a cross-workspace Story binding", async () => {
    await expect(sql`insert into ai_story_keyframe_paid_authorizations
      (authorization_id,contract_version,org_id,workspace_id,story_id,scene_id,scene_version_id,preparation_authority_id,preparation_fingerprint,keyframe_brief_fingerprint,provider_id,model_id,maximum_image_provider_calls,authorized_by,authorized_at,authorization_reason,deterministic_integrity_hash,fact)
      values (${crypto.randomUUID()},${AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION},${ids.orgId},${ids.workspaceId},${ids.storyId},${crypto.randomUUID()},${ids.storyVersionId},'p',${`sha256:${"a".repeat(64)}`},${`sha256:${"b".repeat(64)}`},'openai','gpt-image-2',2,${actor},now(),${AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON},${`sha256:${"c".repeat(64)}`},'{}'::jsonb)`)
      .rejects.toThrow(/calls_check/);
    await expect(sql`insert into ai_story_keyframe_paid_authorizations
      (authorization_id,contract_version,org_id,workspace_id,story_id,scene_id,scene_version_id,preparation_authority_id,preparation_fingerprint,keyframe_brief_fingerprint,provider_id,model_id,maximum_image_provider_calls,authorized_by,authorized_at,authorization_reason,deterministic_integrity_hash,fact)
      values (${crypto.randomUUID()},${AI_STORY_KEYFRAME_PAID_AUTHORIZATION_CONTRACT_VERSION},${ids.orgId},${crypto.randomUUID()},${ids.storyId},${crypto.randomUUID()},${ids.storyVersionId},'p',${`sha256:${"d".repeat(64)}`},${`sha256:${"e".repeat(64)}`},'openai','gpt-image-2',1,${actor},now(),${AI_STORY_KEYFRAME_PAID_AUTHORIZATION_REASON},${`sha256:${"f".repeat(64)}`},'{}'::jsonb)`)
      .rejects.toThrow();
  });
});
