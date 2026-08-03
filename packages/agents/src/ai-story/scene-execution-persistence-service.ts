/**
 * Sprint 3 Phase 2A PR2 — Scene Execution Persistence Service.
 *
 * Receives a validated Generate Review compile+QC artifact and, when QC is
 * PASS or WARNING, atomically persists via the PR1 repository.
 *
 * Hard boundary: never enqueues work, never creates Provider/Outbox rows,
 * never unlocks execution, never calls Provider Router or provider adapters,
 * and never creates attempts or provider results.
 */
import {
  AiStorySceneExecutionPersistenceRepository,
  executionPlanDeterministicFingerprint,
  type AiStorySceneExecutionPersistenceStore,
  type PersistSceneExecutionCompilationInput,
  type PersistedSceneExecutionCompilation,
} from "@ceo-agent/db";
import {
  PHASE1_EXECUTION_LOCKED,
  type AiStoryAiQcResult,
  type AiStoryAiQcStatus,
  type AiStoryExecutionPlan,
  type AiStoryGenerateReviewValidationSummary,
  type AiStoryPersistenceStatus,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
} from "@ceo-agent/shared";

export type SceneExecutionPersistenceServiceInput = {
  readonly overallQcStatus: AiStoryAiQcStatus;
  readonly plan: AiStoryExecutionPlan;
  readonly intents: readonly AiStorySceneExecutionIntent[];
  readonly instructionsBySceneExecutionId: Readonly<
    Record<string, AiStorySceneCompiledInstructions>
  >;
  readonly validationResults: readonly AiStoryAiQcResult[];
};

export type SceneExecutionPersistenceServiceResult = {
  readonly persistenceStatus: AiStoryPersistenceStatus;
  readonly storyExecutionId: string | null;
  readonly sceneExecutionIds: readonly string[];
  readonly compilationHash: string | null;
  readonly executionAllowed: false;
  readonly executionLockCode: typeof PHASE1_EXECUTION_LOCKED;
  readonly validationSummary: AiStoryGenerateReviewValidationSummary;
  readonly acceptedAt: string | null;
  readonly persisted: PersistedSceneExecutionCompilation | null;
};

function buildValidationSummary(
  overallQcStatus: AiStoryAiQcStatus,
  validationResults: readonly AiStoryAiQcResult[]
): AiStoryGenerateReviewValidationSummary {
  const findings = validationResults.flatMap((result) => result.errors);
  return {
    overallQcStatus,
    blockingErrorCount: findings.filter((finding) => finding.severity === "blocking").length,
    warningCount: findings.filter((finding) => finding.severity === "warning").length,
    sceneCount: validationResults.length,
  };
}

function skippedQcFailed(
  input: SceneExecutionPersistenceServiceInput
): SceneExecutionPersistenceServiceResult {
  return {
    persistenceStatus: "skipped_qc_failed",
    storyExecutionId: null,
    sceneExecutionIds: [],
    compilationHash: null,
    executionAllowed: false,
    executionLockCode: PHASE1_EXECUTION_LOCKED,
    validationSummary: buildValidationSummary(input.overallQcStatus, input.validationResults),
    acceptedAt: null,
    persisted: null,
  };
}

export class SceneExecutionPersistenceService {
  constructor(
    private readonly store: AiStorySceneExecutionPersistenceStore = new AiStorySceneExecutionPersistenceRepository()
  ) {}

  /**
   * Persist only when overall QC is `passed` or `warning`.
   * `failed` persists absolutely nothing.
   */
  async persistFromGenerateReview(
    input: SceneExecutionPersistenceServiceInput
  ): Promise<SceneExecutionPersistenceServiceResult> {
    const validationSummary = buildValidationSummary(
      input.overallQcStatus,
      input.validationResults
    );

    if (input.overallQcStatus === "failed") {
      return skippedQcFailed(input);
    }

    const compilation: PersistSceneExecutionCompilationInput = {
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: input.validationResults,
    };

    const fingerprint = executionPlanDeterministicFingerprint(compilation.plan);
    const existing = await this.store.getByDeterministicFingerprint(fingerprint);
    const persisted = await this.store.persistCompilation(compilation);

    return {
      persistenceStatus: existing ? "reloaded" : "persisted",
      storyExecutionId: persisted.plan.storyExecutionId,
      sceneExecutionIds: persisted.intents.map((intent) => intent.identity.sceneExecutionId),
      compilationHash: persisted.plan.compilationHash,
      executionAllowed: false,
      executionLockCode: PHASE1_EXECUTION_LOCKED,
      validationSummary,
      acceptedAt: persisted.acceptedAt,
      persisted,
    };
  }
}
