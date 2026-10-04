import { and, desc, eq, sql } from "drizzle-orm";
import {
  AiStoryGenerationResultSchema, AiStoryGenerationResultDecisionSchema,
  AiStoryPostGenerationQcEvaluationSchema, CanonicalSceneResultSchema,
  AiStoryProviderAttemptBindingSchema,
  postQcAllowsHumanApproval,
  type AiStoryGenerationResult, type AiStoryGenerationResultDecision,
  type CanonicalSceneResult,
} from "@ceo-agent/shared";
import { getDb, schema } from "../client";
import { canonicalPersistenceHash, deterministicPersistenceUuid } from "./ai-story-scene-execution-persistence";
import { resolveSuccessfulProviderAttemptTerminalAuthority } from "./provider-execution-finalizer";

export function generationResultFingerprint(result: Omit<AiStoryGenerationResult, "fingerprint">): string {
  const { createdAt: _createdAt, ...facts } = result;
  Reflect.deleteProperty(facts, "fingerprint");
  return canonicalPersistenceHash(facts);
}

export function materializeGenerationResult(input: Omit<AiStoryGenerationResult, "generationResultId" | "fingerprint" | "contractVersion">): AiStoryGenerationResult {
  const facts = {
    ...input,
    contractVersion: "ai-story-generation-result.v1" as const,
    generationResultId: deterministicPersistenceUuid("ai-story-generation-result", input.source),
  };
  return AiStoryGenerationResultSchema.parse({ ...facts, fingerprint: generationResultFingerprint(facts) });
}

export function validateGenerationResult(raw: unknown): AiStoryGenerationResult {
  const result = AiStoryGenerationResultSchema.parse(raw);
  if (generationResultFingerprint(result) !== result.fingerprint) throw new Error("GENERATION_RESULT_IMMUTABLE_CONFLICT");
  return result;
}

export function assertGenerationResultScope(result: AiStoryGenerationResult, input: {
  orgId: string; workspaceId: string; campaignId: string; storyId: string;
  storyVersionId: string; executionPlanId: string; sceneExecutionId: string; generationUnitId: string;
}) {
  validateGenerationResult(result);
  for (const key of ["orgId", "workspaceId", "campaignId", "storyId", "storyVersionId", "executionPlanId"] as const) {
    if (result.ownership[key] !== input[key]) throw new Error("GENERATION_RESULT_SCOPE_MISMATCH");
  }
  if (result.sceneExecutionId !== input.sceneExecutionId || result.generationUnitId !== input.generationUnitId) {
    throw new Error("GENERATION_RESULT_UNIT_MISMATCH");
  }
}

export class AiStoryGenerationResultRepository {
  constructor(private readonly db = getDb()) {}

  async get(workspaceId: string, generationResultId: string) {
    const [row] = await this.db.select().from(schema.aiStoryGenerationResults).where(and(
      eq(schema.aiStoryGenerationResults.workspaceId, workspaceId),
      eq(schema.aiStoryGenerationResults.generationResultId, generationResultId),
    )).limit(1);
    return row ? validateGenerationResult(row.result) : null;
  }

