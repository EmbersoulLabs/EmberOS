import { eq, sql } from "drizzle-orm";
import {
  PostTerminalProviderRetryAuthorizationFactSchema,
  validateExecutionDispatch,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import {
  AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION,
} from "./ai-story-pre-dispatch-bundle-supersession";
import { canonicalPersistenceHash } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export type ReviewRetryTerminalityEvidence = {
  readonly historicalSceneResultExists: boolean;
  readonly latestHumanReview: "APPROVED" | "REJECTED" | "PENDING_REVIEW" | null;
  readonly validLaterReviewRetryLineage: boolean;
  readonly currentProviderAttemptExists: boolean;
  readonly currentWorkerResultExists: boolean;
  readonly currentSceneResultExists: boolean;
  readonly currentDispatchAlreadyTerminal: boolean;
  readonly anotherExecutableSuccessorExists: boolean;
};

/** Pure policy projection used by focused selector regressions. */
export function isReviewRetryDispatchExecutable(
  evidence: ReviewRetryTerminalityEvidence
): boolean {
  if (
    evidence.currentProviderAttemptExists ||
    evidence.currentWorkerResultExists ||
    evidence.currentSceneResultExists ||
    evidence.currentDispatchAlreadyTerminal ||
    evidence.anotherExecutableSuccessorExists
  ) {
    return false;
  }
  if (!evidence.historicalSceneResultExists) return true;
  if (evidence.latestHumanReview === "APPROVED") return false;
  return (
    evidence.latestHumanReview === "REJECTED" &&
    evidence.validLaterReviewRetryLineage
  );
}

/**
 * A Provider-successful Scene Result is not, by itself, terminal creative
 * authority. Post-terminal Provider retries can be descendants of a
 * review-directed retry even when the successor correlation does not repeat
 * retry_input_revision_id. Follow the prior Attempt back to its scheduling
 * correlation and require the complete rejected-review retry lineage.
 *
 * Current-generation results remain an unconditional duplicate-execution
 * block. An APPROVED review later than the retry authority also remains
 * terminal creative authority.
 */
const postTerminalReviewRetrySceneResultGate = sql`
  and not exists (
    select 1
    from ai_story_scene_results current_result
    where current_result.scene_execution_id = correlation.scene_execution_id
      and current_result.provider_execution_id = execution.execution_id
  )
  and (
    not exists (
      select 1
      from ai_story_scene_results historical_result
      where historical_result.scene_execution_id = correlation.scene_execution_id
    )
    or exists (
      select 1
      from provider_attempts retry_source_attempt
      join ai_story_scene_scheduling_correlations retry_source_correlation
        on retry_source_correlation.provider_execution_id = retry_source_attempt.execution_id
       and retry_source_correlation.scene_execution_id = authority.scene_execution_id
       and retry_source_correlation.org_id = authority.org_id
       and retry_source_correlation.workspace_id = authority.workspace_id
      join ai_story_scene_attempt_input_revisions retry_input
        on retry_input.retry_input_revision_id = retry_source_correlation.retry_input_revision_id
       and retry_input.scene_execution_id = authority.scene_execution_id
       and retry_input.org_id = authority.org_id
       and retry_input.workspace_id = authority.workspace_id
      join ai_story_scene_retry_authorizations review_retry
        on review_retry.retry_input_revision_id = retry_input.retry_input_revision_id
       and review_retry.source_review_id = retry_input.source_review_id
       and review_retry.source_attempt_id = retry_input.source_attempt_id
       and review_retry.scene_execution_id = authority.scene_execution_id
       and review_retry.status in ('AUTHORIZED', 'CONSUMED')
      join ai_story_generated_scene_reviews rejected_review
        on rejected_review.generated_scene_review_id = review_retry.source_review_id
       and rejected_review.provider_attempt_id = review_retry.source_attempt_id
       and rejected_review.scene_execution_id = authority.scene_execution_id
       and rejected_review.decision = 'REJECTED'
      join ai_story_scene_results reviewed_result
        on reviewed_result.scene_result_id = rejected_review.scene_result_id
       and reviewed_result.provider_attempt_id = rejected_review.provider_attempt_id
       and reviewed_result.scene_execution_id = authority.scene_execution_id
       and reviewed_result.status = 'SUCCEEDED'
      where retry_source_attempt.attempt_id = authority.prior_provider_attempt_id
        and authority.authorized_at >= review_retry.authorized_at
        and not exists (
          select 1
          from ai_story_generated_scene_reviews later_approved_review
          where later_approved_review.scene_execution_id = authority.scene_execution_id
            and later_approved_review.decision = 'APPROVED'
            and coalesce(later_approved_review.decided_at, later_approved_review.created_at)
                >= review_retry.authorized_at
        )
    )
  )
`;

export interface DispatchableProviderJob {
  readonly jobId: string;
  readonly executionId: string;
  readonly payloadReference: string;
  readonly correlationId: string;
  readonly status: "PENDING";
}

export type SupersessionSuccessorDispatchCandidate = {
  readonly lifecycleClass: "ACTIVE_SUPERSESSION_SUCCESSOR";
  readonly supersessionId: string;
  readonly sceneExecutionId: string;
  readonly compiledRequestId: string;
  readonly requestFingerprint: string;
  readonly dispatch: ExecutionDispatch;
};

type SupersessionSuccessorRow = {
  supersession_id: string;
  org_id: string;
  workspace_id: string;
  scene_execution_id: string;
  source_compiled_request_id: string;
  source_request_fingerprint: string;
  source_correlation_id: string;
  source_outbox_job_id: string;
  source_dispatch_id: string;
  successor_compiled_request_id: string;
  successor_request_fingerprint: string;
  successor_correlation_id: string;
  successor_outbox_job_id: string;
  successor_dispatch_id: string;
  reason: string;
  actor_user_id: string;
  idempotency_key: string;
  target_contract_version: string;
  authority_version: string;
  paid_side_effect_evidence: Record<string, unknown>;
  integrity_hash: string;
  supersession_created_at: Date | string;
};

function assertSupersessionSuccessorIntegrity(row: SupersessionSuccessorRow): void {
  const authorityBody = {
    supersessionId: row.supersession_id,
    orgId: row.org_id,
    workspaceId: row.workspace_id,
    sceneExecutionId: row.scene_execution_id,
    source: {
      compiledRequestId: row.source_compiled_request_id,
      requestFingerprint: row.source_request_fingerprint,
      correlationId: row.source_correlation_id,
      outboxJobId: row.source_outbox_job_id,
      dispatchId: row.source_dispatch_id,
    },
    successor: {
      compiledRequestId: row.successor_compiled_request_id,
      requestFingerprint: row.successor_request_fingerprint,
      correlationId: row.successor_correlation_id,
      outboxJobId: row.successor_outbox_job_id,
      dispatchId: row.successor_dispatch_id,
    },
    reason: row.reason,
    actorUserId: row.actor_user_id,
    idempotencyKey: row.idempotency_key,
    targetContractVersion: row.target_contract_version,
    authorityVersion: row.authority_version,
    paidSideEffectEvidence: row.paid_side_effect_evidence,
    createdAt: new Date(row.supersession_created_at).toISOString(),
  };
  if (
    row.authority_version !== AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION ||
    canonicalPersistenceHash(authorityBody) !== row.integrity_hash
  ) {
    throw new ExecutionDispatchConflictError(
      "Supersession successor integrity authority is invalid"
    );
  }
}

async function toSupersessionSuccessorCandidate(
  row: SupersessionSuccessorRow,
  dispatchRow: typeof schema.providerExecutionDispatches.$inferSelect
): Promise<SupersessionSuccessorDispatchCandidate> {
  assertSupersessionSuccessorIntegrity(row);
  return {
    lifecycleClass: "ACTIVE_SUPERSESSION_SUCCESSOR",
    supersessionId: row.supersession_id,
    sceneExecutionId: row.scene_execution_id,
    compiledRequestId: row.successor_compiled_request_id,
    requestFingerprint: row.successor_request_fingerprint,
    dispatch: await validateExecutionDispatch(toDispatch(dispatchRow)),
  };
}

export class ExecutionDispatchConflictError extends Error {
  readonly code = "EXECUTION_DISPATCH_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "ExecutionDispatchConflictError";
  }
}

