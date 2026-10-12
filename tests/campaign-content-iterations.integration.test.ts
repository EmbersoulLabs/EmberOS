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
  assetA: crypto.randomUUID(),
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
  await sql`insert into business_profiles(org_id,workspace_id,company_name,industry_display_name,services,version) values(${ids.org},${ids.workspaceA},'Grounded Co','Retail',${['Consulting']},3)`;
  await sql`insert into assets(id,org_id,workspace_id,campaign_id,type,storage_path,status) values(${ids.assetA},${ids.org},${ids.workspaceA},${ids.campaignA},'image','test/asset.jpg','ready')`;
});

afterAll(async () => {
  if (api) await api.closeDb();
  if (sql) {
    // The assets organization FK is installed by a later CI migration, so
    // this fixture cannot rely on organization deletion to cascade yet.
    await sql`delete from assets where id=${ids.assetA}`;
    await sql`delete from organizations where id=${ids.org}`;
    await sql.end();
  }
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

  it("creates immutable Plan revisions and binds approval to the exact latest revision", async () => {
    const iteration = await new api.CampaignContentIterationService().create(scope(), { idempotencyKey: "plan-revisions" });
    const service = new api.CampaignMarketingPlanService();
    const base = { objective: "Awareness", targetAudience: "Local buyers", marketingApproach: "Educational", creativeDirection: "Show the process", assetMode: "ZERO_ASSET" as const, assetIds: [], missingAssets: ["product image"], recommendedModule: "VIDEO_STUDIO" as const, rationale: "Matches the goal", expectedOutcome: "Qualified awareness", businessFactRefs: ["companyName", "industryDisplayName"] };
    const first = await service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "plan-r1-key", content: base });
    const replay = await service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "plan-r1-key", content: base });
    expect(replay.reused).toBe(true);
    expect(replay.plan.id).toBe(first.plan.id);
    const second = await service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 2, expectedLatestRevision: 1, idempotencyKey: "plan-r2-key", content: { ...base, creativeDirection: "Explain the customer decision" } });
    expect([first.plan.revision, second.plan.revision]).toEqual([1, 2]);
    await expect(service.approve(scope(), iteration.iteration.id, { planId: first.plan.id, expectedRevision: 1, expectedIterationVersion: 3, selectedModule: "AI_STORY", idempotencyKey: "approve-stale" })).rejects.toMatchObject({ code: "CAMPAIGN_MARKETING_PLAN_REVISION_CONFLICT" });
    const approved = await service.approve(scope(), iteration.iteration.id, { planId: second.plan.id, expectedRevision: 2, expectedIterationVersion: 3, selectedModule: "PHOTO_SCENE", idempotencyKey: "approve-r2-key" });
    expect(approved.plan.status).toBe("APPROVED");
    expect(approved.plan.selectedModule).toBe("PHOTO_SCENE");
    expect(approved.iteration.state).toBe("PLAN_APPROVED");
    expect((await service.list(scope(), iteration.iteration.id)).map((plan) => plan.status)).toEqual(["DRAFT", "APPROVED"]);
  });

  it("supports zero-asset and authorized asset-based Plans without requiring scripts", async () => {
    const iterations = new api.CampaignContentIterationService();
    const service = new api.CampaignMarketingPlanService();
    const zero = await iterations.create(scope(), { idempotencyKey: "zero-asset-plan" });
    const content = { objective: "Awareness", targetAudience: "Local buyers", marketingApproach: "Useful introduction", creativeDirection: "Simple product context", assetMode: "ZERO_ASSET" as const, assetIds: [], missingAssets: [], recommendedModule: "AI_STORY" as const, rationale: "No source asset is needed", expectedOutcome: "Clear positioning", businessFactRefs: ["companyName"] };
    expect((await service.createRevision(scope(), zero.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "zero-plan-r1", content })).plan.content).not.toHaveProperty("voiceScript");
    const asset = await iterations.create(scope(), { idempotencyKey: "asset-plan" });
    const saved = await service.createRevision(scope(), asset.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "asset-plan-r1", content: { ...content, assetMode: "ASSET_BASED", assetIds: [ids.assetA], recommendedModule: "VIDEO_STUDIO" } });
    expect(saved.plan.content.assetIds).toEqual([ids.assetA]);
  });

  it("rejects stale concurrent Plan saves, unauthorized facts and cross-Workspace RLS reads", async () => {
    const iteration = await new api.CampaignContentIterationService().create(scope(), { idempotencyKey: "plan-security" });
    const service = new api.CampaignMarketingPlanService();
    const content = { objective: "Awareness", targetAudience: "Local buyers", marketingApproach: "Introduction", creativeDirection: "Factual overview", assetMode: "ZERO_ASSET" as const, assetIds: [], missingAssets: [], recommendedModule: "VIDEO_STUDIO" as const, rationale: "Suitable", expectedOutcome: "Awareness", businessFactRefs: ["companyName"] };
    const race = await Promise.allSettled([
      service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "plan-race-a", content }),
      service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 1, expectedLatestRevision: 0, idempotencyKey: "plan-race-b", content: { ...content, rationale: "Different" } }),
    ]);
    expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = (await service.list(scope(), iteration.iteration.id))[0]!;
    const invisible = await sql.begin(async (tx) => { await tx.unsafe("set local role=authenticated"); await tx`select set_config('request.jwt.claim.sub',${ids.outsider},true)`; return tx`select id from campaign_marketing_plan_versions where id=${current.id}`; });
    expect(invisible).toHaveLength(0);
    await expect(service.createRevision(scope(), iteration.iteration.id, { expectedIterationVersion: 2, expectedLatestRevision: 1, idempotencyKey: "bad-fact-key", content: { ...content, rationale: "New", businessFactRefs: ["unverifiedClaim"] } })).rejects.toMatchObject({ code: "CAMPAIGN_MARKETING_PLAN_FACT_UNAUTHORIZED" });
  });
});
