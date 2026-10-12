import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

if (!(process.env.RUN_DB_INTEGRATION_TESTS === "1" && process.env.DATABASE_URL)) {
  process.env.DATABASE_URL = readFileSync(process.env.CAMPAIGN_ITERATIONS_DB_FILE!, "utf8").trim();
}

type DbApi = typeof import("@ceo-agent/db");
let api: DbApi;
let sql: ReturnType<typeof postgres>;
const ids = {
  org: crypto.randomUUID(), workspaceA: crypto.randomUUID(), workspaceB: crypto.randomUUID(),
  admin: crypto.randomUUID(), viewer: crypto.randomUUID(), outsider: crypto.randomUUID(),
  campaignA: crypto.randomUUID(), campaignB: crypto.randomUUID(), taskA: crypto.randomUUID(),
};
const scope = () => ({ orgId: ids.org, workspaceId: ids.workspaceA, campaignId: ids.campaignA, actorUserId: ids.admin });

beforeAll(async () => {
  api = await import("@ceo-agent/db");
  sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false });
  const suffix = ids.org.slice(0, 8);
  await sql`insert into organizations(id,name,slug) values(${ids.org},'Iteration Org',${`iteration-${suffix}`})`;
  await sql`insert into workspaces(id,org_id,name,slug) values(${ids.workspaceA},${ids.org},'A',${`iteration-a-${suffix}`}),(${ids.workspaceB},${ids.org},'B',${`iteration-b-${suffix}`})`;
  await sql`insert into workspace_members(org_id,workspace_id,user_id,role) values
    (${ids.org},${ids.workspaceA},${ids.admin},'admin'),(${ids.org},${ids.workspaceA},${ids.viewer},'viewer'),(${ids.org},${ids.workspaceB},${ids.outsider},'admin')`;
  await sql`insert into campaigns(id,org_id,workspace_id,name,platforms,status) values
    (${ids.campaignA},${ids.org},${ids.workspaceA},'Campaign A',${['tiktok']},'draft'),(${ids.campaignB},${ids.org},${ids.workspaceB},'Campaign B',${['instagram']},'draft')`;
  await sql`insert into tasks(id,org_id,workspace_id,campaign_id,status) values(${ids.taskA},${ids.org},${ids.workspaceA},${ids.campaignA},'completed')`;
});

afterAll(async () => {
  if (api) await api.closeDb();
  if (sql) { await sql`delete from organizations where id=${ids.org}`; await sql.end(); }
});