  async accept(raw: AiStoryGenerationResult) {
    const result = validateGenerationResult(raw);
    return this.db.transaction(async tx => {
      const [scene] = await tx.select().from(schema.aiStorySceneExecutions).where(
        eq(schema.aiStorySceneExecutions.id, result.sceneExecutionId),
      ).limit(1);
      const [plan] = await tx.select().from(schema.aiStoryExecutionPlans).where(
        eq(schema.aiStoryExecutionPlans.id, result.ownership.executionPlanId),
      ).limit(1);
      if (!scene || !plan || scene.executionPlanId !== plan.id || scene.sceneId !== result.sceneId || scene.sceneOrder !== result.sceneOrder ||
          plan.orgId !== result.ownership.orgId || plan.workspaceId !== result.ownership.workspaceId ||
          plan.campaignId !== result.ownership.campaignId || plan.storyId !== result.ownership.storyId ||
          plan.storyVersionId !== result.ownership.storyVersionId || plan.animationPackageId !== result.ownership.animationPackageId) {
        throw new Error("GENERATION_RESULT_SCOPE_MISMATCH");
      }
      const [runtime] = await tx.select().from(schema.aiStoryRuntimeAuthorizedFacts).where(
        eq(schema.aiStoryRuntimeAuthorizedFacts.runtimeAuthorizationId, result.runtimeAuthorizationId),
      ).limit(1);
      if (!runtime || runtime.executionPlanId !== plan.id || runtime.orgId!==plan.orgId || runtime.workspaceId!==plan.workspaceId ||
          runtime.campaignId!==plan.campaignId || runtime.storyId!==plan.storyId || runtime.storyVersionId!==plan.storyVersionId ||
          runtime.animationPackageId!==plan.animationPackageId || !runtime.orderedSceneExecutionIds.includes(result.sceneExecutionId)) {
        throw new Error("GENERATION_RESULT_RUNTIME_AUTHORITY_MISMATCH");
      }
      if (result.source.sourceKind === "MANUAL_LOCAL") {
        const [output] = await tx.select().from(schema.aiStoryLocalGenerationOutputs).where(
          eq(schema.aiStoryLocalGenerationOutputs.outputId, result.source.localGenerationOutputId),
        ).limit(1);
        const [pkg] = output ? await tx.select().from(schema.aiStoryLocalGenerationPackages).where(
          eq(schema.aiStoryLocalGenerationPackages.packageId, output.packageId),
        ).limit(1) : [];
        const [asset] = await tx.select().from(schema.assets).where(eq(schema.assets.id, result.media.assetId)).limit(1);
        if (!output || !pkg || !asset || asset.status !== "ready" ||
            output.unitId !== result.generationUnitId || output.sceneExecutionId !== result.sceneExecutionId ||
            output.assetId !== result.media.assetId || output.contentHash !== result.media.contentHash ||
            pkg.executionPlanId !== plan.id || pkg.runtimeAuthorizationId !== runtime.runtimeAuthorizationId ||
            (pkg.package.version !== "local-generation-package.v1"
              ? pkg.package.sourceAuthority.localSourceAuthorityFingerprint !== result.inputAuthorityFingerprint ||
                pkg.package.sourceAuthority.localSourceAuthorityId !== result.localSourceAuthorityId ||
                result.compiledRequestId !== null
              : pkg.package.sourceAuthority.schedulingAuthorityFingerprint !== result.inputAuthorityFingerprint ||
                pkg.package.sourceAuthority.compiledRequestId !== result.compiledRequestId ||
                pkg.package.sourceAuthority.compiledRequestFingerprint !== result.compiledRequestFingerprint) ||
            result.inputAuthority.localPackageId !== pkg.packageId || result.inputAuthority.localPackageFingerprint !== pkg.packageFingerprint ||
            canonicalPersistenceHash(result.inputAuthority) !== canonicalPersistenceHash({
              localPackageId:pkg.packageId,localPackageFingerprint:pkg.packageFingerprint,
              characterAuthority:pkg.package.characterAuthority,productAuthority:pkg.package.productAuthority,
              references:pkg.package.references,generationMode:pkg.package.generationMode,generateAudio:pkg.package.generateAudio,
              audioBlocked:pkg.package.audioBlocked,sourceAuthority:pkg.package.sourceAuthority,planningAuthority:pkg.package.planningAuthority,
            }) ||
            Math.round(Number(output.durationSec)*1000) !== result.media.durationMs ||
            output.width !== result.media.width || output.height !== result.media.height || asset.fileSizeBytes !== result.media.byteSize ||
            asset.workspaceId !== plan.workspaceId || asset.orgId !== plan.orgId || asset.campaignId !== plan.campaignId ||
            asset.contentHash !== result.media.contentHash || asset.storagePath !== result.media.storagePath) {
          throw new Error("GENERATION_RESULT_LOCAL_SOURCE_MISMATCH");
        }
      } else if (result.source.sourceKind === "REMOTE_PROVIDER") {
        if (!result.compiledRequestId || !result.compiledRequestFingerprint) {
          throw new Error("GENERATION_RESULT_REMOTE_SOURCE_MISMATCH");
        }
        const compiledRequestId = result.compiledRequestId;
        const compiledRequestFingerprint = result.compiledRequestFingerprint;
        const [attempt] = await tx.select().from(schema.providerAttempts).where(
          eq(schema.providerAttempts.attemptId, result.source.providerAttemptId),
        ).limit(1);
        const [attestation] = await tx.select().from(schema.aiStoryDurableSceneMediaAttestations).where(
          eq(schema.aiStoryDurableSceneMediaAttestations.mediaAttestationId, result.media.assetId),
        ).limit(1);
        const [compiled] = await tx.select().from(schema.aiStoryCompiledProviderRequests).where(
          eq(schema.aiStoryCompiledProviderRequests.compiledRequestId, compiledRequestId),
        ).limit(1);
        const bindings = await tx.select().from(schema.aiStoryProviderAttemptCompiledBindings).where(
          eq(schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId, result.source.providerAttemptId),
        );
        const binding = bindings.length === 1
          ? AiStoryProviderAttemptBindingSchema.safeParse(bindings[0]!.binding) : null;
        // A canonical execution/envelope hash and its compiled wire fingerprint
        // are distinct authorities. Current Attempts join them through the exact
        // immutable binding, not through an assumed hash equality. Historical
        // unbound evidence retains its direct compiled-hash compatibility path.
        const compiledBindingMatches = binding?.success === true && !!attempt &&
          binding.data.providerAttemptId === attempt.attemptId &&
          binding.data.providerExecutionId === attempt.executionId &&
          binding.data.contractVersion === attempt.contractVersion &&
          binding.data.orgId === plan.orgId && binding.data.workspaceId === plan.workspaceId &&
          binding.data.campaignId === plan.campaignId && binding.data.storyId === plan.storyId &&
          binding.data.storyVersionId === plan.storyVersionId &&
          binding.data.sceneExecutionId === result.sceneExecutionId &&
          binding.data.compiledRequestId === compiledRequestId &&
          binding.data.requestFingerprint === compiledRequestFingerprint &&
          bindings[0]!.requestFingerprint === binding.data.requestFingerprint;
        if (!attempt || !attestation || !compiled ||
            compiled.sceneExecutionId !== result.sceneExecutionId ||
            compiled.requestFingerprint !== compiledRequestFingerprint ||
            compiled.orgId !== plan.orgId || compiled.workspaceId !== plan.workspaceId ||
            compiled.campaignId !== plan.campaignId || compiled.storyId !== plan.storyId ||
            compiled.storyVersionId !== plan.storyVersionId ||
            (bindings.length > 0 && !compiledBindingMatches) ||
            (!compiledBindingMatches && (attempt.status === "PENDING" || attempt.requestHash !== compiledRequestFingerprint)) ||
            attestation.sceneExecutionId !== result.sceneExecutionId || attestation.durableObjectReference !== result.media.storagePath ||
            attestation.executionPlanId !== plan.id || attestation.contentHash !== result.media.contentHash) {
          throw new Error("GENERATION_RESULT_REMOTE_SOURCE_MISMATCH");
        }
        const [sceneResult] = await tx.select().from(schema.aiStorySceneResults).where(
          eq(schema.aiStorySceneResults.sceneResultId, attestation.sceneResultId),
        ).limit(1);
        if (!sceneResult || !["PENDING", "SUCCEEDED"].includes(attempt.status) ||
            sceneResult.providerAttemptId !== attempt.attemptId || sceneResult.providerExecutionId !== attempt.executionId || sceneResult.status !== "SUCCEEDED") {
          throw new Error("GENERATION_RESULT_REMOTE_TERMINAL_REQUIRED");
        }
        if (attempt.status === "PENDING" && !await resolveSuccessfulProviderAttemptTerminalAuthority({
          reader: tx, providerAttemptId: attempt.attemptId,
          providerExecutionId: attempt.executionId, sceneExecutionId: result.sceneExecutionId,
        })) {
          throw new Error("GENERATION_RESULT_REMOTE_TERMINAL_REQUIRED");
        }
      } else {
        // Contract is ready; no local Worker producer is enabled in V1.
        throw new Error("LOCAL_GPU_WORKER_SOURCE_NOT_ENABLED");
      }
      const rows = await tx.insert(schema.aiStoryGenerationResults).values({
        generationResultId: result.generationResultId, ...result.ownership,
        generationUnitId: result.generationUnitId, sceneExecutionId: result.sceneExecutionId,
        sourceKind: result.source.sourceKind, providerAttemptId: result.source.providerAttemptId,
        localGenerationOutputId: result.source.localGenerationOutputId, localWorkerOutputId: result.source.localWorkerOutputId,
        assetId: result.media.assetId, contentHash: result.media.contentHash,
        fingerprint: result.fingerprint, result, createdAt: new Date(result.createdAt),
      }).onConflictDoNothing().returning();
      if (rows[0]) return { result, replayed: false };
      const [current] = await tx.select().from(schema.aiStoryGenerationResults).where(
        eq(schema.aiStoryGenerationResults.generationResultId, result.generationResultId),
      ).limit(1);
      if (!current || current.fingerprint !== result.fingerprint) throw new Error("GENERATION_RESULT_IMMUTABLE_CONFLICT");
      return { result: validateGenerationResult(current.result), replayed: true };
    });
  }

