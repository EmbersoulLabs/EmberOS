import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  AI_STORY_PROVIDER_RUNTIME_VERSION,
  AiStoryCompiledProviderRequestSchema,
  AiStoryPreGenerationQcEvaluationSchema,
  AiStoryPostGenerationQcEvaluationSchema,
  AiStorySceneCompiledInstructionsSchema,
  AiStorySceneExecutionIntentSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryPreGenerationQcEvaluation,
  type AiStoryPostGenerationQcEvaluation,
  type AiStoryPostGenerationQcInputPackage,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";
import { DurableSceneMediaAttestationSchema, type DurableSceneMediaAttestation } from "@ceo-agent/shared/server";
import { getDb } from "../client";
import * as schema from "../schema/index";

type Db = ReturnType<typeof getDb>;

const LEGACY_PROVIDER_ATTEMPT_CONTRACT_VERSION = "1";
const CURRENT_PROVIDER_RUNTIME_CONTRACT_VERSION = AI_STORY_PROVIDER_RUNTIME_VERSION;

export class AiStoryPostGenerationQcPersistenceError extends Error {
  constructor(readonly code: "POST_QC_IMMUTABLE_CONFLICT", message: string) {
    super(message);
    this.name = "AiStoryPostGenerationQcPersistenceError";
  }
}

export class AiStoryPostGenerationQcRuntimeAuthorityError extends Error {
  constructor(
    readonly code: "POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT",
    message: string,
  ) {
    super(message);
    this.name = "AiStoryPostGenerationQcRuntimeAuthorityError";
  }
}

type PendingRecoverySceneResult = {
  readonly sceneExecutionId: string;
  readonly sceneResultId: string;
  readonly providerAttemptId: string;
  readonly providerExecutionId: string;
  readonly orgId: string;
  readonly workspaceId: string;
};

type RecoveryClassification =
  | { readonly kind: "RECOVERABLE"; readonly compiledRequestId: string }
  | { readonly kind: "HISTORICAL_NOT_AUTO_RECOVERABLE" }
  | { readonly kind: "CURRENT_RUNTIME_AUTHORITY_CORRUPT"; readonly reason: string };

type CompiledAuthorityRow = {
  readonly compiledRequestId: string;
  readonly requestFingerprint: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
  readonly sceneExecutionId: string;
};

type SceneAuthorityRow = {
  readonly orgId: string;
  readonly workspaceId: string;
  readonly campaignId: string;
  readonly storyId: string;
  readonly storyVersionId: string;
};

function providerModelCompatible(
  compiled: Pick<CompiledAuthorityRow, "providerId" | "modelId">,
  attempt: { readonly providerId: string; readonly modelVersion: string },
): boolean {
  return compiled.providerId === attempt.providerId && compiled.modelId === attempt.modelVersion;
}

function compiledMatchesSceneAuthority(
  compiled: CompiledAuthorityRow,
  scene: SceneAuthorityRow,
  sceneExecutionId: string,
): boolean {
  return compiled.sceneExecutionId === sceneExecutionId
    && compiled.orgId === scene.orgId
    && compiled.workspaceId === scene.workspaceId
    && compiled.campaignId === scene.campaignId
    && compiled.storyId === scene.storyId
    && compiled.storyVersionId === scene.storyVersionId;
}

export class AiStoryPostGenerationQcRepository {
  constructor(private readonly db: Db = getDb()) {}

  async getByIdentity(input: { postQcInputId: string; evaluationVersion: number }): Promise<AiStoryPostGenerationQcEvaluation | null> {
    const [row] = await this.db.select({ evaluation: schema.aiStoryPostGenerationQcEvaluations.evaluation })
      .from(schema.aiStoryPostGenerationQcEvaluations)
      .where(and(
        eq(schema.aiStoryPostGenerationQcEvaluations.postQcInputId, input.postQcInputId),
        eq(schema.aiStoryPostGenerationQcEvaluations.evaluationVersion, input.evaluationVersion),
      )).limit(1);
    return row ? AiStoryPostGenerationQcEvaluationSchema.parse(row.evaluation) : null;
  }

