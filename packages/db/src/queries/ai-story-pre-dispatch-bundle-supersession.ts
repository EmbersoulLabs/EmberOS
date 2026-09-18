import { sql } from "drizzle-orm";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  PersistedSceneRoutingDecisionSchema,
  ProviderExecutionSchema,
  RuntimeAuthorizedFactSchema,
  SceneProviderSchedulingCorrelationSchema,
  validateExecutionDispatch,
  validateExecutionEnvelope,
  type ExecutionDispatch,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import { acceptAiStoryCompiledRequest } from "./ai-story-provider-runtime";
import { createProviderExecution } from "./provider-ledger";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";
import type { ScheduleAcceptedBundleInput } from "./ai-story-scene-scheduling";

type Db = ReturnType<typeof getDb>;

export const AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION =
  "ai-story-pre-dispatch-bundle-supersession.v1" as const;

export type AiStoryPreDispatchBundleSupersessionReason =
  | "I2V_PROVIDER_INPUT_PROJECTION_DEFECT"
  | "DETERMINISTIC_PRE_DISPATCH_AUTHORITY_DEFECT"
  | "REVIEW_RETRY_CREATIVE_INSTRUCTION_PRECEDENCE_DEFECT";

export type PreDispatchBundleIdentity = {
  readonly compiledRequestId: string;
  readonly requestFingerprint: string;
  readonly correlationId: string;
  readonly outboxJobId: string;
  readonly dispatchId: string;
};

export type SupersedeAiStoryPreDispatchBundleInput = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly sceneExecutionId: string;
  readonly source: PreDispatchBundleIdentity;
  readonly successor: ScheduleAcceptedBundleInput;
  readonly successorDispatch: ExecutionDispatch;
  readonly reason: AiStoryPreDispatchBundleSupersessionReason;
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly targetContractVersion: string;
  readonly createdAt?: Date;
  readonly testFailureAfter?:
    | "successor_compile"
    | "successor_bundle"
    | "supersession";
};

export type AiStoryPreDispatchBundleSupersessionResult = {
  readonly supersessionId: string;
  readonly sceneExecutionId: string;
  readonly source: PreDispatchBundleIdentity;
  readonly successor: PreDispatchBundleIdentity;
  readonly reason: AiStoryPreDispatchBundleSupersessionReason;
  readonly authorityVersion: typeof AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION;
  readonly integrityHash: string;
  readonly createdAt: string;
  readonly replayed: boolean;
};

export type PreDispatchBundleSupersessionErrorCode =
  | "SUPERSESSION_NOT_FOUND"
  | "SUPERSESSION_ACCESS_DENIED"
  | "SUPERSESSION_NOT_ELIGIBLE"
  | "SUPERSESSION_IDENTITY_CONFLICT"
  | "SUPERSESSION_ALREADY_APPLIED";

export class AiStoryPreDispatchBundleSupersessionError extends Error {
  constructor(
    readonly code: PreDispatchBundleSupersessionErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AiStoryPreDispatchBundleSupersessionError";
  }
}

type SourceRow = {
  org_id: string;
  workspace_id: string;
  scene_execution_id: string;
  release_state: string;
  compiled_request_id: string;
  request_fingerprint: string;
  generation_mode: string;
  provider_id: string;
  model_id: string;
  correlation_id: string;
  runtime_authorization_id: string;
  routing_decision_id: string;
  execution_plan_id: string;
  provider_execution_id: string;
  provider_execution_status: string;
  accepted_attempt_id: string | null;
  accepted_result: unknown | null;
  envelope_id: string;
  outbox_job_id: string;
  outbox_status: string;
  outbox_completed_at: Date | string | null;
  outbox_dead_letter_at: Date | string | null;
  dispatch_id: string;
  dispatch_status: string;
  selected_provider_id: string;
  attempt_count: number;
  attempt_binding_count: number;
  worker_result_count: number;
  scene_result_count: number;
  reservation_count: number;
};

