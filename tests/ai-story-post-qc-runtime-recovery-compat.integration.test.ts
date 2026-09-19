import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import {
  AI_STORY_PROVIDER_RUNTIME_VERSION,
  AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
} from "@ceo-agent/shared";
import {
  DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
  DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION,
  DURABLE_SCENE_MEDIA_STORAGE_PROVIDER,
  PHASE1_EXECUTION_LOCKED,
} from "@ceo-agent/shared/server";
import {
  AiStoryPostGenerationQcRepository,
  AiStoryPostGenerationQcRuntimeAuthorityError,
  AiStoryProviderRuntimeRepository,
  BoundAiStoryPostGenerationQcRepository,
  closeDb,
  canonicalPersistenceHash,
  getDb,
} from "@ceo-agent/db";
import {
  AiStoryPostGenerationQcService,
  buildAiStoryPostGenerationQcInputFromCompiledAuthority,
} from "../packages/agents/src/ai-story/post-generation-qc-service";
import { compileImmutableSeedanceRequestFromSceneCompilation } from "../packages/agents/src/ai-story/provider-runtime-dispatch-integration";
import {
  createLocalDurableObjectStore,
  hashFileSha256Stream,
} from "../packages/agents/src/ai-story/durable-object-store";
import { AiStoryPostGenerationQcRuntimeOrchestrator } from "../apps/worker/src/ai-story-post-generation-qc-orchestrator";
import { runAiStoryProviderWorkerCycle } from "../apps/worker/src/ai-story-provider-worker-cycle";
import {
  RUN_DB_INTEGRATION,
  createIntegrationSql,
  getIntegrationDbUrl,
} from "./helpers/db-integration";
import {
  PR32_USER_A,
  cleanupPr32Tenant,
  prepareAuthorizedSchedulingPlan,
  seedPr32Tenant,
} from "./helpers/ai-story-pr32-scheduling";
import type { Phase2aIdSet } from "./helpers/ai-story-phase-2a";

const execFileAsync = promisify(execFile);
const describeIntegration = RUN_DB_INTEGRATION && getIntegrationDbUrl() ? describe : describe.skip;
const CURRENT_RUNTIME = AI_STORY_PROVIDER_RUNTIME_VERSION;
const HASH_B = `sha256:${"b".repeat(64)}`;

function uniqueIds(): Phase2aIdSet {
  return {
    orgId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    campaignId: crypto.randomUUID(),
    storyId: crypto.randomUUID(),
    storyVersionId: crypto.randomUUID(),
    animationPackageId: crypto.randomUUID(),
    assetId: crypto.randomUUID(),
  };
}

