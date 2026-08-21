import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  authorizeAiStoryExecution,
  authorizeAndExecuteExecutionPlan,
  createGenerateReview,
  type AiStoryExecutionAuthorizationTimings,
  type RuntimeAuthorizationBoundaryTimings,
} from "@ceo-agent/agents";
import {
  closeDb,
  ExecutionPlanAssemblyRepository,
  ExecutionPlanReviewRepository,
  getDb,
  schema,
} from "@ceo-agent/db";
import {
  AiStoryStructuredDraftSchema,
  AnimationPackagePayloadSchema,
} from "@ceo-agent/shared";
import {
  createAiStoryVersion,
  freezeAiStoryVersion,
  setAiStoryStatus,
} from "../apps/web/src/lib/ai-story-service";
import {
  approveAnimationPackage,
  saveAnimationPackage,
} from "../apps/web/src/lib/ai-story-planning-service";

const PRODUCTION_PROJECT = "egkgybrjmzukzmkcrpag";
const CAMPAIGN_ID = "8d1bdda0-fabc-48b2-9936-cc16224f98e3";
const INCIDENT_FIXTURE_ID = "1260d513-de7c-4be5-9cc2-e09f27ca4b55";
const INCIDENT_STORY_ID = "c74c10b4-365c-43dd-bc0c-f5ebaec48244";
const INCIDENT_EXECUTION_PLAN_ID = "6d238436-0ccb-5ae1-ade0-dbd5cfad6194";
const OPERATOR_EMAIL = "kahliant@gmail.com";
const SMOKE_VERSION = "ai-story-runtime-auth-first-write-smoke.v1";

class StopBeforeRelease extends Error {
  constructor() {
    super("RUNTIME_AUTH_FIRST_WRITE_SMOKE_STOP_BEFORE_RELEASE");
    this.name = "StopBeforeRelease";
  }
}

type SourceAuthority = {
  source_story_id: string;
  structured_content: unknown;
  package_payload: unknown;
};

type AuthUser = { id: string; email: string | null };

function assertProductionDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(databaseUrl);
  if (!`${parsed.hostname}:${parsed.username}`.includes(PRODUCTION_PROJECT)) {
    throw new Error("PRODUCTION_DB_IDENTITY_MISMATCH");
  }
}

