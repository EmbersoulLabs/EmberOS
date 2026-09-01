import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  RuntimeRecoveryCommandResultSchema,
  type RuntimeRecoveryCommandResult,
} from "@ceo-agent/shared";
import { getDb } from "../client";
import { deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export const AI_STORY_PRE_DISPATCH_RECOVERY_COMMAND =
  "RecoverAiStoryPreDispatch" as const;
export const AI_STORY_PRE_DISPATCH_RECOVERY_MARKER =
  "ai-story-pre-dispatch-recovery:" as const;

export type PreDispatchRecoveryFailureCode =
  | "RECOVERY_NOT_FOUND"
  | "RECOVERY_ACCESS_DENIED"
  | "RECOVERY_STATE_STALE"
  | "RECOVERY_INVALID_TIMESTAMP"
  | "PRODUCT_VISUAL_AUTHORITY_UNCERTIFIED"
  | "AUTHORITY_CONFLICT"
  | "PROVIDER_MODE_UNCERTIFIED"
  | "DIRECTOR_SHOT_UNSAFE";

export class PreDispatchRecoveryRepositoryError extends Error {
  constructor(
    readonly code: PreDispatchRecoveryFailureCode,
    message: string,
    readonly status = code === "RECOVERY_NOT_FOUND" ? 404 : code === "RECOVERY_ACCESS_DENIED" ? 403 : 409
  ) {
    super(message);
    this.name = "PreDispatchRecoveryRepositoryError";
  }
}

export type PreDispatchRecoveryCommandInput = {
  readonly executionPlanId: string;
  readonly sceneExecutionId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly actorUserId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
};

export type PreDispatchRecoveryCommandResult = {
  readonly recovery: RuntimeRecoveryCommandResult;
  readonly replayed: boolean;
  readonly providerExecutionId: string;
  readonly outboxJobId: string;
  readonly dispatchId: string;
  readonly compiledRequestId: string;
  readonly requestFingerprint: string;
  readonly generationMode: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly preRecoveryState: "PRE_DISPATCH_BLOCKED";
  readonly postRecoveryState: "RECOVERY_AUTHORIZED";
  readonly claimableAfterRecovery: true;
};

type RecoveryRow = {
  execution_plan_id: string;
  scene_execution_id: string;
  org_id: string;
  workspace_id: string;
  release_state: string;
  provider_execution_id: string;
  provider_execution_status: string;
  outbox_job_id: string;
  outbox_status: string;
  dispatch_id: string;
  compiled_request_id: string;
  request_fingerprint: string;
  generation_mode: string;
  provider_id: string;
  model_id: string;
  selected_provider_id: string;
  worker_execution_result_id: string | null;
  provider_attempt_id: string | null;
  provider_request_id: string | null;
  worker_state: string | null;
  worker_result: unknown | null;
  worker_integrity_hash: string | null;
  produced_at: Date | string | null;
  attempt_count: number;
  result_count: number;
  review_count: number;
};

export function assertRecoverablePreDispatchState(input: {
  readonly releaseState: string;
  readonly providerExecutionStatus: string;
  readonly outboxStatus: string;
  readonly workerState: string | null;
  readonly providerRequestId: string | null;
  readonly providerAttemptCount: number;
  readonly resultCount: number;
  readonly generatedReviewCount: number;
}): void {
  if (
    input.releaseState !== "RELEASED" ||
    !["PENDING", "DISPATCHABLE"].includes(input.providerExecutionStatus) ||
    !["PENDING", "CLAIMED"].includes(input.outboxStatus) ||
    ![null, "NOT_ACCEPTED"].includes(input.workerState) ||
    input.providerRequestId !== null ||
    input.providerAttemptCount !== 0 ||
    input.resultCount !== 0 ||
    input.generatedReviewCount !== 0
  ) {
    throw new PreDispatchRecoveryRepositoryError(
      "RECOVERY_STATE_STALE",
      "Scene no longer satisfies the pre-dispatch recoverable-state contract"
    );
  }
}

function integrityHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

const TIMESTAMP_WITH_EXPLICIT_TIMEZONE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * Normalizes timestamp values returned by either Drizzle's Date mapper or a
 * raw postgres-js query. Timestamp strings must carry an explicit timezone so
 * the recovery archive never reinterprets a database instant in local time.
 */
export function normalizeTimestampToIso(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new PreDispatchRecoveryRepositoryError(
        "RECOVERY_INVALID_TIMESTAMP",
        "Recovery evidence timestamp is invalid"
      );
    }
    return value.toISOString();
  }

  if (typeof value === "string" && TIMESTAMP_WITH_EXPLICIT_TIMEZONE.test(value.trim())) {
    const parsed = new Date(value.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  throw new PreDispatchRecoveryRepositoryError(
    "RECOVERY_INVALID_TIMESTAMP",
    "Recovery evidence timestamp is missing, invalid, or lacks an explicit timezone"
  );
}

function responseFromReceipt(row: {
  result_body: unknown;
  provider_execution_id: string;
  outbox_job_id: string;
  dispatch_id: string;
  compiled_request_id: string;
  request_fingerprint: string;
  generation_mode: string;
  provider_id: string;
  model_id: string;
}): PreDispatchRecoveryCommandResult {
  return {
    recovery: RuntimeRecoveryCommandResultSchema.parse(row.result_body),
    replayed: true,
    providerExecutionId: row.provider_execution_id,
    outboxJobId: row.outbox_job_id,
    dispatchId: row.dispatch_id,
    compiledRequestId: row.compiled_request_id,
    requestFingerprint: row.request_fingerprint,
    generationMode: row.generation_mode,
    providerId: row.provider_id,
    modelId: row.model_id,
    preRecoveryState: "PRE_DISPATCH_BLOCKED",
    postRecoveryState: "RECOVERY_AUTHORIZED",
    claimableAfterRecovery: true,
  };
}

/**
 * Atomically reclassifies pre-provider validation evidence and rearms the
 * already-created lineage. It never calls release or creates execution,
 * outbox, dispatch, provider-attempt, result, or review identities.
 */
export class AiStoryPreDispatchRecoveryRepository {
  constructor(
    private readonly db: Db = getDb(),
    private readonly normalizeTimestamp: (value: unknown) => string = normalizeTimestampToIso
  ) {}

  async recover(input: PreDispatchRecoveryCommandInput): Promise<PreDispatchRecoveryCommandResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sceneExecutionId}))`);

      const existingRows = (await tx.execute(sql`
        select receipt.result_body,
               correlation.provider_execution_id,
               correlation.outbox_job_id,
               dispatch.dispatch_id,
               compiled.compiled_request_id,
               compiled.request_fingerprint,
               compiled.generation_mode,
               compiled.provider_id,
               compiled.model_id
        from admin_runtime_recovery_receipts receipt
        join ai_story_scene_scheduling_correlations correlation
          on correlation.scene_execution_id = ${input.sceneExecutionId}::uuid
         and correlation.execution_plan_id = ${input.executionPlanId}::uuid
        join provider_execution_dispatches dispatch
          on dispatch.job_id = correlation.outbox_job_id
        join ai_story_compiled_provider_requests compiled
          on compiled.scene_execution_id = correlation.scene_execution_id
        where receipt.command_type = ${AI_STORY_PRE_DISPATCH_RECOVERY_COMMAND}
          and receipt.target_id = dispatch.dispatch_id
        order by receipt.accepted_at desc
        limit 1
      `)) as unknown as Array<{
        result_body: unknown;
        provider_execution_id: string;
        outbox_job_id: string;
        dispatch_id: string;
        compiled_request_id: string;
        request_fingerprint: string;
        generation_mode: string;
        provider_id: string;
        model_id: string;
      }>;
      if (existingRows[0]) return responseFromReceipt(existingRows[0]);

      const rows = (await tx.execute(sql`
        select correlation.execution_plan_id,
               correlation.scene_execution_id,
               correlation.org_id,
               correlation.workspace_id,
               release.release_state,
               correlation.provider_execution_id,
               execution.status as provider_execution_status,
               correlation.outbox_job_id,
               outbox.status as outbox_status,
               dispatch.dispatch_id,
               compiled.compiled_request_id,
               compiled.request_fingerprint,
               compiled.generation_mode,
               compiled.provider_id,
               compiled.model_id,
               routing.selected_provider_id,
               worker.worker_execution_result_id,
               worker.provider_attempt_id,
               worker.provider_request_id,
               worker.worker_state,
               worker.result as worker_result,
               worker.deterministic_integrity_hash as worker_integrity_hash,
               worker.produced_at,
               (select count(*)::int from provider_attempts attempt
                 where attempt.execution_id = correlation.provider_execution_id) as attempt_count,
               (select count(*)::int from ai_story_scene_results result
                 where result.scene_execution_id = correlation.scene_execution_id) as result_count,
               (select count(*)::int from ai_story_generated_scene_reviews review
                 where review.scene_execution_id = correlation.scene_execution_id) as review_count
        from ai_story_scene_scheduling_correlations correlation
        join ai_story_scene_release_states release
          on release.scene_execution_id = correlation.scene_execution_id
        join provider_executions execution
          on execution.execution_id = correlation.provider_execution_id
        join provider_outbox_jobs outbox
          on outbox.job_id = correlation.outbox_job_id
        join provider_execution_dispatches dispatch
          on dispatch.job_id = outbox.job_id
        join ai_story_compiled_provider_requests compiled
          on compiled.scene_execution_id = correlation.scene_execution_id
        join ai_story_scene_routing_decisions routing
          on routing.routing_decision_id = correlation.routing_decision_id
        left join ai_story_worker_execution_results worker
          on worker.dispatch_id = dispatch.dispatch_id
        where correlation.execution_plan_id = ${input.executionPlanId}::uuid
          and correlation.scene_execution_id = ${input.sceneExecutionId}::uuid
        for update of release, execution, outbox, dispatch
      `)) as unknown as RecoveryRow[];
      const row = rows[0];
      if (!row) {
        throw new PreDispatchRecoveryRepositoryError(
          "RECOVERY_NOT_FOUND",
          "Recoverable Scene dispatch lineage was not found"
        );
      }
      if (row.org_id !== input.orgId || row.workspace_id !== input.workspaceId) {
        throw new PreDispatchRecoveryRepositoryError(
          "RECOVERY_ACCESS_DENIED",
          "Cross-workspace or cross-tenant recovery denied"
        );
      }
      if (row.provider_id !== row.selected_provider_id) {
        throw new PreDispatchRecoveryRepositoryError(
          "AUTHORITY_CONFLICT",
          "Compiled Provider authority conflicts with the accepted routing decision"
        );
      }
      assertRecoverablePreDispatchState({
        releaseState: row.release_state,
        providerExecutionStatus: row.provider_execution_status,
        outboxStatus: row.outbox_status,
        workerState: row.worker_state,
        providerRequestId: row.provider_request_id,
        providerAttemptCount: Number(row.attempt_count),
        resultCount: Number(row.result_count),
        generatedReviewCount: Number(row.review_count),
      });
      // Raw postgres-js query results hydrate timestamptz columns as strings in
      // production. Normalize before the first durable mutation so invalid
      // evidence fails closed and the transaction remains untouched.
      const producedAtIso = row.worker_execution_result_id
        ? this.normalizeTimestamp(row.produced_at)
        : null;

      const receiptId = deterministicPersistenceUuid("ai-story-pre-dispatch-recovery-receipt", {
        executionPlanId: input.executionPlanId,
        sceneExecutionId: input.sceneExecutionId,
        dispatchId: row.dispatch_id,
      });
      const commandId = deterministicPersistenceUuid("ai-story-pre-dispatch-recovery-command", {
        receiptId,
        actorUserId: input.actorUserId,
      });
      const acceptedAt = new Date().toISOString();
      const resultBase = {
        contractVersion: "1" as const,
        commandType: AI_STORY_PRE_DISPATCH_RECOVERY_COMMAND,
        commandId,
        executionPlanId: input.executionPlanId,
        targetId: row.dispatch_id,
        status: "ACCEPTED" as const,
        explanation: {
          willHappen: [
            "Rearm the existing Scene provider dispatch for one Worker claim",
            "Revalidate Scene generation and reference authority before any provider submission",
          ],
          willNotHappen: [
            "No Scene release, provider execution, outbox, or dispatch identity is created",
            "No provider call is performed by this command",
          ],
        },
        outcomeSummary:
          `Existing pre-dispatch-blocked lineage authorized for one recovery claim; ` +
          `compiledRequest=${row.compiled_request_id}; fingerprint=${row.request_fingerprint}; ` +
          `generationMode=${row.generation_mode}; provider=${row.provider_id}; model=${row.model_id}`,
        acceptedAt,
      };
      const recovery = RuntimeRecoveryCommandResultSchema.parse({
        ...resultBase,
        integrityHash: integrityHash(resultBase),
      });

      // The old NOT_ACCEPTED row is pre-provider validation evidence, not a
      // provider terminal result. Archive it append-only before freeing the
      // dispatch terminal slot for the real Attempt 1 result.
      if (row.worker_execution_result_id) {
        const observationId = deterministicPersistenceUuid("ai-story-pre-dispatch-blocked-archive", {
          dispatchId: row.dispatch_id,
          compiledRequestId: row.compiled_request_id,
          requestFingerprint: row.request_fingerprint,
          generationMode: row.generation_mode,
          providerId: row.provider_id,
          modelId: row.model_id,
          workerExecutionResultId: row.worker_execution_result_id,
        });
        await tx.execute(sql`
          insert into ai_story_worker_attempt_observations (
            observation_id, org_id, workspace_id, provider_execution_id,
            provider_attempt_id, dispatch_id, outbox_job_id, provider_request_id,
            observation_kind, reconciliation_required, deterministic_integrity_hash,
            observation, produced_at
          ) values (
            ${observationId}::uuid, ${row.org_id}::uuid, ${row.workspace_id}::uuid,
            ${row.provider_execution_id}, ${row.provider_attempt_id}, ${row.dispatch_id},
            ${row.outbox_job_id}, null, 'PRE_DISPATCH_BLOCKED', false,
            ${row.worker_integrity_hash}, ${JSON.stringify(row.worker_result)}::jsonb,
            ${producedAtIso}::timestamptz
          ) on conflict (observation_id) do nothing
        `);
        await tx.execute(sql`
          delete from ai_story_worker_execution_results
          where worker_execution_result_id = ${row.worker_execution_result_id}::uuid
        `);
      }
      await tx.execute(sql`
        insert into admin_runtime_recovery_receipts (
          recovery_receipt_id, command_type, command_id, org_id, workspace_id,
          execution_plan_id, target_id, idempotency_key, actor_user_id, reason,
          status, accepted_at, integrity_hash, contract_version, result_body
        ) values (
          ${receiptId}::uuid, ${recovery.commandType}, ${recovery.commandId}::uuid,
          ${row.org_id}::uuid, ${row.workspace_id}::uuid,
          ${input.executionPlanId}::uuid, ${row.dispatch_id}, ${input.idempotencyKey},
          ${input.actorUserId}::uuid, ${input.reason}, ${recovery.status},
          ${recovery.acceptedAt}::timestamptz, ${recovery.integrityHash},
          ${recovery.contractVersion}, ${JSON.stringify(recovery)}::jsonb
        )
      `);
      await tx.execute(sql`
        update provider_outbox_jobs
        set status = 'PENDING',
            next_visible_at = now(),
            lease_owner = null,
            lease_expires_at = null,
            retry_delay_ms = null,
            retry_classification = null,
            last_error_category = null,
            operator_notes = ${`${AI_STORY_PRE_DISPATCH_RECOVERY_MARKER}${receiptId}`},
            updated_at = now()
        where job_id = ${row.outbox_job_id}
      `);

      return {
        recovery,
        replayed: false,
        providerExecutionId: row.provider_execution_id,
        outboxJobId: row.outbox_job_id,
        dispatchId: row.dispatch_id,
        compiledRequestId: row.compiled_request_id,
        requestFingerprint: row.request_fingerprint,
        generationMode: row.generation_mode,
        providerId: row.provider_id,
        modelId: row.model_id,
        preRecoveryState: "PRE_DISPATCH_BLOCKED",
        postRecoveryState: "RECOVERY_AUTHORIZED",
        claimableAfterRecovery: true,
      };
    });
  }
}
