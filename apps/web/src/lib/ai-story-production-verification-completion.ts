import { performance } from "node:perf_hooks";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, withFreshDbContext, type QueryDb } from "@ceo-agent/db";

export type ProductionVerificationCompletionTimingKey =
  | "completion_projection_build_ms"
  | "fixture_row_lookup_ms"
  | "fixture_state_transition_validation_ms"
  | "fixture_completed_write_ms"
  | "fixture_completed_readback_ms"
  | "fixture_completed_commit_ms";

export type ProductionVerificationCompletionTiming = {
  readonly step: ProductionVerificationCompletionTimingKey;
  readonly durationMs: number;
  readonly outcome: "PASS" | "CONVERGED" | "FAIL";
};

export type ProductionVerificationCompletionResult = {
  readonly fixtureState: "COMPLETED";
  readonly storyStatus: "ready_for_execution";
  readonly converged: boolean;
  readonly connectionAcquireCount: 1;
  readonly transactionCount: 1;
  readonly secondCheckoutAttempts: 0;
  readonly serialDbRoundTripCount: number;
  readonly timings: readonly ProductionVerificationCompletionTiming[];
};

export class ProductionVerificationCompletionError extends Error {
  constructor(
    readonly code:
      | "PRODUCTION_VERIFICATION_FIXTURE_NOT_FOUND"
      | "PRODUCTION_VERIFICATION_CROSS_WORKSPACE_DENIED"
      | "PRODUCTION_VERIFICATION_COMPLETION_INVARIANT_FAILED"
      | "PRODUCTION_VERIFICATION_COMPLETION_WRITE_FAILED",
    message: string
  ) {
    super(message);
    this.name = "ProductionVerificationCompletionError";
  }
}

export type ProductionVerificationCompletionInput = {
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly executionPlanId: string;
  readonly workspaceId: string;
};

export type ProductionVerificationFixtureRow = {
  story_id: string;
  story_status: string;
  archived_at: Date | null;
  version_id: string;
  frozen_at: Date | null;
  verification_fixture: boolean;
  verification_fixture_version: string | null;
  fixture_run_id: string | null;
};

export type ProductionVerificationCompletionProjection = {
  review_open_count: number;
  approved_scene_intents: number;
  approved_story_reviews: number;
  assembly_count: number;
  assembly_scene_count: number;
  runtime_fact_count: number;
  release_row_count: number;
  released_scene_1_count: number;
  held_scene_2_count: number;
  held_scene_3_count: number;
  seedance_routing_count: number;
  verification_count: number;
  scheduling_correlation_count: number;
  outbox_count: number;
  terminal_outbox_count: number;
  claimable_outbox_count: number;
  leased_outbox_count: number;
  outbox_attempt_count: number;
  provider_attempt_count: number;
  generated_scene_result_count: number;
  generated_scene_review_count: number;
};

function numeric(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

async function timed<T>(
  timings: ProductionVerificationCompletionTiming[],
  step: ProductionVerificationCompletionTimingKey,
  operation: () => Promise<T>,
  converged = false
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await operation();
    timings.push({
      step,
      durationMs: performance.now() - startedAt,
      outcome: converged ? "CONVERGED" : "PASS",
    });
    return result;
  } catch (error) {
    timings.push({ step, durationMs: performance.now() - startedAt, outcome: "FAIL" });
    throw error;
  }
}

export class ProductionVerificationCompletionRepository {
  constructor(private readonly db: QueryDb) {}

  async loadFixture(input: ProductionVerificationCompletionInput): Promise<ProductionVerificationFixtureRow | null> {
    const [row] = await this.db.execute<ProductionVerificationFixtureRow>(sql`
      select
        s.id::text as story_id,
        s.status as story_status,
        s.archived_at,
        v.id::text as version_id,
        v.frozen_at,
        coalesce((v.source_context_snapshot->>'verificationFixture')::boolean, false)
          as verification_fixture,
        v.source_context_snapshot->>'verificationFixtureVersion'
          as verification_fixture_version,
        v.source_context_snapshot->>'fixtureRunId' as fixture_run_id
      from ai_stories s
      join ai_story_versions v on v.id = ${input.storyVersionId}::uuid
        and v.story_id = s.id
      join ai_story_execution_plans p on p.id = ${input.executionPlanId}::uuid
        and p.story_id = s.id
        and p.story_version_id = v.id
      where s.id = ${input.storyId}::uuid
        and s.workspace_id = ${input.workspaceId}::uuid
      limit 1
    `);
    return row ?? null;
  }