  async latestQc(workspaceId: string, generationResultId: string) {
    const [row] = await this.db.select().from(schema.aiStoryPostGenerationQcEvaluations).where(and(
      eq(schema.aiStoryPostGenerationQcEvaluations.workspaceId, workspaceId),
      eq(schema.aiStoryPostGenerationQcEvaluations.generationResultId, generationResultId),
    )).orderBy(desc(schema.aiStoryPostGenerationQcEvaluations.evaluationVersion)).limit(1);
    return row ? AiStoryPostGenerationQcEvaluationSchema.parse(row.evaluation) : null;
  }

  async decision(generationResultId: string) {
    const [row] = await this.db.select().from(schema.aiStoryGenerationResultDecisions).where(
      eq(schema.aiStoryGenerationResultDecisions.generationResultId, generationResultId),
    ).limit(1);
    return row ? AiStoryGenerationResultDecisionSchema.parse(row.fact) : null;
  }

  async continuityFrame(workspaceId: string, generationResultId: string) {
    const result = await this.get(workspaceId, generationResultId);
    if (!result || (await this.decision(generationResultId))?.decision !== "APPROVED") return null;
    const [frame] = await this.db.select().from(schema.aiStoryGenerationResultContinuityFrames).where(
      eq(schema.aiStoryGenerationResultContinuityFrames.generationResultId, generationResultId),
    ).limit(1);
    return frame ?? null;
  }

