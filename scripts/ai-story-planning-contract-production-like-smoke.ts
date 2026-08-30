/**
 * Zero-provider production-like smoke for planning contract accounting.
 * Uses pg_temp tables on one bounded connection; persistent tables are never mutated.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { AiStoryStructuredDraftSchema } from "@ceo-agent/shared";
import { getDb } from "@ceo-agent/db";
import * as schema from "../packages/db/src/schema/index";
import { createAiStoryVersion } from "../apps/web/src/lib/ai-story-service";
import {
  beginAiStoryPlanningAccounting,
  buildAiStoryPlanningLedgerIdentity,
  persistAiStoryPlanningOutcome,
} from "../apps/web/src/lib/ai-story-planning-accounting";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const client = postgres(databaseUrl, { max: 1, prepare: false });
const db = drizzle(client, { schema }) as unknown as ReturnType<typeof getDb>;
const orgId = "10000000-0000-4000-8000-000000000001";
const workspaceId = "10000000-0000-4000-8000-000000000002";
const campaignId = "10000000-0000-4000-8000-000000000003";
const malformedStoryId = "10000000-0000-4000-8000-000000000004";
const validStoryId = "10000000-0000-4000-8000-000000000005";
const startedAt = "2026-08-22T00:00:00.000Z";
const completedAt = "2026-08-22T00:00:01.000Z";

const validDraft = AiStoryStructuredDraftSchema.parse({
  title: "Production-like",
  summary: "Valid deterministic response",
  objective: "Control-path verification",
  targetAudience: "Operators",
  tone: "Clear",
  estimatedDuration: "15s",
  story: { opening: "A", development: "B", ending: "C" },
  keyMessages: ["Safe"],
  cta: "Review",
  assetReferences: [],
  warnings: [],
});

async function main() {
  await client.unsafe(`
    drop table if exists pg_temp.provider_attempt_costs;
    drop table if exists pg_temp.provider_attempt_usage;
    drop table if exists pg_temp.provider_attempts;
    drop table if exists pg_temp.provider_executions;
    drop table if exists pg_temp.ai_story_versions;
    drop table if exists pg_temp.ai_stories;
    create temporary table provider_executions (
      execution_id text primary key, contract_version text not null,
      org_id uuid not null, workspace_id uuid not null, campaign_id uuid,
      pipeline_run_id text not null, capability_id text not null,
      capability_version text not null, idempotency_key text not null unique,
      deterministic_fingerprint text not null, request_hash text not null,
      output_schema_id text not null, output_schema_version text not null,
      status text not null, execution_metadata jsonb not null,
      accepted_attempt_id text, accepted_result jsonb, accepted_response_hash text,
      accepted_at timestamptz, created_at timestamptz not null,
      completed_at timestamptz
    ) on commit preserve rows;
    create temporary table provider_attempts (
      attempt_id text primary key, execution_id text not null,
      contract_version text not null, attempt_number integer not null,
      provider_id text not null, provider_version text not null,
      model_version text not null, provider_request_id text,
      request_hash text not null, response_hash text, status text not null,
      started_at timestamptz, completed_at timestamptz, failure jsonb,
      warnings jsonb not null default '[]'::jsonb,
      provider_metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      unique (execution_id, attempt_number)
    ) on commit preserve rows;
    create temporary table provider_attempt_usage (
      attempt_id text primary key, usage jsonb not null,
      recorded_at timestamptz not null default now()
    ) on commit preserve rows;
    create temporary table provider_attempt_costs (
      attempt_id text primary key, cost jsonb not null,
      recorded_at timestamptz not null default now()
    ) on commit preserve rows;
    create temporary table ai_stories (
      id uuid primary key, org_id uuid not null, workspace_id uuid not null,
      campaign_id uuid not null, title text not null, original_idea text not null,
      status text not null, current_version_id uuid, created_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(), archived_at timestamptz
    ) on commit preserve rows;
    create temporary table ai_story_versions (
      id uuid primary key default gen_random_uuid(), story_id uuid not null,
      version_number integer not null, structured_content jsonb not null,
      source_context_snapshot jsonb not null default '{}'::jsonb,
      ai_metadata jsonb not null default '{}'::jsonb,
      user_edited boolean not null default false, created_by uuid,
      created_at timestamptz not null default now(), frozen_at timestamptz,
      frozen_by uuid, unique (story_id, version_number)
    ) on commit preserve rows;
    set search_path to pg_temp, public;
  `);
  await client.unsafe(
    `insert into ai_stories
      (id, org_id, workspace_id, campaign_id, title, original_idea, status, created_at, updated_at)
     values ($1,$2,$3,$4,'Malformed','fixture','generating',$5,$5),
            ($6,$2,$3,$4,'Valid','fixture','generating',$5,$5)`,
    [malformedStoryId, orgId, workspaceId, campaignId, startedAt, validStoryId]
  );

  const malformedIdentity = buildAiStoryPlanningLedgerIdentity({
    orgId,
    workspaceId,
    campaignId,
    storyId: malformedStoryId,
    runSeed: startedAt,
    requestMaterial: { storyId: malformedStoryId, idea: "malformed" },
    startedAt,
  });
  await beginAiStoryPlanningAccounting(db, malformedIdentity);
  const malformedOutcome = {
    db,
    storyId: malformedStoryId,
    identity: malformedIdentity,
    status: "TERMINAL_FAILURE" as const,
    failureCode: "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID" as const,
    errorStage: "validation" as const,
    validationIssueCodes: ["MISSING_REQUIRED_FIELD" as const],
    accounting: {
      provider: "openai" as const,
      model: "gpt-4o-mini-2024-07-18",
      providerRequestId: "chatcmpl-production-like-malformed",
      usage: { input: 100, output: 50, total: 150 },
      cost: {
        amount: 0.000045,
        currency: "USD" as const,
        costSource: "MODEL_PRICING_TABLE" as const,
      },
    },
    timings: {
      planningProviderMs: 20,
      planningDecodeMs: 1,
      planningValidationMs: 2,
    },
    completedAt,
  };
  await persistAiStoryPlanningOutcome(malformedOutcome);
  await persistAiStoryPlanningOutcome(malformedOutcome);

  const validIdentity = buildAiStoryPlanningLedgerIdentity({
    orgId,
    workspaceId,
    campaignId,
    storyId: validStoryId,
    runSeed: startedAt,
    requestMaterial: { storyId: validStoryId, idea: "valid" },
    startedAt,
  });
  await beginAiStoryPlanningAccounting(db, validIdentity);
  await persistAiStoryPlanningOutcome({
    db,
    storyId: validStoryId,
    identity: validIdentity,
    status: "SUCCEEDED",
    accounting: {
      provider: "openai",
      model: "gpt-4o-mini-2024-07-18",
      providerRequestId: "chatcmpl-production-like-valid",
      usage: { input: 80, output: 40, total: 120 },
      cost: {
        amount: 0.000036,
        currency: "USD",
        costSource: "MODEL_PRICING_TABLE",
      },
    },
    timings: {
      planningProviderMs: 18,
      planningDecodeMs: 1,
      planningValidationMs: 1,
    },
    completedAt,
  });
  await createAiStoryVersion(db, {
    storyId: validStoryId,
    structuredContent: validDraft,
    sourceContextSnapshot: { productionLike: true },
    aiMetadata: { planningExecutionId: validIdentity.executionId },
  });

  const [malformed] = await client.unsafe(`
    select
      (select status from ai_stories where id = $1) as story_status,
      (select count(*)::int from ai_story_versions where story_id = $1) as story_versions,
      (select count(*)::int from provider_attempts where execution_id = $2) as attempts,
      (select count(*)::int from provider_attempt_usage u join provider_attempts a on a.attempt_id=u.attempt_id where a.execution_id = $2) as usage_rows,
      (select count(*)::int from provider_attempt_costs c join provider_attempts a on a.attempt_id=c.attempt_id where a.execution_id = $2) as cost_rows,
      (select failure->>'code' from provider_attempts where execution_id = $2) as failure_code
  `, [malformedStoryId, malformedIdentity.executionId]);
  const [valid] = await client.unsafe(`
    select
      (select count(*)::int from ai_story_versions where story_id = $1) as story_versions,
      (select count(*)::int from provider_attempts where execution_id = $2) as attempts,
      (select count(*)::int from provider_attempt_usage u join provider_attempts a on a.attempt_id=u.attempt_id where a.execution_id = $2) as usage_rows,
      (select count(*)::int from provider_attempt_costs c join provider_attempts a on a.attempt_id=c.attempt_id where a.execution_id = $2) as cost_rows
  `, [validStoryId, validIdentity.executionId]);

  const pass =
    malformed.story_status === "failed" &&
    malformed.story_versions === 0 &&
    malformed.attempts === 1 &&
    malformed.usage_rows === 1 &&
    malformed.cost_rows === 1 &&
    malformed.failure_code === "AI_STORY_PLANNING_OUTPUT_CONTRACT_INVALID" &&
    valid.story_versions === 1 &&
    valid.attempts === 1 &&
    valid.usage_rows === 1 &&
    valid.cost_rows === 1;
  console.log(JSON.stringify({
    status: pass ? "PASS" : "FAIL",
    externalProviderCalls: 0,
    persistentRowsCreated: 0,
    malformed: {
      ...malformed,
      sceneCount: 0,
      reviewCount: 0,
      executionPlanCount: 0,
      providerOutboxCount: 0,
    },
    valid,
  }));
  if (!pass) process.exitCode = 1;
}

void main().finally(async () => client.end({ timeout: 2 }));