  async loadProjection(input: ProductionVerificationCompletionInput): Promise<ProductionVerificationCompletionProjection> {
    const [row] = await this.db.execute<ProductionVerificationCompletionProjection>(sql`
      select
        (select count(*)::int from ai_story_review_opened_facts r
          where r.execution_plan_id = ${input.executionPlanId}::uuid) as review_open_count,
        (select count(*)::int from ai_story_scene_intent_review_facts r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.decision = 'APPROVED') as approved_scene_intents,
        (select count(*)::int from ai_story_story_review_facts r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.decision = 'APPROVED') as approved_story_reviews,
        (select count(*)::int from ai_story_assembly_definitions a
          where a.execution_plan_id = ${input.executionPlanId}::uuid
            and a.scene_count = 3) as assembly_count,
        (select count(*)::int from ai_story_assembly_scene_memberships a
          where a.execution_plan_id = ${input.executionPlanId}::uuid) as assembly_scene_count,
        (select count(*)::int from ai_story_runtime_authorized_facts a
          where a.execution_plan_id = ${input.executionPlanId}::uuid) as runtime_fact_count,
        (select count(*)::int from ai_story_scene_release_states r
          where r.execution_plan_id = ${input.executionPlanId}::uuid) as release_row_count,
        (select count(*)::int from ai_story_scene_release_states r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.scene_order = 1 and r.release_state = 'RELEASED') as released_scene_1_count,
        (select count(*)::int from ai_story_scene_release_states r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.scene_order = 2 and r.release_state = 'AUTHORIZED_NOT_RELEASED') as held_scene_2_count,
        (select count(*)::int from ai_story_scene_release_states r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.scene_order = 3 and r.release_state = 'AUTHORIZED_NOT_RELEASED') as held_scene_3_count,
        (select count(*)::int from ai_story_scene_routing_decisions r
          where r.execution_plan_id = ${input.executionPlanId}::uuid
            and r.selected_provider_id = 'seedance') as seedance_routing_count,
        (select count(*)::int from ai_story_execute_verifications v
          where v.execution_plan_id = ${input.executionPlanId}::uuid
            and v.verification_mode = true
            and v.authorized_by = 'ACTIVE_PLATFORM_ADMIN') as verification_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join ai_story_execute_verifications v
            on v.execution_plan_id = c.execution_plan_id
           and v.scene_execution_id = c.scene_execution_id
           and v.outbox_job_id = c.outbox_job_id
          join ai_story_scene_routing_decisions r
            on r.routing_decision_id = c.routing_decision_id
           and r.execution_plan_id = c.execution_plan_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid) as scheduling_correlation_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join provider_outbox_jobs o on o.job_id = c.outbox_job_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid) as outbox_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join provider_outbox_jobs o on o.job_id = c.outbox_job_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid
            and o.status = 'CANCELLED') as terminal_outbox_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join provider_outbox_jobs o on o.job_id = c.outbox_job_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid
            and ((o.status in ('PENDING', 'RETRY_WAIT') and o.next_visible_at <= now())
              or (o.status = 'CLAIMED' and o.lease_expires_at <= now()))) as claimable_outbox_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join provider_outbox_jobs o on o.job_id = c.outbox_job_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid
            and (o.lease_owner is not null or o.lease_expires_at is not null)) as leased_outbox_count,
        (select coalesce(sum(o.attempt_count), 0)::int
          from ai_story_scene_scheduling_correlations c
          join provider_outbox_jobs o on o.job_id = c.outbox_job_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid) as outbox_attempt_count,
        (select count(*)::int from ai_story_scene_scheduling_correlations c
          join provider_attempts a on a.execution_id = c.provider_execution_id
          where c.execution_plan_id = ${input.executionPlanId}::uuid) as provider_attempt_count,
        (select count(*)::int from ai_story_scene_results r
          where r.execution_plan_id = ${input.executionPlanId}::uuid) as generated_scene_result_count,
        (select count(*)::int from ai_story_generated_scene_reviews r
          where r.execution_plan_id = ${input.executionPlanId}::uuid) as generated_scene_review_count
    `);
    if (!row) {
      throw new ProductionVerificationCompletionError(
        "PRODUCTION_VERIFICATION_COMPLETION_INVARIANT_FAILED",
        "Verification completion projection was not returned"
      );
    }
    return row;
  }