  async acceptContinuityFrame(result: AiStoryGenerationResult, frame: { frameAssetId:string; contentHash:string; sourceContentHash:string; extractedAt:Date }) {
    const approved = await this.decision(result.generationResultId);
    if (approved?.decision !== "APPROVED" || frame.sourceContentHash !== result.media.contentHash) throw new Error("GENERATION_RESULT_APPROVAL_REQUIRED");
    const [asset] = await this.db.select().from(schema.assets).where(eq(schema.assets.id, frame.frameAssetId)).limit(1);
    if (!asset || asset.status !== "ready" || asset.workspaceId !== result.ownership.workspaceId || asset.orgId !== result.ownership.orgId ||
        asset.campaignId !== result.ownership.campaignId || asset.contentHash !== frame.contentHash || asset.mimeType !== "image/png") throw new Error("GENERATION_RESULT_FRAME_AUTHORITY_INVALID");
    await this.db.insert(schema.aiStoryGenerationResultContinuityFrames).values({ generationResultId:result.generationResultId, ...frame }).onConflictDoNothing();
    const stored = await this.continuityFrame(result.ownership.workspaceId, result.generationResultId);
    if (!stored || stored.frameAssetId !== frame.frameAssetId || stored.contentHash !== frame.contentHash || stored.sourceContentHash !== frame.sourceContentHash) throw new Error("GENERATION_RESULT_IMMUTABLE_CONFLICT");
    return stored;
  }

