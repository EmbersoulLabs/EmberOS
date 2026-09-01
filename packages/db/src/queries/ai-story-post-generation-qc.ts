import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
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

export class AiStoryPostGenerationQcPersistenceError extends Error {
  constructor(readonly code: "POST_QC_IMMUTABLE_CONFLICT", message: string) {
    super(message);
    this.name = "AiStoryPostGenerationQcPersistenceError";
  }
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

  /** Successful durable media that has not yet converged Post-QC. */
  async listPendingRuntimeRecoverySceneExecutionIds(limit = 10): Promise<readonly string[]> {
    const rows = await this.db.select({
      sceneExecutionId: schema.aiStorySceneResults.sceneExecutionId,
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
      .limit(Math.max(1, Math.min(limit, 50)));
    return [...new Set(rows.map((row) => row.sceneExecutionId))];
  }

  async loadRuntimeRecoveryAuthority(sceneExecutionId: string): Promise<{
    readonly executionPlanId: string;
    readonly intent: AiStorySceneExecutionIntent;
    readonly instructions: AiStorySceneCompiledInstructions;
    readonly compiledRequest: AiStoryCompiledProviderRequest;
    readonly preGenerationAuthority: Pick<
      AiStoryPreGenerationQcEvaluation,
      "qcEvaluationId" | "qcFingerprint" | "scriptVersionId" | "handoffId" | "productGrounded"
    > & { readonly shotRecipeFingerprint: string | null };
    readonly handoffFingerprint: string;
    readonly sceneVersion: number;
    readonly providerAttemptId: string;
    readonly providerTaskId: string | null;
    readonly actualUsage: Record<string, unknown> | null;
    readonly attestation: DurableSceneMediaAttestation;
  } | null> {
    const [sceneResult] = await this.db.select({
      executionPlanId: schema.aiStorySceneResults.executionPlanId,
      providerAttemptId: schema.aiStorySceneResults.providerAttemptId,
      sceneResultId: schema.aiStorySceneResults.sceneResultId,
      status: schema.aiStorySceneResults.status,
    }).from(schema.aiStorySceneResults).where(eq(
      schema.aiStorySceneResults.sceneExecutionId,
      sceneExecutionId,
    )).orderBy(desc(schema.aiStorySceneResults.projectedAt)).limit(1);
    if (!sceneResult || sceneResult.status !== "SUCCEEDED") return null;

    const [scene, compiledRow, attemptRow, attestationRow] = await Promise.all([
      this.db.select({
        intent: schema.aiStorySceneExecutions.intent,
        instructionHash: schema.aiStorySceneExecutions.instructionHash,
        sceneId: schema.aiStorySceneExecutions.sceneId,
        storyVersionId: schema.aiStorySceneExecutions.storyVersionId,
      }).from(schema.aiStorySceneExecutions).where(eq(schema.aiStorySceneExecutions.id, sceneExecutionId)).limit(1),
      this.db.select({ request: schema.aiStoryCompiledProviderRequests.compiledRequest })
        .from(schema.aiStoryCompiledProviderRequests)
        .where(eq(schema.aiStoryCompiledProviderRequests.sceneExecutionId, sceneExecutionId))
        .orderBy(desc(schema.aiStoryCompiledProviderRequests.compiledAt)).limit(1),
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

    const [instructionRows, qcRows, directorRows, motionRows, sceneVersionRows] = await Promise.all([
      this.db.select({ instructions: schema.aiStorySceneInstructionSnapshots.instructions })
        .from(schema.aiStorySceneInstructionSnapshots)
        .where(eq(schema.aiStorySceneInstructionSnapshots.contentHash, sceneRow.instructionHash)).limit(1),
      this.db.select({ evaluation: schema.aiStoryPreGenerationQcEvaluations.evaluation })
        .from(schema.aiStoryPreGenerationQcEvaluations)
        .where(eq(schema.aiStoryPreGenerationQcEvaluations.qcEvaluationId, compiled.qcEvaluationId)).limit(1),
      this.db.select({
        directorPlanId: schema.aiStoryDirectorPlanVersions.directorPlanId,
        scriptVersionId: schema.aiStoryDirectorPlanVersions.scriptVersionId,
        handoffId: schema.aiStoryDirectorPlanVersions.handoffId,
      }).from(schema.aiStoryDirectorPlanVersions).where(and(
        eq(schema.aiStoryDirectorPlanVersions.orgId, compiled.orgId),
        eq(schema.aiStoryDirectorPlanVersions.workspaceId, compiled.workspaceId),
        eq(schema.aiStoryDirectorPlanVersions.storyId, compiled.storyId),
        eq(schema.aiStoryDirectorPlanVersions.storyVersionId, compiled.storyVersionId),
        eq(schema.aiStoryDirectorPlanVersions.directorFingerprint, compiled.directorFingerprint),
        eq(schema.aiStoryDirectorPlanVersions.status, "FROZEN"),
      )).limit(1),
      this.db.select({
        motionPlanId: schema.aiStoryMotionPlanVersions.motionPlanId,
        directorPlanId: schema.aiStoryMotionPlanVersions.directorPlanId,
        scriptVersionId: schema.aiStoryMotionPlanVersions.scriptVersionId,
        handoffId: schema.aiStoryMotionPlanVersions.handoffId,
      })
        .from(schema.aiStoryMotionPlanVersions).where(and(
          eq(schema.aiStoryMotionPlanVersions.orgId, compiled.orgId),
          eq(schema.aiStoryMotionPlanVersions.workspaceId, compiled.workspaceId),
          eq(schema.aiStoryMotionPlanVersions.storyId, compiled.storyId),
          eq(schema.aiStoryMotionPlanVersions.storyVersionId, compiled.storyVersionId),
          eq(schema.aiStoryMotionPlanVersions.motionFingerprint, compiled.motionFingerprint),
          eq(schema.aiStoryMotionPlanVersions.status, "FROZEN"),
        )).limit(1),
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
    const fallbackLineage = directorRows[0] && motionRows[0] &&
      directorRows[0].directorPlanId === motionRows[0].directorPlanId &&
      directorRows[0].scriptVersionId === motionRows[0].scriptVersionId &&
      directorRows[0].handoffId === motionRows[0].handoffId
      ? directorRows[0]
      : null;
    if (!qc && !fallbackLineage) return null;
    const handoffId = qc?.handoffId ?? fallbackLineage!.handoffId;
    const [handoff] = await this.db.select({
      handoffFingerprint: schema.aiStoryScriptDirectorHandoffs.handoffFingerprint,
    }).from(schema.aiStoryScriptDirectorHandoffs)
      .where(eq(schema.aiStoryScriptDirectorHandoffs.handoffId, handoffId)).limit(1);
    if (!handoff) return null;
    const metadata = attemptRow[0].providerMetadata ?? {};
    return {
      executionPlanId: sceneResult.executionPlanId,
      intent: AiStorySceneExecutionIntentSchema.parse(sceneRow.intent),
      instructions: AiStorySceneCompiledInstructionsSchema.parse(instructionRows[0].instructions),
      compiledRequest: compiled,
      preGenerationAuthority: qc ? {
        qcEvaluationId: qc.qcEvaluationId,
        qcFingerprint: qc.qcFingerprint,
        scriptVersionId: qc.scriptVersionId,
        handoffId: qc.handoffId,
        productGrounded: qc.productGrounded,
        shotRecipeFingerprint: qc.shotRecipeBindings?.[0]?.recipeFingerprint ?? null,
      } : {
        // Older V1 schedules used the persisted Scene-intent validation capsule
        // as their canonical Pre-QC authority. Its immutable identity and
        // fingerprint are carried by the compiled request; frozen
        // Director/Motion/Handoff rows supply the remaining lineage.
        qcEvaluationId: compiled.qcEvaluationId,
        qcFingerprint: compiled.qcFingerprint,
        scriptVersionId: fallbackLineage!.scriptVersionId,
        handoffId: fallbackLineage!.handoffId,
        productGrounded: compiled.generationAuthority?.strategy === "PRODUCT_GROUNDED_VIDEO",
        shotRecipeFingerprint: null,
      },
      handoffFingerprint: handoff.handoffFingerprint,
      // Legacy retained Scenes predate canonical Scene-version rows and are
      // contractually version 1. Canonical UUID Scenes resolve the persisted version.
      sceneVersion: sceneVersionRows[0]?.version ?? 1,
      providerAttemptId: sceneResult.providerAttemptId,
      providerTaskId: attemptRow[0].providerTaskId,
      actualUsage: (metadata.actualUsage as Record<string, unknown> | undefined) ?? null,
      attestation,
    };
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