  async writeCompleted(storyId: string): Promise<boolean> {
    const rows = await this.db
      .update(schema.aiStories)
      .set({ status: "ready_for_execution", updatedAt: new Date() })
      .where(and(
        eq(schema.aiStories.id, storyId),
        isNull(schema.aiStories.archivedAt),
        inArray(schema.aiStories.status, ["planning_review", "ready_for_execution"])
      ))
      .returning({ id: schema.aiStories.id });
    return rows.length === 1;
  }

  async readCompleted(storyId: string): Promise<boolean> {
    const [story] = await this.db
      .select({ id: schema.aiStories.id })
      .from(schema.aiStories)
      .where(and(
        eq(schema.aiStories.id, storyId),
        eq(schema.aiStories.status, "ready_for_execution"),
        isNull(schema.aiStories.archivedAt)
      ))
      .limit(1);
    return Boolean(story);
  }
}

export function assertProductionVerificationCompletionInvariant(
  row: ProductionVerificationFixtureRow,
  projection: ProductionVerificationCompletionProjection
): void {
  const counts = {
    reviewOpen: numeric(projection.review_open_count),
    approvedIntents: numeric(projection.approved_scene_intents),
    approvedStory: numeric(projection.approved_story_reviews),
    assembly: numeric(projection.assembly_count),
    assemblyScenes: numeric(projection.assembly_scene_count),
    runtimeFacts: numeric(projection.runtime_fact_count),
    releases: numeric(projection.release_row_count),
    scene1Released: numeric(projection.released_scene_1_count),
    scene2Held: numeric(projection.held_scene_2_count),
    scene3Held: numeric(projection.held_scene_3_count),
    routing: numeric(projection.seedance_routing_count),
    verification: numeric(projection.verification_count),
    correlation: numeric(projection.scheduling_correlation_count),
    outboxes: numeric(projection.outbox_count),
    terminalOutboxes: numeric(projection.terminal_outbox_count),
    claimableOutboxes: numeric(projection.claimable_outbox_count),
    leasedOutboxes: numeric(projection.leased_outbox_count),
    outboxAttempts: numeric(projection.outbox_attempt_count),
    providerAttempts: numeric(projection.provider_attempt_count),
    generatedResults: numeric(projection.generated_scene_result_count),
    generatedReviews: numeric(projection.generated_scene_review_count),
  };
  const valid =
    row.verification_fixture === true &&
    row.verification_fixture_version === "ai-story-prod-verify-fixture.v1" &&
    Boolean(row.fixture_run_id) &&
    Boolean(row.frozen_at) &&
    row.archived_at === null &&
    ["planning_review", "ready_for_execution"].includes(row.story_status) &&
    counts.reviewOpen === 1 &&
    counts.approvedIntents === 3 &&
    counts.approvedStory === 1 &&
    counts.assembly === 1 &&
    counts.assemblyScenes === 3 &&
    counts.runtimeFacts === 1 &&
    counts.releases === 3 &&
    counts.scene1Released === 1 &&
    counts.scene2Held === 1 &&
    counts.scene3Held === 1 &&
    counts.routing === 1 &&
    counts.verification === 1 &&
    counts.correlation === 1 &&
    counts.outboxes === 1 &&
    counts.terminalOutboxes === 1 &&
    counts.claimableOutboxes === 0 &&
    counts.leasedOutboxes === 0 &&
    counts.outboxAttempts === 0 &&
    counts.providerAttempts === 0 &&
    counts.generatedResults === 0 &&
    counts.generatedReviews === 0;
  if (!valid) {
    throw new ProductionVerificationCompletionError(
      "PRODUCTION_VERIFICATION_COMPLETION_INVARIANT_FAILED",
      "Persisted zero-provider verification authority is incomplete or unsafe"
    );
  }
}

