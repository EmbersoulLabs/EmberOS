import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
// Storage and ffprobe/ffmpeg are the only mocked boundaries of result delivery; hashing,
// MP4 inspection, duration, ownership and persistence run for real.
const storageState = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../apps/worker/src/storage", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  downloadStorageBytes: async (path: string) => {
    const bytes = storageState.objects.get(path);
    if (!bytes) throw new Error("STORAGE_OBJECT_NOT_FOUND");
    return bytes;
  },
}));
vi.mock("@ceo-agent/agents", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  validateLocalGenerationMedia: async (bytes: Uint8Array, expectedContentHash: string, nativeAudioRequired: boolean) => {
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== expectedContentHash) throw new Error("LOCAL_GENERATION_MEDIA_HASH_MISMATCH");
    if (nativeAudioRequired) throw new Error("LOCAL_GENERATION_NATIVE_AUDIO_REQUIRED");
    const buffer = Buffer.from(bytes);
    const marker = buffer.indexOf(Buffer.from("mvhd", "ascii"));
    return { durationMs: buffer.readUInt32BE(marker + 20), width: 720, height: 1280, hasAudio: false };
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
    await sql.unsafe(readFileSync(
      "supabase/migrations/20261013030433_ai_story_local_gpu_dispatch_authority_v1.sql",
      "utf8",
    ));
    await sql.unsafe(readFileSync(
      "supabase/migrations/20261018030000_ai_story_local_gpu_submit_outcomes_v1.sql",
      "utf8",
    ));
    await sql.unsafe(readFileSync(
      "supabase/migrations/20261018080000_ai_story_local_gpu_non_acceptance_attestation_v1.sql",
      "utf8",
    ));
    await sql.unsafe(readFileSync(
      "supabase/migrations/20261018100000_ai_story_generation_result_local_gpu_local_output_v1.sql",
      "utf8",
    ));
    await sql.unsafe(readFileSync(
      "supabase/migrations/20261018140000_ai_story_commercial_audio_assembly_v1.sql",
      "utf8",
    ));
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
    const { groundingLineage: _lineage, ...persistedInstructions } = instructions;
    await sql`insert into ai_story_scene_instruction_snapshots(content_hash,snapshot_id,org_id,workspace_id,contract_version,instructions)
      values(${instructionHash},${randomUUID()},${ids.org},${ids.workspace},'1',${sql.json(persistedInstructions)})`;
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
      await sql.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx`delete from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace}`;
      });
      await sql.unsafe("set session_replication_role = replica");
      await sql`delete from ai_story_generation_results where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_media_jobs where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_local_generation_outputs where package_id=${packageId}`;
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
    await expect(withAuthenticatedUser(sql, ids.ordinary, (tx) =>
      tx<{ count: number }[]>`select count(*)::int count from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`,
    )).rejects.toMatchObject({ code: "42501" });
  });

  it("replays a lost response under a new key and renews an expired never-dispatched authority in place", async () => {
    const [first] = await sql<{ id: string }[]>`select dispatch_authority_id id from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`;
    const replay = await call("lost-response-retry");
    expect(replay.status).toBe(202);
    expect(await replay.json()).toMatchObject({ dispatchAuthorityId: first!.id, replayed: true, gpuSubmitted: false });
    await sql`update ai_story_local_gpu_dispatch_authorities set expires_at=now()-interval '1 minute' where workspace_id=${ids.workspace}`;
    const renewed = await call("after-expiry");
    expect(renewed.status).toBe(202);
    expect(await renewed.json()).toMatchObject({ dispatchAuthorityId: first!.id, replayed: false });
    const rows = await sql<{ authorities: number; live: boolean; assets: number }[]>`select
      (select count(*) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace})::int authorities,
      (select bool_and(expires_at > now()) from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}) live,
      (select count(*) from assets where workspace_id=${ids.workspace})::int assets`;
    expect(rows[0]).toEqual({ authorities: 1, live: true, assets: 1 });
  });

  it("derives per-execution authority automatically only from a Superadmin and frozen production LOCAL_GPU Planning", async () => {
    const { autoAuthorizeReleasedLocalGpuPackages } = await import("@ceo-agent/agents");
    const ports = {
      fetchCapabilities: async () => ({ status: 200, body: { capabilities: { contracts: { v3: { workflows: { MINIMAX_H3_T2V: {
        execution: "enabled", textToVideo: true, placeholderImage: false, missingModels: [], e2eCertified: true,
      } } } } } } }),
      createSignedUploadUrl: async (path: string) => `https://storage.invalid/upload/${path}`,
      createSignedReadUrl: async (path: string) => `https://storage.invalid/read/${path}`,
    };
    const base = { env: process.env, orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, executionPlanId: ids.plan, ports };
    expect(await autoAuthorizeReleasedLocalGpuPackages({ ...base, actorUserId: ids.ordinary }))
      .toMatchObject({ status: "NOT_ELIGIBLE", code: "LOCAL_GPU_SUPERADMIN_AUTHORITY_REQUIRED" });
    expect(await autoAuthorizeReleasedLocalGpuPackages({ ...base, actorUserId: ids.actor }))
      .toMatchObject({ status: "NOT_ELIGIBLE", code: "LOCAL_GPU_PLANNING_ENVIRONMENT_NOT_SELECTED" });
    await sql`update ai_story_animation_packages set payload=${sql.json({ scenePlan: [], executionCapabilityAuthority: {
      executionEnvironment: "LOCAL_GPU", environment: "production",
    } })} where id=${ids.animation}`;
    const derived = await autoAuthorizeReleasedLocalGpuPackages({ ...base, actorUserId: ids.actor });
    expect(derived.status).toBe("AUTHORIZED");
    expect(derived.packages).toEqual([expect.objectContaining({ packageId, sceneExecutionId: ids.sceneExecution, replayed: true, code: null })]);
    const [count] = await sql<{ authorities: number }[]>`select count(*)::int authorities from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`;
    expect(count!.authorities).toBe(1);
  });

  it("Worker discovers persisted authority, claims once across concurrent instances, signs one POST, then stays status-only after the TTL", async () => {
    const workerEnv = {
      ...process.env,
      LOCAL_GPU_SUPERADMIN_GLOBAL_ENABLED: "true",
      LOCAL_GPU_PRODUCTION_DISPATCH_ENABLED: "true",
      LOCAL_GPU_SCENE_EXECUTION_ID: undefined,
    };
    const calls: { method: string; url: string; authorization: string | null; body: string }[] = [];
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ method: init?.method ?? "GET", url: String(url), authorization: headers.get("authorization"), body: String(init?.body ?? "") });
      if ((init?.method ?? "GET") === "POST") return new Response(JSON.stringify({ state: "QUEUED" }), { status: 202 });
      return new Response(JSON.stringify({ job: { state: "QUEUED" } }), { status: 200 });
    }) as typeof fetch;
    const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
    await Promise.all([runWorkerLocalGpuDispatchCycle(workerEnv), runWorkerLocalGpuDispatchCycle(workerEnv)]);
    const ours = () => calls.filter((item) => item.body.includes(ids.sceneExecution) || item.url.includes(gateId ?? "__none__"));
    const [release] = await sql<{ gate: string | null }[]>`select gate_provider_attempt_id gate from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}`;
    const gateId = release!.gate;
    expect(gateId).toMatch(/^[0-9a-f-]{36}$/);
    const posts = calls.filter((item) => item.method === "POST" && item.url === "https://desktop.invalid/v1/jobs" && item.body.includes(ids.sceneExecution));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.authorization).toMatch(/^Bearer /);
    expect(posts[0]!.body).toContain(gateId!);

    await sql`update ai_story_local_gpu_dispatch_authorities set expires_at=now()-interval '1 minute' where workspace_id=${ids.workspace}`;
    await runWorkerLocalGpuDispatchCycle(workerEnv);
    const statusReads = ours().filter((item) => item.method === "GET" && item.url === `https://desktop.invalid/v1/jobs/${gateId}`);
    expect(statusReads.length).toBeGreaterThanOrEqual(1);
    expect(calls.filter((item) => item.method === "POST" && item.body.includes(ids.sceneExecution))).toHaveLength(1);
    const [after] = await sql<{ gate: string | null }[]>`select gate_provider_attempt_id gate from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}`;
    expect(after!.gate).toBe(gateId);
  });

  describe("submit rejection recovery", () => {
    const workerEnv = () => ({
      ...process.env,
      LOCAL_GPU_SUPERADMIN_GLOBAL_ENABLED: "true",
      LOCAL_GPU_PRODUCTION_DISPATCH_ENABLED: "true",
      LOCAL_GPU_SCENE_EXECUTION_ID: undefined,
    });
    const desktopCapabilities = { capabilities: { contracts: { v3: { workflows: { MINIMAX_H3_T2V: {
      execution: "enabled", textToVideo: true, placeholderImage: false, missingModels: [], e2eCertified: true,
    } } } } } };
    const desktop = (post: () => Response, status: () => Response) => {
      const calls: { method: string; url: string; body: string }[] = [];
      global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        calls.push({ method, url: String(url), body: String(init?.body ?? "") });
        if (String(url).endsWith("/v1/capabilities")) return new Response(JSON.stringify(desktopCapabilities), { status: 200 });
        return method === "POST" ? post() : status();
      }) as typeof fetch;
      return {
        posts: () => calls.filter((item) => item.method === "POST" && item.body.includes(ids.sceneExecution)).length,
        statusReads: () => calls.filter((item) => item.method === "GET" && item.url.includes("/v1/jobs/")).length,
      };
    };
    const outcomes = () => sql<{ attempt: number; kind: string; http: number | null; code: string | null; message: string | null; reason: string | null; by: string }[]>`
      select attempt_number attempt, kind, http_status http, desktop_error_code code, desktop_error_message message,
        uncertain_reason reason, recorded_by by
      from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace} order by attempt_number, created_at`;
    const gate = async () => (await sql<{ gate: string | null }[]>`select gate_provider_attempt_id gate from ai_story_scene_release_states where scene_execution_id=${ids.sceneExecution}`)[0]!.gate;
    // Fixture-only reset between scenarios; production code never clears a claim or deletes evidence.
    const resetFixture = () => sql.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      await tx`delete from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace}`;
      await tx`update ai_story_scene_release_states set gate_provider_attempt_id=null where scene_execution_id=${ids.sceneExecution}`;
      await tx`update ai_story_local_gpu_dispatch_authorities set expires_at=now()+interval '10 minutes' where workspace_id=${ids.workspace}`;
    });
    let retryRoute: typeof import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/scenes/[sceneExecutionId]/local-gpu-submit/route");
    const retryParams = () => ({ params: Promise.resolve({ id: ids.campaign, storyId: ids.story, executionPlanId: ids.plan, sceneExecutionId: ids.sceneExecution }) });
    const retry = (body: unknown) => retryRoute.POST(new Request("http://localhost/retry", { method: "POST", body: JSON.stringify(body) }), retryParams());

    beforeAll(async () => {
      retryRoute = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/scenes/[sceneExecutionId]/local-gpu-submit/route");
    });

    it("persists a definite 422 rejection with its Desktop code once across concurrent Workers, then stops polling", async () => {
      await resetFixture();
      const io = desktop(
        () => new Response(JSON.stringify({ error: {
          code: "CONTRACT_V2_UPLOAD_BINDING_MISMATCH",
          message: "binding mismatch for https://storage.invalid/upload/x?token=eyJhbGciOiJIUzI1NiJ9.eyJ4IjoxfQ.sig",
          issues: [{ path: ["request", "upload", "binding"] }],
        } }), { status: 422 }),
        () => new Response("{}", { status: 404 }),
      );
      const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      const steps = await Promise.all([runWorkerLocalGpuDispatchCycle(workerEnv()), runWorkerLocalGpuDispatchCycle(workerEnv())]);
      expect(steps.map((step) => step.code).join(",")).toContain("LOCAL_GPU_SUBMIT_REJECTED:422:CONTRACT_V2_UPLOAD_BINDING_MISMATCH");
      expect(io.posts()).toBe(1);
      const rows = await outcomes();
      expect(rows.map((row) => row.kind)).toEqual(["SUBMIT_STARTED", "SUBMIT_REJECTED"]);
      expect(rows[1]).toMatchObject({ attempt: 1, http: 422, code: "CONTRACT_V2_UPLOAD_BINDING_MISMATCH", by: "WORKER" });
      expect(rows[1]!.message).not.toMatch(/storage\.invalid|eyJ|token=/);
      expect(await gate()).toMatch(/^[0-9a-f-]{36}$/);

      const { getDb: db, selectAuthorizedLocalGpuDispatchScopes } = await import("@ceo-agent/db");
      expect((await selectAuthorizedLocalGpuDispatchScopes(db(), 5)).some((scope) => scope.sceneExecutionId === ids.sceneExecution)).toBe(false);
      const statusReadsAfterConcurrentWorkers = io.statusReads();
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(io.posts()).toBe(1);
      expect(io.statusReads()).toBe(statusReadsAfterConcurrentWorkers);

      const evidence = await retryRoute.GET(new Request("http://localhost/evidence"), retryParams());
      expect(evidence.status).toBe(200);
      const body = await evidence.json() as { outcomes: { kind: string; desktopErrorCode: string | null }[] };
      expect(body.outcomes.find((row) => row.kind === "SUBMIT_REJECTED")?.desktopErrorCode).toBe("CONTRACT_V2_UPLOAD_BINDING_MISMATCH");
    });

    it("lets only a Superadmin open the next attempt, renews an expired authority, and the Worker posts it exactly once", async () => {
      authState.user = { id: ids.ordinary, email: "ordinary@example.invalid" };
      expect((await retry({ expectedAttemptNumber: 1 })).status).toBe(403);
      authState.user = { id: ids.actor, email: "admin@example.invalid" };
      expect((await retry({})).status).toBe(422);
      const stale = await retry({ expectedAttemptNumber: 2 });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "LOCAL_GPU_RETRY_ATTEMPT_STALE" });
      expect((await outcomes()).some((row) => row.kind === "HUMAN_RETRY_AUTHORIZED")).toBe(false);

      await sql`update ai_story_local_gpu_dispatch_authorities set expires_at=now()-interval '1 minute' where workspace_id=${ids.workspace}`;
      const io = desktop(
        () => new Response(JSON.stringify({ state: "QUEUED" }), { status: 202 }),
        () => new Response(JSON.stringify({ job: { state: "QUEUED" } }), { status: 200 }),
      );
      const opened = await retry({ expectedAttemptNumber: 1 });
      expect(opened.status).toBe(201);
      expect(await opened.json()).toMatchObject({ attemptNumber: 2, replayed: false, localGpuAuthorization: { status: "AUTHORIZED" } });
      const replay = await retry({ expectedAttemptNumber: 1 });
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ attemptNumber: 2, replayed: true });
      const [live] = await sql<{ live: boolean }[]>`select bool_and(expires_at > now()) live from ai_story_local_gpu_dispatch_authorities where workspace_id=${ids.workspace}`;
      expect(live!.live).toBe(true);
      expect(io.posts()).toBe(0);

      const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      await Promise.all([runWorkerLocalGpuDispatchCycle(workerEnv()), runWorkerLocalGpuDispatchCycle(workerEnv())]);
      expect(io.posts()).toBe(1);
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(io.posts()).toBe(1);
      const attempt2 = (await outcomes()).filter((row) => row.attempt === 2);
      expect(attempt2.map((row) => row.kind)).toEqual(["HUMAN_RETRY_AUTHORIZED", "SUBMIT_STARTED", "SUBMIT_ACCEPTED"]);
      expect(attempt2[0]!.by).toBe("HUMAN");
      const accepted = await retry({ expectedAttemptNumber: 2 });
      expect(accepted.status).toBe(409);
      expect(await accepted.json()).toMatchObject({ code: "LOCAL_GPU_RETRY_NOT_ELIGIBLE" });
    });

    it("waits for authority renewal before starting a pending retry", async () => {
      await resetFixture();
      const io = desktop(
        () => new Response(JSON.stringify({ code: "PAYLOAD_INVALID" }), { status: 400 }),
        () => new Response("{}", { status: 404 }),
      );
      const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(io.posts()).toBe(1);
      expect((await retry({ expectedAttemptNumber: 1 })).status).toBe(201);
      await sql`update ai_story_local_gpu_dispatch_authorities set expires_at=now()-interval '1 minute' where workspace_id=${ids.workspace}`;
      const waiting = await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(waiting.code).toContain("LOCAL_GPU_RETRY_AWAITING_AUTHORITY_RENEWAL");
      expect(io.posts()).toBe(1);
    });

    it("keeps status-only reconciliation after an uncertain POST and stops only after a bounded 404 window, refusing retry as unproven", async () => {
      await resetFixture();
      const io = desktop(
        () => new Response("{}", { status: 409 }),
        () => new Response("{}", { status: 404 }),
      );
      const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      expect((await runWorkerLocalGpuDispatchCycle(workerEnv())).code).toContain("LOCAL_GPU_SUBMIT_UNCERTAIN");
      expect((await runWorkerLocalGpuDispatchCycle(workerEnv())).code).toContain("not_found");
      expect((await outcomes()).map((row) => row.kind)).toEqual(["SUBMIT_STARTED", "SUBMIT_UNCERTAIN"]);
      await sql.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx`update ai_story_local_gpu_submit_outcomes set created_at=now()-interval '11 minutes' where workspace_id=${ids.workspace}`;
      });
      expect((await runWorkerLocalGpuDispatchCycle(workerEnv())).code).toContain("LOCAL_GPU_SUBMIT_TERMINAL_STATUS_NOT_FOUND_EXHAUSTED");
      const reads = io.statusReads();
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(io.statusReads()).toBe(reads);
      expect(io.posts()).toBe(1);
      const unproven = await retry({ expectedAttemptNumber: 1 });
      expect(unproven.status).toBe(409);
      expect(await unproven.json()).toMatchObject({ code: "LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN" });
      expect(await gate()).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("recovers a 404-exhausted job only from verified Desktop non-acceptance evidence, once, without duplicate GPU work", async () => {
      const attestRoute = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/scenes/[sceneExecutionId]/local-gpu-submit/attestation/route");
      const attest = (body: unknown) => attestRoute.POST(new Request("http://localhost/attest", { method: "POST", body: JSON.stringify(body) }), retryParams());
      const jobId = (await gate())!;
      type Verdict = { verdict: string; basis: string | null; jobStatus?: string | null; count?: number };
      let mode: Verdict | { status: number } | { tamper: "signature" | "challenge" } = { status: 404 };
      const desktopCalls: { method: string; url: string }[] = [];
      const sign = (evidence: Record<string, unknown>) => {
        const payload = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64url");
        const signature = createHmac("sha256", process.env.LOCAL_GPU_SIGNING_SECRET!).update(`local-gpu-submission-evidence.v1.${payload}`).digest("base64url");
        return { payload, signature };
      };
      global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const target = new URL(String(url));
        desktopCalls.push({ method, url: target.pathname });
        if (!target.pathname.endsWith("/submission-evidence")) return new Response("{}", { status: 404 });
        if ("status" in mode) return new Response("{}", { status: mode.status });
        const token = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
        const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, string>;
        const verdict: Verdict = "verdict" in mode ? mode : { verdict: "REJECTED_BEFORE_ENQUEUE", basis: "AUTHENTICATED_SUBMIT_WITHOUT_ENQUEUE" };
        const evidence = {
          v: 1, contract: "local-gpu-submission-evidence.v1", environment: claims.environment, jobId: claims.jobId,
          workspaceId: claims.workspaceId, sceneExecutionId: claims.sceneExecutionId, workflow: claims.workflow,
          verdict: verdict.verdict, basis: verdict.basis, jobStatus: verdict.jobStatus ?? null, rejection: null,
          submitAuthorizationCount: verdict.count ?? 1, lastSubmitAuthorizationAt: new Date(Date.now() - 3_600_000).toISOString(),
          challenge: "tamper" in mode && mode.tamper === "challenge" ? "f".repeat(64) : target.searchParams.get("challenge"),
          issuedAt: new Date().toISOString(), desktopVersion: "integration",
        };
        const signed = sign(evidence);
        return new Response(JSON.stringify("tamper" in mode && mode.tamper === "signature" ? { ...signed, signature: sign({ ...evidence, v: 2 }).signature } : signed), { status: 200 });
      }) as typeof fetch;
      const expectCode = async (response: Response, status: number, code: string) => {
        expect(response.status).toBe(status);
        expect(await response.json()).toMatchObject({ code });
      };
      const attestedRows = async () => (await outcomes()).filter((row) => row.kind === "DESKTOP_NON_ACCEPTANCE_ATTESTED");

      authState.user = { id: ids.ordinary, email: "ordinary@example.invalid" };
      expect((await attest({ expectedAttemptNumber: 1 })).status).toBe(403);
      authState.user = { id: ids.actor, email: "admin@example.invalid" };
      expect((await attest({})).status).toBe(422);
      await expectCode(await attest({ expectedAttemptNumber: 2 }), 409, "LOCAL_GPU_RETRY_ATTEMPT_STALE");
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 503, "LOCAL_GPU_ATTESTATION_UNAVAILABLE");
      mode = { tamper: "signature" };
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 502, "LOCAL_GPU_ATTESTATION_INVALID");
      mode = { tamper: "challenge" };
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 502, "LOCAL_GPU_ATTESTATION_INVALID");
      mode = { verdict: "ACCEPTED", basis: "JOB_RECORD", jobStatus: "RUNNING" };
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 409, "LOCAL_GPU_JOB_PREVIOUSLY_ACCEPTED");
      mode = { verdict: "ACCEPTED", basis: "JOB_RECORD", jobStatus: "COMPLETED" };
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 409, "LOCAL_GPU_JOB_ALREADY_COMPLETED");
      for (const verdict of ["IN_FLIGHT", "NO_SUBMIT_RECORD", "INCONSISTENT"]) {
        mode = { verdict, basis: null };
        await expectCode(await attest({ expectedAttemptNumber: 1 }), 409, "LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN");
      }
      expect(await attestedRows()).toHaveLength(0);
      await expectCode(await retry({ expectedAttemptNumber: 1 }), 409, "LOCAL_GPU_NON_ACCEPTANCE_UNPROVEN");

      await sql.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx`update ai_story_local_gpu_dispatch_authorities set revoked_at=now() where workspace_id=${ids.workspace}`;
      });
      mode = { verdict: "REJECTED_BEFORE_ENQUEUE", basis: "AUTHENTICATED_SUBMIT_WITHOUT_ENQUEUE" };
      await expectCode(await attest({ expectedAttemptNumber: 1 }), 409, "LOCAL_GPU_DISPATCH_AUTHORITY_REVOKED");
      await sql.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx`update ai_story_local_gpu_dispatch_authorities set revoked_at=null where workspace_id=${ids.workspace}`;
      });

      const proven = await Promise.all([attest({ expectedAttemptNumber: 1 }), attest({ expectedAttemptNumber: 1 })]);
      expect(proven.map((response) => response.status).sort()).toEqual([200, 201]);
      const [row] = await attestedRows();
      expect(await attestedRows()).toHaveLength(1);
      expect(row).toMatchObject({ attempt: 1, by: "HUMAN" });
      const [diagnostic] = await sql<{ diagnostic: Record<string, unknown> }[]>`select diagnostic from ai_story_local_gpu_submit_outcomes
        where workspace_id=${ids.workspace} and kind='DESKTOP_NON_ACCEPTANCE_ATTESTED'`;
      expect(diagnostic!.diagnostic).toMatchObject({ verdict: "REJECTED_BEFORE_ENQUEUE", basis: "AUTHENTICATED_SUBMIT_WITHOUT_ENQUEUE" });
      expect(String(diagnostic!.diagnostic.attestationDigest)).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(diagnostic!.diagnostic)).not.toMatch(/Bearer|eyJ|signature|ephemeral-postgres-only-secret/);
      await expect(sql`insert into ai_story_local_gpu_submit_outcomes(outcome_id,org_id,workspace_id,story_id,scene_execution_id,package_id,dispatch_authority_id,job_id,attempt_number,kind,diagnostic,recorded_by,recorded_by_user_id)
        select ${randomUUID()},org_id,workspace_id,story_id,scene_execution_id,package_id,dispatch_authority_id,job_id,7,'DESKTOP_NON_ACCEPTANCE_ATTESTED','{}'::jsonb,'HUMAN',recorded_by_user_id
        from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace} and kind='DESKTOP_NON_ACCEPTANCE_ATTESTED'`)
        .rejects.toMatchObject({ code: "23514" });
      expect(desktopCalls.every((call) => call.method === "GET")).toBe(true);
      expect(await gate()).toBe(jobId);

      const io = desktop(
        () => new Response(JSON.stringify({ state: "QUEUED" }), { status: 202 }),
        () => new Response(JSON.stringify({ job: { state: "QUEUED" } }), { status: 200 }),
      );
      const opened = await retry({ expectedAttemptNumber: 1 });
      expect(opened.status).toBe(201);
      expect(await opened.json()).toMatchObject({ jobId, attemptNumber: 2, replayed: false });
      const { runWorkerLocalGpuDispatchCycle } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      await Promise.all([runWorkerLocalGpuDispatchCycle(workerEnv()), runWorkerLocalGpuDispatchCycle(workerEnv())]);
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(io.posts()).toBe(1);
      expect((await outcomes()).filter((item) => item.attempt === 2).map((item) => item.kind))
        .toEqual(["HUMAN_RETRY_AUTHORIZED", "SUBMIT_STARTED", "SUBMIT_ACCEPTED"]);
      await expectCode(await attest({ expectedAttemptNumber: 2 }), 409, "LOCAL_GPU_ATTESTATION_NOT_APPLICABLE");
      expect(await gate()).toBe(jobId);
    });

    it("delivers a mocked Desktop result through signed status/result, hash binding, validation and Generation Result to the human-review boundary exactly once", async () => {
      const jobId = (await gate())!;
      const [unit] = await sql<{ durationSec: string }[]>`select package->>'durationSec' "durationSec" from ai_story_local_generation_packages where package_id=${packageId}`;
      const mp4 = (marker: string) => {
        const ftyp = Buffer.alloc(16); ftyp.writeUInt32BE(16, 0); ftyp.write("ftypisom", 4, "ascii");
        const mvhd = Buffer.alloc(32); mvhd.writeUInt32BE(32, 0); mvhd.write("mvhd", 4, "ascii");
        mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(Number(unit!.durationSec) * 1000, 24);
        const free = Buffer.from(`\0\0\0\0free${marker}`, "binary"); free.writeUInt32BE(free.length, 0);
        return Buffer.concat([ftyp, mvhd, free]);
      };
      const sha = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const output = mp4("desktop-output"), forged = mp4("forged-output");
      const [asset] = await sql<{ id: string; path: string; status: string; uploadedBy: string }[]>`select id, storage_path path, status, uploaded_by "uploadedBy"
        from assets where workspace_id=${ids.workspace} and metadata->>'sourceKind'='LOCAL_GPU_WORKER'`;
      expect(asset).toMatchObject({ status: "uploading", uploadedBy: ids.actor });
      expect(asset!.path.startsWith(`${ids.workspace}/ai-story/local-generation/${packageId}/`)).toBe(true);
      storageState.objects.clear();
      const desktopCalls: { method: string; path: string; action: string; workflow: string }[] = [];
      global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const target = new URL(String(url));
        const token = String(new Headers(init?.headers).get("authorization")).replace("Bearer ", "");
        const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8")) as Record<string, string>;
        desktopCalls.push({ method, path: target.pathname, action: claims.action!, workflow: claims.workflow! });
        // Mirrors Desktop assertSameIdentity: job tokens must carry the job's own workflow.
        if (claims.jobId !== jobId || claims.workflow !== "MINIMAX_H3_T2V") {
          return new Response(JSON.stringify({ error: { code: "LOCAL_GPU_WORKFLOW_MISMATCH" } }), { status: 403 });
        }
        if (method === "GET" && target.pathname === `/v1/jobs/${jobId}`) return new Response(JSON.stringify({ job: { state: "COMPLETED" } }), { status: 200 });
        if (method === "GET" && target.pathname === `/v1/jobs/${jobId}/result`) {
          return new Response(JSON.stringify({ jobId, status: "COMPLETED", result: { contentHash: sha(output) } }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }) as typeof fetch;
      const counts = async () => (await sql<{ results: number; outputs: number; jobs: number }[]>`select
        (select count(*) from ai_story_generation_results where workspace_id=${ids.workspace})::int results,
        (select count(*) from ai_story_local_generation_outputs where package_id=${packageId})::int outputs,
        (select count(*) from ai_story_local_media_jobs where workspace_id=${ids.workspace} and kind='VALIDATE_OUTPUT')::int jobs`)[0]!;
      const mediaJob = async () => (await sql<{ state: string; code: string | null }[]>`select state, error_code code from ai_story_local_media_jobs
        where workspace_id=${ids.workspace} and kind='VALIDATE_OUTPUT'`)[0];
      const assetRow = async () => (await sql<{ status: string; hash: string | null; desktopHash: string | null; size: number | null }[]>`select status, content_hash hash,
        metadata->>'desktopResultContentHash' "desktopHash", file_size_bytes::int size from assets where id=${asset!.id}`)[0]!;

      const { runWorkerLocalGpuDispatchCycle, bindLocalGpuDesktopOutput } = await import("../apps/worker/src/ai-story-local-gpu-worker-dispatch");
      const { runAiStoryLocalMediaWorkerCycle } = await import("../apps/worker/src/ai-story-local-media-worker-cycle");
      const steps = await Promise.all([runWorkerLocalGpuDispatchCycle(workerEnv()), runWorkerLocalGpuDispatchCycle(workerEnv())]);
      expect(steps.map((step) => step.code)).toContain("LOCAL_GPU_OUTPUT_VALIDATION_ENQUEUED");
      expect(desktopCalls.length).toBeGreaterThan(0);
      expect(desktopCalls.every((call) => call.method === "GET" && call.workflow === "MINIMAX_H3_T2V")).toBe(true);
      expect(new Set(desktopCalls.map((call) => call.action))).toEqual(new Set(["status", "result"]));
      expect(await counts()).toEqual({ results: 0, outputs: 0, jobs: 1 });
      expect(await assetRow()).toMatchObject({ status: "uploading", desktopHash: sha(output) });
      const reads = desktopCalls.length;
      await runWorkerLocalGpuDispatchCycle(workerEnv());
      expect(desktopCalls.length).toBe(reads);

      // Upload not yet visible in storage: fails closed, nothing is materialized.
      expect(await runAiStoryLocalMediaWorkerCycle()).toMatchObject({ status: "FAILED", errorCode: "STORAGE_OBJECT_NOT_FOUND" });
      expect(await counts()).toEqual({ results: 0, outputs: 0, jobs: 1 });

      const outputRoute = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/output/route");
      const outputParams = () => ({ params: Promise.resolve({ id: ids.campaign, storyId: ids.story, executionPlanId: ids.plan, packageId }) });
      const revalidate = () => outputRoute.PATCH(new Request("http://localhost/output", { method: "PATCH", body: JSON.stringify({ assetId: asset!.id }) }), outputParams());
      authState.user = { id: ids.ordinary, email: "ordinary@example.invalid" };
      expect((await revalidate()).status).toBe(403);
      expect(await mediaJob()).toEqual({ state: "FAILED", code: "STORAGE_OBJECT_NOT_FOUND" });
      authState.user = { id: ids.actor, email: "admin@example.invalid" };

      // Bytes that differ from the Desktop-signed hash never become a result.
      storageState.objects.set(asset!.path, forged);
      expect((await revalidate()).status).toBe(202);
      expect(await runAiStoryLocalMediaWorkerCycle()).toMatchObject({ status: "FAILED", errorCode: "GENERATION_RESULT_CONTENT_MISMATCH" });
      expect(await counts()).toEqual({ results: 0, outputs: 0, jobs: 1 });
      expect((await assetRow()).status).toBe("uploading");
      expect(await bindLocalGpuDesktopOutput({ orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, executionPlanId: ids.plan,
        packageId, runtimeAuthorizationId: ids.runtime }, sha(forged))).toBe("GENERATION_RESULT_CONTENT_MISMATCH");

      storageState.objects.set(asset!.path, output);
      expect((await revalidate()).status).toBe(202);
      expect(await runAiStoryLocalMediaWorkerCycle()).toMatchObject({ status: "SUCCEEDED" });
      expect(await counts()).toEqual({ results: 1, outputs: 1, jobs: 1 });
      expect(await assetRow()).toEqual({ status: "ready", hash: sha(output), desktopHash: sha(output), size: output.length });
      const [result] = await sql<{ id: string; sourceKind: string; hash: string; scene: string; plan: string; assetId: string; outputId: string | null; attempt: string | null }[]>`
        select generation_result_id id, source_kind "sourceKind", content_hash hash, scene_execution_id scene, execution_plan_id plan, asset_id "assetId",
          coalesce(local_worker_output_id, local_generation_output_id) "outputId", provider_attempt_id attempt
        from ai_story_generation_results where workspace_id=${ids.workspace}`;
      // Desktop bytes reuse the canonical local VALIDATE_OUTPUT authority but keep their LOCAL_GPU origin; no Provider Attempt is invented.
      expect(result).toMatchObject({ sourceKind: "LOCAL_GPU_WORKER", hash: sha(output), scene: ids.sceneExecution, plan: ids.plan, assetId: asset!.id, attempt: null });
      const [stored] = await sql<{ outputId: string; hash: string; qc: string }[]>`select output_id "outputId", content_hash hash, qc_state qc
        from ai_story_local_generation_outputs where package_id=${packageId}`;
      expect(stored).toMatchObject({ outputId: result!.outputId, hash: sha(output), qc: "PENDING" });
      expect((await sql`select 1 from ai_story_generation_results where generation_result_id=${result!.id}
        and local_generation_output_id=${stored!.outputId} and local_worker_output_id is null`).length).toBe(1);

      // The same Desktop output can never be relabelled as a manual upload, and LOCAL_GPU origin needs the Worker-bound hash.
      const { AiStoryGenerationResultRepository, materializeGenerationResult } = await import("../packages/db/src");
      const repository = new AiStoryGenerationResultRepository();
      const accepted = (await repository.get(ids.workspace, result!.id))!;
      const { generationResultId: _id, fingerprint: _fp, contractVersion: _cv, ...facts } = accepted;
      await expect(repository.accept(materializeGenerationResult({ ...facts, source: { ...accepted.source, sourceKind: "MANUAL_LOCAL", localWorkerOutputId: null } as never })))
        .rejects.toThrow("GENERATION_RESULT_LOCAL_SOURCE_MISMATCH");
      await sql`update assets set metadata = metadata || ${sql.json({ desktopResultContentHash: sha(forged) })} where id=${asset!.id}`;
      await expect(repository.accept(accepted)).rejects.toThrow("GENERATION_RESULT_LOCAL_GPU_SOURCE_MISMATCH");
      await sql`update assets set metadata = metadata || ${sql.json({ desktopResultContentHash: sha(output) })} where id=${asset!.id}`;
      expect(await repository.accept(accepted)).toMatchObject({ replayed: true });
      expect(await counts()).toEqual({ results: 1, outputs: 1, jobs: 1 });

      // Replays after success (operator re-run, Worker restart re-bind) are suppressed.
      const replay = await revalidate();
      expect(replay.status).toBe(202);
      expect(await replay.json()).toMatchObject({ state: "SUCCEEDED" });
      expect(await bindLocalGpuDesktopOutput({ orgId: ids.org, workspaceId: ids.workspace, campaignId: ids.campaign, executionPlanId: ids.plan,
        packageId, runtimeAuthorizationId: ids.runtime }, sha(output))).toBe("LOCAL_GPU_OUTPUT_VALIDATION_ENQUEUED");
      expect(await runAiStoryLocalMediaWorkerCycle()).toEqual({ status: "IDLE" });
      expect(await mediaJob()).toEqual({ state: "SUCCEEDED", code: null });
      expect(await counts()).toEqual({ results: 1, outputs: 1, jobs: 1 });

      // Post-QC requirements are served; nothing is evaluated, approved or released without a human.
      const resultRoute = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/execution-plans/[executionPlanId]/local-generation/[packageId]/result/route");
      const review = await resultRoute.GET(new Request("http://localhost/result"), outputParams());
      expect(review.status).toBe(200);
      const body = await review.json() as { generationResultId: string; sourceKind: string; requirements: { requirementId: string }[]; evaluation: unknown; decision: unknown; continuityFrame: unknown };
      expect(body).toMatchObject({ generationResultId: result!.id, sourceKind: "LOCAL_GPU_WORKER", evaluation: null, decision: null, continuityFrame: null });
      expect(body.requirements.length).toBeGreaterThan(0);
      const reviewBody = body as typeof body & { commercialAudio: { finalPolicy: string; assembly: { state: string } | null }; reviewedMedia: string };
      expect(reviewBody.commercialAudio.finalPolicy).toBe("LICENSED_BGM");
      expect(reviewBody.commercialAudio.assembly?.state).toBe("PENDING");
      expect(reviewBody.reviewedMedia).toBe("GENERATION_SOURCE");
      const blockedQc = await resultRoute.POST(new Request("http://localhost/result", { method: "POST", body: JSON.stringify({ action: "EVALUATE", observations: [] }) }), outputParams());
      expect(blockedQc.status).toBe(409);
      const assembledAssetId = randomUUID();
      await sql`insert into assets(id, org_id, workspace_id, campaign_id, type, mime_type, storage_path, status, source, uploaded_by, content_hash, file_size_bytes, display_name)
        select ${assembledAssetId}, org_id, workspace_id, campaign_id, 'video', 'video/mp4', storage_path || '-commercial-audio', 'ready', 'ai_story_commercial_audio', uploaded_by, ${sha(output)}, 1, 'assembled'
        from assets where id=${asset!.id}`;
      await sql`update ai_story_commercial_audio_assemblies set state='ASSEMBLED', output_asset_id=${assembledAssetId}, output_content_hash=${sha(output)}, has_audio=true
        where generation_result_id=${result!.id} and state='PENDING'`;
      const premature = await resultRoute.POST(new Request("http://localhost/result", { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "no Post-QC yet" }) }), outputParams());
      expect(premature.status).toBeGreaterThanOrEqual(400);

      // Existing human-evidence Post-QC runs on the LOCAL_GPU result and stops at the Human Review boundary.
      const observations = body.requirements.map((requirement) => ({
        observationId: randomUUID(), evidenceVersion: "ai-story-visual-evidence.v1", requirementId: requirement.requirementId,
        source: "HUMAN_SUPPLIED_EVIDENCE", summary: "Reviewer confirmed this requirement in the delivered video.", observableSignal: "SATISFIED",
        confidence: { level: "HIGH", score: 0.9, evidenceQuality: "STRONG" }, timeRangeMs: null, subjects: [], artifactSeverity: null,
      }));
      const evaluated = await resultRoute.POST(new Request("http://localhost/result", { method: "POST", body: JSON.stringify({ action: "EVALUATE", observations }) }), outputParams());
      expect(evaluated.status).toBe(200);
      const qc = (await resultRoute.GET(new Request("http://localhost/result"), outputParams()).then((response) => response.json())) as {
        sourceKind: string; decision: unknown; audioEvidence: { autoApproved: false } | null;
        evaluation: { sourceKind: string; generationResultId: string; mediaContentHash: string; eligibleForHumanReview: boolean; autoApproved: boolean; audioEvidenceId?: string };
      };
      expect(qc).toMatchObject({ sourceKind: "LOCAL_GPU_WORKER", decision: null });
      expect(qc.evaluation).toMatchObject({ sourceKind: "LOCAL_GPU_WORKER", generationResultId: result!.id, mediaContentHash: sha(output), eligibleForHumanReview: true, autoApproved: false });
      expect(qc.evaluation.audioEvidenceId).toBeTruthy();
      expect((await sql`select 1 from ai_story_local_gpu_audio_evidence where generation_result_id=${result!.id}`).length).toBe(1);
      expect((await sql`select 1 from ai_story_local_generation_packages where retry_of_package_id=${packageId}`).length).toBe(0);
      expect((await sql`select 1 from ai_story_generation_result_decisions where generation_result_id=${result!.id}`).length).toBe(0);
      expect((await sql`select 1 from ai_story_local_media_jobs where workspace_id=${ids.workspace} and kind='EXTRACT_FRAME'`).length).toBe(0);
      expect(desktopCalls.some((call) => call.method !== "GET")).toBe(false);
      expect(await gate()).toBe(jobId);
    });

    it("keeps evidence append-only and server-only", async () => {
      await expect(sql`update ai_story_local_gpu_submit_outcomes set kind='SUBMIT_ACCEPTED' where workspace_id=${ids.workspace}`)
        .rejects.toMatchObject({ code: "23514" });
      await expect(sql`delete from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace}`)
        .rejects.toMatchObject({ code: "23514" });
      expect(await isRlsEnabled(sql, "ai_story_local_gpu_submit_outcomes")).toBe(true);
      await expect(withAuthenticatedUser(sql, ids.ordinary, (tx) =>
        tx<{ count: number }[]>`select count(*)::int count from ai_story_local_gpu_submit_outcomes where workspace_id=${ids.workspace}`,
      )).rejects.toMatchObject({ code: "42501" });
    });
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
