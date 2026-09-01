import { sql } from "drizzle-orm";
import { getDb } from "../client";
import {
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
} from "./ai-story-scene-execution-persistence";

type Db = ReturnType<typeof getDb>;

export const CERTIFICATION_SLOT_RECONCILIATION_VERSION =
  "certification-submission-slot-reconciliation.v1" as const;
export const CERTIFICATION_SLOT_RECONCILIATION_REASON =
  "PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION" as const;
export const CERTIFICATION_SLOT_RECONCILIATION_OUTCOME =
  "PROVEN_NOT_SUBMITTED" as const;

export type CertificationSubmissionQuotaProjection = {
  grossConsumed: number;
  reconciledNonSubmissions: number;
  effectiveConsumed: number;
  reservedInFlight: number;
  maximum: number;
  remaining: number;
};

export function projectCertificationSubmissionQuota(input: {
  grossConsumed: number;
  reconciledNonSubmissions: number;
  reservedInFlight: number;
  maximum: number;
}): CertificationSubmissionQuotaProjection {
  if (
    !Number.isInteger(input.grossConsumed) ||
    !Number.isInteger(input.reconciledNonSubmissions) ||
    !Number.isInteger(input.reservedInFlight) ||
    !Number.isInteger(input.maximum) ||
    input.grossConsumed < 0 ||
    input.reconciledNonSubmissions < 0 ||
    input.reconciledNonSubmissions > input.grossConsumed ||
    input.reservedInFlight < 0 ||
    input.maximum < 1
  ) {
    throw new CertificationSubmissionSlotReconciliationError(
      "RECONCILIATION_QUOTA_INVALID",
      "Certification submission quota projection is internally inconsistent"
    );
  }
  const effectiveConsumed = input.grossConsumed - input.reconciledNonSubmissions;
  return {
    ...input,
    effectiveConsumed,
    remaining: Math.max(0, input.maximum - effectiveConsumed - input.reservedInFlight),
  };
}

export type CertificationSubmissionSlotReconciliationErrorCode =
  | "RECONCILIATION_NOT_FOUND"
  | "RECONCILIATION_ACCESS_DENIED"
  | "RECONCILIATION_NOT_ELIGIBLE"
  | "RECONCILIATION_IDENTITY_CONFLICT"
  | "RECONCILIATION_QUOTA_INVALID";

export class CertificationSubmissionSlotReconciliationError extends Error {
  constructor(
    readonly code: CertificationSubmissionSlotReconciliationErrorCode,
    message: string
  ) {
    super(message);
    this.name = "CertificationSubmissionSlotReconciliationError";
  }
}

export type ReconcileCertificationSubmissionSlotInput = {
  environment: "STAGING";
  orgId: string;
  workspaceId: string;
  certificationScopeId: string;
  sceneExecutionId: string;
  dispatchId: string;
  reservationId: string;
  sourceConsumptionEventId: string;
  outcomeClassification: "PROVEN_NOT_SUBMITTED";
  reason: "PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION";
  actorUserId: string;
  idempotencyKey: string;
  evidence: Readonly<Record<string, unknown>>;
  createdAt?: string;
};

export type CertificationSubmissionSlotReconciliationResult = {
  reconciliationId: string;
  sourceConsumptionEventId: string;
  quotaBefore: CertificationSubmissionQuotaProjection;
  quotaAfter: CertificationSubmissionQuotaProjection;
  integrityHash: string;
  contractVersion: typeof CERTIFICATION_SLOT_RECONCILIATION_VERSION;
  createdAt: string;
  replayed: boolean;
};

type AuthorityRow = {
  certification_scope_id: string;
  environment: string;
  org_id: string;
  workspace_id: string;
  max_provider_submissions: number;
  consumed_provider_submissions: number;
  reserved_provider_submissions: number;
  reservation_status: string;
  settled_cost_usd: string | null;
  reservation_execution_identity: string;
  source_consumption_event_id: string;
  source_event_type: string;
  scene_execution_id: string;
  dispatch_id: string;
  worker_state: string | null;
  acceptance_classification: string | null;
  canonical_provider_state: string | null;
  provider_request_id: string | null;
  worker_attempt_identity: string | null;
  attempt_count: number;
  attempt_binding_count: number;
  scene_result_count: number;
  reconciled_count: number;
};

type ReceiptRow = {
  reconciliation_id: string;
  source_consumption_event_id: string;
  quota_before: CertificationSubmissionQuotaProjection;
  quota_after: CertificationSubmissionQuotaProjection;
  integrity_hash: string;
  contract_version: typeof CERTIFICATION_SLOT_RECONCILIATION_VERSION;
  created_at: Date | string;
  scene_execution_id: string;
  dispatch_id: string;
  certification_reservation_id: string;
  outcome_classification: string;
  reason: string;
};