describe("Campaign Content Iteration PostgreSQL authority", () => {
  it("reapplies the additive migration without changing historical Campaign rows", async () => {
    await sql.unsafe(readFileSync("packages/db/sql/campaign-content-iterations-v1.sql", "utf8"));
    const campaigns = await sql`select id from campaigns where org_id=${ids.org} order by id`;
    expect(campaigns).toHaveLength(2);
  });

  it("creates multiple stable iterations and converges duplicate creation", async () => {
    const service = new api.CampaignContentIterationService();
    const [first, second] = await Promise.all([
      service.create(scope(), { idempotencyKey: "create-1", payload: { brief: "first" } }),
      service.create(scope(), { idempotencyKey: "create-2", payload: { brief: "second" } }),
    ]);
    expect([first.iteration.sequenceNumber, second.iteration.sequenceNumber].sort()).toEqual([1, 2]);
    expect(first.iteration.id).not.toBe(second.iteration.id);
    const replay = await service.create(scope(), { idempotencyKey: "create-1", payload: { brief: "first" } });
    expect(replay.reused).toBe(true);
    expect(replay.iteration.id).toBe(first.iteration.id);
    await expect(service.create(scope(), { idempotencyKey: "create-1", payload: { brief: "changed" } })).rejects.toMatchObject({ code: "CAMPAIGN_ITERATION_IDEMPOTENCY_CONFLICT" });
  });

  it("serializes transitions, preserves independent state, and records append-only history", async () => {
    const service = new api.CampaignContentIterationService();
    const one = await service.create(scope(), { idempotencyKey: "state-one" });
    const two = await service.create(scope(), { idempotencyKey: "state-two" });
    const transition = await service.transition(scope(), one.iteration.id, { expectedVersion: 1, toState: "PLAN_APPROVED", idempotencyKey: "approve-one" });
    expect(transition.iteration.state).toBe("PLAN_APPROVED");
    expect((await service.history(scope(), two.iteration.id)).iteration.state).toBe("PLANNING");
    const replay = await service.transition(scope(), one.iteration.id, { expectedVersion: 1, toState: "PLAN_APPROVED", idempotencyKey: "approve-one" });
    expect(replay.reused).toBe(true);
    const fact = await service.appendFact(scope(), one.iteration.id, { expectedVersion: 2, factType: "PLAN_APPROVED", idempotencyKey: "plan-fact", payload: { planVersion: 1 } });
    expect(fact.iteration.version).toBe(3);
    const history = await service.history(scope(), one.iteration.id);
    expect(history.facts.map((item) => item.sequenceNumber)).toEqual([1, 2, 3]);
    const race = await Promise.allSettled([
      service.transition(scope(), two.iteration.id, { expectedVersion: 1, toState: "PLAN_APPROVED", idempotencyKey: "race-a" }),
      service.transition(scope(), two.iteration.id, { expectedVersion: 1, toState: "PLAN_APPROVED", idempotencyKey: "race-b" }),
    ]);
    expect(race.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(race.filter((item) => item.status === "rejected")).toHaveLength(1);
  });

  it("rejects wrong Workspace, unauthorized roles, invalid transitions, and foreign artifacts", async () => {
    const service = new api.CampaignContentIterationService();
    const created = await service.create(scope(), { idempotencyKey: "security" });
    await expect(service.create({ ...scope(), actorUserId: ids.viewer }, { idempotencyKey: "viewer" })).rejects.toMatchObject({ code: "CAMPAIGN_ITERATION_ROLE_DENIED" });
    await expect(service.history({ ...scope(), workspaceId: ids.workspaceB, campaignId: ids.campaignB }, created.iteration.id)).rejects.toMatchObject({ code: "CAMPAIGN_SCOPE_DENIED" });
    await expect(service.transition(scope(), created.iteration.id, { expectedVersion: 1, toState: "PUBLISHED", idempotencyKey: "skip" })).rejects.toMatchObject({ code: "CAMPAIGN_ITERATION_TRANSITION_INVALID" });
    await expect(service.attachArtifact(scope(), created.iteration.id, { expectedVersion: 1, artifactType: "VIDEO_TASK", artifactId: crypto.randomUUID(), idempotencyKey: "bad-artifact" })).rejects.toMatchObject({ code: "CAMPAIGN_ARTIFACT_SCOPE_DENIED" });
    const attached = await service.attachArtifact(scope(), created.iteration.id, { expectedVersion: 1, artifactType: "VIDEO_TASK", artifactId: ids.taskA, idempotencyKey: "good-artifact" });
    expect(attached.fact.payload).toEqual({ artifactType: "VIDEO_TASK", artifactId: ids.taskA });
  });

  it("enforces cross-Workspace RLS and denies direct authenticated writes", async () => {
    const service = new api.CampaignContentIterationService();
    const created = await service.create(scope(), { idempotencyKey: "rls" });
    const visible = await sql.begin(async (tx) => { await tx.unsafe("set local role=authenticated"); await tx`select set_config('request.jwt.claim.sub',${ids.outsider},true)`; return tx`select id from campaign_content_iterations where id=${created.iteration.id}`; });
    expect(visible).toHaveLength(0);
    const directWrite = await sql.begin(async (tx) => { await tx.unsafe("set local role=authenticated"); await tx`select set_config('request.jwt.claim.sub',${ids.admin},true)`; return tx`update campaign_content_iterations set state='CANCELLED' where id=${created.iteration.id} returning id`; });
    expect(directWrite).toHaveLength(0);
    const history = await service.history(scope(), created.iteration.id);
    expect(history.iteration.state).toBe("PLANNING");
  });
});