type ReceiptRow = {
  supersession_id: string;
  scene_execution_id: string;
  source_compiled_request_id: string;
  source_correlation_id: string;
  source_outbox_job_id: string;
  source_dispatch_id: string;
  successor_compiled_request_id: string;
  successor_correlation_id: string;
  successor_outbox_job_id: string;
  successor_dispatch_id: string;
  reason: AiStoryPreDispatchBundleSupersessionReason;
  integrity_hash: string;
  created_at: Date | string;
};

function identityFromReceipt(row: ReceiptRow, side: "source" | "successor", fingerprint: string): PreDispatchBundleIdentity {
  return {
    compiledRequestId: row[`${side}_compiled_request_id`],
    requestFingerprint: fingerprint,
    correlationId: row[`${side}_correlation_id`],
    outboxJobId: row[`${side}_outbox_job_id`],
    dispatchId: row[`${side}_dispatch_id`],
  };
}

export function assertPreDispatchSupersessionEligibility(input: {
  readonly providerExecutionStatus: string;
  readonly outboxStatus: string;
  readonly providerAttemptCount: number;
  readonly providerAttemptBindingCount: number;
  readonly workerResultCount: number;
  readonly sceneResultCount: number;
  readonly commercialReservationCount: number;
  readonly acceptedAttemptId?: string | null;
  readonly acceptedResult?: unknown | null;
  readonly outboxCompletedAt?: unknown | null;
  readonly outboxDeadLetterAt?: unknown | null;
  readonly dispatchStatus?: string;
}): void {
  if (
    input.providerAttemptCount !== 0 ||
    input.providerAttemptBindingCount !== 0 ||
    input.workerResultCount !== 0 ||
    input.sceneResultCount !== 0 ||
    input.commercialReservationCount !== 0 ||
    input.acceptedAttemptId != null ||
    input.acceptedResult != null ||
    input.outboxCompletedAt != null ||
    input.outboxDeadLetterAt != null ||
    (input.dispatchStatus != null && input.dispatchStatus !== "DISPATCHED") ||
    !["PENDING", "DISPATCHABLE"].includes(input.providerExecutionStatus) ||
    !["PENDING", "CLAIMED", "RETRY_WAIT"].includes(input.outboxStatus)
  ) {
    throw new AiStoryPreDispatchBundleSupersessionError(
      "SUPERSESSION_NOT_ELIGIBLE",
      "Paid, terminal, result, or ambiguous execution evidence exists"
    );
  }
}

function failAfter(input: SupersedeAiStoryPreDispatchBundleInput, stage: NonNullable<SupersedeAiStoryPreDispatchBundleInput["testFailureAfter"]>): void {
  if (input.testFailureAfter === stage) {
    throw new AiStoryPreDispatchBundleSupersessionError(
      "SUPERSESSION_IDENTITY_CONFLICT",
      `test failure after ${stage}`
    );
  }
}

/**
 * Atomically appends a corrected pre-dispatch bundle and the immutable
 * source→successor authority. It never creates a reservation, Attempt, task,
 * Provider call, Scene execution, or release event.
 */
export class AiStoryPreDispatchBundleSupersessionRepository {
  constructor(private readonly db: Db = getDb()) {}

