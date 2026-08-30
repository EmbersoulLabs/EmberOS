import { and, eq, sql } from "drizzle-orm";
import {
  assertExecutionPlanOwnershipChain,
  closeDb,
  getDb,
  ROLE_HIERARCHY,
  schema,
  withFreshDbContext,
} from "@ceo-agent/db";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const parsed = new URL(databaseUrl);
if (!`${parsed.hostname}:${parsed.username}`.includes("egkgybrjmzukzmkcrpag")) {
  throw new Error("PRODUCTION_DB_IDENTITY_MISMATCH");
}
const executionPlanId = process.env.AI_STORY_REVIEW_SMOKE_PLAN_ID?.trim();
if (!executionPlanId) throw new Error("AI_STORY_REVIEW_SMOKE_PLAN_ID is required");

async function main() {
  const db = getDb();
  const startedAt = performance.now();
  const readPath = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    const [plan] = await tx
      .select()
      .from(schema.aiStoryExecutionPlans)
      .where(eq(schema.aiStoryExecutionPlans.id, executionPlanId))
      .limit(1);
    if (!plan) throw new Error("Execution Plan not found");
    await assertExecutionPlanOwnershipChain(plan, tx);
    const [story] = await tx
      .select({ createdBy: schema.aiStories.createdBy, status: schema.aiStories.status })
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, plan.storyId))
      .limit(1);
    if (!story?.createdBy) throw new Error("Fixture Story creator is missing");
    const [member] = await tx
      .select({ role: schema.workspaceMembers.role })
      .from(schema.workspaceMembers)
      .where(and(
        eq(schema.workspaceMembers.workspaceId, plan.workspaceId),
        eq(schema.workspaceMembers.userId, story.createdBy)
      ))
      .limit(1);
    if (!member || ROLE_HIERARCHY[member.role as keyof typeof ROLE_HIERARCHY] < ROLE_HIERARCHY.operator) {
      throw new Error("Fixture reviewer authorization preflight failed");
    }
    const opened = await tx
      .select({ factId: schema.aiStoryReviewOpenedFacts.factId })
      .from(schema.aiStoryReviewOpenedFacts)
      .where(eq(schema.aiStoryReviewOpenedFacts.executionPlanId, plan.id));
    return { storyId: plan.storyId, storyStatus: story.status, reviewOpenedRows: opened.length };
  });
  const openReviewReadPathMs = Math.round((performance.now() - startedAt) * 100) / 100;

  const recoveryStartedAt = performance.now();
  const recoveryRead = await withFreshDbContext(async (freshDb) => {
    const [story] = await freshDb
      .select({ status: schema.aiStories.status })
      .from(schema.aiStories)
      .where(eq(schema.aiStories.id, readPath.storyId))
      .limit(1);
    return story?.status ?? null;
  });
  const failureClassificationFreshContextMs =
    Math.round((performance.now() - recoveryStartedAt) * 100) / 100;

  const [safety] = await db.execute<{
    claimable: number;
    attempts: number;
  }>(sql`
    select
      (select count(*)::int
       from ai_story_scene_scheduling_correlations c
       join provider_outbox_jobs o on o.job_id = c.outbox_job_id
       where (o.status in ('PENDING','RETRY_WAIT') and o.next_visible_at <= now())
          or (o.status = 'CLAIMED' and o.lease_expires_at <= now())) as claimable,
      (select count(*)::int
       from ai_story_scene_scheduling_correlations c
       join provider_attempts a on a.execution_id = c.provider_execution_id) as attempts
  `);

  console.log(JSON.stringify({
    productionDb: "egkgybrjmzukzmkcrpag",
    dbIdentityMatch: true,
    serverlessPoolMaxOne: process.env.VERCEL === "1",
    openReviewReadPathMs,
    reviewOpenedRows: readPath.reviewOpenedRows,
    incidentStoryStatus: readPath.storyStatus,
    recoveryReadStatus: recoveryRead,
    failureClassificationFreshContextMs,
    claimableAiStoryOutboxes: Number(safety?.claimable ?? 0),
    aiStoryProviderAttempts: Number(safety?.attempts ?? 0),
  }));
}

void main().finally(() => closeDb());