async function cleanupCompatTenant(sql: Sql, ids: Phase2aIdSet): Promise<void> {
  const [trigger] = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.ai_story_post_generation_qc_evaluations'::regclass
        AND tgname = 'ai_story_post_qc_immutable_v1'
    ) AS present
  `;
  if (trigger?.present) {
    await sql.unsafe(
      "ALTER TABLE ai_story_post_generation_qc_evaluations DISABLE TRIGGER ai_story_post_qc_immutable_v1"
    );
  }
  try {
    await sql`DELETE FROM ai_story_post_generation_qc_evaluations WHERE org_id = ${ids.orgId}`;
  } finally {
    if (trigger?.present) {
      await sql.unsafe(
        "ALTER TABLE ai_story_post_generation_qc_evaluations ENABLE TRIGGER ai_story_post_qc_immutable_v1"
      );
    }
  }
  await cleanupPr32Tenant(sql, ids);
}

type CompiledMode =
  | "none"
  | "unique"
  | "unrelated-later"
  | "no-hash-match"
  | "ambiguous";

type BindingMode = "none" | "exact" | "fingerprint-mismatch";

async function seedRecoveryScene(input: {
  readonly sql: Sql;
  readonly ids: Phase2aIdSet;
  readonly sceneIndex?: number;
  readonly prepared?: Awaited<ReturnType<typeof prepareAuthorizedSchedulingPlan>>;
  readonly contractVersion: typeof CURRENT_RUNTIME | "1";
  readonly compiled: CompiledMode;
  readonly binding: BindingMode;
  readonly projectedAt: string;
  readonly persistPostQc?: boolean;
  readonly media?: { readonly contentHash: string; readonly byteSize: number };
}) {
  const prepared = input.prepared ?? await prepareAuthorizedSchedulingPlan({
    purpose: `post-qc-recovery-${crypto.randomUUID()}`,
    ids: input.ids,
    userId: PR32_USER_A,
    sceneOrder: [input.sceneIndex ?? 0],
    skipCommercialAuthorization: true,
  });
  const sceneIndex = input.sceneIndex ?? 0;
  const intent = prepared.persisted.intents[sceneIndex]!;
  const sceneExecutionId = intent.identity.sceneExecutionId;
  const instructions = prepared.persisted.instructionsBySceneExecutionId[sceneExecutionId]!;
  const sourceHash = `sha256:${"a".repeat(64)}`;
  await input.sql`update assets set content_hash=${sourceHash} where id=${input.ids.assetId}::uuid`;
  const runtime = new AiStoryProviderRuntimeRepository(getDb());
  const referenceAssets = await runtime.getReferenceAssetAuthorities({
    orgId: input.ids.orgId,
    workspaceId: input.ids.workspaceId,
    campaignId: input.ids.campaignId,
    assetIds: [input.ids.assetId],
  });
  const compile = (compiledAt: string) => compileImmutableSeedanceRequestFromSceneCompilation({
    intent,
    instructions,
    authority: {
      qcEvaluationId: crypto.randomUUID(),
      qcFingerprint: sourceHash,
      qcCapabilityVersion: "test.v1",
      directorFingerprint: sourceHash,
      motionFingerprint: sourceHash,
    },
    adapterVersion: "test.v1",
    compiledAt,
    referenceAssets,
  });

  let boundCompiled = input.compiled === "none" ? null : await runtime.acceptCompiledRequest(compile("2026-09-01T00:00:00.000Z"));
  let laterCompiled = null as typeof boundCompiled;
  if (input.compiled === "unrelated-later" && boundCompiled) {
    laterCompiled = await runtime.acceptCompiledRequest(compile("2026-09-02T00:00:00.000Z"));
  }
  if (input.compiled === "ambiguous") {
    await runtime.acceptCompiledRequest(compile("2026-09-03T00:00:00.000Z"));
  }

  const providerExecutionId = `exec:${crypto.randomUUID()}`;
  const providerAttemptId = crypto.randomUUID();
  const attemptHash = input.compiled === "no-hash-match" || input.compiled === "ambiguous" || !boundCompiled
    ? HASH_B
    : boundCompiled.requestFingerprint;
  await input.sql`
    INSERT INTO provider_executions (
      execution_id, contract_version, org_id, workspace_id, campaign_id, pipeline_run_id,
      capability_id, capability_version, idempotency_key, deterministic_fingerprint,
      request_hash, output_schema_id, output_schema_version, status, execution_metadata
    ) VALUES (
      ${providerExecutionId}, ${input.contractVersion}, ${input.ids.orgId}, ${input.ids.workspaceId},
      ${input.ids.campaignId}, ${`pipe:${crypto.randomUUID()}`}, 'animation-video-generation', '1.0.0',
      ${`idem:${crypto.randomUUID()}`}, ${canonicalPersistenceHash(providerExecutionId)},
      ${attemptHash}, 'canonical-provider-result', '1.0.0', 'SUCCEEDED',
      ${input.sql.json({
        skillId: "animation-video-generation",
        skillVersion: "1.0.0",
        contextVersions: {},
        outputSchemaId: "canonical-provider-result",
        outputSchemaVersion: "1.0.0",
        correlationId: crypto.randomUUID(),
        createdAt: input.projectedAt,
      })}
    )
  `;
  await input.sql`
    INSERT INTO provider_attempts (
      attempt_id, execution_id, contract_version, attempt_number, provider_id, provider_version,
      model_version, request_hash, status, warnings, provider_metadata
    ) VALUES (
      ${providerAttemptId}, ${providerExecutionId}, ${input.contractVersion}, 1, 'seedance', '1.0.0',
      'dreamina-seedance-2-0-260128', ${attemptHash}, 'SUCCEEDED', ${input.sql.json([])},
      ${input.sql.json({})}
    )
  `;

  if (input.binding !== "none" && boundCompiled) {
    const fingerprint = input.binding === "fingerprint-mismatch" ? HASH_B : boundCompiled.requestFingerprint;
    const now = input.projectedAt;
    const attemptInputFingerprint = canonicalPersistenceHash({
      kind: "ai-story-provider-attempt-input.v1",
      compiledRequestId: boundCompiled.compiledRequestId,
      requestFingerprint: fingerprint,
      attemptNumber: 1,
    });
    const binding = {
      providerAttemptId,
      providerExecutionId,
      contractVersion: CURRENT_RUNTIME,
      compiledRequestId: boundCompiled.compiledRequestId,
      requestFingerprint: fingerprint,
      attemptInputFingerprint,
      idempotencyKey: `idem:${providerAttemptId}`,
      attemptNumber: 1,
      orgId: boundCompiled.orgId,
      workspaceId: boundCompiled.workspaceId,
      campaignId: boundCompiled.campaignId,
      storyId: boundCompiled.storyId,
      storyVersionId: boundCompiled.storyVersionId,
      sceneExecutionId,
      generationMode: boundCompiled.generationMode,
      providerId: boundCompiled.providerId,
      modelId: boundCompiled.modelId,
      adapterVersion: boundCompiled.adapterVersion,
      mappingVersion: boundCompiled.mappingVersion,
      capabilityVersion: boundCompiled.capabilityVersion,
      qcEvaluationId: boundCompiled.qcEvaluationId,
      qcFingerprint: boundCompiled.qcFingerprint,
      sceneFingerprint: boundCompiled.sceneFingerprint,
      directorFingerprint: boundCompiled.directorFingerprint,
      motionFingerprint: boundCompiled.motionFingerprint,
      castSnapshotFingerprint: boundCompiled.castSnapshotFingerprint,
      locationSnapshotFingerprint: boundCompiled.locationSnapshotFingerprint,
      productSnapshotFingerprint: boundCompiled.productSnapshotFingerprint,
      estimatedCost: boundCompiled.estimatedCost,
      status: "SUCCEEDED",
      pollCount: 0,
      createdAt: now,
      updatedAt: now,
      automaticPaidRetry: false,
      providerFallback: false,
    };
    await input.sql`
      INSERT INTO ai_story_provider_attempt_compiled_bindings (
        provider_attempt_id, compiled_request_id, org_id, workspace_id, scene_execution_id,
        idempotency_key, request_fingerprint, attempt_input_fingerprint, status, poll_count,
        binding, created_at, updated_at
      ) VALUES (
        ${providerAttemptId}, ${boundCompiled.compiledRequestId}::uuid, ${input.ids.orgId},
        ${input.ids.workspaceId}, ${sceneExecutionId}::uuid, ${binding.idempotencyKey},
        ${fingerprint}, ${attemptInputFingerprint}, 'SUCCEEDED', 0, ${input.sql.json(binding)},
        ${now}, ${now}
      )
    `;
  }

  const envelopeId = `envelope:${crypto.randomUUID()}`;
  const outboxJobId = `job:${crypto.randomUUID()}`;
  const dispatchId = `dispatch:${crypto.randomUUID()}`;
  const routingDecisionId = crypto.randomUUID();
  const workerExecutionResultId = crypto.randomUUID();
  const projectionCorrelationId = crypto.randomUUID();
  const sceneResultId = crypto.randomUUID();
  const mediaAttestationId = crypto.randomUUID();
  const payloadReference = `payload:${crypto.randomUUID()}`;
  await input.sql`
    INSERT INTO provider_execution_envelopes (
      envelope_id, version, payload_reference, org_id, workspace_id, execution_context,
      capability_id, capability_version, provider_policy_snapshot, canonical_request,
      request_hash, envelope_hash, created_at
    ) VALUES (
      ${envelopeId}, '1', ${payloadReference}, ${input.ids.orgId}, ${input.ids.workspaceId},
      ${input.sql.json({ workspaceId: input.ids.workspaceId })},
      'animation-video-generation', '1.0.0', ${input.sql.json({})}, ${input.sql.json({})},
      ${attemptHash}, ${canonicalPersistenceHash(envelopeId)}, ${input.projectedAt}
    )
  `;
  await input.sql`
    INSERT INTO provider_outbox_jobs (job_id, contract_version, execution_id, payload_reference, correlation_id, status)
    VALUES (${outboxJobId}, '1', ${providerExecutionId}, ${payloadReference}, ${crypto.randomUUID()}, 'PENDING')
  `;
  await input.sql`
    INSERT INTO provider_execution_dispatches (
      dispatch_id, version, job_id, execution_id, envelope_id, payload_reference, correlation_id,
      org_id, workspace_id, capability_id, capability_version, request_hash, envelope_hash,
      worker_handoff, dispatch_hash, status, created_at
    ) VALUES (
      ${dispatchId}, '1', ${outboxJobId}, ${providerExecutionId}, ${envelopeId}, ${payloadReference},
      ${crypto.randomUUID()}, ${input.ids.orgId}, ${input.ids.workspaceId}, 'animation-video-generation',
      '1.0.0', ${attemptHash}, ${canonicalPersistenceHash(dispatchId)},
      ${input.sql.json({ envelopeId, payloadReference, dispatchContractVersion: "1" })},
      ${canonicalPersistenceHash(`${dispatchId}:hash`)}, 'DISPATCHED', ${input.projectedAt}
    )
  `;
  await input.sql`
    INSERT INTO ai_story_scene_routing_decisions (
      routing_decision_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
      animation_package_id, execution_plan_id, scene_execution_id, runtime_authorization_id,
      capability_id, capability_version, selected_provider_id, selected_adapter_version,
      router_version, registry_snapshot_hash, capability_snapshot, policy_snapshot,
      candidate_summary, decided_at, deterministic_integrity_hash, automatic_fallback_enabled,
      contract_version, decision
    ) VALUES (
      ${routingDecisionId}::uuid, ${input.ids.orgId}, ${input.ids.workspaceId}, ${input.ids.campaignId},
      ${input.ids.storyId}, ${input.ids.storyVersionId}, ${input.ids.animationPackageId},
      ${prepared.executionPlanId}::uuid, ${sceneExecutionId}::uuid,
      ${prepared.acceptedAuthorization.runtimeAuthorizationId}::uuid,
      'animation-video-generation', '1.0.0', 'seedance', '1.0.0', 1, ${sourceHash},
      ${input.sql.json({})}, ${input.sql.json({})}, ${input.sql.json([])}, ${input.projectedAt},
      ${canonicalPersistenceHash(routingDecisionId)}, false, '1', ${input.sql.json({ providerId: "seedance" })}
    )
  `;
  await input.sql`
    INSERT INTO ai_story_worker_execution_results (
      worker_execution_result_id, org_id, workspace_id, provider_execution_id, provider_attempt_id,
      dispatch_id, outbox_job_id, routing_decision_id, provider_id, adapter_version, router_version,
      worker_state, acceptance_classification, canonical_provider_state, deterministic_integrity_hash,
      worker_contract_version, result, produced_at
    ) VALUES (
      ${workerExecutionResultId}::uuid, ${input.ids.orgId}, ${input.ids.workspaceId}, ${providerExecutionId},
      ${providerAttemptId}, ${dispatchId}, ${outboxJobId}, ${routingDecisionId}::uuid, 'seedance', '1.0.0',
      1, 'TERMINAL_SUCCESS', 'ACCEPTED', 'SUCCEEDED', ${canonicalPersistenceHash(workerExecutionResultId)},
      '1', ${input.sql.json({ workerExecutionResultId })}, ${input.projectedAt}
    )
  `;
  await input.sql`
    INSERT INTO ai_story_scene_projection_correlations (
      projection_correlation_id, org_id, workspace_id, scene_execution_id, worker_execution_result_id,
      provider_execution_id, provider_attempt_id, outbox_job_id, dispatch_id,
      provider_finalization_reference, scene_result_id, integrity_hash, contract_version,
      correlation, projected_at
    ) VALUES (
      ${projectionCorrelationId}::uuid, ${input.ids.orgId}, ${input.ids.workspaceId}, ${sceneExecutionId}::uuid,
      ${workerExecutionResultId}::uuid, ${providerExecutionId}, ${providerAttemptId}, ${outboxJobId},
      ${dispatchId}, ${`final:${providerAttemptId}`}, ${sceneResultId}::uuid,
      ${canonicalPersistenceHash(projectionCorrelationId)}, '1', ${input.sql.json({ sceneResultId })},
      ${input.projectedAt}
    )
  `;
  await input.sql`
    INSERT INTO ai_story_scene_results (
      scene_result_id, org_id, workspace_id, execution_plan_id, scene_runtime_id, scene_execution_id,
      worker_execution_result_id, projection_correlation_id, provider_execution_id, provider_attempt_id,
      provider_finalization_reference, scene_id, scene_order, status, integrity_hash, contract_version,
      result, accepted_at, projected_at
    ) VALUES (
      ${sceneResultId}::uuid, ${input.ids.orgId}, ${input.ids.workspaceId}, ${prepared.executionPlanId}::uuid,
      ${crypto.randomUUID()}::uuid, ${sceneExecutionId}::uuid, ${workerExecutionResultId}::uuid,
      ${projectionCorrelationId}::uuid, ${providerExecutionId}, ${providerAttemptId},
      ${`final:${providerAttemptId}`}, ${intent.identity.sceneId}, ${intent.identity.sceneOrder},
      'SUCCEEDED', ${canonicalPersistenceHash(sceneResultId)}, '1', ${input.sql.json({ sceneResultId })},
      ${input.projectedAt}, ${input.projectedAt}
    )
  `;
  const durableObjectReference = `${input.ids.workspaceId}/ai-story/${sceneResultId}.mp4`;
  const contentHash = input.media?.contentHash ?? canonicalPersistenceHash({ sceneResultId, media: "fixture" });
  const byteSize = input.media?.byteSize ?? 4096;
  const attestation = {
    contractVersion: DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
    mediaAttestationId,
    orgId: input.ids.orgId,
    workspaceId: input.ids.workspaceId,
    campaignId: input.ids.campaignId,
    storyId: input.ids.storyId,
    storyVersionId: input.ids.storyVersionId,
    animationPackageId: input.ids.animationPackageId,
    executionPlanId: prepared.executionPlanId,
    sceneExecutionId,
    sceneResultId,
    sourceMediaReference: { scheme: "https", host: "cdn.example.com", path: "/scene.mp4" },
    durableObjectReference,
    contentHash,
    byteSize,
    mediaType: "video/mp4",
    ingestContractVersion: DURABLE_SCENE_MEDIA_CONTRACT_VERSION,
    storageProvider: DURABLE_SCENE_MEDIA_STORAGE_PROVIDER,
    storageNamespaceVersion: DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION,
    acceptedAt: input.projectedAt,
    integrityHash: canonicalPersistenceHash({ mediaAttestationId, sceneResultId }),
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
  };
  await input.sql`
    INSERT INTO ai_story_durable_scene_media_attestations (
      media_attestation_id, org_id, workspace_id, campaign_id, story_id, story_version_id,
      animation_package_id, execution_plan_id, scene_execution_id, scene_result_id,
      source_media_reference, durable_object_reference, content_hash, byte_size, media_type,
      ingest_contract_version, storage_provider, storage_namespace_version, accepted_at,
      integrity_hash, attestation
    ) VALUES (
      ${mediaAttestationId}::uuid, ${input.ids.orgId}, ${input.ids.workspaceId}, ${input.ids.campaignId},
      ${input.ids.storyId}, ${input.ids.storyVersionId}, ${input.ids.animationPackageId},
      ${prepared.executionPlanId}::uuid, ${sceneExecutionId}::uuid, ${sceneResultId}::uuid,
      ${input.sql.json(attestation.sourceMediaReference)}, ${durableObjectReference}, ${contentHash},
      ${byteSize}, 'video/mp4', ${DURABLE_SCENE_MEDIA_CONTRACT_VERSION}, ${DURABLE_SCENE_MEDIA_STORAGE_PROVIDER},
      ${DURABLE_SCENE_MEDIA_STORAGE_NAMESPACE_VERSION}, ${input.projectedAt}, ${attestation.integrityHash},
      ${input.sql.json(attestation)}
    )
  `;
  if (input.persistPostQc) {
    const postQcInputId = crypto.randomUUID();
    const evaluationFingerprint = canonicalPersistenceHash({ postQc: sceneResultId });
    await input.sql`
      INSERT INTO ai_story_post_generation_qc_evaluations (
        post_qc_evaluation_id, post_qc_input_id, evaluation_version, org_id, workspace_id,
        provider_attempt_id, media_asset_id, scene_execution_id, aggregate_status,
        evaluation_fingerprint, input_package, evaluation, evaluated_at
      ) VALUES (
        ${crypto.randomUUID()}::uuid, ${postQcInputId}::uuid, 1, ${input.ids.orgId}, ${input.ids.workspaceId},
        ${providerAttemptId}, ${mediaAttestationId}::uuid, ${sceneExecutionId}::uuid, 'POST_QC_PASS',
        ${evaluationFingerprint}, ${input.sql.json({ postQcInputId })}, ${input.sql.json({ postQcInputId })},
        ${input.projectedAt}
      )
    `;
  }
  return {
    prepared,
    sceneExecutionId,
    providerAttemptId,
    providerExecutionId,
    boundCompiled,
    laterCompiled,
    outboxJobId,
    mediaAttestationId,
    sceneResultId,
    durableObjectReference,
    contentHash,
  };
}

describeIntegration("AI Story Post-QC runtime recovery compatibility", () => {
  let sql: Sql;
  const repository = () => new AiStoryPostGenerationQcRepository(getDb());

  beforeAll(async () => {
    sql = createIntegrationSql();
  }, 30_000);

  afterAll(async () => {
    await closeDb();
    if (sql) await sql.end();
  });

  it("excludes unsupported historical media without throwing", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "hist-unsupported");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: "1", compiled: "none", binding: "none",
        projectedAt: "2026-08-01T00:00:00.000Z",
      });
      await expect(repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId)).resolves.toBeNull();
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).not.toContain(seeded.sceneExecutionId);
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("selects the current recoverable Scene instead of starving behind historical media", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "starvation");
    try {
      const prepared = await prepareAuthorizedSchedulingPlan({
        purpose: `starvation-${crypto.randomUUID()}`,
        ids,
        userId: PR32_USER_A,
        sceneOrder: [0, 1],
        skipCommercialAuthorization: true,
      });
      const historical = await seedRecoveryScene({
        sql, ids, prepared, sceneIndex: 0, contractVersion: "1", compiled: "none",
        binding: "none", projectedAt: "2026-08-01T00:00:00.000Z",
      });
      const current = await seedRecoveryScene({
        sql, ids, prepared, sceneIndex: 1, contractVersion: CURRENT_RUNTIME, compiled: "unique",
        binding: "exact", projectedAt: "2026-08-02T00:00:00.000Z",
      });
      const pendingBefore = await repository().listPendingRuntimeRecoverySceneExecutionIds(50);
      expect(pendingBefore).toContain(current.sceneExecutionId);
      expect(pendingBefore).not.toContain(historical.sceneExecutionId);
      const postQcInputId = crypto.randomUUID();
      await sql`
        INSERT INTO ai_story_post_generation_qc_evaluations (
          post_qc_evaluation_id, post_qc_input_id, evaluation_version, org_id, workspace_id,
          provider_attempt_id, media_asset_id, scene_execution_id, aggregate_status,
          evaluation_fingerprint, input_package, evaluation, evaluated_at
        ) VALUES (
          ${crypto.randomUUID()}::uuid, ${postQcInputId}::uuid, 1, ${ids.orgId}, ${ids.workspaceId},
          ${current.providerAttemptId}, ${current.mediaAttestationId}::uuid, ${current.sceneExecutionId}::uuid,
          'POST_QC_PASS', ${canonicalPersistenceHash({ postQc: current.sceneResultId })},
          ${sql.json({ postQcInputId })}, ${sql.json({ postQcInputId })}, ${"2026-08-02T01:00:00.000Z"}
        )
      `;
      const pendingAfter = await repository().listPendingRuntimeRecoverySceneExecutionIds(50);
      expect(pendingAfter).not.toContain(current.sceneExecutionId);
      expect(pendingAfter).not.toContain(historical.sceneExecutionId);
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 90_000);

  it("loads the exact Attempt-bound compiled request, not a later unrelated request", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "exact-binding");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unrelated-later",
        binding: "exact", projectedAt: "2026-09-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).toContain(seeded.sceneExecutionId);
      const authority = await repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId);
      expect(authority?.compiledRequest.compiledRequestId).toBe(seeded.boundCompiled?.compiledRequestId);
      expect(authority?.compiledRequest.compiledRequestId).not.toBe(seeded.laterCompiled?.compiledRequestId);
      expect(authority?.preGenerationAuthority.planningLineageSource).toBe("LEGACY_COMPILED_V1");
      expect(authority?.preGenerationAuthority.scriptVersionId).toBeNull();
      expect(authority?.preGenerationAuthority.handoffId).toBeNull();
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("fails closed for current runtime missing Attempt binding", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "missing-binding");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unique", binding: "none",
        projectedAt: "2026-09-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).toContain(seeded.sceneExecutionId);
      await expect(repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId)).rejects.toMatchObject({
        code: "POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT",
      });
      const orchestrator = new AiStoryPostGenerationQcRuntimeOrchestrator(
        repository(),
        createLocalDurableObjectStore(await mkdtemp(join(tmpdir(), "post-qc-corrupt-"))),
      );
      await expect(orchestrator.recoverNext()).rejects.toBeInstanceOf(AiStoryPostGenerationQcRuntimeAuthorityError);
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("fails closed for current runtime fingerprint mismatch", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "fp-mismatch");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unique",
        binding: "fingerprint-mismatch", projectedAt: "2026-09-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).toContain(seeded.sceneExecutionId);
      await expect(repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId)).rejects.toMatchObject({
        code: "POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT",
      });
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("recovers a legacy unique immutable compiled match without fabricating Script/Handoff identity", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "legacy-unique");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: "1", compiled: "unique", binding: "none",
        projectedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).toContain(seeded.sceneExecutionId);
      const authority = await repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId);
      expect(authority?.compiledRequest.compiledRequestId).toBe(seeded.boundCompiled?.compiledRequestId);
      expect(authority?.preGenerationAuthority).toMatchObject({
        planningLineageSource: "LEGACY_COMPILED_V1",
        scriptVersionId: null,
        handoffId: null,
        handoffFingerprint: null,
      });
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("classifies legacy scenes without a compiled hash match as not auto-recoverable", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "legacy-none");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: "1", compiled: "no-hash-match", binding: "none",
        projectedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).not.toContain(seeded.sceneExecutionId);
      await expect(repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId)).resolves.toBeNull();
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("classifies legacy scenes with ambiguous compiled matches as not auto-recoverable", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "legacy-ambiguous");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: "1", compiled: "ambiguous", binding: "none",
        projectedAt: "2026-07-01T00:00:00.000Z",
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).not.toContain(seeded.sceneExecutionId);
      await expect(repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId)).resolves.toBeNull();
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("excludes Scenes that already have exact Post-QC evidence", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "existing-post-qc");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unique", binding: "exact",
        projectedAt: "2026-09-01T00:00:00.000Z", persistPostQc: true,
      });
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).not.toContain(seeded.sceneExecutionId);
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("replays Post-QC recovery idempotently without duplicate Human Review rows", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "idempotent");
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unique", binding: "exact",
        projectedAt: "2026-09-01T00:00:00.000Z",
      });
      const authority = await repository().loadRuntimeRecoveryAuthority(seeded.sceneExecutionId);
      expect(authority).toBeTruthy();
      const compiled = authority!.compiledRequest;
      const qcInput = buildAiStoryPostGenerationQcInputFromCompiledAuthority({
        intent: authority!.intent,
        instructions: authority!.instructions,
        preGenerationAuthority: authority!.preGenerationAuthority,
        sceneVersion: authority!.sceneVersion,
        compiledRequest: compiled,
        attempt: {
          providerAttemptId: authority!.providerAttemptId,
          compiledRequestId: compiled.compiledRequestId,
          requestFingerprint: compiled.requestFingerprint,
          sceneExecutionId: compiled.sceneExecutionId,
          orgId: compiled.orgId,
          workspaceId: compiled.workspaceId,
          campaignId: compiled.campaignId,
          storyId: compiled.storyId,
          storyVersionId: compiled.storyVersionId,
          generationMode: compiled.generationMode,
          providerId: compiled.providerId,
          modelId: compiled.modelId,
          mediaAssetId: authority!.attestation.mediaAttestationId,
        },
        privateMedia: {
          mediaAssetId: authority!.attestation.mediaAttestationId,
          contentHash: authority!.attestation.contentHash,
          durableObjectReference: authority!.attestation.durableObjectReference,
          byteSize: authority!.attestation.byteSize,
          durationMs: 1000,
          width: 320,
          height: 240,
          readable: true,
          decodable: true,
        },
        createdAt: authority!.attestation.acceptedAt,
      });
      const service = new AiStoryPostGenerationQcService({
        repository: new BoundAiStoryPostGenerationQcRepository(qcInput, repository()),
        evidenceProvider: {
          providerId: "post-qc-visual-evidence-unavailable",
          contractVersion: AI_STORY_VISUAL_EVIDENCE_CONTRACT_VERSION,
          async analyze() { throw new Error("AI_STORY_VISUAL_EVIDENCE_UNAVAILABLE"); },
        },
      });
      const first = await service.evaluate(qcInput);
      const second = await service.evaluate(qcInput);
      expect(first.replayed).toBe(false);
      expect(second.replayed).toBe(true);
      expect(first.evaluation.autoApproved).toBe(false);
      expect(first.evaluation.autoRetryAuthorized).toBe(false);
      const [qcCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ai_story_post_generation_qc_evaluations
        WHERE scene_execution_id = ${seeded.sceneExecutionId}::uuid
          AND provider_attempt_id = ${seeded.providerAttemptId}
      `;
      const [reviewCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ai_story_generated_scene_reviews
        WHERE scene_execution_id = ${seeded.sceneExecutionId}::uuid
      `;
      expect(qcCount?.count).toBe(1);
      expect(reviewCount?.count).toBe(0);
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(10)).not.toContain(seeded.sceneExecutionId);
    } finally {
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("returns no recoverable work for historical-only media and does not claim Provider jobs", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "historical-only-worker");
    const previous = process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
    process.env.AI_STORY_PROVIDER_DISPATCH_MODE = "certification_no_dispatch";
    try {
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: "1", compiled: "none", binding: "none",
        projectedAt: "2026-08-01T00:00:00.000Z",
      });
      const orchestrator = new AiStoryPostGenerationQcRuntimeOrchestrator(
        repository(),
        createLocalDurableObjectStore(await mkdtemp(join(tmpdir(), "post-qc-hist-"))),
      );
      const pending = await repository().listPendingRuntimeRecoverySceneExecutionIds(50);
      expect(pending).not.toContain(seeded.sceneExecutionId);
      await expect(orchestrator.recoverNext()).resolves.toBeNull();
      const cycle = await runAiStoryProviderWorkerCycle({ postGenerationQcRecovery: orchestrator });
      expect(cycle).toEqual({ dispatchStatus: "NO_JOB" });
      const [outbox] = await sql<{ lease_owner: string | null; status: string }[]>`
        SELECT lease_owner, status FROM provider_outbox_jobs WHERE job_id = ${seeded.outboxJobId}
      `;
      expect(outbox?.lease_owner).toBeNull();
      expect(outbox?.status).toBe("PENDING");
    } finally {
      process.env.AI_STORY_PROVIDER_DISPATCH_MODE = previous;
      await cleanupCompatTenant(sql, ids);
    }
  }, 60_000);

  it("completes Post-QC for a recoverable current Scene and does not recover it twice", async () => {
    const ids = uniqueIds();
    await seedPr32Tenant(sql, ids, PR32_USER_A, "recover-current");
    const previous = process.env.AI_STORY_PROVIDER_DISPATCH_MODE;
    process.env.AI_STORY_PROVIDER_DISPATCH_MODE = "certification_no_dispatch";
    const working = await mkdtemp(join(tmpdir(), "post-qc-current-"));
    try {
      const localPath = join(working, "scene.mp4");
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=1", "-pix_fmt", "yuv420p", localPath,
      ], { windowsHide: true });
      const contentHash = await hashFileSha256Stream(localPath);
      const byteSize = (await stat(localPath)).size;
      const seeded = await seedRecoveryScene({
        sql, ids, contractVersion: CURRENT_RUNTIME, compiled: "unique", binding: "exact",
        projectedAt: "2026-09-01T00:00:00.000Z",
        media: { contentHash, byteSize },
      });
      const store = createLocalDurableObjectStore(working);
      await store.putImmutableObject({
        workspaceId: ids.workspaceId,
        objectKey: seeded.durableObjectReference,
        localPath,
        contentHash,
        mediaType: "video/mp4",
        byteSize,
      });
      const orchestrator = new AiStoryPostGenerationQcRuntimeOrchestrator(repository(), store);
      const first = await orchestrator.evaluateSceneExecution(seeded.sceneExecutionId);
      expect(first.evaluation.providerAttemptId).toBe(seeded.providerAttemptId);
      expect(first.evaluation.autoApproved).toBe(false);
      expect(first.replayed).toBe(false);
      expect(await repository().listPendingRuntimeRecoverySceneExecutionIds(50)).not.toContain(seeded.sceneExecutionId);
      const second = await orchestrator.evaluateSceneExecution(seeded.sceneExecutionId);
      expect(second.replayed).toBe(true);
      const cycle = await runAiStoryProviderWorkerCycle({ postGenerationQcRecovery: orchestrator });
      expect(cycle).toEqual({ dispatchStatus: "NO_JOB" });
      const [qcCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM ai_story_post_generation_qc_evaluations
        WHERE scene_execution_id = ${seeded.sceneExecutionId}::uuid
      `;
      expect(qcCount?.count).toBe(1);
    } finally {
      process.env.AI_STORY_PROVIDER_DISPATCH_MODE = previous;
      await rm(working, { recursive: true, force: true });
      await cleanupCompatTenant(sql, ids);
    }
  }, 90_000);
});