  async getLatestByProviderAttemptIds(input: {
    workspaceId: string;
    providerAttemptIds: readonly string[];
  }): Promise<ReadonlyMap<string, AiStoryPostGenerationQcEvaluation>> {
    if (input.providerAttemptIds.length === 0) return new Map();
    const rows = await this.db.select({
      providerAttemptId: schema.aiStoryPostGenerationQcEvaluations.providerAttemptId,
      evaluation: schema.aiStoryPostGenerationQcEvaluations.evaluation,
    }).from(schema.aiStoryPostGenerationQcEvaluations).where(and(
      eq(schema.aiStoryPostGenerationQcEvaluations.workspaceId, input.workspaceId),
      inArray(schema.aiStoryPostGenerationQcEvaluations.providerAttemptId, [...input.providerAttemptIds]),
    )).orderBy(
      desc(schema.aiStoryPostGenerationQcEvaluations.evaluationVersion),
      desc(schema.aiStoryPostGenerationQcEvaluations.evaluatedAt),
    );
    const latest = new Map<string, AiStoryPostGenerationQcEvaluation>();
    for (const row of rows) {
      if (!latest.has(row.providerAttemptId)) {
        latest.set(row.providerAttemptId, AiStoryPostGenerationQcEvaluationSchema.parse(row.evaluation));
      }
    }
    return latest;
  }

  /** Successful durable media that automatic Post-QC recovery can reconstruct. */
  async listPendingRuntimeRecoverySceneExecutionIds(limit = 10): Promise<readonly string[]> {
    const wanted = Math.max(1, Math.min(limit, 50));
    const eligible: string[] = [];
    const seen = new Set<string>();
    const batchSize = 50;
    let offset = 0;
    while (eligible.length < wanted) {
      const rows = await this.selectPendingRecoverySceneResults(batchSize, offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        if (seen.has(row.sceneExecutionId)) continue;
        const classification = await this.classifyRuntimeRecovery(row);
        if (classification.kind === "HISTORICAL_NOT_AUTO_RECOVERABLE") continue;
        seen.add(row.sceneExecutionId);
        eligible.push(row.sceneExecutionId);
        if (eligible.length >= wanted) break;
      }
      offset += rows.length;
      if (rows.length < batchSize) break;
    }
    return eligible;
  }