  /** Read-only exact source capsule used by the canonical supersession command. */
  async loadSourceBundle(input: {
    readonly sceneExecutionId: string;
    readonly source: PreDispatchBundleIdentity;
  }): Promise<{
    readonly bundle: ScheduleAcceptedBundleInput;
    readonly dispatch: ExecutionDispatch;
    readonly intent: import("@ceo-agent/shared").AiStorySceneExecutionIntent;
    readonly instructions: import("@ceo-agent/shared").AiStorySceneCompiledInstructions;
  }> {
    const rows = (await this.db.execute(sql`
      select runtime.fact as runtime_fact, routing.decision as routing_decision,
             compiled.compiled_request, correlation.correlation,
             execution.contract_version, execution.execution_id, execution.org_id,
             execution.workspace_id, execution.campaign_id, execution.pipeline_run_id,
             execution.capability_id, execution.capability_version, execution.idempotency_key,
             execution.deterministic_fingerprint, execution.status as execution_status,
             execution.execution_metadata, execution.accepted_attempt_id,
             execution.created_at as execution_created_at, execution.completed_at,
             envelope.version as envelope_version, envelope.envelope_id,
             envelope.payload_reference, envelope.org_id as envelope_org_id,
             envelope.workspace_id as envelope_workspace_id, envelope.execution_context,
             envelope.capability_id as envelope_capability_id,
             envelope.capability_version as envelope_capability_version,
             envelope.provider_policy_snapshot, envelope.canonical_request,
             envelope.request_hash, envelope.envelope_hash, envelope.created_at as envelope_created_at,
             outbox.job_id, outbox.priority, outbox.next_visible_at,
             dispatch.version as dispatch_version, dispatch.dispatch_id,
             dispatch.worker_handoff, dispatch.dispatch_hash,
             dispatch.status as dispatch_status, dispatch.created_at as dispatch_created_at,
             correlation.scheduled_by, scene.intent, instruction.instructions
      from ai_story_scene_scheduling_correlations correlation
      join ai_story_runtime_authorized_facts runtime on runtime.runtime_authorization_id=correlation.runtime_authorization_id
      join ai_story_scene_routing_decisions routing on routing.routing_decision_id=correlation.routing_decision_id
      join ai_story_compiled_provider_requests compiled on compiled.compiled_request_id=${input.source.compiledRequestId}::uuid
        and compiled.scene_execution_id=correlation.scene_execution_id
      join provider_executions execution on execution.execution_id=correlation.provider_execution_id
      join provider_execution_envelopes envelope on envelope.envelope_id=correlation.envelope_id
      join provider_outbox_jobs outbox on outbox.job_id=correlation.outbox_job_id
      join provider_execution_dispatches dispatch on dispatch.job_id=outbox.job_id
      join ai_story_scene_executions scene on scene.id=correlation.scene_execution_id
      join ai_story_scene_instruction_snapshots instruction on instruction.content_hash=scene.instruction_hash
      where correlation.scene_execution_id=${input.sceneExecutionId}::uuid
        and correlation.correlation_id=${input.source.correlationId}::uuid
        and correlation.outbox_job_id=${input.source.outboxJobId}
        and dispatch.dispatch_id=${input.source.dispatchId}
        and compiled.request_fingerprint=${input.source.requestFingerprint}
      limit 1
    `)) as unknown as Array<Record<string, any>>;
    const row = rows[0];
    if (!row) throw new AiStoryPreDispatchBundleSupersessionError("SUPERSESSION_NOT_FOUND", "Exact source bundle was not found");
    const runtimeAuthorizedFact = RuntimeAuthorizedFactSchema.parse(row.runtime_fact);
    const routingDecision = PersistedSceneRoutingDecisionSchema.parse(row.routing_decision);
    const compiledProviderRequest = AiStoryCompiledProviderRequestSchema.parse(row.compiled_request);
    const correlation = SceneProviderSchedulingCorrelationSchema.parse(row.correlation);
    const providerExecution = ProviderExecutionSchema.parse({
      contractVersion: row.contract_version,
      identity: {
        executionId: row.execution_id, tenantId: row.org_id, workspaceId: row.workspace_id,
        ...(row.campaign_id ? { campaignId: row.campaign_id } : {}), pipelineRunId: row.pipeline_run_id,
        capabilityId: row.capability_id, capabilityVersion: row.capability_version,
        idempotencyKey: row.idempotency_key, deterministicFingerprint: row.deterministic_fingerprint,
      },
      metadata: row.execution_metadata,
      status: row.execution_status,
      ...(row.accepted_attempt_id ? { acceptedAttemptId: row.accepted_attempt_id } : {}),
      createdAt: new Date(row.execution_created_at).toISOString(),
      ...(row.completed_at ? { completedAt: new Date(row.completed_at).toISOString() } : {}),
    });
    const envelope = await validateExecutionEnvelope({
      version: row.envelope_version, envelopeId: row.envelope_id,
      payloadReference: row.payload_reference, tenantId: row.envelope_org_id,
      workspaceId: row.envelope_workspace_id, executionContext: row.execution_context,
      capabilityId: row.envelope_capability_id, capabilityVersion: row.envelope_capability_version,
      providerPolicySnapshot: row.provider_policy_snapshot, canonicalRequest: row.canonical_request,
      requestHash: row.request_hash, envelopeHash: row.envelope_hash,
      createdAt: new Date(row.envelope_created_at).toISOString(),
    });
    const dispatch = await validateExecutionDispatch({
      version: row.dispatch_version, dispatchId: row.dispatch_id, jobId: row.job_id,
      executionId: row.execution_id, envelopeId: row.envelope_id,
      payloadReference: row.payload_reference, correlationId: correlation.correlationId,
      tenantId: row.envelope_org_id, workspaceId: row.envelope_workspace_id,
      capabilityId: row.envelope_capability_id, capabilityVersion: row.envelope_capability_version,
      requestHash: row.request_hash, envelopeHash: row.envelope_hash,
      workerHandoff: row.worker_handoff, dispatchHash: row.dispatch_hash,
      status: row.dispatch_status, createdAt: new Date(row.dispatch_created_at).toISOString(),
    });
    return {
      bundle: {
        runtimeAuthorizedFact, routingDecision, providerExecution, compiledProviderRequest,
        requestHash: envelope.requestHash, envelope,
        outboxJob: { jobId: row.job_id, executionId: row.execution_id, payloadReference: row.payload_reference, correlationId: correlation.correlationId, priority: row.priority, nextVisibleAt: new Date(row.next_visible_at) },
        correlation, scheduledBy: row.scheduled_by,
      },
      dispatch,
      intent: AiStorySceneExecutionIntentSchema.parse(row.intent),
      instructions: AiStorySceneCompiledInstructionsSchema.parse(row.instructions),
    };
  }

