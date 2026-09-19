import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { createExecutionDispatch } from "@ceo-agent/shared";
import { SceneAttemptInputRevisionFactSchema } from "@ceo-agent/shared";
import { SceneSchedulingCoordinator } from "../packages/agents/src/ai-story/scene-scheduling-coordinator";
import { SceneFinalizationCoordinator } from "../packages/agents/src/ai-story/scene-finalization-coordinator";
import {
  applyRetryInputRevision,
} from "../packages/agents/src/ai-story/differentiated-retry-service";
import {
  mapCompiledInstructionsToCanonicalScenePayload,
} from "../packages/agents/src/ai-story/canonical-scene-payload-resolver";
import { CREATIVE_T2V_MODE } from "../packages/agents/src/ai-story/product-grounding-contract";
import {
  closeDb,
  CertificationCommercialAuthorityService,
  DifferentiatedRetryRepository,
  ExecutionEnvelopeRepository,
  ProviderExecutionFinalizationRepository,
  ProviderLedgerRepository,
  ProviderOutboxRepository,
  SceneProjectionRepositoryImpl,
  SceneProviderWorkerRuntimeRepository,
} from "@ceo-agent/db";
import {
  PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
} from "@ceo-agent/shared/server";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  FixedSeedanceRouter,
  PR32_USER_A,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import { buildTerminalSuccessWorkerResult } from "./helpers/ai-story-pr35-finalizer";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";

const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const T2V_IDS: Phase2aIdSet = {
  orgId: "e61c2148-0b3f-4629-b1e7-1aa954120501",
  workspaceId: "a12f7a1e-0000-4000-8000-000000000001",
  campaignId: "8d1bdda0-0000-4000-8000-000000000001",
  storyId: "e61c2148-0b3f-4629-b1e7-1aa954120518",
  storyVersionId: "e61c2148-0b3f-4629-b1e7-1aa954120519",
  animationPackageId: "e61c2148-0b3f-4629-b1e7-1aa95412051a",
  assetId: "c0e04afc-01fc-4578-8697-ec76fb6d0a82",
};
const HASH = `sha256:${"a".repeat(64)}`;
const retrySql = readFileSync(
  resolve(process.cwd(), "packages/db/sql/ai-story-t2v-human-retry-contract-v1.sql"),
  "utf8"
);

describeIntegration("T2V human retry SQL predecessor compatibility", () => {
  let sql: Sql;
  const schemaName = `t2v_retry_${randomUUID().replaceAll("-", "")}`;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await sql.unsafe(`CREATE SCHEMA ${schemaName}; SET search_path TO ${schemaName}, public;`);
  });

  afterAll(async () => {
    if (sql) await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    if (sql) await sql.end();
  });

  it("keeps historical FIRST_FRAME_I2V retry rows readable after the v2 mode constraint", async () => {
    await sql.unsafe(`
      SET search_path TO ${schemaName}, public;
      CREATE TABLE ai_story_scene_attempt_input_revisions (
        retry_input_revision_id uuid PRIMARY KEY,
        product_asset_id uuid NOT NULL,
        product_authority_hash text NOT NULL,
        visual_authority_certification_hash text NOT NULL,
        provider_mode_requirement text NOT NULL,
        fact jsonb NOT NULL
      );
      ALTER TABLE ai_story_scene_attempt_input_revisions
        ADD CONSTRAINT ai_story_scene_retry_revision_mode_v1
        CHECK (provider_mode_requirement = 'FIRST_FRAME_I2V');
    `);
    const historicalId = randomUUID();
    await sql.unsafe(`
      INSERT INTO ai_story_scene_attempt_input_revisions
        (retry_input_revision_id, product_asset_id, product_authority_hash,
         visual_authority_certification_hash, provider_mode_requirement, fact)
      VALUES (
        '${historicalId}', '${randomUUID()}', '${HASH}', '${HASH}', 'FIRST_FRAME_I2V',
        '{"providerModeRequirement":"FIRST_FRAME_I2V"}'
      )
    `);
    await sql.unsafe(`SET search_path TO ${schemaName}, public; ${retrySql}`);
    const rows = await sql<{ provider_mode_requirement: string; product_asset_id: string }[]>`
      SELECT provider_mode_requirement, product_asset_id::text
        FROM ai_story_scene_attempt_input_revisions
       WHERE retry_input_revision_id = ${historicalId}::uuid
    `;
    expect(rows).toEqual([{
      provider_mode_requirement: "FIRST_FRAME_I2V",
      product_asset_id: rows[0]!.product_asset_id,
    }]);
    await sql.unsafe(`
      INSERT INTO ai_story_scene_attempt_input_revisions
        (retry_input_revision_id, product_asset_id, product_authority_hash,
         visual_authority_certification_hash, provider_mode_requirement, fact)
      VALUES (
        '${randomUUID()}', NULL, NULL, NULL, 'REFERENCE_FREE_T2V',
        '{"providerModeRequirement":"REFERENCE_FREE_T2V"}'
      )
    `);
    await expect(sql.unsafe(`
      INSERT INTO ai_story_scene_attempt_input_revisions
        (retry_input_revision_id, product_asset_id, product_authority_hash,
         visual_authority_certification_hash, provider_mode_requirement, fact)
      VALUES (
        '${randomUUID()}', '${randomUUID()}', '${HASH}', '${HASH}', 'REFERENCE_FREE_T2V',
        '{"providerModeRequirement":"REFERENCE_FREE_T2V"}'
      )
    `)).rejects.toThrow();
  });
});