function resultFromRow(row: ReceiptRow, replayed: boolean): CertificationSubmissionSlotReconciliationResult {
  return {
    reconciliationId: row.reconciliation_id,
    sourceConsumptionEventId: row.source_consumption_event_id,
    quotaBefore: row.quota_before,
    quotaAfter: row.quota_after,
    integrityHash: row.integrity_hash,
    contractVersion: row.contract_version,
    createdAt: new Date(row.created_at).toISOString(),
    replayed,
  };
}

/**
 * Appends one correction authority for one exact gross SUBMITTED event.
 * The gross counter and reservation/event history are deliberately untouched.
 */
export class CertificationSubmissionSlotReconciliationService {
  constructor(private readonly db: Db = getDb()) {}

  async getQuotaProjection(scopeId: string): Promise<CertificationSubmissionQuotaProjection> {
    const rows = (await this.db.execute(sql`
      select scope.max_provider_submissions,
             scope.consumed_provider_submissions,
             scope.reserved_provider_submissions,
             count(reconciliation.reconciliation_id)::int as reconciled_count
      from certification_commercial_scopes scope
      left join certification_submission_slot_reconciliations reconciliation
        on reconciliation.certification_scope_id = scope.certification_scope_id
      where scope.certification_scope_id = ${scopeId}::uuid
      group by scope.certification_scope_id
    `)) as unknown as Array<{
      max_provider_submissions: number;
      consumed_provider_submissions: number;
      reserved_provider_submissions: number;
      reconciled_count: number;
    }>;
    const row = rows[0];
    if (!row) {
      throw new CertificationSubmissionSlotReconciliationError(
        "RECONCILIATION_NOT_FOUND",
        "Certification commercial scope was not found"
      );
    }
    return projectCertificationSubmissionQuota({
      maximum: Number(row.max_provider_submissions),
      grossConsumed: Number(row.consumed_provider_submissions),
      reconciledNonSubmissions: Number(row.reconciled_count),
      reservedInFlight: Number(row.reserved_provider_submissions),
    });
  }

