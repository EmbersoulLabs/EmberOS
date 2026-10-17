import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { PlatformAdminRepositoryImpl, closeDb } from "@ceo-agent/db";
import { buildPlatformAdminAssignment } from "@ceo-agent/shared/server";
import { animationPackageFixture } from "./helpers/ai-story-animation-package";
import { createIntegrationSql, getIntegrationDbUrl, RUN_DB_INTEGRATION } from "./helpers/db-integration";

const authState = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock("@/lib/auth", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  requireAuth: async () => {
    if (!authState.user) throw new Error("UNAUTHENTICATED");
    return authState.user;
  },
}));

const suite = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe.sequential : describe.skip;
const FRAME = "11111111-1111-4111-8111-111111111111";
const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function shortScenePackage() {
  const base = animationPackageFixture("review");
  const authority = {
    strategy: "PRODUCT_GROUNDED_VIDEO" as const,
    referenceSource: "SCENE_EXPLICIT" as const,
    referenceAssetIds: [FRAME],
    firstFrameAssetId: FRAME,
    productVisualIdentityRequirement: "REQUIRED" as const,
  };
  const continuity = ["", "Scene 001 and Scene 002 are merged as one continuous shot.", ""];
  const cameras = ["LOCKED", "SLOW_PUSH_IN", "LOCKED"];
  return {
    ...base,
    scenePlan: continuity.map((continuityNotes, order) => ({
      ...base.scenePlan[0]!,
      id: `scene-00${order + 1}`,
      order,
      durationSec: 2,
      continuityNotes,
      generationAuthority: authority,
    })),
    shotPlan: cameras.map((cameraType, order) => ({
      ...base.shotPlan[0]!,
      id: `shot-00${order + 1}`,
      sceneId: `scene-00${order + 1}`,
      order: 0,
      cameraType,
      durationSec: 2,
    })),
  };
}