  async loadRuntimeRecoveryAuthority(sceneExecutionId: string): Promise<{
    readonly executionPlanId: string;
    readonly intent: AiStorySceneExecutionIntent;
    readonly instructions: AiStorySceneCompiledInstructions;
    readonly compiledRequest: AiStoryCompiledProviderRequest;
    readonly preGenerationAuthority: Pick<
      AiStoryPreGenerationQcEvaluation,
      "qcEvaluationId" | "qcFingerprint" | "productGrounded"
    > & {
      readonly planningLineageSource: "FROZEN_SCRIPT_DIRECTOR" | "LEGACY_COMPILED_V1";
      readonly scriptVersionId: string | null;
      readonly handoffId: string | null;
      readonly handoffFingerprint: string | null;
      readonly shotRecipeFingerprint: string | null;
    };
    readonly sceneVersion: number;
    readonly providerAttemptId: string;
    readonly providerTaskId: string | null;
    readonly actualUsage: Record<string, unknown> | null;
    readonly attestation: DurableSceneMediaAttestation;
  } | null> {
    const [sceneResult] = await this.db.select({
      executionPlanId: schema.aiStorySceneResults.executionPlanId,
      providerAttemptId: schema.aiStorySceneResults.providerAttemptId,
      providerExecutionId: schema.aiStorySceneResults.providerExecutionId,
      sceneResultId: schema.aiStorySceneResults.sceneResultId,
      orgId: schema.aiStorySceneResults.orgId,
      workspaceId: schema.aiStorySceneResults.workspaceId,
      status: schema.aiStorySceneResults.status,
      sceneExecutionId: schema.aiStorySceneResults.sceneExecutionId,
    }).from(schema.aiStorySceneResults).where(eq(
      schema.aiStorySceneResults.sceneExecutionId,
      sceneExecutionId,
    )).orderBy(desc(schema.aiStorySceneResults.projectedAt)).limit(1);
    if (!sceneResult || sceneResult.status !== "SUCCEEDED") return null;

    const classification = await this.classifyRuntimeRecovery(sceneResult);
    if (classification.kind === "HISTORICAL_NOT_AUTO_RECOVERABLE") return null;
    if (classification.kind === "CURRENT_RUNTIME_AUTHORITY_CORRUPT") {
      throw new AiStoryPostGenerationQcRuntimeAuthorityError(
        "POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT",
        classification.reason,
      );
    }

    const [scene, compiledRow, attemptRow, attestationRow] = await Promise.all([
      this.db.select({
        intent: schema.aiStorySceneExecutions.intent,
        instructionHash: schema.aiStorySceneExecutions.instructionHash,
        sceneId: schema.aiStorySceneExecutions.sceneId,
        storyVersionId: schema.aiStorySceneExecutions.storyVersionId,
      }).from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id, sceneExecutionId)).limit(1),
      this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
        .from(schema.aiStoryCompiledProviderRequests)
        .where(eq(
          schema.aiStoryCompiledProviderRequests.compiledRequestId,
          classification.compiledRequestId,
        )).limit(1),
      this.db.select({
        providerTaskId: schema.providerAttempts.providerRequestId,
        providerMetadata: schema.providerAttempts.providerMetadata,
      }).from(schema.providerAttempts)
        .where(eq(schema.providerAttempts.attemptId, sceneResult.providerAttemptId)).limit(1),
      this.db.select({ attestation: schema.aiStoryDurableSceneMediaAttestations.attestation })
        .from(schema.aiStoryDurableSceneMediaAttestations)
        .where(eq(schema.aiStoryDurableSceneMediaAttestations.sceneResultId, sceneResult.sceneResultId)).limit(1),
    ]);
    const sceneRow = scene[0];
    const compiled = compiledRow[0]
      ? AiStoryCompiledProviderRequestSchema.parse(compiledRow[0].request)
      : null;
    const attestation = attestationRow[0]
      ? DurableSceneMediaAttestationSchema.parse(attestationRow[0].attestation)
      : null;
    if (!sceneRow || !compiled || !attemptRow[0] || !attestation) return null;
    if (compiled.compiledRequestId !== classification.compiledRequestId) return null;

    const [instructionRows, qcRows, sceneVersionRows] = await Promise.all([
      this.db.select({ instructions: schema.aiStorySceneInstructionSnapshots.instructions })
        .from(schema.aiStorySceneInstructionSnapshots)
        .where(eq(schema.aiStorySceneInstructionSnapshots.contentHash, sceneRow.instructionHash)).limit(1),
      this.db.select({ evaluation: schema.aiStoryPreGenerationQcEvaluations.evaluation })
        .from(schema.aiStoryPreGenerationQcEvaluations)
        .where(eq(schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId, compiled.qcEvaluationId)).limit(1),
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sceneRow.sceneId)
        ? this.db.select({ version: schema.aiStoryCanonicalSceneVersions.version })
            .from(schema.aiStoryCanonicalSceneVersions)
            .where(and(
              eq(schema.aiStoryCanonicalSceneVersions.sceneId, sceneRow.sceneId),
              eq(schema.aiStoryCanonicalSceneVersions.storyVersionId, sceneRow.storyVersionId),
            )).orderBy(desc(schema.aiStoryCanonicalSceneVersions.version)).limit(1)
        : Promise.resolve([]),
    ]);
    if (!instructionRows[0]) return null;
    const qc = qcRows[0]
      ? AiStoryPreGenerationQcEvaluationSchema.parse(qcRows[0].evaluation)
      : null;
    const [handoff] = qc ? await this.db.select({
      handoffFingerprint: schema.aiStoryScriptDirectorHandoffs.handoffFingerprint,
    }).from(schema.aiStoryScriptDirectorHandoffs)
      .where(eq(schema.aiStoryScriptDirectorHandoffs.handoffId, qc.handoffId)).limit(1) : [];
    if (qc && !handoff) {
      throw new AiStoryPostGenerationQcRuntimeAuthorityError(
        "POST_QC_CURRENT_RUNTIME_AUTHORITY_CORRUPT",
        `Canonical Pre-QC handoff authority is missing for scene ${sceneExecutionId}`,
      );
    }
    const metadata = attemptRow[0].providerMetadata ?? {};
    return {
      executionPlanId: sceneResult.executionPlanId,
      intent: AiStorySceneExecutionIntentSchema.parse(sceneRow.intent),
      instructions: AiStorySceneCompiledInstructionsSchema.parse(instructionRows[0].instructions),
      compiledRequest: compiled,
      preGenerationAuthority: qc ? {
        planningLineageSource: "FROZEN_SCRIPT_DIRECTOR",
        qcEvaluationId: qc.qcEvaluationId,
        qcFingerprint: qc.qcFingerprint,
        scriptVersionId: qc.scriptVersionId,
        handoffId: qc.handoffId,
        handoffFingerprint: handoff!.handoffFingerprint,
        productGrounded: qc.productGrounded,
        shotRecipeFingerprint: qc.shotRecipeBindings?.[0]?.recipeFingerprint ?? null,
      } : {
        // Older V1 schedules used the persisted Scene-intent validation capsule
        // as their canonical Pre-QC authority. Its immutable identity and
        // fingerprint are carried by the compiled request; frozen
        // Director/Motion/Handoff rows supply the remaining lineage.
        planningLineageSource: "LEGACY_COMPILED_V1",
        qcEvaluationId: compiled.qcEvaluationId,
        qcFingerprint: compiled.qcFingerprint,
        scriptVersionId: null,
        handoffId: null,
        handoffFingerprint: null,
        productGrounded: compiled.generationAuthority?.strategy === "PRODUCT_GROUNDED_VIDEO",
        shotRecipeFingerprint: null,
      },
      // Legacy retained Scenes predate canonical Scene-version rows and are
      // contractually version 1. Canonical UUID Scenes resolve the persisted version.
      sceneVersion: sceneVersionRows[0]?.version ?? 1,
      providerAttemptId: sceneResult.providerAttemptId,
      providerTaskId: attemptRow[0].providerTaskId,
      actualUsage: (metadata.actualUsage as Record<string, unknown> | undefined) ?? null,
      attestation,
    };
  }

  private async selectPendingRecoverySceneResults(
    limit: number,
    offset: number,
  ): Promise<readonly PendingRecoverySceneResult[]> {
    return this.db.select({
      sceneExecutionId: schema.aiStorySceneResults.sceneExecutionId,
      sceneResultId: schema.aiStorySceneResults.sceneResultId,
      providerAttemptId: schema.aiStorySceneResults.providerAttemptId,
      providerExecutionId: schema.aiStorySceneResults.providerExecutionId,
      orgId: schema.aiStorySceneResults.orgId,
      workspaceId: schema.aiStorySceneResults.workspaceId,
    }).from(schema.aiStorySceneResults)
      .innerJoin(
        schema.aiStoryDurableSceneMediaAttestations,
        eq(schema.aiStoryDurableSceneMediaAttestations.sceneResultId, schema.aiStorySceneResults.sceneResultId),
      )
      .leftJoin(
        schema.aiStoryPostGenerationQcEvaluations,
        and(
          eq(schema.aiStoryPostGenerationQcEvaluations.sceneExecutionId, schema.aiStorySceneResults.sceneExecutionId),
          eq(schema.aiStoryPostGenerationQcEvaluations.providerAttemptId, schema.aiStorySceneResults.providerAttemptId),
        ),
      )
      .where(and(
        eq(schema.aiStorySceneResults.status, "SUCCEEDED"),
        isNull(schema.aiStoryPostGenerationQcEvaluations.postQcEvaluationId),
      ))
      .orderBy(asc(schema.aiStorySceneResults.projectedAt))
      .limit(limit)
      .offset(offset);
  }

  private async classifyRuntimeRecovery(
    sceneResult: PendingRecoverySceneResult,
  ): Promise<RecoveryClassification> {
    const [attempt] = await this.db.select({
      contractVersion: schema.providerAttempts.contractVersion,
      requestHash: schema.providerAttempts.requestHash,
      providerId: schema.providerAttempts.providerId,
      modelVersion: schema.providerAttempts.modelVersion,
    }).from(schema.providerAttempts)
      .where(eq(schema.providerAttempts.attemptId, sceneResult.providerAttemptId)).limit(1);
    if (!attempt) return { kind: "HISTORICAL_NOT_AUTO_RECOVERABLE" };

    const [scene] = await this.db.select({
      orgId: schema.aiStorySceneExecutions.orgId,
      workspaceId: schema.aiStorySceneExecutions.workspaceId,
      campaignId: schema.aiStorySceneExecutions.campaignId,
      storyId: schema.aiStorySceneExecutions.storyId,
      storyVersionId: schema.aiStorySceneExecutions.storyVersionId,
    }).from(schema.aiStorySceneExecutions)
      .where(eq(schema.aiStorySceneExecutions.id, sceneResult.sceneExecutionId)).limit(1);
    if (!scene) {
      return attempt.contractVersion === CURRENT_PROVIDER_RUNTIME_CONTRACT_VERSION
        ? {
            kind: "CURRENT_RUNTIME_AUTHORITY_CORRUPT",
            reason: `Current AI Story Scene authority is missing for ${sceneResult.sceneExecutionId}`,
          }
        : { kind: "HISTORICAL_NOT_AUTO_RECOVERABLE" };
    }

    if (attempt.contractVersion === CURRENT_PROVIDER_RUNTIME_CONTRACT_VERSION) {
      return this.classifyCurrentRuntimeRecovery(sceneResult, scene, attempt);
    }
    if (attempt.contractVersion === LEGACY_PROVIDER_ATTEMPT_CONTRACT_VERSION) {
      return this.classifyLegacyRuntimeRecovery(sceneResult, scene, attempt);
    }
    return { kind: "HISTORICAL_NOT_AUTO_RECOVERABLE" };
  }

  private async classifyCurrentRuntimeRecovery(
    sceneResult: PendingRecoverySceneResult,
    scene: SceneAuthorityRow,
    attempt: { readonly providerId: string; readonly modelVersion: string },
  ): Promise<RecoveryClassification> {
    const corrupt = (reason: string): RecoveryClassification => ({
      kind: "CURRENT_RUNTIME_AUTHORITY_CORRUPT",
      reason,
    });
    const [bindingRow] = await this.db.select({
      providerAttemptId: schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
      compiledRequestId: schema.aiStoryProviderAttemptCompiledBindings.compiledRequestId,
      binding: schema.aiStoryProviderAttemptCompiledBindings.binding,
      sceneExecutionId: schema.aiStoryProviderAttemptCompiledBindings.sceneExecutionId,
      requestFingerprint: schema.aiStoryProviderAttemptCompiledBindings.requestFingerprint,
      orgId: schema.aiStoryProviderAttemptCompiledBindings.orgId,
      workspaceId: schema.aiStoryProviderAttemptCompiledBindings.workspaceId,
    }).from(schema.aiStoryProviderAttemptCompiledBindings)
      .where(eq(
        schema.aiStoryProviderAttemptCompiledBindings.providerAttemptId,
        sceneResult.providerAttemptId,
      )).limit(1);
    if (!bindingRow) {
      return corrupt(
        `Current AI Story Attempt binding is missing for ${sceneResult.providerAttemptId}`,
      );
    }
    const binding = bindingRow.binding;
    if (
      bindingRow.providerAttemptId !== sceneResult.providerAttemptId
      || binding.providerAttemptId !== sceneResult.providerAttemptId
      || binding.providerExecutionId !== sceneResult.providerExecutionId
      || binding.sceneExecutionId !== sceneResult.sceneExecutionId
      || bindingRow.sceneExecutionId !== sceneResult.sceneExecutionId
    ) {
      return corrupt(
        `Current AI Story Attempt binding identities contradict Scene Result ${sceneResult.sceneResultId}`,
      );
    }

    const [compiled] = await this.db.select({
      compiledRequestId: schema.aiStoryCompiledProviderRequests.compiledRequestId,
      requestFingerprint: schema.aiStoryCompiledProviderRequests.requestFingerprint,
      providerId: schema.aiStoryCompiledProviderRequests.providerId,
      modelId: schema.aiStoryCompiledProviderRequests.modelId,
      orgId: schema.aiStoryCompiledProviderRequests.orgId,
      workspaceId: schema.aiStoryCompiledProviderRequests.workspaceId,
      campaignId: schema.aiStoryCompiledProviderRequests.campaignId,
      storyId: schema.aiStoryCompiledProviderRequests.storyId,
      storyVersionId: schema.aiStoryCompiledProviderRequests.storyVersionId,
      sceneExecutionId: schema.aiStoryCompiledProviderRequests.sceneExecutionId,
    }).from(schema.aiStoryCompiledProviderRequests)
      .where(eq(
        schema.aiStoryCompiledProviderRequests.compiledRequestId,
        binding.compiledRequestId,
      )).limit(1);
    if (!compiled || compiled.compiledRequestId !== binding.compiledRequestId) {
      return corrupt(
        `Current AI Story compiled request ${binding.compiledRequestId} is missing for Attempt ${sceneResult.providerAttemptId}`,
      );
    }
    if (
      binding.requestFingerprint !== compiled.requestFingerprint
      || bindingRow.requestFingerprint !== compiled.requestFingerprint
    ) {
      return corrupt(
        `Current AI Story Attempt binding fingerprint contradicts compiled request ${compiled.compiledRequestId}`,
      );
    }
    if (compiled.sceneExecutionId !== sceneResult.sceneExecutionId) {
      return corrupt(
        `Current AI Story compiled request ${compiled.compiledRequestId} is bound to a foreign Scene`,
      );
    }
    if (!compiledMatchesSceneAuthority(compiled, scene, sceneResult.sceneExecutionId)) {
      return corrupt(
        `Current AI Story compiled request ${compiled.compiledRequestId} contradicts Scene identity`,
      );
    }
    if (
      binding.orgId !== compiled.orgId
      || binding.workspaceId !== compiled.workspaceId
      || binding.campaignId !== compiled.campaignId
      || binding.storyId !== compiled.storyId
      || binding.storyVersionId !== compiled.storyVersionId
      || bindingRow.orgId !== compiled.orgId
      || bindingRow.workspaceId !== compiled.workspaceId
    ) {
      return corrupt(
        `Current AI Story Attempt binding tenant identity contradicts compiled request ${compiled.compiledRequestId}`,
      );
    }
    if (!providerModelCompatible(compiled, attempt) || binding.providerId !== compiled.providerId || binding.modelId !== compiled.modelId) {
      return corrupt(
        `Current AI Story Provider/model identity contradicts compiled request ${compiled.compiledRequestId}`,
      );
    }
    return { kind: "RECOVERABLE", compiledRequestId: compiled.compiledRequestId };
  }

  private async classifyLegacyRuntimeRecovery(
    sceneResult: PendingRecoverySceneResult,
    scene: SceneAuthorityRow,
    attempt: { readonly requestHash: string; readonly providerId: string; readonly modelVersion: string },
  ): Promise<RecoveryClassification> {
    const compiledRows = await this.db.select({
      compiledRequestId: schema.aiStoryCompiledProviderRequests.compiledRequestId,
      requestFingerprint: schema.aiStoryCompiledProviderRequests.requestFingerprint,
      providerId: schema.aiStoryCompiledProviderRequests.providerId,
      modelId: schema.aiStoryCompiledProviderRequests.modelId,
      orgId: schema.aiStoryCompiledProviderRequests.orgId,
      workspaceId: schema.aiStoryCompiledProviderRequests.workspaceId,
      campaignId: schema.aiStoryCompiledProviderRequests.campaignId,
      storyId: schema.aiStoryCompiledProviderRequests.storyId,
      storyVersionId: schema.aiStoryCompiledProviderRequests.storyVersionId,
      sceneExecutionId: schema.aiStoryCompiledProviderRequests.sceneExecutionId,
    }).from(schema.aiStoryCompiledProviderRequests)
      .where(eq(
        schema.aiStoryCompiledProviderRequests.sceneExecutionId,
        sceneResult.sceneExecutionId,
      ));
    const compatible = compiledRows.filter((row) => (
      compiledMatchesSceneAuthority(row, scene, sceneResult.sceneExecutionId)
      && providerModelCompatible(row, attempt)
    ));
    const uniqueMatches = compatible.filter((row) => row.requestFingerprint === attempt.requestHash);
    if (uniqueMatches.length === 1) {
      return { kind: "RECOVERABLE", compiledRequestId: uniqueMatches[0]!.compiledRequestId };
    }
    return { kind: "HISTORICAL_NOT_AUTO_RECOVERABLE" };
  }

  async accept(inputPackage: AiStoryPostGenerationQcInputPackage, evaluation: AiStoryPostGenerationQcEvaluation): Promise<{ evaluation: AiStoryPostGenerationQcEvaluation; replayed: boolean }>;
  async accept(evaluation: AiStoryPostGenerationQcEvaluation): Promise<{ evaluation: AiStoryPostGenerationQcEvaluation; replayed: boolean }>;
  async accept(first: AiStoryPostGenerationQcInputPackage | AiStoryPostGenerationQcEvaluation, second?: AiStoryPostGenerationQcEvaluation) {
    const evaluation = AiStoryPostGenerationQcEvaluationSchema.parse(second ?? first);
    const inputPackage = second ? first as AiStoryPostGenerationQcInputPackage : null;
    if (!inputPackage) throw new AiStoryPostGenerationQcPersistenceError("POST_QC_IMMUTABLE_CONFLICT", "Durable Post-QC acceptance requires its immutable input package");
    const inserted = await this.db.insert(schema.aiStoryPostGenerationQcEvaluations).values({
      postQcEvaluationId: evaluation.postQcEvaluationId,
      postQcInputId: evaluation.postQcInputId,
      evaluationVersion: evaluation.evaluationVersion,
      orgId: evaluation.orgId,
      workspaceId: evaluation.workspaceId,
      providerAttemptId: evaluation.providerAttemptId,
      mediaAssetId: evaluation.mediaAssetId,
      sceneExecutionId: evaluation.sceneExecutionId,
      aggregateStatus: evaluation.aggregateStatus,
      evaluationFingerprint: evaluation.evaluationFingerprint,
      inputPackage,
      evaluation,
      evaluatedAt: new Date(evaluation.evaluatedAt),
    }).onConflictDoNothing().returning({ evaluation: schema.aiStoryPostGenerationQcEvaluations.evaluation });
    if (inserted[0]) return { evaluation: AiStoryPostGenerationQcEvaluationSchema.parse(inserted[0].evaluation), replayed: false };
    const current = await this.getByIdentity(evaluation);
    if (!current || current.evaluationFingerprint !== evaluation.evaluationFingerprint) {
      throw new AiStoryPostGenerationQcPersistenceError("POST_QC_IMMUTABLE_CONFLICT", "Post-QC evaluation identity conflicts with immutable evidence");
    }
    return { evaluation: current, replayed: true };
  }
}

/** Adapter keeps the service repository interface while preserving immutable input. */
export class BoundAiStoryPostGenerationQcRepository {
  constructor(private readonly input: AiStoryPostGenerationQcInputPackage, private readonly repository = new AiStoryPostGenerationQcRepository()) {}
  getByIdentity(identity: { postQcInputId: string; evaluationVersion: number }) { return this.repository.getByIdentity(identity); }
  accept(evaluation: AiStoryPostGenerationQcEvaluation) { return this.repository.accept(this.input, evaluation); }
}
