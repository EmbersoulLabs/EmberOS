import { eq, sql } from "drizzle-orm";
import {
  authorizeAndExecuteExecutionPlan,
  type RuntimeAuthorizationBoundaryTimings,
} from "@ceo-agent/agents";
import { closeDb, getDb, schema } from "@ceo-agent/db";
import { RuntimeAuthorizedFactSchema } from "@ceo-agent/shared";

const SMOKE_EXECUTION_PLAN_ID = process.env.AI_STORY_RUNTIME_AUTH_SMOKE_PLAN_ID?.trim();
const INCIDENT_EXECUTION_PLAN_ID = "e82233dd-3eab-5c1c-b1b1-1179d3fea3a6";

class StopBeforeRelease extends Error {
  constructor() { super("RUNTIME_AUTH_SMOKE_STOP_BEFORE_RELEASE"); }
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const parsed = new URL(databaseUrl);
if (!`${parsed.hostname}:${parsed.username}`.includes("egkgybrjmzukzmkcrpag")) {
  throw new Error("PRODUCTION_DB_IDENTITY_MISMATCH");
}

async function authorityCounts(executionPlanId: string) {
  const db = getDb();
  const [row] = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from ai_story_runtime_authorized_facts where execution_plan_id=${executionPlanId}::uuid) as runtime_facts,
      (select count(*)::int from ai_story_scene_release_states where execution_plan_id=${executionPlanId}::uuid) as releases,
      (select count(*)::int from ai_story_scene_routing_decisions where execution_plan_id=${executionPlanId}::uuid) as routing,
      (select count(*)::int from ai_story_scene_scheduling_correlations where execution_plan_id=${executionPlanId}::uuid) as correlations,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_outbox_jobs o on o.job_id=c.outbox_job_id where c.execution_plan_id=${executionPlanId}::uuid) as outboxes,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_attempts a on a.execution_id=c.provider_execution_id where c.execution_plan_id=${executionPlanId}::uuid) as attempts,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_outbox_jobs o on o.job_id=c.outbox_job_id where ((o.status in ('PENDING','RETRY_WAIT') and o.next_visible_at<=now()) or (o.status='CLAIMED' and o.lease_expires_at<=now()))) as global_claimable_ai_story_outboxes
  `);
  return row;
}

async function main() {
  if (!SMOKE_EXECUTION_PLAN_ID) {
    throw new Error("AI_STORY_RUNTIME_AUTH_SMOKE_PLAN_ID is required");
  }
  if (SMOKE_EXECUTION_PLAN_ID === INCIDENT_EXECUTION_PLAN_ID) {
    throw new Error("INCIDENT_FIXTURE_SMOKE_DENIED");
  }
  const db = getDb();
  const [plan] = await db.select().from(schema.aiStoryExecutionPlans)
    .where(eq(schema.aiStoryExecutionPlans.id, SMOKE_EXECUTION_PLAN_ID)).limit(1);
  const [existingRow] = await db.select().from(schema.aiStoryRuntimeAuthorizedFacts)
    .where(eq(schema.aiStoryRuntimeAuthorizedFacts.executionPlanId, SMOKE_EXECUTION_PLAN_ID))
    .limit(1);
  if (!plan || !existingRow) throw new Error("SMOKE_AUTHORITY_NOT_FOUND");
  const existing = RuntimeAuthorizedFactSchema.parse(existingRow.fact);
  if (
    existing.executionAuthorization?.accessMode !== "ops" ||
    existing.executionAuthorization.settlementMode !== "none"
  ) {
    throw new Error("SMOKE_REQUIRES_EXISTING_OPS_AUTHORITY");
  }
  const before = await authorityCounts(SMOKE_EXECUTION_PLAN_ID);
  let timings: RuntimeAuthorizationBoundaryTimings | null = null;
  const startedAt = performance.now();
  let stoppedBeforeRelease = false;
  try {
    await authorizeAndExecuteExecutionPlan({
      executionPlanId: plan.id,
      actorUserId: existing.authorizedBy,
      ownership: {
        orgId: plan.orgId,
        workspaceId: plan.workspaceId,
        campaignId: plan.campaignId,
        storyId: plan.storyId,
        storyVersionId: plan.storyVersionId,
        animationPackageId: plan.animationPackageId,
        executionPlanId: plan.id,
      },
      router: {} as never,
      now: () => new Date(existing.authorizedAt),
      executionAuthorization: existing.executionAuthorization,
      observeRuntimeAuthorizationBoundary: (value) => { timings = value; },
      sceneReleaseRepository: {
        initialize: async () => { throw new StopBeforeRelease(); },
      } as never,
    });
  } catch (error) {
    if (!(error instanceof StopBeforeRelease)) throw error;
    stoppedBeforeRelease = true;
  }
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
  const after = await authorityCounts(SMOKE_EXECUTION_PLAN_ID);
  const incident = await authorityCounts(INCIDENT_EXECUTION_PLAN_ID);
  const connectionLeakProbeStartedAt = performance.now();
  await db.execute(sql`select 1`);
  const connectionLeakProbeMs = Math.round(
    (performance.now() - connectionLeakProbeStartedAt) * 100
  ) / 100;
  console.log(JSON.stringify({
    productionDb: "egkgybrjmzukzmkcrpag",
    smokeExecutionPlanId: SMOKE_EXECUTION_PLAN_ID,
    incidentExecutionPlanId: INCIDENT_EXECUTION_PLAN_ID,
    stoppedBeforeRelease,
    durationMs,
    timings,
    before,
    after,
    unchanged: JSON.stringify(before) === JSON.stringify(after),
    incident,
    connectionLeakProbeMs,
  }));
}

void main().finally(() => closeDb());