suite("execution-unit duration authority over real HTTP and PostgreSQL", () => {
  const ids = {
    org: randomUUID(), workspace: randomUUID(), campaign: randomUUID(), story: randomUUID(),
    storyVersion: randomUUID(), animation: randomUUID(), actor: randomUUID(), outsider: randomUUID(),
    plan: randomUUID(), sceneExecution: randomUUID(),
  };
  let sql: Sql;
  let assignmentId: string;
  let approve: typeof import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/approve/route");
  let successor: typeof import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/duration-successor/route");
  const oldFetch = global.fetch;
  const desktop = vi.fn(async () => new Response("{}", { status: 200 }));
  const routeParams = () => ({ params: Promise.resolve({ id: ids.campaign, storyId: ids.story }) });

  const postApprove = () => approve.POST(new Request("http://localhost/approve", {
    method: "POST", body: JSON.stringify({ executionEnvironment: "LOCAL_GPU" }),
  }), routeParams());
  const postSuccessor = (durations: unknown) => successor.POST(new Request("http://localhost/duration-successor", {
    method: "POST", body: JSON.stringify({ durations }),
  }), routeParams());

  const snapshot = async () => (await sql<{ story_status: string; package_status: string; payload_hash: string; packages: number }[]>`
    select s.status story_status, p.status package_status, md5(p.payload::text) payload_hash,
      (select count(*) from ai_story_animation_packages where workspace_id=${ids.workspace})::int packages
    from ai_stories s join ai_story_animation_packages p on p.id=${ids.animation}
    where s.id=${ids.story} and s.workspace_id=${ids.workspace}`)[0];

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
    `);
    global.fetch = desktop as typeof fetch;
    await sql`insert into auth.users(id) values(${ids.actor}::uuid),(${ids.outsider}::uuid) on conflict do nothing`;
    await sql`insert into organizations(id,name,slug) values(${ids.org},'Duration Gate',${`duration-${ids.org}`})`;
    await sql`insert into workspaces(id,org_id,name,slug) values(${ids.workspace},${ids.org},'Duration Gate',${`duration-${ids.workspace}`})`;
    await sql`insert into workspace_members(org_id,workspace_id,user_id,role) values(${ids.org},${ids.workspace},${ids.actor},'admin')`;
    await sql`insert into campaigns(id,org_id,workspace_id,name) values(${ids.campaign},${ids.org},${ids.workspace},'Duration Gate')`;
    await sql`insert into ai_stories(id,org_id,workspace_id,campaign_id,title,original_idea,status)
      values(${ids.story},${ids.org},${ids.workspace},${ids.campaign},'Duration Gate','Duration Gate','planning_review')`;
    await sql`insert into ai_story_versions(id,story_id,version_number,structured_content)
      values(${ids.storyVersion},${ids.story},1,${sql.json({})})`;
    await sql`update ai_stories set current_version_id=${ids.storyVersion} where id=${ids.story}`;
    await sql`insert into ai_story_animation_packages(id,org_id,workspace_id,campaign_id,story_id,story_version_id,status,payload)
      values(${ids.animation},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},'review',${sql.json(shortScenePackage() as never)})`;
    const assignment = buildPlatformAdminAssignment({ userId: ids.actor, grantedAt: new Date().toISOString(),
      reason: "ephemeral duration gate certification", identitySeed: `duration-gate:${ids.actor}` });
    await new PlatformAdminRepositoryImpl().acceptOrConvergeGrant(assignment);
    assignmentId = assignment.platformAdminAssignmentId;
    approve = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/approve/route");
    successor = await import("../apps/web/src/app/api/campaigns/[id]/ai-stories/[storyId]/planning/duration-successor/route");
  }, 120_000);

  afterAll(async () => {
    global.fetch = oldFetch;
    if (sql) {
      await sql.unsafe("set session_replication_role = replica");
      await sql`delete from ai_story_scene_executions where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_execution_plans where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_animation_packages where workspace_id=${ids.workspace}`;
      await sql`delete from ai_story_versions where story_id=${ids.story}`;
      await sql`delete from ai_stories where workspace_id=${ids.workspace}`;
      await sql`delete from campaigns where workspace_id=${ids.workspace}`;
      await sql`delete from workspace_members where workspace_id=${ids.workspace}`;
      await sql`delete from platform_admin_grants where platform_admin_assignment_id=${assignmentId}::uuid`;
      await sql`delete from workspaces where id=${ids.workspace}`;
      await sql`delete from organizations where id=${ids.org}`;
      await sql`delete from auth.users where id in (${ids.actor}::uuid,${ids.outsider}::uuid)`;
      await sql.unsafe("set session_replication_role = origin");
      await sql.end();
    }
    await closeDb();
  }, 120_000);

  it("refuses approval with the exact per-Scene duration decision and leaves history untouched", async () => {
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
    const before = await snapshot();
    const response = await postApprove();
    expect(response.status).toBe(409);
    const body = await response.json() as {
      code: string;
      executionUnitDurations: {
        status: string;
        maxSec: number;
        units: { sceneId: string; durationSec: number; certified: boolean }[];
        decision: { option: { changes: { sceneId: string; toDurationSec: number }[]; episodeDurationSec: number } };
      };
    };
    expect(body.code).toBe("PLANNING_EXECUTION_UNIT_DURATION_UNSUPPORTED");
    expect(body.executionUnitDurations.status).toBe("CREATIVE_DECISION_REQUIRED");
    expect(body.executionUnitDurations.maxSec).toBe(12);
    expect(body.executionUnitDurations.units.map((unit) => [unit.sceneId, unit.durationSec, unit.certified])).toEqual([
      ["scene-001", 2, false], ["scene-002", 2, false], ["scene-003", 2, false],
    ]);
    expect(body.executionUnitDurations.decision.option.changes.map((change) => [change.sceneId, change.toDurationSec])).toEqual([
      ["scene-001", 5], ["scene-002", 5], ["scene-003", 5],
    ]);
    expect(body.executionUnitDurations.decision.option.episodeDurationSec).toBe(15);
    expect(await snapshot()).toEqual(before);
    expect(before).toMatchObject({ story_status: "planning_review", package_status: "review", packages: 1 });
    expect(desktop).not.toHaveBeenCalled();
  });

  it("rejects uncertified or incomplete duration successors without writing", async () => {
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
    const before = await snapshot();
    const tooLong = await postSuccessor([
      { sceneId: "scene-001", durationSec: 13 }, { sceneId: "scene-002", durationSec: 5 }, { sceneId: "scene-003", durationSec: 5 },
    ]);
    expect(tooLong.status).toBe(422);
    expect((await tooLong.json() as { code: string }).code).toBe("EXECUTION_UNIT_DURATION_UNSUPPORTED");
    const incomplete = await postSuccessor([{ sceneId: "scene-001", durationSec: 5 }]);
    expect(incomplete.status).toBe(422);
    expect((await incomplete.json() as { code: string }).code).toBe("EXECUTION_UNIT_DURATION_INCOMPLETE");
    expect(await snapshot()).toEqual(before);
    expect(desktop).not.toHaveBeenCalled();
  });

  it("refuses a duration successor once execution has started", async () => {
    authState.user = { id: ids.actor, email: "admin@example.invalid" };
    await sql`insert into ai_story_execution_plans(id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,status,contract_version,compilation_hash,deterministic_fingerprint,plan,compiled_at)
      values(${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},'PLANNED','1',${hash("plan")},${hash("plan-fingerprint")},${sql.json({ certification: true })},now())`;
    await sql.begin(async (tx) => {
      await tx.unsafe("set local session_replication_role = replica");
      await tx`insert into ai_story_scene_executions(id,execution_plan_id,org_id,workspace_id,campaign_id,story_id,story_version_id,animation_package_id,scene_id,scene_order,status,idempotency_key,deterministic_fingerprint,compilation_hash,instruction_hash,intent)
        values(${ids.sceneExecution},${ids.plan},${ids.org},${ids.workspace},${ids.campaign},${ids.story},${ids.storyVersion},${ids.animation},'scene-001',0,'DISPATCHED',${`duration-${ids.sceneExecution}`},${hash("scene")},${hash("plan")},${hash("instruction")},${tx.json({ certification: true })})`;
    });
    await sql`update ai_stories set status='executing' where id=${ids.story}`;
    const before = await snapshot();
    const response = await postSuccessor([
      { sceneId: "scene-001", durationSec: 5 }, { sceneId: "scene-002", durationSec: 5 }, { sceneId: "scene-003", durationSec: 5 },
    ]);
    expect(response.status).toBe(409);
    expect((await response.json() as { code: string }).code).toBe("EXECUTION_UNIT_DURATION_SUCCESSOR_EXECUTION_STARTED");
    expect(await snapshot()).toEqual(before);
    expect(before.story_status).toBe("executing");
  });

  it("denies a non-member before revealing Planning facts", async () => {
    authState.user = { id: ids.outsider, email: "outsider@example.invalid" };
    const before = await snapshot();
    const approval = await postApprove();
    expect([403, 404]).toContain(approval.status);
    expect(await approval.json()).not.toHaveProperty("executionUnitDurations");
    const revision = await postSuccessor([{ sceneId: "scene-001", durationSec: 5 }]);
    expect([403, 404]).toContain(revision.status);
    expect(await snapshot()).toEqual(before);
    expect(desktop).not.toHaveBeenCalled();
  });
});
