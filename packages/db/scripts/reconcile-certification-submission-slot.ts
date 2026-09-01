import { config } from "dotenv";
import { resolve } from "node:path";
import {
  AiStoryPreDispatchRecoveryRepository,
  CertificationSubmissionSlotReconciliationService,
} from "../src/index";
import { refuseProductionAiStoryApply } from "./refuse-production-ai-story-apply";

config({ path: resolve(process.cwd(), "../../apps/worker/.env") });
config({ path: resolve(process.cwd(), "../../.env.local") });
refuseProductionAiStoryApply();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  if (required("AI_STORY_PROVIDER_DISPATCH_MODE") !== "certification_no_dispatch") {
    throw new Error("CERTIFICATION_NO_DISPATCH_MUST_REMAIN_ACTIVE");
  }
  const actorUserId = required("SLOT_RECONCILIATION_ACTOR_USER_ID");
  const sceneExecutionId = required("SLOT_RECONCILIATION_SCENE_EXECUTION_ID");
  const dispatchId = required("SLOT_RECONCILIATION_DISPATCH_ID");
  const reservationId = required("SLOT_RECONCILIATION_RESERVATION_ID");
  const sourceConsumptionEventId = required("SLOT_RECONCILIATION_SOURCE_EVENT_ID");
  const certificationScopeId = required("SLOT_RECONCILIATION_SCOPE_ID");
  const idempotencyKey = required("SLOT_RECONCILIATION_IDEMPOTENCY_KEY");
  const service = new CertificationSubmissionSlotReconciliationService();
  const result = await service.reconcile({
    environment: "STAGING",
    orgId: required("SLOT_RECONCILIATION_ORG_ID"),
    workspaceId: required("SLOT_RECONCILIATION_WORKSPACE_ID"),
    certificationScopeId,
    sceneExecutionId,
    dispatchId,
    reservationId,
    sourceConsumptionEventId,
    outcomeClassification: "PROVEN_NOT_SUBMITTED",
    reason: "PROVEN_PROVIDER_NON_ACCEPTANCE_RECONCILIATION",
    actorUserId,
    idempotencyKey,
    evidence: {
      evidenceVersion: "scene-2-provider-non-acceptance.v1",
      workerState: "NOT_ACCEPTED",
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      providerRequestId: null,
      providerTaskId: null,
      providerChargeUsd: "0.00",
      providerHistoryWindowStart: required("SLOT_RECONCILIATION_WINDOW_START"),
      providerHistoryWindowEnd: required("SLOT_RECONCILIATION_WINDOW_END"),
      providerHistoryCandidates: 0,
      certifiedAt: new Date().toISOString(),
    },
  });

  let recovery: unknown = null;
  if (process.env.SLOT_RECONCILIATION_REARM === "true") {
    if (result.quotaAfter.effectiveConsumed !== 1 || result.quotaAfter.remaining !== 3) {
      throw new Error("RECONCILED_QUOTA_DOES_NOT_MATCH_AUTHORIZED_SCENE_2_STATE");
    }
    recovery = await new AiStoryPreDispatchRecoveryRepository().recover({
      executionPlanId: required("SLOT_RECONCILIATION_EXECUTION_PLAN_ID"),
      sceneExecutionId,
      orgId: required("SLOT_RECONCILIATION_ORG_ID"),
      workspaceId: required("SLOT_RECONCILIATION_WORKSPACE_ID"),
      actorUserId,
      idempotencyKey: `${idempotencyKey}:dispatch-rearm`,
      reason: "AI Story V1 STAGING proven non-submission slot reconciliation",
    });
  }

  console.log(JSON.stringify({ reconciliation: result, recovery }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
