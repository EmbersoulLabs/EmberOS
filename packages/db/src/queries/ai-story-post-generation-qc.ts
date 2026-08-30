import { and, desc, eq, inArray } from "drizzle-orm";
import {
  AiStoryPostGenerationQcEvaluationSchema,
  type AiStoryPostGenerationQcEvaluation,
  type AiStoryPostGenerationQcInputPackage,
} from "@ceo-agent/shared";
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