export type ProductionVerificationCompletionWriter = (
  input: ProductionVerificationCompletionInput
) => Promise<ProductionVerificationCompletionResult>;

const writeCompletionWithFreshDb: ProductionVerificationCompletionWriter = async (input) => {
  const timings: ProductionVerificationCompletionTiming[] = [];
  let transactionBodyCompletedAt = performance.now();
  const completed = await withFreshDbContext(async (freshDb) => {
    const result = await freshDb.transaction(async (tx) => {
      const repository = new ProductionVerificationCompletionRepository(tx);
      const fixture = await timed(timings, "fixture_row_lookup_ms", () =>
        repository.loadFixture(input)
      );
      if (!fixture) {
        throw new ProductionVerificationCompletionError(
          "PRODUCTION_VERIFICATION_FIXTURE_NOT_FOUND",
          "Verification fixture ownership chain was not found"
        );
      }
      if (fixture.story_id !== input.storyId || fixture.version_id !== input.storyVersionId) {
        throw new ProductionVerificationCompletionError(
          "PRODUCTION_VERIFICATION_CROSS_WORKSPACE_DENIED",
          "Verification fixture ownership chain does not match the requested workspace"
        );
      }
      const projection = await timed(timings, "completion_projection_build_ms", () =>
        repository.loadProjection(input)
      );
      await timed(timings, "fixture_state_transition_validation_ms", async () => {
        assertProductionVerificationCompletionInvariant(fixture, projection);
      });
      const converged = fixture.story_status === "ready_for_execution";
      const written = await timed(
        timings,
        "fixture_completed_write_ms",
        () => repository.writeCompleted(input.storyId),
        converged
      );
      if (!written) {
        throw new ProductionVerificationCompletionError(
          "PRODUCTION_VERIFICATION_COMPLETION_WRITE_FAILED",
          "Verification fixture completion write did not update the expected Story"
        );
      }
      const readback = await timed(timings, "fixture_completed_readback_ms", () =>
        repository.readCompleted(input.storyId)
      );
      if (!readback) {
        throw new ProductionVerificationCompletionError(
          "PRODUCTION_VERIFICATION_COMPLETION_WRITE_FAILED",
          "Verification fixture completion readback did not converge"
        );
      }
      transactionBodyCompletedAt = performance.now();
      return { converged };
    });
    timings.push({
      step: "fixture_completed_commit_ms",
      durationMs: performance.now() - transactionBodyCompletedAt,
      outcome: "PASS",
    });
    return result;
  });
  console.info(JSON.stringify({
    event: "AI_STORY_PROD_VERIFY_COMPLETION_BOUNDARY_COMPLETED",
    storyId: input.storyId,
    executionPlanId: input.executionPlanId,
    connectionAcquireCount: 1,
    transactionCount: 1,
    secondCheckoutAttempts: 0,
    serialDbRoundTripCount: 4,
    converged: completed.converged,
    timings,
  }));
  return {
    fixtureState: "COMPLETED",
    storyStatus: "ready_for_execution",
    converged: completed.converged,
    connectionAcquireCount: 1,
    transactionCount: 1,
    secondCheckoutAttempts: 0,
    serialDbRoundTripCount: 4,
    timings,
  };
};

export async function completeProductionVerificationFixture(
  input: ProductionVerificationCompletionInput,
  options: { readonly writer?: ProductionVerificationCompletionWriter } = {}
): Promise<ProductionVerificationCompletionResult> {
  return (options.writer ?? writeCompletionWithFreshDb)(input);
}