  async reconcile(
    input: ReconcileCertificationSubmissionSlotInput
  ): Promise<CertificationSubmissionSlotReconciliationResult> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.certificationScopeId}))`);

      const replayRows = (await tx.execute(sql`
        select * from certification_submission_slot_reconciliations
        where idempotency_key = ${input.idempotencyKey}
        limit 1
      `)) as unknown as ReceiptRow[];
      const replay = replayRows[0];
      if (replay) {
        if (
          replay.source_consumption_event_id !== input.sourceConsumptionEventId ||
          replay.scene_execution_id !== input.sceneExecutionId ||
          replay.dispatch_id !== input.dispatchId ||
          replay.certification_reservation_id !== input.reservationId ||
          replay.outcome_classification !== input.outcomeClassification ||
          replay.reason !== input.reason
        ) {
          throw new CertificationSubmissionSlotReconciliationError(
            "RECONCILIATION_IDENTITY_CONFLICT",
            "Idempotency key belongs to different slot-reconciliation authority"
          );
        }
        return resultFromRow(replay, true);
      }

      const rows = (await tx.execute(sql`
        select scope.certification_scope_id, scope.environment, scope.org_id,
               scope.workspace_id, scope.max_provider_submissions,
               scope.consumed_provider_submissions, scope.reserved_provider_submissions,
               reservation.status as reservation_status,
               reservation.settled_cost_usd::text as settled_cost_usd,
               reservation.execution_identity as reservation_execution_identity,
               event.certification_commercial_event_id as source_consumption_event_id,
               event.event_type as source_event_type,
               correlation.scene_execution_id, dispatch.dispatch_id,
               worker.worker_state, worker.acceptance_classification,
               worker.canonical_provider_state, worker.provider_request_id,
               worker.provider_attempt_id as worker_attempt_identity,
               (select count(*)::int from provider_attempts attempt
                 where attempt.execution_id = dispatch.execution_id) as attempt_count,
               (select count(*)::int from ai_story_provider_attempt_compiled_bindings binding
                 where binding.scene_execution_id = correlation.scene_execution_id) as attempt_binding_count,
               (select count(*)::int from ai_story_scene_results result
                 where result.scene_execution_id = correlation.scene_execution_id) as scene_result_count,
               (select count(*)::int from certification_submission_slot_reconciliations prior
                 where prior.certification_scope_id = scope.certification_scope_id) as reconciled_count
        from certification_commercial_scopes scope
        join certification_commercial_reservations reservation
          on reservation.certification_scope_id = scope.certification_scope_id
        join certification_commercial_events event
          on event.certification_reservation_id = reservation.certification_reservation_id
         and event.event_type = 'SUBMITTED'
        join provider_execution_dispatches dispatch
          on dispatch.dispatch_id = ${input.dispatchId}
        join ai_story_scene_scheduling_correlations correlation
          on correlation.provider_execution_id = dispatch.execution_id
         and correlation.outbox_job_id = dispatch.job_id
        left join ai_story_worker_execution_results worker
          on worker.dispatch_id = dispatch.dispatch_id
        where scope.certification_scope_id = ${input.certificationScopeId}::uuid
          and reservation.certification_reservation_id = ${input.reservationId}::uuid
          and event.certification_commercial_event_id = ${input.sourceConsumptionEventId}::uuid
          and correlation.scene_execution_id = ${input.sceneExecutionId}::uuid
        for update of scope, reservation, dispatch
      `)) as unknown as AuthorityRow[];
      const row = rows[0];
      if (!row) {
        throw new CertificationSubmissionSlotReconciliationError(
          "RECONCILIATION_NOT_FOUND",
          "Exact slot-consumption lineage was not found"
        );
      }
      if (
        row.environment !== input.environment ||
        row.org_id !== input.orgId ||
        row.workspace_id !== input.workspaceId
      ) {
        throw new CertificationSubmissionSlotReconciliationError(
          "RECONCILIATION_ACCESS_DENIED",
          "Cross-environment, cross-organization, or cross-workspace reconciliation denied"
        );
      }
      const eligible =
        row.source_event_type === "SUBMITTED" &&
        row.reservation_status === "RELEASED" &&
        (row.settled_cost_usd === null || Number(row.settled_cost_usd) === 0) &&
        row.worker_state === "NOT_ACCEPTED" &&
        row.acceptance_classification === "NOT_ACCEPTED" &&
        row.canonical_provider_state === "NOT_ACCEPTED" &&
        row.provider_request_id === null &&
        row.worker_attempt_identity === row.reservation_execution_identity &&
        Number(row.attempt_count) === 0 &&
        Number(row.attempt_binding_count) === 0 &&
        Number(row.scene_result_count) === 0;
      if (!eligible) {
        throw new CertificationSubmissionSlotReconciliationError(
          "RECONCILIATION_NOT_ELIGIBLE",
          "Slot consumption is not proven to be a zero-charge Provider non-submission"
        );
      }

      const quotaBefore = projectCertificationSubmissionQuota({
        maximum: Number(row.max_provider_submissions),
        grossConsumed: Number(row.consumed_provider_submissions),
        reconciledNonSubmissions: Number(row.reconciled_count),
        reservedInFlight: Number(row.reserved_provider_submissions),
      });
      const quotaAfter = projectCertificationSubmissionQuota({
        maximum: quotaBefore.maximum,
        grossConsumed: quotaBefore.grossConsumed,
        reconciledNonSubmissions: quotaBefore.reconciledNonSubmissions + 1,
        reservedInFlight: quotaBefore.reservedInFlight,
      });
      const createdAt = input.createdAt ?? new Date().toISOString();
      const reconciliationId = deterministicPersistenceUuid(
        "certification-submission-slot-reconciliation",
        { sourceConsumptionEventId: input.sourceConsumptionEventId }
      );
      const body = {
        reconciliationId,
        environment: input.environment,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        certificationScopeId: input.certificationScopeId,
        sceneExecutionId: input.sceneExecutionId,
        dispatchId: input.dispatchId,
        reservationId: input.reservationId,
        sourceConsumptionEventId: input.sourceConsumptionEventId,
        outcomeClassification: input.outcomeClassification,
        reason: input.reason,
        actorUserId: input.actorUserId,
        idempotencyKey: input.idempotencyKey,
        evidence: input.evidence,
        quotaBefore,
        quotaAfter,
        contractVersion: CERTIFICATION_SLOT_RECONCILIATION_VERSION,
        createdAt,
      };
      const integrityHash = canonicalPersistenceHash(body);
      await tx.execute(sql`
        insert into certification_submission_slot_reconciliations (
          reconciliation_id, environment, org_id, workspace_id,
          certification_scope_id, scene_execution_id, dispatch_id,
          certification_reservation_id, source_consumption_event_id,
          outcome_classification, reason, actor_user_id, idempotency_key,
          evidence, quota_before, quota_after, integrity_hash,
          contract_version, created_at
        ) values (
          ${reconciliationId}::uuid, ${input.environment}, ${input.orgId}::uuid,
          ${input.workspaceId}::uuid, ${input.certificationScopeId}::uuid,
          ${input.sceneExecutionId}::uuid, ${input.dispatchId},
          ${input.reservationId}::uuid, ${input.sourceConsumptionEventId}::uuid,
          ${input.outcomeClassification}, ${input.reason}, ${input.actorUserId}::uuid,
          ${input.idempotencyKey}, ${JSON.stringify(input.evidence)}::jsonb,
          ${JSON.stringify(quotaBefore)}::jsonb, ${JSON.stringify(quotaAfter)}::jsonb,
          ${integrityHash}, ${CERTIFICATION_SLOT_RECONCILIATION_VERSION},
          ${createdAt}::timestamptz
        )
      `);
      return {
        reconciliationId,
        sourceConsumptionEventId: input.sourceConsumptionEventId,
        quotaBefore,
        quotaAfter,
        integrityHash,
        contractVersion: CERTIFICATION_SLOT_RECONCILIATION_VERSION,
        createdAt,
        replayed: false,
      };
    });
  }
}
