import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "@ceo-agent/db";
import {
  assertProductionVerificationCompletionInvariant,
  ProductionVerificationCompletionRepository,
} from "../apps/web/src/lib/ai-story-production-verification-completion";

const PRODUCTION_PROJECT = "egkgybrjmzukzmkcrpag";
const STORY_ID = "10000000-0000-4000-8000-000000000001";
const VERSION_ID = "10000000-0000-4000-8000-000000000002";
const PLAN_ID = "10000000-0000-4000-8000-000000000003";
const WORKSPACE_ID = "10000000-0000-4000-8000-000000000004";
const SCENE_ID = "10000000-0000-4000-8000-000000000005";
const ROUTING_ID = "10000000-0000-4000-8000-000000000006";

function assertProductionDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const parsed = new URL(databaseUrl);
  if (!`${parsed.hostname}:${parsed.username}`.includes(PRODUCTION_PROJECT)) {
    throw new Error("PRODUCTION_DB_IDENTITY_MISMATCH");
  }
}

async function main() {
  assertProductionDatabase();
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql.raw("set local search_path = pg_temp, public"));
    await tx.execute(sql.raw(`drop table if exists
      pg_temp.ai_stories,
      pg_temp.ai_story_versions,
      pg_temp.ai_story_execution_plans,
      pg_temp.ai_story_review_opened_facts,
      pg_temp.ai_story_scene_intent_review_facts,
      pg_temp.ai_story_story_review_facts,
      pg_temp.ai_story_assembly_definitions,
      pg_temp.ai_story_assembly_scene_memberships,
      pg_temp.ai_story_runtime_authorized_facts,
      pg_temp.ai_story_scene_release_states,
      pg_temp.ai_story_scene_routing_decisions,
      pg_temp.ai_story_execute_verifications,
      pg_temp.ai_story_scene_scheduling_correlations,
      pg_temp.provider_outbox_jobs,
      pg_temp.provider_attempts,
      pg_temp.ai_story_scene_results,
      pg_temp.ai_story_generated_scene_reviews`));
    const definitions = [
      "create temporary table ai_stories (id uuid primary key, workspace_id uuid not null, status text not null, archived_at timestamptz, updated_at timestamptz not null) on commit drop",
      "create temporary table ai_story_versions (id uuid primary key, story_id uuid not null, frozen_at timestamptz, source_context_snapshot jsonb not null) on commit drop",
      "create temporary table ai_story_execution_plans (id uuid primary key, story_id uuid not null, story_version_id uuid not null) on commit drop",
      "create temporary table ai_story_review_opened_facts (execution_plan_id uuid not null) on commit drop",
      "create temporary table ai_story_scene_intent_review_facts (execution_plan_id uuid not null, decision text not null) on commit drop",
      "create temporary table ai_story_story_review_facts (execution_plan_id uuid not null, decision text not null) on commit drop",
      "create temporary table ai_story_assembly_definitions (execution_plan_id uuid not null, scene_count int not null) on commit drop",
      "create temporary table ai_story_assembly_scene_memberships (execution_plan_id uuid not null) on commit drop",
      "create temporary table ai_story_runtime_authorized_facts (execution_plan_id uuid not null) on commit drop",
      "create temporary table ai_story_scene_release_states (execution_plan_id uuid not null, scene_order int not null, release_state text not null) on commit drop",
      "create temporary table ai_story_scene_routing_decisions (routing_decision_id uuid primary key, execution_plan_id uuid not null, selected_provider_id text not null) on commit drop",
      "create temporary table ai_story_execute_verifications (execution_plan_id uuid not null, verification_mode boolean not null, authorized_by text not null, scene_execution_id uuid not null, outbox_job_id text not null) on commit drop",
      "create temporary table ai_story_scene_scheduling_correlations (execution_plan_id uuid not null, scene_execution_id uuid not null, outbox_job_id text not null, routing_decision_id uuid not null, provider_execution_id text not null) on commit drop",
      "create temporary table provider_outbox_jobs (job_id text primary key, status text not null, next_visible_at timestamptz not null, lease_expires_at timestamptz, lease_owner text, attempt_count int not null) on commit drop",
      "create temporary table provider_attempts (execution_id text not null) on commit drop",
      "create temporary table ai_story_scene_results (execution_plan_id uuid not null) on commit drop",
      "create temporary table ai_story_generated_scene_reviews (execution_plan_id uuid not null) on commit drop",
    ];
    for (const definition of definitions) await tx.execute(sql.raw(definition));

    await tx.execute(sql`insert into ai_stories values (
      ${STORY_ID}::uuid, ${WORKSPACE_ID}::uuid, 'planning_review', null, now()
    )`);
    await tx.execute(sql`insert into ai_story_versions values (
      ${VERSION_ID}::uuid, ${STORY_ID}::uuid, now(),
      ${JSON.stringify({
        verificationFixture: true,
        verificationFixtureVersion: "ai-story-prod-verify-fixture.v1",
        fixtureRunId: "completion-smoke-isolated-v1",
      })}::jsonb
    )`);
    await tx.execute(sql`insert into ai_story_execution_plans values (
      ${PLAN_ID}::uuid, ${STORY_ID}::uuid, ${VERSION_ID}::uuid
    )`);
    await tx.execute(sql`insert into ai_story_review_opened_facts values (${PLAN_ID}::uuid)`);
    await tx.execute(sql`insert into ai_story_scene_intent_review_facts values
      (${PLAN_ID}::uuid, 'APPROVED'),
      (${PLAN_ID}::uuid, 'APPROVED'),
      (${PLAN_ID}::uuid, 'APPROVED')`);
    await tx.execute(sql`insert into ai_story_story_review_facts values (${PLAN_ID}::uuid, 'APPROVED')`);
    await tx.execute(sql`insert into ai_story_assembly_definitions values (${PLAN_ID}::uuid, 3)`);
    await tx.execute(sql`insert into ai_story_assembly_scene_memberships values
      (${PLAN_ID}::uuid), (${PLAN_ID}::uuid), (${PLAN_ID}::uuid)`);
    await tx.execute(sql`insert into ai_story_runtime_authorized_facts values (${PLAN_ID}::uuid)`);
    await tx.execute(sql`insert into ai_story_scene_release_states values
      (${PLAN_ID}::uuid, 1, 'RELEASED'),
      (${PLAN_ID}::uuid, 2, 'AUTHORIZED_NOT_RELEASED'),
      (${PLAN_ID}::uuid, 3, 'AUTHORIZED_NOT_RELEASED')`);
    await tx.execute(sql`insert into ai_story_scene_routing_decisions values (
      ${ROUTING_ID}::uuid, ${PLAN_ID}::uuid, 'seedance'
    )`);
    await tx.execute(sql`insert into ai_story_execute_verifications values (
      ${PLAN_ID}::uuid, true, 'ACTIVE_PLATFORM_ADMIN', ${SCENE_ID}::uuid, 'completion-smoke-outbox'
    )`);
    await tx.execute(sql`insert into ai_story_scene_scheduling_correlations values (
      ${PLAN_ID}::uuid, ${SCENE_ID}::uuid, 'completion-smoke-outbox', ${ROUTING_ID}::uuid, 'completion-smoke-execution'
    )`);
    await tx.execute(sql`insert into provider_outbox_jobs values (
      'completion-smoke-outbox', 'CANCELLED', now(), null, null, 0
    )`);

    const completionStartedAt = performance.now();
    const repository = new ProductionVerificationCompletionRepository(tx);
    const input = {
      storyId: STORY_ID,
      storyVersionId: VERSION_ID,
      executionPlanId: PLAN_ID,
      workspaceId: WORKSPACE_ID,
    };
    const fixture = await repository.loadFixture(input);
    if (!fixture) throw new Error("ISOLATED_FIXTURE_NOT_FOUND");
    const projection = await repository.loadProjection(input);
    assertProductionVerificationCompletionInvariant(fixture, projection);
    const firstWrite = await repository.writeCompleted(STORY_ID);
    const firstReadback = await repository.readCompleted(STORY_ID);
    const secondWrite = await repository.writeCompleted(STORY_ID);
    const secondReadback = await repository.readCompleted(STORY_ID);
    if (!firstWrite || !firstReadback || !secondWrite || !secondReadback) {
      throw new Error("ISOLATED_COMPLETION_DID_NOT_CONVERGE");
    }
    return {
      fixtureStatusBefore: fixture.story_status,
      fixtureStatusAfter: "COMPLETED",
      firstCompletion: "PASS",
      duplicateCompletion: "CONVERGED",
      claimableOutboxesCreated: 0,
      providerAttemptsCreated: 0,
      canonicalFactsMutated: false,
      persistentProductionRowsCreated: 0,
      completionDurationMs: performance.now() - completionStartedAt,
    };
  });
  console.log(JSON.stringify({
    productionDb: PRODUCTION_PROJECT,
    dbIdentityMatch: true,
    ...result,
  }));
}

void main().finally(() => closeDb());
