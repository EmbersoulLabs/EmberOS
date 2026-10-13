import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  AiStoryLocalGenerationRepository,
  PlatformAdminRepositoryImpl,
  canonicalPersistenceHash,
  closeDb,
  getDb,
  schema,
} from "@ceo-agent/db";
import { buildPlatformAdminAssignment, buildPlatformAdminRevocation } from "@ceo-agent/shared/server";
import {
  materializeProviderNeutralLocalGenerationPackage,
  materializeSequentialLocalPackageV3,
} from "@ceo-agent/agents";
import { createIntegrationSql, getIntegrationDbUrl, isRlsEnabled, RUN_DB_INTEGRATION, withAuthenticatedUser } from "./helpers/db-integration";
import { providerNeutralLocalFactsFixture } from "./ai-story-provider-neutral-local-authority.test";

const authState = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/auth", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  requireAuth: async () => {
    if (!authState.user) throw new Error("UNAUTHENTICATED");
    return authState.user;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ storage: { from: () => ({
    createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://storage.invalid/upload/${path}` }, error: null }),
    createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://storage.invalid/read/${path}` }, error: null }),
  }) } }),
}));

const suite = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe.sequential : describe.skip;
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

suite("LOCAL_GPU Superadmin real HTTP/PostgreSQL authority", () => {
  const ids = {
    org: randomUUID(), workspace: randomUUID(), campaign: randomUUID(), story: randomUUID(),
    storyVersion: randomUUID(), animation: randomUUID(), plan: randomUUID(), runtime: randomUUID(),
    sceneExecution: randomUUID(), actor: randomUUID(), ordinary: randomUUID(), agency: randomUUID(),
  };
  let sql: Sql;
  let route: typeof import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/local-gpu-authority/route");
  let packageId: string;
  let assignmentId: string;
  const oldFetch = global.fetch;
  const envKeys = ["LOCAL_GPU_PROVIDER_ENABLED", "LOCAL_GPU_ENVIRONMENT", "LOCAL_GPU_SIGNING_SECRET", "LOCAL_GPU_BASE_URL"] as const;
  const oldEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

  const call = (key = "http-postgres-cert") => route.POST(new Request("http://localhost/authority", {
    method: "POST", headers: { "idempotency-key": key }, body: "",
  }), { params: Promise.resolve({ id: ids.campaign, storyId: ids.story, executionPlanId: ids.plan, packageId }) });

  beforeAll(async () => {
    sql = createIntegrationSql();
    // Mirrors the established Platform Admin PostgreSQL fixture: ephemeral
    // Postgres has no Supabase auth schema after canonical Drizzle bootstrap.
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
    `);
    process.env.LOCAL_GPU_PROVIDER_ENABLED = "true";
    process.env.LOCAL_GPU_ENVIRONMENT = "production";
    process.env.LOCAL_GPU_SIGNING_SECRET = "ephemeral-postgres-only-secret";
    process.env.LOCAL_GPU_BASE_URL = "https://desktop.invalid";
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ capabilities: {
      contracts: { v3: { workflows: { MINIMAX_H3_T2V: {
        execution: "enabled", textToVideo: true, placeholderImage: false, missingModels: [], e2eCertified: true,
      } } } },
    } }), { status: 200 })) as typeof fetch;

    await sql`insert into auth.users(id) values(${ids.actor}::uuid),(${ids.ordinary}::uuid),(${ids.agency}::uuid) on conflict do nothing`;
    await sql`insert into organizations(id,name,slug) values(${ids.org},'HTTP PostgreSQL Cert',${`http-cert-${ids.org}`})`;
    await sql`insert into workspaces(id,org_id,name,slug) values(${ids.workspace},${ids.org},'HTTP Cert',${`http-cert-${ids.workspace}`})`;
    await sql`insert into workspace_members(org_id,workspace_id,user_id,role) values
      (${ids.org},${ids.workspace},${ids.actor},'admin'),(${ids.org},${ids.workspace},${ids.ordinary},'admin'),
      (${ids.org},${ids.workspace},${ids.agency},'viewer')`;
    await sql`insert into campaigns(id,org_id,workspace_id,name) values(${ids.campaign},${ids.org},${ids.workspace},'HTTP Cert')`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea)
      values(${ids.story},${ids.org},${ids.workspace},${ids.campaign},'HTTP Cert','HTTP Cert')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content,frozen_at)
      values(${ids.storyVersion},${ids.story},1,${sql.json({})},now())`;
    await sql`update ai_stories set current_version_id=${ids.storyVersion} where id=${ids.story}`;
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload)
      values(${ids.animation},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},'ready_for_execution',${sql.json({scenePlan:[]})})`;
    const canonicalFacts = providerNeutralLocalFactsFixture("T2V", ids.sceneExecution);
    const instructions = { ...canonicalFacts.instructions, sceneOrder: 0 };
    const instructionHash = canonicalPersistenceHash(instructions);
    await sql`insert into ai_story_scene_instruction_snapshots(content_hash,snapshot_id,org_id,workspace_id,contract_version,instructions)
      values(${instructionHash},${randomUUID()},${ids.org},${ids.workspace},'1',${sql.json({certification:true})})`;
    await sql`insert into ai_story_execution_plans(id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,status,contract_version,compilation_hash,deterministic_fingerprint,plan,compiled_at)
      values(${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},'PLANNED','1',${hash("plan")},${hash("plan-fingerprint")},${sql.json({certification:true})},now())`;
    const facts = {
      ...canonicalFacts,
      orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, storyId: ids.story,
      storyVersionId: ids.storyVersion, executionPlanId: ids.plan, runtimeAuthorizationId: ids.runtime,
      order: 1, instructionContentHash: instructionHash,
      intent: { ...canonicalFacts.intent, identity: { ...canonicalFacts.intent.identity,
        tenantId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, storyId: ids.story,
        storyVersionId: ids.storyVersion, animationPackageId: ids.animation, sceneExecutionId: ids.sceneExecution,
      }, normalizedPayloadReference: { ...canonicalFacts.intent.normalizedPayloadReference, contentHash: instructionHash } },
      scene: { ...canonicalFacts.scene, storyVersionId: ids.storyVersion, events: [] },
      instructions,
    };
    await sql`insert into ai_story_scene_executions(id,execution_plan_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,scene_id,scene_order,status,idempotency_key,deterministic_fingerprint,compilation_hash,instruction_hash,intent)
      values(${ids.sceneExecution},${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},${facts.scene.sceneId},0,'PLANNED',${`http-${ids.sceneExecution}`},${hash("scene-execution")},${hash("plan")},${instructionHash},${sql.json(facts.intent)})`;
    await sql`insert into ai_story_runtime_authorized_facts(runtime_authorization_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,execution_plan_id,runtime_authorization_version,review_decision_id,review_hash,assembly_definition_id,assembly_hash,ordered_scene_execution_ids,qc_result_ids,authorized_by,authorized_at,authorization_contract_version,deterministic_integrity_hash,fact)
      values(${ids.runtime},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},${ids.plan},1,${randomUUID()},${hash("review")},${randomUUID()},${hash("assembly")},${sql.json([ids.sceneExecution])},${sql.json([])},${ids.actor},now(),'1',${hash("runtime")},${sql.json({certification:true})})`;
    const base = materializeProviderNeutralLocalGenerationPackage(facts);
    if (base.version !== "local-generation-package.v2") throw new Error("V2_PACKAGE_REQUIRED");
    const pkg = materializeSequentialLocalPackageV3({ basePackage: base, release: {
      releaseRevision: 0, releasedBy: ids.actor, releasedAt: new Date().toISOString(),
    }, predecessor: null });
    packageId = pkg.packageId;
    await new AiStoryLocalGenerationRepository().initializeSequential({ package: pkg, orderedSceneExecutionIds: [ids.sceneExecution], createdBy: ids.actor });
    const assignment = buildPlatformAdminAssignment({ userId: ids.actor, grantedAt: new Date().toISOString(),
      reason: "ephemeral HTTP/PostgreSQL certification", identitySeed: `http-cert:${ids.actor}` });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);
    assignmentId = assignment.platformAdminAssignmentId;
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
    route = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/local-gpu-authority/route");
  }, 120_000);

  afterAll(async () => {
    global.fetch = oldFetch;
    for (const key of envKeys) oldEnv[key] === undefined ? delete process.env[key] : process.env[key] = oldEnv[key];
    if (sql) {
      await sql.unsafe("set session_replication_role = replica");
      await sql`delete from assets where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_scene_release_states where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_generation_packages where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_runtime_authorized_facts where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_scene_executions where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_execution_plans where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_scene_instruction_snapshots where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_animation_packages where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_versions where story_id=${ids.story}`;
      await sql`delete from ai_stories where workspace_id=${ids.workspace}`;
      await sql`delete from campaigns where workspace_id=${ids.workspace}`;
      await sql`delete from workspace_members where workspace_id=${ids.workspace}`;
      await sql`delete from platform_admin_revocations where platform_admin_assignment_id=${assignmentId}::uuid`;
      await sql`delete from platform_admin_grants where platform_admin_assignment_id=${assignmentId}::uuid`;
      await sql`delete from workspaces where id=${ids.workspace}`;
      await sql`delete from organizations where id=${ids.org}`;
      await sql`delete from auth.users where id in (${ids.actor}::uuid,${ids.ordinary}::uuid,${ids.agency}::uuid)`;
      await sql.unsafe("set session_replication_role = origin");
      await sql.end();
    }
    await closeDb();
  }, 120_000);

  it("allows canonical ZERO_ASSET T2V and converges duplicate/concurrent HTTP Execute", async () => {
    const responses = await Promise.all([call(), call()]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const bodies = await Promise.all(responses.map((response) => response.json())) as Array<{ dispatchAuthorityId: string; gpuSubmitted: boolean }>;
    expect(new Set(bodies.map((body) => body.dispatchAuthorityId)).size).toBe(1);
    expect(bodies.every((body) => body.gpuSubmitted === false)).toBe(true);
    const rows = await sql<{ authorities: number; assets: number; mode: string }[]>`
      select (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace} and status='uploading')::int assets,
      (select execution_mode from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}) mode`;
    expect(rows[0]).toMatchObject({ authorities: 1, assets: 1, mode: "LOCAL_GPU" });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("denies an ordinary user through the real Platform Admin repository without side effects", async () => {
    authState.user = { id: ids.ordinary, email: "ordinary@example.invalid" };
    const before = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    const response = await call("ordinary-denied");
    expect(response.status).toBe(403);
    const after = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(after[0]).toEqual(before[0]);
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
  });

  it("denies an Agency member without a Platform Admin grant and preserves state", async () => {
    authState.user = { id: ids.agency, email: "agency@example.invalid" };
    const before = await sql<{ authorities: number; assets: number; mode: string }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets,
      (select execution_mode from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}) mode`;
    const response = await call("agency-denied");
    expect(response.status).toBe(403);
    const after = await sql<{ authorities: number; assets: number; mode: string }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets,
      (select execution_mode from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}) mode`;
    expect(after[0]).toEqual(before[0]);
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
  });

  it("denies a cross-workspace/campaign route without authority or asset mutation", async () => {
    const before = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    const response = await route.POST(new Request("http://localhost/authority", {
      method: "POST", headers: { "idempotency-key": "cross-workspace" }, body: "",
    }), { params: Promise.resolve({ id: randomUUID(), storyId: ids.story, executionPlanId: ids.plan, packageId }) });
    expect(response.status).toBe(404);
    const after = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(after[0]).toEqual(before[0]);
  });

  it("denies an unreleased Scene before creating new side effects", async () => {
    await sql`update ai_story_scene_release_states set release_state='WAITING_FOR_PREDECESSOR' where scene_execution_id=${ids.sceneExecution}`;
    const before = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    const response = await call("unreleased-denied");
    expect(response.status).toBe(404);
    const after = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(after[0]).toEqual(before[0]);
    await sql`update ai_story_scene_release_states set release_state='RELEASED' where scene_execution_id=${ids.sceneExecution}`;
  });

  it("keeps Native Dialogue outside certified V2/V3 and creates no new rows", async () => {
    const [saved] = await sql<{ package: Record<string, unknown> }[]>`select package from ai_story_local_generation_packages where package_id=${packageId}`;
    const dialoguePackage = materializeProviderNeutralLocalGenerationPackage(
      providerNeutralLocalFactsFixture("T2V", ids.sceneExecution),
    );
    const native = { ...saved!.package, recommendedWorkflow: "MINIMAX_H3_NATIVE_DIALOGUE",
      dialogue: dialoguePackage.dialogue };
    await sql`update ai_story_local_generation_packages set package=${sql.json(native)} where package_id=${packageId}`;
    const before = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    const response = await call("native-dialogue-denied");
    expect(response.status).toBe(409);
    const after = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(after[0]).toEqual(before[0]);
    await sql`update ai_story_local_generation_packages set package=${sql.json(saved!.package)} where package_id=${packageId}`;
  });

  it("enforces RLS against an authenticated non-owner", async () => {
    expect(await isRlsEnabled(sql, "ai_story_local_gpu_dispatch_authorities")).toBe(true);
    const rows = await withAuthenticatedUser(sql, ids.ordinary, (tx) =>
      tx<{ count: number }[]>`select count(*)::int count from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`,
    );
    expect(rows[0]?.count).toBe(0);
  });

  it("revalidates revocation and leaves no new authority or output asset", async () => {
    const assignment = buildPlatformAdminAssignment({ userId: ids.actor, grantedAt: new Date().toISOString(),
      reason: "ephemeral HTTP/PostgreSQL certification", identitySeed: `http-cert:${ids.actor}` });
    const revocation = buildPlatformAdminRevocation({ assignment, revokedAt: new Date().toISOString(),
      revokedByUserId: ids.actor, reason: "certification revocation" });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeRevocation(revocation);
    const before = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    const response = await call("revoked-denied");
    expect(response.status).toBe(403);
    const after = await sql<{ authorities: number; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(after[0]).toEqual(before[0]);
  });
});