async function authorityCounts(executionPlanId: string) {
  const [row] = await getDb().execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from ai_story_runtime_authorized_facts where execution_plan_id=${executionPlanId}::uuid) as runtime_facts,
      (select count(*)::int from ai_story_execute_verifications where execution_plan_id=${executionPlanId}::uuid) as verifications,
      (select count(*)::int from ai_story_scene_release_states where execution_plan_id=${executionPlanId}::uuid) as releases,
      (select count(*)::int from ai_story_scene_routing_decisions where execution_plan_id=${executionPlanId}::uuid) as routing,
      (select count(*)::int from ai_story_scene_scheduling_correlations where execution_plan_id=${executionPlanId}::uuid) as correlations,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_outbox_jobs o on o.job_id=c.outbox_job_id where c.execution_plan_id=${executionPlanId}::uuid) as outboxes,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_attempts a on a.execution_id=c.provider_execution_id where c.execution_plan_id=${executionPlanId}::uuid) as attempts,
      (select count(*)::int from ai_story_scene_scheduling_correlations c join provider_outbox_jobs o on o.job_id=c.outbox_job_id where c.execution_plan_id=${executionPlanId}::uuid and ((o.status in ('PENDING','RETRY_WAIT') and o.next_visible_at<=now()) or (o.status='CLAIMED' and o.lease_expires_at<=now()))) as claimable_outboxes
  `);
  return row;
}

async function firstWriteDbAnalysis(executionPlanId: string) {
  const [indexRow] = await getDb().execute<{
    plan_unique: boolean;
    hash_unique: boolean;
  }>(sql`
    select
      exists (
        select 1 from pg_indexes
         where schemaname = current_schema()
           and tablename = 'ai_story_runtime_authorized_facts'
           and indexname = 'ai_story_runtime_auth_plan_unique'
           and indexdef ilike '%unique%execution_plan_id%'
      ) as plan_unique,
      exists (
        select 1 from pg_indexes
         where schemaname = current_schema()
           and tablename = 'ai_story_runtime_authorized_facts'
           and indexname = 'ai_story_runtime_auth_hash_unique'
           and indexdef ilike '%unique%deterministic_integrity_hash%'
      ) as hash_unique
  `);
  const [lockRow] = await getDb().execute<{ lock_waits: number }>(sql`
    select count(*)::int as lock_waits
      from pg_stat_activity
     where pid <> pg_backend_pid()
       and wait_event_type = 'Lock'
       and query ilike '%ai_story_runtime_authorized_facts%'
  `);
  const lookupPlan = await getDb().execute<Record<string, unknown>>(sql`
    explain (format json)
    select runtime_authorization_id
      from ai_story_runtime_authorized_facts
     where execution_plan_id = ${executionPlanId}::uuid
     limit 1
  `);
  return {
    uniqueConstraint: Boolean(indexRow?.plan_unique && indexRow?.hash_unique),
    conflictTarget: Boolean(indexRow?.plan_unique && indexRow?.hash_unique),
    lockWait: Number(lockRow?.lock_waits ?? 0) > 0,
    lookupPlanPresent: lookupPlan.length > 0,
  };
}

async function loadOperator(): Promise<AuthUser> {
  const [user] = await getDb().execute<AuthUser>(sql`
    select id::text, email
      from auth.users
     where lower(email) = lower(${OPERATOR_EMAIL})
     limit 1
  `);
  if (!user) throw new Error("PRODUCTION_OPERATOR_AUTH_USER_NOT_FOUND");
  return user;
}

async function loadSafeFixtureSource(): Promise<SourceAuthority> {
  const [source] = await getDb().execute<SourceAuthority>(sql`
    select
      s.id::text as source_story_id,
      v.structured_content,
      p.payload as package_payload
    from ai_stories s
    join ai_story_versions v on v.id = s.current_version_id
    join ai_story_animation_packages p
      on p.story_id = s.id
     and p.story_version_id = v.id
    where s.campaign_id = ${CAMPAIGN_ID}::uuid
      and s.id <> ${INCIDENT_STORY_ID}::uuid
      and v.frozen_at is not null
      and p.status = 'ready_for_execution'
      and coalesce(v.source_context_snapshot->>'verificationFixture', '') = 'true'
    order by p.approved_at desc nulls last, p.created_at desc
    limit 1
  `);
  if (!source) throw new Error("SAFE_VERIFICATION_SOURCE_AUTHORITY_NOT_FOUND");
  return source;
}

async function createFreshApprovedPlan(actor: AuthUser) {
  const db = getDb();
  const [campaign] = await db.select().from(schema.campaigns)
    .where(eq(schema.campaigns.id, CAMPAIGN_ID)).limit(1);
  if (!campaign) throw new Error("PRODUCTION_CAMPAIGN_NOT_FOUND");

  const source = await loadSafeFixtureSource();
  if (source.source_story_id === INCIDENT_STORY_ID) {
    throw new Error("INCIDENT_FIXTURE_SOURCE_DENIED");
  }
  const structuredContent = AiStoryStructuredDraftSchema.parse(source.structured_content);
  const packagePayload = AnimationPackagePayloadSchema.parse(source.package_payload);
  const runId = randomUUID();
  const [story] = await db.insert(schema.aiStories).values({
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    title: "Runtime Authorization First-Write Production Smoke",
    originalIdea: "PRODUCTION_RUNTIME_AUTH_FIRST_WRITE_SMOKE",
    status: "review",
    createdBy: actor.id,
  }).returning();
  if (!story) throw new Error("SMOKE_STORY_CREATE_FAILED");

  const version = await createAiStoryVersion(db, {
    storyId: story.id,
    structuredContent,
    sourceContextSnapshot: {
      runtimeAuthorizationFirstWriteSmoke: true,
      runtimeAuthorizationFirstWriteSmokeVersion: SMOKE_VERSION,
      smokeRunId: runId,
      sourceVerificationStoryId: source.source_story_id,
      incidentFixtureIdExcluded: INCIDENT_FIXTURE_ID,
      purpose: "FRESH_PLAN_RUNTIME_AUTHORIZED_FACT_FIRST_WRITE",
    },
    aiMetadata: { externalAiCalls: 0, generatedBy: "SERVER_OPERATOR_SMOKE" },
    userEdited: false,
    createdBy: actor.id,
  });
  await freezeAiStoryVersion(db, {
    storyId: story.id,
    versionId: version.id,
    frozenBy: actor.id,
    fromStatus: "review",
  });
  const pkg = await saveAnimationPackage(db, {
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
    storyId: story.id,
    storyVersionId: version.id,
    payload: packagePayload,
  });
  await setAiStoryStatus(db, story.id, "ready_for_animation", "planning");
  await setAiStoryStatus(db, story.id, "planning", "planning_review");
  const approvedPackage = await approveAnimationPackage(db, {
    packageId: pkg.id,
    campaignId: campaign.id,
    storyId: story.id,
    workspaceId: campaign.workspaceId,
    approvedBy: actor.id,
  });
  const generated = await createGenerateReview({
    db,
    campaignId: campaign.id,
    storyId: story.id,
    workspaceId: campaign.workspaceId,
    orgId: campaign.orgId,
  });
  if (!generated.storyExecutionId || generated.sceneExecutionIds.length !== 3) {
    throw new Error("SMOKE_PLAN_NOT_EXACTLY_THREE_SCENES");
  }
  if (generated.storyExecutionId === INCIDENT_EXECUTION_PLAN_ID) {
    throw new Error("INCIDENT_EXECUTION_PLAN_REUSE_DENIED");
  }

  const review = new ExecutionPlanReviewRepository(db);
  await review.openReview({ executionPlanId: generated.storyExecutionId, openedBy: actor.id });
  for (const sceneExecutionId of generated.sceneExecutionIds) {
    await review.appendSceneIntentDecision({
      executionPlanId: generated.storyExecutionId,
      sceneExecutionId,
      decision: "APPROVED",
      reviewedBy: actor.id,
      rationale: SMOKE_VERSION,
    });
  }
  await review.appendStoryDecision({
    executionPlanId: generated.storyExecutionId,
    decision: "APPROVED",
    reviewedBy: actor.id,
    rationale: SMOKE_VERSION,
  });
  await new ExecutionPlanAssemblyRepository(db).createOrReturnAssembly({
    executionPlanId: generated.storyExecutionId,
    createdBy: actor.id,
    orderedSceneExecutionIds: generated.sceneExecutionIds,
  });

  return {
    runId,
    storyId: story.id,
    storyVersionId: version.id,
    animationPackageId: approvedPackage.id,
    executionPlanId: generated.storyExecutionId,
    orgId: campaign.orgId,
    workspaceId: campaign.workspaceId,
    campaignId: campaign.id,
  };
}

async function main() {
  assertProductionDatabase();
  const actor = await loadOperator();
  const incidentBefore = await authorityCounts(INCIDENT_EXECUTION_PLAN_ID);
  const smoke = await createFreshApprovedPlan(actor);
  const before = await authorityCounts(smoke.executionPlanId);
  if (Number(before.runtime_facts) !== 0) {
    throw new Error("SMOKE_PLAN_NOT_FRESH");
  }
  const dbAnalysis = await firstWriteDbAnalysis(smoke.executionPlanId);
  if (!dbAnalysis.uniqueConstraint || !dbAnalysis.conflictTarget || dbAnalysis.lockWait) {
    throw new Error("SMOKE_FIRST_WRITE_DB_ANALYSIS_FAILED");
  }

  let executionAuthorizationTimings: AiStoryExecutionAuthorizationTimings | null = null;
  const executionAuthorization = await authorizeAiStoryExecution({
    user: actor,
    orgId: smoke.orgId,
    workspaceId: smoke.workspaceId,
    minRole: "operator",
    clientClaims: {},
    observeAuthorizationBoundary: (value) => { executionAuthorizationTimings = value; },
  });
  if (
    executionAuthorization.authorizedBy !== "ACTIVE_PLATFORM_ADMIN" ||
    executionAuthorization.accessMode !== "ops" ||
    executionAuthorization.settlementMode !== "none"
  ) {
    throw new Error("SMOKE_EXECUTION_AUTHORITY_INVALID");
  }

  let runtimeAuthorizationTimings: RuntimeAuthorizationBoundaryTimings | null = null;
  let stoppedBeforeRelease = false;
  const firstWriteStartedAt = performance.now();
  try {
    await authorizeAndExecuteExecutionPlan({
      executionPlanId: smoke.executionPlanId,
      actorUserId: actor.id,
      ownership: {
        orgId: smoke.orgId,
        workspaceId: smoke.workspaceId,
        campaignId: smoke.campaignId,
        storyId: smoke.storyId,
        storyVersionId: smoke.storyVersionId,
        animationPackageId: smoke.animationPackageId,
        executionPlanId: smoke.executionPlanId,
      },
      router: {} as never,
      executionAuthorization,
      observeRuntimeAuthorizationBoundary: (value) => { runtimeAuthorizationTimings = value; },
      sceneReleaseRepository: {
        initialize: async () => { throw new StopBeforeRelease(); },
      } as never,
    });
  } catch (error) {
    if (!(error instanceof StopBeforeRelease)) throw error;
    stoppedBeforeRelease = true;
  }
  const firstWriteDurationMs = Math.round((performance.now() - firstWriteStartedAt) * 100) / 100;
  const after = await authorityCounts(smoke.executionPlanId);
  const incidentAfter = await authorityCounts(INCIDENT_EXECUTION_PLAN_ID);
  const connectionLeakProbeStartedAt = performance.now();
  await getDb().execute(sql`select 1`);
  const connectionLeakProbeMs = Math.round(
    (performance.now() - connectionLeakProbeStartedAt) * 100
  ) / 100;

  const passed =
    stoppedBeforeRelease &&
    Number(before.runtime_facts) === 0 &&
    Number(after.runtime_facts) === 1 &&
    Number(after.verifications) === 0 &&
    Number(after.releases) === 0 &&
    Number(after.routing) === 0 &&
    Number(after.correlations) === 0 &&
    Number(after.outboxes) === 0 &&
    Number(after.attempts) === 0 &&
    Number(after.claimable_outboxes) === 0 &&
    firstWriteDurationMs < 15_000 &&
    JSON.stringify(incidentBefore) === JSON.stringify(incidentAfter);
  if (!passed) throw new Error("PRODUCTION_FIRST_WRITE_SMOKE_INVARIANT_FAILED");

  console.log(JSON.stringify({
    result: "PASS",
    productionDb: PRODUCTION_PROJECT,
    smokeRunId: smoke.runId,
    smokeStoryId: smoke.storyId,
    smokeExecutionPlanId: smoke.executionPlanId,
    stoppedBeforeRelease,
    executionAuthorization: {
      authorizedBy: executionAuthorization.authorizedBy,
      accessMode: executionAuthorization.accessMode,
      settlementMode: executionAuthorization.settlementMode,
    },
    executionAuthorizationTimings,
    runtimeAuthorizationTimings,
    firstWriteDurationMs,
    before,
    after,
    incidentUnchanged: true,
    dbAnalysis,
    connectionLeakProbeMs,
    externalAiProviderCalls: 0,
  }));
}

void main().finally(() => closeDb());