  /** Exact adjacent Unit in the same frozen Plan; never a global/latest-media lookup. */
  async previousUnitContinuity(pkg: import("@ceo-agent/shared").AiStoryLocalGenerationPackage) {
    const [row] = await this.db.select({ result:schema.aiStoryGenerationResults.result, frame:schema.aiStoryGenerationResultContinuityFrames })
      .from(schema.aiStoryGenerationResults)
      .innerJoin(schema.aiStoryGenerationResultDecisions, eq(schema.aiStoryGenerationResultDecisions.generationResultId, schema.aiStoryGenerationResults.generationResultId))
      .innerJoin(schema.aiStoryGenerationResultContinuityFrames, eq(schema.aiStoryGenerationResultContinuityFrames.generationResultId, schema.aiStoryGenerationResults.generationResultId))
      .innerJoin(schema.aiStoryLocalGenerationPackages, eq(schema.aiStoryLocalGenerationPackages.unitId, schema.aiStoryGenerationResults.generationUnitId))
      .where(and(eq(schema.aiStoryGenerationResults.workspaceId,pkg.workspaceId),eq(schema.aiStoryGenerationResults.executionPlanId,pkg.executionPlanId),
        eq(schema.aiStoryGenerationResultDecisions.decision,"APPROVED"),eq(schema.aiStoryLocalGenerationPackages.runtimeAuthorizationId,pkg.runtimeAuthorizationId),
        eq(schema.aiStoryLocalGenerationPackages.unitOrder,pkg.order-1))).limit(1);
    if (!row) return null;
    const result=validateGenerationResult(row.result);
    if (result.ownership.storyId!==pkg.storyId || result.ownership.storyVersionId!==pkg.storyVersionId || result.ownership.campaignId!==pkg.campaignId ||
        row.frame.sourceContentHash!==result.media.contentHash) throw new Error("GENERATION_RESULT_FRAME_AUTHORITY_INVALID");
    return { ...row.frame, generationMode:pkg.generationMode, automaticModeSelection:false as const };
  }