describeIntegration("Scene 1 REFERENCE_FREE_T2V human retry PostgreSQL certification", () => {
  let sql: Sql;

  beforeAll(async () => {
    sql = createIntegrationSql();
    await cleanupPr32Tenant(sql, T2V_IDS);
    await seedPr32Tenant(sql, T2V_IDS, PR32_USER_A, "t2v-retry");
  }, 180_000);

  afterAll(async () => {
    await cleanupPr32Tenant(sql, T2V_IDS);
    await sql.end();
    await closeDb();
  }, 60_000);

  it("creates a reference-free retry revision and compiled request without Provider submission", async () => {
    const prepared = await prepareAuthorizedSchedulingPlan({
      purpose: "t2v-human-retry-scene-1",
      ids: T2V_IDS,
      sceneOrder: [0],
      referenceFreeT2vOrders: [0],
    });
    const sourceIntent = prepared.persisted.intents[0]!;
    expect(sourceIntent.generationAuthority).toMatchObject({
      strategy: "TEXT_TO_VIDEO",
      referenceSource: "REFERENCE_FREE_T2V",
    });
    expect(sourceIntent.referencedAssetIds).toEqual([]);

    const scheduled = await new SceneSchedulingCoordinator({
      router: new FixedSeedanceRouter(),
    }).scheduleAuthorizedScene({
      executionPlanId: prepared.executionPlanId,
      sceneExecutionId: prepared.sceneExecutionIds[0]!,
      runtimeAuthorizationId: prepared.acceptedAuthorization.runtimeAuthorizationId,
      commercialAuthorizationId: prepared.commercialAuthorizationId,
      actorUserId: PR32_USER_A,
    });
    const envelope = await new ExecutionEnvelopeRepository().getEnvelope(scheduled.envelopeId);
    expect(envelope).toBeTruthy();
    const dispatch = await createExecutionDispatch({
      version: "1",
      dispatchId: `dispatch:${scheduled.outboxJobId}`,
      jobId: scheduled.outboxJobId,
      executionId: scheduled.providerExecutionId,
      envelopeId: scheduled.envelopeId,
      payloadReference: scheduled.payloadReference,
      correlationId: scheduled.correlation.correlationId,
      tenantId: scheduled.correlation.ownership.orgId,
      workspaceId: scheduled.correlation.ownership.workspaceId,
      capabilityId: scheduled.routingDecision.capabilityId,
      capabilityVersion: scheduled.routingDecision.capabilityVersion,
      requestHash: scheduled.requestHash,
      envelopeHash: scheduled.envelopeHash,
      workerHandoff: {
        envelopeId: scheduled.envelopeId,
        payloadReference: scheduled.payloadReference,
        dispatchContractVersion: "1",
      },
      status: "DISPATCHED",
      createdAt: scheduled.correlation.scheduledAt,
    });
    await sql`
      INSERT INTO provider_execution_dispatches (
        dispatch_id, version, job_id, execution_id, envelope_id,
        payload_reference, correlation_id, org_id, workspace_id,
        capability_id, capability_version, request_hash, envelope_hash,
        worker_handoff, dispatch_hash, status, created_at
      ) VALUES (
        ${dispatch.dispatchId}, ${dispatch.version}, ${dispatch.jobId},
        ${dispatch.executionId}, ${dispatch.envelopeId}, ${dispatch.payloadReference},
        ${dispatch.correlationId}, ${dispatch.tenantId}, ${dispatch.workspaceId},
        ${dispatch.capabilityId}, ${dispatch.capabilityVersion}, ${dispatch.requestHash},
        ${dispatch.envelopeHash}, ${sql.json(dispatch.workerHandoff)},
        ${dispatch.dispatchHash}, ${dispatch.status}, ${dispatch.createdAt}
      )
    `;

    const chain = new SceneProjectionRepositoryImpl();
    const loaded = await chain.loadValidatedBundleByDispatchId(dispatch.dispatchId);
    expect(loaded).toBeTruthy();
    const worker = buildTerminalSuccessWorkerResult(loaded!, {
      providerExecutionId: loaded!.providerExecutionId,
      outboxJobId: loaded!.outboxJobId,
      dispatchId: loaded!.dispatch.dispatchId,
      routingDecisionId: loaded!.routingDecision.routingDecisionId,
      providerId: loaded!.routingDecision.selectedProviderId,
      adapterVersion: loaded!.routingDecision.selectedAdapterVersion,
      providerAttemptId: randomUUID(),
      workerExecutionResultId: randomUUID(),
    });
    await new SceneProviderWorkerRuntimeRepository().acceptOrReturnWorkerExecutionResult(worker);

    const outcome = await new SceneFinalizationCoordinator({
      chain,
      bridge: {
        ledger: new ProviderLedgerRepository(),
        outbox: new ProviderOutboxRepository(),
      },
      productionFinalizer: new ProviderExecutionFinalizationRepository(),
      projection: chain,
    }).finalizeAndProject({ dispatchId: dispatch.dispatchId });
    expect(outcome.outcome).toBe("PROJECTED");
    if (outcome.outcome !== "PROJECTED") throw new Error("expected PROJECTED");

    const repo = new DifferentiatedRetryRepository();
    const rejection = await repo.rejectCreative({
      executionPlanId: outcome.sceneResult.executionPlanId,
      sceneExecutionId: outcome.sceneResult.sceneExecutionId,
      workspaceId: dispatch.workspaceId,
      actorUserId: PR32_USER_A,
      reason: "COMPOSITION_UNACCEPTABLE",
    });
    expect(rejection.eligibility.eligibility).toBe("ELIGIBLE");

    await expect(repo.createInputRevision({
      executionPlanId: outcome.sceneResult.executionPlanId,
      sceneExecutionId: outcome.sceneResult.sceneExecutionId,
      workspaceId: dispatch.workspaceId,
      actorUserId: PR32_USER_A,
      sourceReviewId: rejection.reviewId,
      creativeDirection: {
        visualRole: "closed lily bud poetic opening for next Product reveal",
        cameraInstruction: "fast elegant time-lapse bloom",
        focusProgression: ["closed lily bud", "elegant time-lapse bloom"],
        shotEmphasis: "poetic opening for next Product reveal",
      },
      expectedProductAssetId: T2V_IDS.assetId,
      productAuthorityHash: HASH,
      visualAuthorityCertificationHash: HASH,
    })).rejects.toMatchObject({ code: "RETRY_MODE_ESCALATION_DENIED" });

    const revision = await repo.createInputRevision({
      executionPlanId: outcome.sceneResult.executionPlanId,
      sceneExecutionId: outcome.sceneResult.sceneExecutionId,
      workspaceId: dispatch.workspaceId,
      actorUserId: PR32_USER_A,
      sourceReviewId: rejection.reviewId,
      creativeDirection: {
        visualRole: "closed lily bud poetic opening for next Product reveal",
        cameraInstruction: "fast elegant time-lapse bloom",
        focusProgression: ["closed lily bud", "elegant time-lapse bloom"],
        shotEmphasis: "poetic opening for next Product reveal",
      },
    });
    const parsed = SceneAttemptInputRevisionFactSchema.parse(revision);
    expect(parsed.providerModeRequirement).toBe("REFERENCE_FREE_T2V");
    expect(parsed.productAssetId).toBeNull();
    expect(parsed.productAuthorityHash).toBeNull();
    expect(parsed.visualAuthorityCertificationHash).toBeNull();

    const authorization = await repo.authorizeRetry({
      executionPlanId: outcome.sceneResult.executionPlanId,
      sceneExecutionId: outcome.sceneResult.sceneExecutionId,
      workspaceId: dispatch.workspaceId,
      actorUserId: PR32_USER_A,
      sourceReviewId: rejection.reviewId,
      retryInputRevisionId: revision.retryInputRevisionId,
    });
    expect(authorization.authorizedAttemptNumber).toBe(2);

    const baseInstructions = prepared.persisted.instructionsBySceneExecutionId[
      sourceIntent.identity.sceneExecutionId
    ]!;
    const frozenAuthority = JSON.stringify(sourceIntent.generationAuthority);
    const revised = applyRetryInputRevision(baseInstructions, parsed);
    const payload = mapCompiledInstructionsToCanonicalScenePayload({
      instructions: revised,
      intent: sourceIntent,
    });
    expect(payload.generationMode).toBe(CREATIVE_T2V_MODE);
    expect(payload.assetReferences).toEqual([]);
    expect(payload.productGrounding).toBeUndefined();
    expect(revised.generationAuthority).toEqual(sourceIntent.generationAuthority);
    expect(JSON.stringify(sourceIntent.generationAuthority)).toBe(frozenAuthority);
    expect(revised.referencedAssetIds).toEqual([]);

    const [counts] = await sql<{ attempts: number; revisions: number }[]>`
      SELECT
        (SELECT count(*)::int FROM provider_attempts WHERE execution_id = ${dispatch.executionId}) AS attempts,
        (SELECT count(*)::int FROM ai_story_scene_attempt_input_revisions
          WHERE scene_execution_id = ${outcome.sceneResult.sceneExecutionId}) AS revisions
    `;
    expect(counts?.attempts).toBe(1);
    expect(counts?.revisions).toBeGreaterThanOrEqual(1);

    const commercial = new CertificationCommercialAuthorityService();
    const scope = await commercial.getActiveScope("PRODUCTION", T2V_IDS.orgId, T2V_IDS.workspaceId);
    if (scope?.environment === "PRODUCTION" && scope.status === "ACTIVE" && scope.maxProviderSubmissions === 1) {
      const amended = await commercial.amendActiveProductionSubmissionQuota({
        environment: "PRODUCTION",
        certificationScopeId: scope.certificationScopeId,
        orgId: T2V_IDS.orgId,
        workspaceId: T2V_IDS.workspaceId,
        actorUserId: PR32_USER_A,
        humanAuthorizationReason: PRODUCTION_ADDITIONAL_SUBMISSION_QUOTA_AMENDMENT_REASON,
        amendedAt: "2026-09-19T16:30:00.000Z",
        maxProviderSubmissions: 2,
      });
      expect(amended.scope.maxProviderSubmissions).toBe(2);
      expect(amended.scope.maxProviderCostUsd).toBe(scope.maxProviderCostUsd);
    }
  }, 180_000);
});