function toDispatch(
  row: typeof schema.providerExecutionDispatches.$inferSelect
): ExecutionDispatch {
  return {
    version: row.version as "1",
    dispatchId: row.dispatchId,
    jobId: row.jobId,
    executionId: row.executionId,
    envelopeId: row.envelopeId,
    payloadReference: row.payloadReference,
    correlationId: row.correlationId,
    tenantId: row.orgId,
    workspaceId: row.workspaceId,
    capabilityId: row.capabilityId,
    capabilityVersion: row.capabilityVersion,
    requestHash: row.requestHash,
    envelopeHash: row.envelopeHash,
    workerHandoff: row.workerHandoff,
    dispatchHash: row.dispatchHash,
    status: row.status as "DISPATCHED",
    createdAt: row.createdAt.toISOString(),
  };
}

function assertEquivalentDispatch(
  existing: ExecutionDispatch,
  requested: ExecutionDispatch
): ExecutionDispatch {
  if (
    existing.dispatchId !== requested.dispatchId ||
    existing.dispatchHash !== requested.dispatchHash ||
    existing.jobId !== requested.jobId ||
    existing.executionId !== requested.executionId ||
    existing.envelopeId !== requested.envelopeId ||
    existing.requestHash !== requested.requestHash ||
    existing.envelopeHash !== requested.envelopeHash ||
    existing.correlationId !== requested.correlationId
  ) {
    throw new ExecutionDispatchConflictError(
      "Persisted Dispatch conflicts with requested immutable identity"
    );
  }
  return existing;
}