  async acceptDecision(result: AiStoryGenerationResult, raw: AiStoryGenerationResultDecision) {
    const decision = AiStoryGenerationResultDecisionSchema.parse(raw);
    if (decision.generationResultId !== result.generationResultId) throw new Error("GENERATION_RESULT_SCOPE_MISMATCH");
    return this.db.transaction(async tx => {
      await tx.execute(sql`select id from ai_story_execution_plans where id=${result.ownership.executionPlanId} for update`);
      await tx.execute(sql`select id from ai_story_scene_executions where id=${result.sceneExecutionId} for update`);
      const [accepted] = await tx.select().from(schema.aiStoryGenerationResults).where(
        eq(schema.aiStoryGenerationResults.generationResultId, result.generationResultId),
      ).limit(1);
      if (!accepted || accepted.fingerprint !== result.fingerprint) throw new Error("GENERATION_RESULT_IMMUTABLE_CONFLICT");
      const [qcRow] = await tx.select().from(schema.aiStoryPostGenerationQcEvaluations).where(
        eq(schema.aiStoryPostGenerationQcEvaluations.postQcEvaluationId, decision.postQcEvaluationId),
      ).limit(1);
      const qc = qcRow ? AiStoryPostGenerationQcEvaluationSchema.parse(qcRow.evaluation) : null;
      if (!qc || qc.generationResultId !== result.generationResultId || qc.mediaContentHash !== result.media.contentHash ||
          qc.sceneExecutionId !== result.sceneExecutionId || qc.workspaceId !== result.ownership.workspaceId ||
          qc.compiledRequestFingerprint !== result.compiledRequestFingerprint ||
          (decision.decision === "APPROVED" && (!qc.eligibleForHumanReview || !postQcAllowsHumanApproval(qc)))) {
        throw new Error("GENERATED_SCENE_POST_QC_REQUIRED");
      }
      const [latestQc] = await tx.select().from(schema.aiStoryPostGenerationQcEvaluations).where(
        eq(schema.aiStoryPostGenerationQcEvaluations.generationResultId, result.generationResultId),
      ).orderBy(desc(schema.aiStoryPostGenerationQcEvaluations.evaluationVersion)).limit(1);
      if (latestQc?.postQcEvaluationId !== decision.postQcEvaluationId) throw new Error("GENERATED_SCENE_POST_QC_REQUIRED");
      const [existing] = await tx.select().from(schema.aiStoryGenerationResultDecisions).where(
        eq(schema.aiStoryGenerationResultDecisions.generationResultId, result.generationResultId),
      ).limit(1);
      if (existing) {
        if (existing.decision !== decision.decision) throw new Error("GENERATION_RESULT_DECISION_IMMUTABLE_CONFLICT");
        return { decision: AiStoryGenerationResultDecisionSchema.parse(existing.fact), replayed: true };
      }
      if (decision.decision === "APPROVED") {
        const [inFlight] = await tx.execute(sql`
          select execution_id from provider_executions where execution_id in (
            select provider_execution_id from ai_story_scene_scheduling_correlations where scene_execution_id=${result.sceneExecutionId})
          and status not in ('SUCCEEDED','TERMINAL_FAILURE') limit 1`);
        if (inFlight) throw new Error("GENERATED_SCENE_EXECUTION_IN_FLIGHT");
        const [approved] = await tx.execute(sql`
          select scene_result_id from ai_story_scene_results where scene_execution_id=${result.sceneExecutionId}
          and (generation_result_id in(select generation_result_id from ai_story_generation_result_decisions where decision='APPROVED')
            or scene_result_id in(select scene_result_id from ai_story_generated_scene_reviews where decision='APPROVED')) limit 1`);
        if (approved) throw new Error("GENERATED_SCENE_REVIEW_STATE_CONFLICT");
      }
      await tx.insert(schema.aiStoryGenerationResultDecisions).values({
        ...decision, fact: decision, decidedAt: new Date(decision.decidedAt),
      });
      if (decision.decision === "APPROVED" && result.source.sourceKind !== "REMOTE_PROVIDER") {
        const scene = projectApprovedGenerationResult(result, decision);
        await tx.execute(sql`
          insert into ai_story_scene_results(scene_result_id,org_id,workspace_id,execution_plan_id,scene_runtime_id,
            scene_execution_id,generation_result_id,scene_id,scene_order,status,integrity_hash,contract_version,result,accepted_at,projected_at)
          values(${scene.sceneResultId},${result.ownership.orgId},${result.ownership.workspaceId},${scene.executionPlanId},
            ${scene.sceneRuntimeId},${scene.sceneExecutionId},${result.generationResultId},${scene.sceneId},${scene.sceneOrder},
            'SUCCEEDED',${scene.integrityHash},'1',${JSON.stringify(scene)}::jsonb,${scene.acceptedAt},${scene.acceptedAt})
          on conflict(scene_result_id) do nothing`);
      }
      return { decision, replayed: false };
    });
  }
}

/** Existing canonical Scene Result shape is shared by all execution sources. */
export function projectApprovedGenerationResult(result: AiStoryGenerationResult, decision: AiStoryGenerationResultDecision): CanonicalSceneResult {
  validateGenerationResult(result);
  if (decision.generationResultId !== result.generationResultId || decision.decision !== "APPROVED") throw new Error("GENERATION_RESULT_APPROVAL_REQUIRED");
  const facts = {
    sceneResultId: deterministicPersistenceUuid("ai-story-generation-scene-result", { generationResultId: result.generationResultId }),
    executionPlanId: result.ownership.executionPlanId,
    sceneRuntimeId: deterministicPersistenceUuid("ai-story-scene-runtime", { executionPlanId: result.ownership.executionPlanId, sceneExecutionId: result.sceneExecutionId, runtimeAuthorizationId: result.runtimeAuthorizationId }),
    sceneExecutionId: result.sceneExecutionId, sceneId: result.sceneId, sceneOrder: result.sceneOrder,
    ownership: result.ownership, status: "SUCCEEDED" as const, failureClassification: null,
    mediaReference: { uri: result.media.durableObjectReference, contentHash: result.media.contentHash, mediaType: result.media.mediaType },
    durationMs: result.media.durationMs, acceptedAt: decision.decidedAt, contractVersion: "1" as const,
  };
  return CanonicalSceneResultSchema.parse({ ...facts, integrityHash: canonicalPersistenceHash(facts) });
}