  async supersede(
    input: SupersedeAiStoryPreDispatchBundleInput
  ): Promise<AiStoryPreDispatchBundleSupersessionResult> {
    const successorRequest = AiStoryCompiledProviderRequestSchema.parse(
      input.successor.compiledProviderRequest
    );
    const successorExecution = ProviderExecutionSchema.parse(
      input.successor.providerExecution
    );
    const successorCorrelation = SceneProviderSchedulingCorrelationSchema.parse(
      input.successor.correlation
    );
    const successorEnvelope = await validateExecutionEnvelope(input.successor.envelope);
    const successorDispatch = await validateExecutionDispatch(input.successorDispatch);
    const createdAt = input.createdAt ?? new Date();

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sceneExecutionId}))`);

      const replayRows = (await tx.execute(sql`
        select s.*, source.request_fingerprint as source_fingerprint,
               successor.request_fingerprint as successor_fingerprint
        from ai_story_pre_dispatch_bundle_supersessions s
        join ai_story_compiled_provider_requests source
          on source.compiled_request_id = s.source_compiled_request_id
        join ai_story_compiled_provider_requests successor
          on successor.compiled_request_id = s.successor_compiled_request_id
        where s.idempotency_key = ${input.idempotencyKey}
        limit 1
      `)) as unknown as Array<ReceiptRow & { source_fingerprint: string; successor_fingerprint: string }>;
      const replay = replayRows[0];
      if (replay) {
        if (
          replay.scene_execution_id !== input.sceneExecutionId ||
          replay.source_compiled_request_id !== input.source.compiledRequestId ||
          replay.successor_compiled_request_id !== successorRequest.compiledRequestId ||
          replay.reason !== input.reason
        ) {
          throw new AiStoryPreDispatchBundleSupersessionError(
            "SUPERSESSION_IDENTITY_CONFLICT",
            "Idempotency key belongs to a different supersession"
          );
        }
        return {
          supersessionId: replay.supersession_id,
          sceneExecutionId: replay.scene_execution_id,
          source: identityFromReceipt(replay, "source", replay.source_fingerprint),
          successor: identityFromReceipt(replay, "successor", replay.successor_fingerprint),
          reason: replay.reason,
          authorityVersion: AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION,
          integrityHash: replay.integrity_hash,
          createdAt: new Date(replay.created_at).toISOString(),
          replayed: true,
        };
      }

      const sourceRows = (await tx.execute(sql`
        select correlation.org_id, correlation.workspace_id,
               correlation.scene_execution_id, release.release_state,
               compiled.compiled_request_id, compiled.request_fingerprint,
               compiled.generation_mode, compiled.provider_id, compiled.model_id,
               correlation.correlation_id, correlation.runtime_authorization_id,
               correlation.routing_decision_id, correlation.execution_plan_id,
               correlation.provider_execution_id,
               execution.status as provider_execution_status,
               execution.accepted_attempt_id, execution.accepted_result,
               correlation.envelope_id, correlation.outbox_job_id,
               outbox.status as outbox_status, outbox.completed_at as outbox_completed_at,
               outbox.dead_letter_at as outbox_dead_letter_at,
               dispatch.dispatch_id, dispatch.status as dispatch_status,
               routing.selected_provider_id,
               (select count(*)::int from provider_attempts a
                 where a.execution_id = correlation.provider_execution_id) attempt_count,
               (select count(*)::int from ai_story_provider_attempt_compiled_bindings b
                 where b.scene_execution_id = correlation.scene_execution_id
                   and b.compiled_request_id = compiled.compiled_request_id) attempt_binding_count,
               (select count(*)::int from ai_story_worker_execution_results w
                 where w.dispatch_id = dispatch.dispatch_id) worker_result_count,
               (select count(*)::int from ai_story_scene_results r
                 join provider_attempts result_attempt on result_attempt.attempt_id=r.provider_attempt_id
                 where result_attempt.execution_id=correlation.provider_execution_id) scene_result_count,
               (select count(*)::int from certification_commercial_reservations reservation
                 where reservation.execution_identity in (
                   correlation.provider_execution_id,
                   compiled.compiled_request_id::text
                 ) or exists (
                   select 1 from ai_story_provider_attempt_compiled_bindings binding
                   where binding.provider_attempt_id = reservation.execution_identity
                     and binding.compiled_request_id = compiled.compiled_request_id
                 )) reservation_count
        from ai_story_scene_scheduling_correlations correlation
        join ai_story_scene_release_states release
          on release.scene_execution_id = correlation.scene_execution_id
        join ai_story_compiled_provider_requests compiled
          on compiled.compiled_request_id = ${input.source.compiledRequestId}::uuid
         and compiled.scene_execution_id = correlation.scene_execution_id
        join provider_executions execution
          on execution.execution_id = correlation.provider_execution_id
        join provider_outbox_jobs outbox on outbox.job_id = correlation.outbox_job_id
        join provider_execution_dispatches dispatch on dispatch.job_id = outbox.job_id
        join ai_story_scene_routing_decisions routing
          on routing.routing_decision_id = correlation.routing_decision_id
        where correlation.scene_execution_id = ${input.sceneExecutionId}::uuid
          and correlation.correlation_id = ${input.source.correlationId}::uuid
          and correlation.outbox_job_id = ${input.source.outboxJobId}
          and dispatch.dispatch_id = ${input.source.dispatchId}
        for update of correlation, release, execution, outbox, dispatch
      `)) as unknown as SourceRow[];
      const source = sourceRows[0];
      if (!source) {
        throw new AiStoryPreDispatchBundleSupersessionError(
          "SUPERSESSION_NOT_FOUND",
          "Exact source pre-dispatch bundle was not found"
        );
      }
      if (source.org_id !== input.orgId || source.workspace_id !== input.workspaceId) {
        throw new AiStoryPreDispatchBundleSupersessionError(
          "SUPERSESSION_ACCESS_DENIED",
          "Cross-workspace or cross-organization supersession denied"
        );
      }
      if (
        source.release_state !== "RELEASED" ||
        source.request_fingerprint !== input.source.requestFingerprint ||
        source.provider_id !== source.selected_provider_id
      ) {
        throw new AiStoryPreDispatchBundleSupersessionError(
          "SUPERSESSION_IDENTITY_CONFLICT",
          "Source release, fingerprint, or Provider authority conflicts"
        );
      }
      assertPreDispatchSupersessionEligibility({
        providerExecutionStatus: source.provider_execution_status,
        outboxStatus: source.outbox_status,
        providerAttemptCount: Number(source.attempt_count),
        providerAttemptBindingCount: Number(source.attempt_binding_count),
        workerResultCount: Number(source.worker_result_count),
        sceneResultCount: Number(source.scene_result_count),
        commercialReservationCount: Number(source.reservation_count),
        acceptedAttemptId: source.accepted_attempt_id,
        acceptedResult: source.accepted_result,
        outboxCompletedAt: source.outbox_completed_at,
        outboxDeadLetterAt: source.outbox_dead_letter_at,
        dispatchStatus: source.dispatch_status,
      });

      const activeRows = (await tx.execute(sql`
        select correlation.correlation_id
        from ai_story_scene_scheduling_correlations correlation
        join provider_executions execution on execution.execution_id=correlation.provider_execution_id
        join provider_outbox_jobs outbox on outbox.job_id=correlation.outbox_job_id
        join provider_execution_dispatches dispatch
          on dispatch.job_id = correlation.outbox_job_id
        where correlation.scene_execution_id = ${input.sceneExecutionId}::uuid
          and execution.status in ('PENDING','DISPATCHABLE')
          and outbox.status in ('PENDING','CLAIMED','RETRY_WAIT')
          and not exists (select 1 from provider_attempts attempt where attempt.execution_id=execution.execution_id)
          and not exists (select 1 from ai_story_worker_execution_results result where result.dispatch_id=dispatch.dispatch_id)
          and not exists (
            select 1 from ai_story_pre_dispatch_bundle_supersessions supersession
            where supersession.source_dispatch_id = dispatch.dispatch_id
          )
      `)) as unknown as Array<{ correlation_id: string }>;
      if (activeRows.length !== 1 || activeRows[0]?.correlation_id !== source.correlation_id) {
        throw new AiStoryPreDispatchBundleSupersessionError(
          "SUPERSESSION_NOT_ELIGIBLE",
          "Source is not the single active bundle for this Scene execution"
        );
      }

      if (
        successorRequest.sceneExecutionId !== input.sceneExecutionId ||
        successorRequest.orgId !== input.orgId ||
        successorRequest.workspaceId !== input.workspaceId ||
        successorRequest.providerId !== source.provider_id ||
        successorRequest.modelId !== source.model_id ||
        successorRequest.compiledRequestId === source.compiled_request_id ||
        successorRequest.requestFingerprint === source.request_fingerprint ||
        successorCorrelation.sceneExecutionId !== input.sceneExecutionId ||
        successorCorrelation.executionPlanId !== source.execution_plan_id ||
        successorCorrelation.runtimeAuthorizationId !== source.runtime_authorization_id ||
        successorCorrelation.routingDecisionId !== source.routing_decision_id ||
        successorCorrelation.providerExecutionId !== successorExecution.identity.executionId ||
        successorCorrelation.envelopeId !== successorEnvelope.envelopeId ||
        successorCorrelation.outboxJobId !== input.successor.outboxJob.jobId ||
        successorCorrelation.requestHash !== successorEnvelope.requestHash ||
        successorCorrelation.envelopeHash !== successorEnvelope.envelopeHash ||
        successorEnvelope.executionContext.trace?.compiledRequestId !== successorRequest.compiledRequestId ||
        successorEnvelope.executionContext.trace?.compiledRequestFingerprint !== successorRequest.requestFingerprint ||
        input.successor.outboxJob.executionId !== successorExecution.identity.executionId ||
        input.successor.outboxJob.payloadReference !== successorEnvelope.payloadReference ||
        input.successor.outboxJob.correlationId !== successorCorrelation.correlationId ||
        successorDispatch.jobId !== input.successor.outboxJob.jobId ||
        successorDispatch.executionId !== successorExecution.identity.executionId ||
        successorDispatch.envelopeId !== successorEnvelope.envelopeId ||
        successorDispatch.correlationId !== successorCorrelation.correlationId ||
        successorDispatch.tenantId !== input.orgId ||
        successorDispatch.workspaceId !== input.workspaceId
      ) {
        throw new AiStoryPreDispatchBundleSupersessionError(
          "SUPERSESSION_IDENTITY_CONFLICT",
          "Successor bundle does not preserve the protected Scene authority"
        );
      }

      await acceptAiStoryCompiledRequest(tx, successorRequest);
      failAfter(input, "successor_compile");
      await createProviderExecution(tx, successorExecution, input.successor.requestHash);
      await tx.execute(sql`
        insert into provider_outbox_jobs (
          job_id, contract_version, execution_id, payload_reference,
          correlation_id, status, priority, next_visible_at
        ) values (
          ${input.successor.outboxJob.jobId}, '1',
          ${input.successor.outboxJob.executionId},
          ${input.successor.outboxJob.payloadReference},
          ${input.successor.outboxJob.correlationId}, 'PENDING',
          ${input.successor.outboxJob.priority ?? 0},
          ${(input.successor.outboxJob.nextVisibleAt ?? createdAt).toISOString()}::timestamptz
        )
      `);
      await tx.execute(sql`
        insert into provider_execution_envelopes (
          envelope_id, version, payload_reference, org_id, workspace_id,
          execution_context, capability_id, capability_version,
          provider_policy_snapshot, canonical_request, request_hash,
          envelope_hash, created_at
        ) values (
          ${successorEnvelope.envelopeId}, ${successorEnvelope.version},
          ${successorEnvelope.payloadReference}, ${successorEnvelope.tenantId}::uuid,
          ${successorEnvelope.workspaceId}::uuid,
          ${JSON.stringify(successorEnvelope.executionContext)}::jsonb,
          ${successorEnvelope.capabilityId}, ${successorEnvelope.capabilityVersion},
          ${JSON.stringify(successorEnvelope.providerPolicySnapshot)}::jsonb,
          ${JSON.stringify(successorEnvelope.canonicalRequest)}::jsonb,
          ${successorEnvelope.requestHash}, ${successorEnvelope.envelopeHash},
          ${successorEnvelope.createdAt}::timestamptz
        )
      `);
      await tx.execute(sql`
        insert into ai_story_scene_scheduling_correlations (
          correlation_id, org_id, workspace_id, campaign_id, story_id,
          story_version_id, animation_package_id, execution_plan_id,
          scene_execution_id, runtime_authorization_id, routing_decision_id,
          provider_execution_id, envelope_id, outbox_job_id, request_hash,
          envelope_hash, routing_decision_hash, authorization_hash,
          scheduling_identity_hash, retry_input_revision_id, contract_version,
          scheduled_by, scheduled_at, correlation
        ) values (
          ${successorCorrelation.correlationId}::uuid,
          ${successorCorrelation.ownership.orgId}::uuid,
          ${successorCorrelation.ownership.workspaceId}::uuid,
          ${successorCorrelation.ownership.campaignId}::uuid,
          ${successorCorrelation.ownership.storyId}::uuid,
          ${successorCorrelation.ownership.storyVersionId}::uuid,
          ${successorCorrelation.ownership.animationPackageId}::uuid,
          ${successorCorrelation.executionPlanId}::uuid,
          ${successorCorrelation.sceneExecutionId}::uuid,
          ${successorCorrelation.runtimeAuthorizationId}::uuid,
          ${successorCorrelation.routingDecisionId}::uuid,
          ${successorCorrelation.providerExecutionId}, ${successorCorrelation.envelopeId},
          ${successorCorrelation.outboxJobId}, ${successorCorrelation.requestHash},
          ${successorCorrelation.envelopeHash}, ${successorCorrelation.routingDecisionHash},
          ${successorCorrelation.authorizationHash}, ${successorCorrelation.schedulingIdentityHash},
          ${successorCorrelation.retryInputRevisionId ?? null}::uuid,
          ${successorCorrelation.contractVersion}, ${successorCorrelation.scheduledBy}::uuid,
          ${successorCorrelation.scheduledAt}::timestamptz,
          ${JSON.stringify(successorCorrelation)}::jsonb
        )
      `);
      await tx.execute(sql`
        insert into provider_execution_dispatches (
          dispatch_id, version, job_id, execution_id, envelope_id,
          payload_reference, correlation_id, org_id, workspace_id,
          capability_id, capability_version, request_hash, envelope_hash,
          worker_handoff, dispatch_hash, status, created_at
        ) values (
          ${successorDispatch.dispatchId}, ${successorDispatch.version},
          ${successorDispatch.jobId}, ${successorDispatch.executionId},
          ${successorDispatch.envelopeId}, ${successorDispatch.payloadReference},
          ${successorDispatch.correlationId}, ${successorDispatch.tenantId}::uuid,
          ${successorDispatch.workspaceId}::uuid, ${successorDispatch.capabilityId},
          ${successorDispatch.capabilityVersion}, ${successorDispatch.requestHash},
          ${successorDispatch.envelopeHash},
          ${JSON.stringify(successorDispatch.workerHandoff)}::jsonb,
          ${successorDispatch.dispatchHash}, ${successorDispatch.status},
          ${successorDispatch.createdAt}::timestamptz
        )
      `);
      failAfter(input, "successor_bundle");

      const supersessionId = deterministicPersistenceUuid(
        "ai-story-pre-dispatch-bundle-supersession",
        {
          sourceCompiledRequestId: source.compiled_request_id,
          reason: input.reason,
          targetContractVersion: input.targetContractVersion,
        }
      );
      const paidSideEffectEvidence = {
        commercialReservations: 0,
        providerAttempts: 0,
        providerAttemptBindings: 0,
        providerTasks: 0,
        providerSubmissions: 0,
        workerResults: 0,
        sceneResults: 0,
      };
      const authorityBody = {
        supersessionId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        sceneExecutionId: input.sceneExecutionId,
        source: input.source,
        successor: {
          compiledRequestId: successorRequest.compiledRequestId,
          requestFingerprint: successorRequest.requestFingerprint,
          correlationId: successorCorrelation.correlationId,
          outboxJobId: input.successor.outboxJob.jobId,
          dispatchId: successorDispatch.dispatchId,
        },
        reason: input.reason,
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        targetContractVersion: input.targetContractVersion,
        authorityVersion: AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION,
        paidSideEffectEvidence,
        createdAt: createdAt.toISOString(),
      };
      const integrityHash = canonicalPersistenceHash(authorityBody);
      await tx.execute(sql`
        insert into ai_story_pre_dispatch_bundle_supersessions (
          supersession_id, org_id, workspace_id, scene_execution_id,
          source_compiled_request_id, source_correlation_id,
          source_outbox_job_id, source_dispatch_id,
          successor_compiled_request_id, successor_correlation_id,
          successor_outbox_job_id, successor_dispatch_id, reason,
          actor_user_id, idempotency_key, target_contract_version,
          authority_version, paid_side_effect_evidence, integrity_hash, created_at
        ) values (
          ${supersessionId}::uuid, ${input.orgId}::uuid, ${input.workspaceId}::uuid,
          ${input.sceneExecutionId}::uuid, ${source.compiled_request_id}::uuid,
          ${source.correlation_id}::uuid, ${source.outbox_job_id}, ${source.dispatch_id},
          ${successorRequest.compiledRequestId}::uuid,
          ${successorCorrelation.correlationId}::uuid,
          ${input.successor.outboxJob.jobId}, ${successorDispatch.dispatchId},
          ${input.reason}, ${input.actorUserId}::uuid, ${input.idempotencyKey},
          ${input.targetContractVersion},
          ${AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION},
          ${JSON.stringify(paidSideEffectEvidence)}::jsonb, ${integrityHash},
          ${createdAt.toISOString()}::timestamptz
        )
      `);
      failAfter(input, "supersession");

      return {
        supersessionId,
        sceneExecutionId: input.sceneExecutionId,
        source: input.source,
        successor: authorityBody.successor,
        reason: input.reason,
        authorityVersion: AI_STORY_PRE_DISPATCH_BUNDLE_SUPERSESSION_VERSION,
        integrityHash,
        createdAt: createdAt.toISOString(),
        replayed: false,
      };
    });
  }
}