export class ExecutionDispatchRepository {
  constructor(private readonly db: Db = getDb()) {}

  /**
   * Reads the next canonically authorized existing-Dispatch recovery without
   * acquiring a lease or mutating outbox state. This is the non-consuming
   * selector authority used while certification_no_dispatch is active.
   */
  async previewAuthorizedRecoveryDispatch(
    now: Date = new Date()
  ): Promise<ExecutionDispatch | null> {
    const rows = (await this.db.execute(sql`
      select dispatch.dispatch_id
      from provider_outbox_jobs job
      join provider_execution_dispatches dispatch on dispatch.job_id = job.job_id
      join ai_story_scene_scheduling_correlations correlation
        on correlation.outbox_job_id = job.job_id
       and correlation.provider_execution_id = job.execution_id
      join provider_executions execution on execution.execution_id = job.execution_id
      join admin_runtime_recovery_receipts receipt
        on receipt.command_type = 'RecoverAiStoryPreDispatch'
       and receipt.target_id = dispatch.dispatch_id
      where job.operator_notes = concat('ai-story-pre-dispatch-recovery:', receipt.recovery_receipt_id::text)
        and not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
          where supersession.source_dispatch_id = dispatch.dispatch_id
             or supersession.source_outbox_job_id = job.job_id
        )
        and execution.accepted_attempt_id is null
        and execution.accepted_result is null
        and not exists (
          select 1 from provider_attempts attempt
          where attempt.execution_id = execution.execution_id
        )
        and not exists (
          select 1 from ai_story_worker_execution_results result
          where result.dispatch_id = dispatch.dispatch_id
        )
        and not exists (
          select 1 from ai_story_scene_results result
          where result.scene_execution_id = correlation.scene_execution_id
        )
        and job.next_visible_at <= ${now.toISOString()}::timestamptz
        and (
          job.status = 'PENDING'
          or (job.status = 'CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz)
        )
      order by job.next_visible_at asc, job.created_at asc
      limit 1
    `)) as unknown as Array<{ dispatch_id: string }>;
    const selected = rows[0];
    if (!selected) return null;
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, selected.dispatch_id))
      .limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  /**
   * Reads an existing Dispatch that is the active successor side of a valid
   * append-only pre-dispatch supersession. This lifecycle is distinct from a
   * RecoverAiStoryPreDispatch recovery and therefore never relies on a
   * recovery receipt or marker.
   */
  async previewAuthorizedSupersessionSuccessorDispatch(
    now: Date = new Date()
  ): Promise<SupersessionSuccessorDispatchCandidate | null> {
    const rows = (await this.db.execute(sql`
      select supersession.*,
             supersession.created_at as supersession_created_at,
             source_compiled.request_fingerprint as source_request_fingerprint,
             successor_compiled.request_fingerprint as successor_request_fingerprint
      from ai_story_pre_dispatch_bundle_supersessions supersession
      join ai_story_compiled_provider_requests source_compiled
        on source_compiled.compiled_request_id = supersession.source_compiled_request_id
      join ai_story_compiled_provider_requests successor_compiled
        on successor_compiled.compiled_request_id = supersession.successor_compiled_request_id
       and successor_compiled.scene_execution_id = supersession.scene_execution_id
       and successor_compiled.org_id = supersession.org_id
       and successor_compiled.workspace_id = supersession.workspace_id
      join ai_story_scene_scheduling_correlations correlation
        on correlation.correlation_id = supersession.successor_correlation_id
       and correlation.scene_execution_id = supersession.scene_execution_id
       and correlation.outbox_job_id = supersession.successor_outbox_job_id
       and correlation.org_id = supersession.org_id
       and correlation.workspace_id = supersession.workspace_id
      join ai_story_scene_release_states release
        on release.scene_execution_id = supersession.scene_execution_id
       and release.workspace_id = supersession.workspace_id
       and release.execution_plan_id = correlation.execution_plan_id
       and release.runtime_authorization_id = correlation.runtime_authorization_id
       and release.release_state = 'RELEASED'
      join provider_outbox_jobs job
        on job.job_id = supersession.successor_outbox_job_id
       and job.execution_id = correlation.provider_execution_id
      join provider_execution_dispatches dispatch
        on dispatch.dispatch_id = supersession.successor_dispatch_id
       and dispatch.job_id = job.job_id
       and dispatch.execution_id = job.execution_id
       and dispatch.correlation_id = correlation.correlation_id::text
       and dispatch.org_id = supersession.org_id
       and dispatch.workspace_id = supersession.workspace_id
       and dispatch.status = 'DISPATCHED'
      join provider_executions execution
        on execution.execution_id = job.execution_id
      where not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions later
          where later.source_dispatch_id = supersession.successor_dispatch_id
             or later.source_outbox_job_id = supersession.successor_outbox_job_id
        )
        and job.next_visible_at <= ${now.toISOString()}::timestamptz
        and (
          job.status in ('PENDING', 'RETRY_WAIT')
          or (job.status = 'CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz)
        )
        and execution.status in ('PENDING', 'DISPATCHABLE')
        and execution.accepted_attempt_id is null
        and execution.accepted_result is null
        and not exists (
          select 1 from provider_attempts attempt
          where attempt.execution_id = execution.execution_id
        )
        and not exists (
          select 1 from ai_story_worker_execution_results result
          where result.dispatch_id = dispatch.dispatch_id
        )
        and not exists (
          select 1 from ai_story_scene_results result
          join provider_attempts result_attempt on result_attempt.attempt_id=result.provider_attempt_id
          where result_attempt.execution_id=execution.execution_id
        )
        and not exists (
          select 1 from certification_commercial_reservations reservation
          where reservation.execution_identity in (
            execution.execution_id,
            supersession.successor_compiled_request_id::text
          )
        )
      order by job.next_visible_at asc, job.created_at asc, job.job_id asc
      limit 1
    `)) as unknown as SupersessionSuccessorRow[];
    const row = rows[0];
    if (!row) return null;
    const [dispatchRow] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, row.successor_dispatch_id))
      .limit(1);
    return dispatchRow ? await toSupersessionSuccessorCandidate(row, dispatchRow) : null;
  }

  /** Selects only the one human-authorized post-terminal retry generation. */
  async previewAuthorizedPostTerminalRetryDispatch(
    now: Date = new Date()
  ): Promise<ExecutionDispatch | null> {
    const rows = (await this.db.execute(sql`
      select dispatch.dispatch_id, authority.fact
      from ai_story_post_terminal_provider_retry_authorizations authority
      join ai_story_scene_scheduling_correlations correlation
        on correlation.post_terminal_retry_authorization_id = authority.authorization_id
       and correlation.scene_execution_id = authority.scene_execution_id
       and correlation.source_provider_attempt_id = authority.prior_provider_attempt_id
      join provider_outbox_jobs job on job.job_id = correlation.outbox_job_id
      join provider_execution_dispatches dispatch on dispatch.job_id = job.job_id
      join provider_executions execution on execution.execution_id = job.execution_id
      join ai_story_worker_execution_results source_result
        on source_result.worker_execution_result_id = authority.prior_worker_result_id
       and source_result.provider_attempt_id = authority.prior_provider_attempt_id
      where authority.environment = 'STAGING'
        and source_result.worker_state = 'NOT_ACCEPTED'
        and job.next_visible_at <= ${now.toISOString()}::timestamptz
        and (job.status in ('PENDING','RETRY_WAIT')
          or (job.status='CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz))
        and execution.status in ('PENDING','DISPATCHABLE')
        and execution.accepted_attempt_id is null
        and execution.accepted_result is null
        and not exists (select 1 from provider_attempts a where a.execution_id=execution.execution_id)
        and not exists (select 1 from ai_story_worker_execution_results r where r.dispatch_id=dispatch.dispatch_id)
        ${postTerminalReviewRetrySceneResultGate}
      order by job.next_visible_at, job.created_at
      limit 1
    `)) as unknown as Array<{ dispatch_id: string; fact: unknown }>;
    const selected = rows[0];
    if (!selected) return null;
    PostTerminalProviderRetryAuthorizationFactSchema.parse(selected.fact);
    const [row] = await this.db.select().from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, selected.dispatch_id)).limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  async selectEligibleJob(
    now: Date = new Date(),
    options: { readonly ownership?: "ANY" | "AI_STORY_SCENE" | "GENERIC_PROVIDER" } = {}
  ): Promise<DispatchableProviderJob | null> {
    const ownership = options.ownership ?? "ANY";
    const ownershipPredicate =
      ownership === "AI_STORY_SCENE"
        ? sql`and exists (
            select 1
            from ai_story_scene_scheduling_correlations correlation
            where correlation.outbox_job_id = job.job_id
          )`
        : ownership === "GENERIC_PROVIDER"
          ? sql`and not exists (
              select 1
              from ai_story_scene_scheduling_correlations correlation
              where correlation.outbox_job_id = job.job_id
            )`
          : sql``;

    const rows = (await this.db.execute(sql`
      select
        job.job_id,
        job.execution_id,
        job.payload_reference,
        job.correlation_id,
        job.status
      from provider_outbox_jobs job
      join provider_executions execution
        on execution.execution_id = job.execution_id
      left join provider_execution_dispatches dispatch
        on dispatch.job_id = job.job_id
      where job.status = 'PENDING'
        and job.next_visible_at <= ${now.toISOString()}::timestamptz
        and execution.status in ('PENDING', 'DISPATCHABLE')
        and dispatch.dispatch_id is null
        and not exists (
          select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
          where supersession.source_outbox_job_id = job.job_id
        )
        ${ownershipPredicate}
      order by
        job.priority desc,
        job.next_visible_at asc,
        job.created_at asc,
        job.job_id asc
      limit 1
    `)) as unknown as Array<{
      job_id: string;
      execution_id: string;
      payload_reference: string;
      correlation_id: string;
      status: "PENDING";
    }>;
    const row = rows[0];
    return row
      ? {
          jobId: row.job_id,
          executionId: row.execution_id,
          payloadReference: row.payload_reference,
          correlationId: row.correlation_id,
          status: row.status,
        }
      : null;
  }

  /**
   * Claims one explicitly authorized pre-dispatch recovery without creating a
   * new Dispatch. The marker can only be written by the atomic recovery
   * transaction; ordinary PENDING jobs are deliberately excluded.
   */
  async claimAuthorizedRecoveryDispatch(input: {
    readonly workerId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  }): Promise<ExecutionDispatch | null> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 60_000));
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select dispatch.dispatch_id
        from provider_outbox_jobs job
        join provider_execution_dispatches dispatch on dispatch.job_id = job.job_id
        join ai_story_scene_scheduling_correlations correlation
          on correlation.outbox_job_id = job.job_id
         and correlation.provider_execution_id = job.execution_id
        join provider_executions execution on execution.execution_id = job.execution_id
        join admin_runtime_recovery_receipts receipt
          on receipt.command_type = 'RecoverAiStoryPreDispatch'
         and receipt.target_id = dispatch.dispatch_id
        where job.operator_notes = concat('ai-story-pre-dispatch-recovery:', receipt.recovery_receipt_id::text)
          and not exists (
            select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
            where supersession.source_dispatch_id = dispatch.dispatch_id
               or supersession.source_outbox_job_id = job.job_id
          )
          and execution.accepted_attempt_id is null
          and execution.accepted_result is null
          and not exists (
            select 1 from provider_attempts attempt
            where attempt.execution_id = execution.execution_id
          )
          and not exists (
            select 1 from ai_story_worker_execution_results result
            where result.dispatch_id = dispatch.dispatch_id
          )
          and not exists (
            select 1 from ai_story_scene_results result
            where result.scene_execution_id = correlation.scene_execution_id
          )
          and job.next_visible_at <= ${now.toISOString()}::timestamptz
          and (
            job.status = 'PENDING'
            or (job.status = 'CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz)
          )
        order by job.next_visible_at asc, job.created_at asc
        for update of job skip locked
        limit 1
      `)) as unknown as Array<{ dispatch_id: string }>;
      const selected = rows[0];
      if (!selected) return null;
      await tx.execute(sql`
        update provider_outbox_jobs job
        set status = 'CLAIMED',
            lease_owner = ${input.workerId},
            lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
            updated_at = ${now.toISOString()}::timestamptz
        from provider_execution_dispatches dispatch
        where dispatch.job_id = job.job_id
          and dispatch.dispatch_id = ${selected.dispatch_id}
      `);
      const [row] = await tx
        .select()
        .from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.dispatchId, selected.dispatch_id))
        .limit(1);
      return row ? validateExecutionDispatch(toDispatch(row)) : null;
    });
  }

  /**
   * Claims the exact existing Dispatch on the active successor side of a
   * canonical supersession. The outbox lease remains the single concurrency
   * authority; no replacement Dispatch or recovery receipt is created.
   */
  async claimAuthorizedSupersessionSuccessorDispatch(input: {
    readonly workerId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  }): Promise<ExecutionDispatch | null> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 60_000));
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select supersession.*,
               supersession.created_at as supersession_created_at,
               source_compiled.request_fingerprint as source_request_fingerprint,
               successor_compiled.request_fingerprint as successor_request_fingerprint
        from ai_story_pre_dispatch_bundle_supersessions supersession
        join ai_story_compiled_provider_requests source_compiled
          on source_compiled.compiled_request_id = supersession.source_compiled_request_id
        join ai_story_compiled_provider_requests successor_compiled
          on successor_compiled.compiled_request_id = supersession.successor_compiled_request_id
         and successor_compiled.scene_execution_id = supersession.scene_execution_id
         and successor_compiled.org_id = supersession.org_id
         and successor_compiled.workspace_id = supersession.workspace_id
        join ai_story_scene_scheduling_correlations correlation
          on correlation.correlation_id = supersession.successor_correlation_id
         and correlation.scene_execution_id = supersession.scene_execution_id
         and correlation.outbox_job_id = supersession.successor_outbox_job_id
         and correlation.org_id = supersession.org_id
         and correlation.workspace_id = supersession.workspace_id
        join ai_story_scene_release_states release
          on release.scene_execution_id = supersession.scene_execution_id
         and release.workspace_id = supersession.workspace_id
         and release.execution_plan_id = correlation.execution_plan_id
         and release.runtime_authorization_id = correlation.runtime_authorization_id
         and release.release_state = 'RELEASED'
        join provider_outbox_jobs job
          on job.job_id = supersession.successor_outbox_job_id
         and job.execution_id = correlation.provider_execution_id
        join provider_execution_dispatches dispatch
          on dispatch.dispatch_id = supersession.successor_dispatch_id
         and dispatch.job_id = job.job_id
         and dispatch.execution_id = job.execution_id
         and dispatch.correlation_id = correlation.correlation_id::text
         and dispatch.org_id = supersession.org_id
         and dispatch.workspace_id = supersession.workspace_id
         and dispatch.status = 'DISPATCHED'
        join provider_executions execution
          on execution.execution_id = job.execution_id
        where not exists (
            select 1 from ai_story_pre_dispatch_bundle_supersessions later
            where later.source_dispatch_id = supersession.successor_dispatch_id
               or later.source_outbox_job_id = supersession.successor_outbox_job_id
          )
          and job.next_visible_at <= ${now.toISOString()}::timestamptz
          and (
            job.status in ('PENDING', 'RETRY_WAIT')
            or (job.status = 'CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz)
          )
          and execution.status in ('PENDING', 'DISPATCHABLE')
          and execution.accepted_attempt_id is null
          and execution.accepted_result is null
          and not exists (select 1 from provider_attempts attempt where attempt.execution_id = execution.execution_id)
          and not exists (select 1 from ai_story_worker_execution_results result where result.dispatch_id = dispatch.dispatch_id)
          and not exists (
            select 1 from ai_story_scene_results result
            join provider_attempts result_attempt on result_attempt.attempt_id=result.provider_attempt_id
            where result_attempt.execution_id=execution.execution_id
          )
          and not exists (
            select 1 from certification_commercial_reservations reservation
            where reservation.execution_identity in (
              execution.execution_id,
              supersession.successor_compiled_request_id::text
            )
          )
        order by job.next_visible_at asc, job.created_at asc, job.job_id asc
        for update of job skip locked
        limit 1
      `)) as unknown as SupersessionSuccessorRow[];
      const selected = rows[0];
      if (!selected) return null;
      assertSupersessionSuccessorIntegrity(selected);
      const updated = await tx.execute(sql`
        update provider_outbox_jobs
        set status = 'CLAIMED',
            lease_owner = ${input.workerId},
            lease_expires_at = ${leaseExpiresAt.toISOString()}::timestamptz,
            attempt_count = attempt_count + 1,
            updated_at = ${now.toISOString()}::timestamptz
        where job_id = ${selected.successor_outbox_job_id}
          and (
            status in ('PENDING', 'RETRY_WAIT')
            or (status = 'CLAIMED' and lease_expires_at < ${now.toISOString()}::timestamptz)
          )
        returning job_id
      `) as unknown as Array<{ job_id: string }>;
      if (!updated[0]) return null;
      const [dispatchRow] = await tx
        .select()
        .from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.dispatchId, selected.successor_dispatch_id))
        .limit(1);
      return dispatchRow ? validateExecutionDispatch(toDispatch(dispatchRow)) : null;
    });
  }

  async claimAuthorizedPostTerminalRetryDispatch(input: {
    readonly workerId: string;
    readonly now?: Date;
    readonly leaseMs?: number;
  }): Promise<ExecutionDispatch | null> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + (input.leaseMs ?? 60_000));
    return this.db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        select dispatch.dispatch_id, job.job_id, authority.fact
        from ai_story_post_terminal_provider_retry_authorizations authority
        join ai_story_scene_scheduling_correlations correlation
          on correlation.post_terminal_retry_authorization_id=authority.authorization_id
         and correlation.scene_execution_id=authority.scene_execution_id
         and correlation.source_provider_attempt_id=authority.prior_provider_attempt_id
        join provider_outbox_jobs job on job.job_id=correlation.outbox_job_id
        join provider_execution_dispatches dispatch on dispatch.job_id=job.job_id
        join provider_executions execution on execution.execution_id=job.execution_id
        join ai_story_worker_execution_results source_result
          on source_result.worker_execution_result_id=authority.prior_worker_result_id
         and source_result.provider_attempt_id=authority.prior_provider_attempt_id
        where authority.environment='STAGING'
          and source_result.worker_state='NOT_ACCEPTED'
          and job.next_visible_at <= ${now.toISOString()}::timestamptz
          and (job.status in ('PENDING','RETRY_WAIT')
            or (job.status='CLAIMED' and job.lease_expires_at < ${now.toISOString()}::timestamptz))
          and execution.status in ('PENDING','DISPATCHABLE')
          and execution.accepted_attempt_id is null and execution.accepted_result is null
          and not exists (select 1 from provider_attempts a where a.execution_id=execution.execution_id)
          and not exists (select 1 from ai_story_worker_execution_results r where r.dispatch_id=dispatch.dispatch_id)
          ${postTerminalReviewRetrySceneResultGate}
        order by job.next_visible_at, job.created_at
        for update of job skip locked limit 1
      `)) as unknown as Array<{ dispatch_id: string; job_id: string; fact: unknown }>;
      const selected = rows[0];
      if (!selected) return null;
      PostTerminalProviderRetryAuthorizationFactSchema.parse(selected.fact);
      const updated = (await tx.execute(sql`
        update provider_outbox_jobs set status='CLAIMED', lease_owner=${input.workerId},
          lease_expires_at=${leaseExpiresAt.toISOString()}::timestamptz,
          attempt_count=attempt_count+1, updated_at=${now.toISOString()}::timestamptz
        where job_id=${selected.job_id}
          and (status in ('PENDING','RETRY_WAIT')
            or (status='CLAIMED' and lease_expires_at < ${now.toISOString()}::timestamptz))
        returning job_id
      `)) as unknown as Array<{ job_id: string }>;
      if (!updated[0]) return null;
      const [row] = await tx.select().from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.dispatchId, selected.dispatch_id)).limit(1);
      return row ? validateExecutionDispatch(toDispatch(row)) : null;
    });
  }

  async createDispatch(input: ExecutionDispatch): Promise<ExecutionDispatch> {
    const dispatch = await validateExecutionDispatch(input);
    return this.db.transaction(async (tx) => {
      const jobs = (await tx.execute(sql`
        select job_id, execution_id, payload_reference, correlation_id, status
        from provider_outbox_jobs
        where job_id = ${dispatch.jobId}
        for update
      `)) as unknown as Array<{
        job_id: string;
        execution_id: string;
        payload_reference: string;
        correlation_id: string;
        status: string;
      }>;
      const job = jobs[0];
      if (!job) throw new ExecutionDispatchConflictError("Outbox job does not exist");
      const superseded = (await tx.execute(sql`
        select 1
        from ai_story_pre_dispatch_bundle_supersessions
        where source_outbox_job_id = ${dispatch.jobId}
        limit 1
      `)) as unknown as Array<{ "?column?": number }>;
      if (superseded[0]) {
        throw new ExecutionDispatchConflictError(
          "Superseded outbox authority cannot create or recover a Dispatch"
        );
      }
      const [persisted] = await tx
        .select()
        .from(schema.providerExecutionDispatches)
        .where(eq(schema.providerExecutionDispatches.jobId, dispatch.jobId))
        .limit(1);
      if (persisted) {
        return assertEquivalentDispatch(
          await validateExecutionDispatch(toDispatch(persisted)),
          dispatch
        );
      }
      if (job.status !== "PENDING") {
        throw new ExecutionDispatchConflictError("Outbox job is not dispatchable");
      }
      if (
        job.execution_id !== dispatch.executionId ||
        job.payload_reference !== dispatch.payloadReference
      ) {
        throw new ExecutionDispatchConflictError(
          "Dispatch identity conflicts with outbox intent"
        );
      }

      const rows = await tx
        .insert(schema.providerExecutionDispatches)
        .values({
          dispatchId: dispatch.dispatchId,
          version: dispatch.version,
          jobId: dispatch.jobId,
          executionId: dispatch.executionId,
          envelopeId: dispatch.envelopeId,
          payloadReference: dispatch.payloadReference,
          correlationId: dispatch.correlationId,
          orgId: dispatch.tenantId,
          workspaceId: dispatch.workspaceId,
          capabilityId: dispatch.capabilityId,
          capabilityVersion: dispatch.capabilityVersion,
          requestHash: dispatch.requestHash,
          envelopeHash: dispatch.envelopeHash,
          workerHandoff: dispatch.workerHandoff,
          dispatchHash: dispatch.dispatchHash,
          status: dispatch.status,
          createdAt: new Date(dispatch.createdAt),
        })
        .onConflictDoNothing()
        .returning();
      if (!rows[0]) {
        const [accepted] = await tx
          .select()
          .from(schema.providerExecutionDispatches)
          .where(eq(schema.providerExecutionDispatches.jobId, dispatch.jobId))
          .limit(1);
        if (!accepted) {
          throw new ExecutionDispatchConflictError(
            "Dispatch persistence did not produce an accepted record"
          );
        }
        return assertEquivalentDispatch(
          await validateExecutionDispatch(toDispatch(accepted)),
          dispatch
        );
      }
      return validateExecutionDispatch(toDispatch(rows[0]));
    });
  }

  async getDispatch(dispatchId: string): Promise<ExecutionDispatch | null> {
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.dispatchId, dispatchId))
      .limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  async getDispatchByJobId(jobId: string): Promise<ExecutionDispatch | null> {
    const [row] = await this.db
      .select()
      .from(schema.providerExecutionDispatches)
      .where(eq(schema.providerExecutionDispatches.jobId, jobId))
      .limit(1);
    return row ? validateExecutionDispatch(toDispatch(row)) : null;
  }

  async exists(jobId: string): Promise<boolean> {
    return (await this.getDispatchByJobId(jobId)) !== null;
  }
}
