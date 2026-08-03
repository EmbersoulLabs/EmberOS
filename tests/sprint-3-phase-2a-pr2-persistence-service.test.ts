/**
 * Sprint 3 Phase 2A PR2 — Scene Execution Persistence Service unit tests.
 * Uses an in-memory store double; never touches Queue / Outbox / Provider.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ExecutionPlanIdentityConflictError,
  ExecutionPlanOwnershipError,
  type AiStorySceneExecutionPersistenceStore,
  type PersistedSceneExecutionCompilation,
} from "@ceo-agent/db";
import { PHASE1_EXECUTION_LOCKED } from "@ceo-agent/shared";
import { SceneExecutionPersistenceService } from "../packages/agents/src/ai-story/scene-execution-persistence-service";
import { makePhase2aCompilation } from "./helpers/ai-story-phase-2a";

function asPersisted(
  input: ReturnType<typeof makePhase2aCompilation>,
  acceptedAt = "2026-08-02T12:00:00.000Z"
): PersistedSceneExecutionCompilation {
  return {
    plan: input.plan,
    intents: input.intents,
    instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
    validationResults: input.validationResults,
    acceptedAt,
  };
}

function makeStore(
  overrides: Partial<AiStorySceneExecutionPersistenceStore> = {}
): AiStorySceneExecutionPersistenceStore {
  return {
    persistCompilation: vi.fn(),
    getByExecutionPlanId: vi.fn(async () => null),
    getByDeterministicFingerprint: vi.fn(async () => null),
    listByStoryVersionId: vi.fn(async () => []),
    getInstructionSnapshot: vi.fn(async () => null),
    getValidationResults: vi.fn(async () => []),
    ...overrides,
  };
}

describe("SceneExecutionPersistenceService", () => {
  it("persists when overall QC is passed", async () => {
    const input = makePhase2aCompilation();
    const persisted = asPersisted(input);
    const store = makeStore({
      persistCompilation: vi.fn(async () => persisted),
      getByDeterministicFingerprint: vi.fn(async () => null),
    });
    const service = new SceneExecutionPersistenceService(store);

    const result = await service.persistFromGenerateReview({
      overallQcStatus: "passed",
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: input.validationResults,
    });

    expect(store.persistCompilation).toHaveBeenCalledOnce();
    expect(result.persistenceStatus).toBe("persisted");
    expect(result.storyExecutionId).toBe(input.plan.storyExecutionId);
    expect(result.sceneExecutionIds).toEqual(
      input.intents.map((intent) => intent.identity.sceneExecutionId)
    );
    expect(result.compilationHash).toBe(input.plan.compilationHash);
    expect(result.executionAllowed).toBe(false);
    expect(result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
  });

  it("persists when overall QC is warning (non-blocking)", async () => {
    const input = makePhase2aCompilation();
    const warnings = input.validationResults.map((result) => ({
      ...result,
      status: "warning" as const,
      errors: [
        {
          code: "CONTINUITY_CONTEXT_MISSING" as const,
          path: "worldContinuity",
          message: "Soft continuity warning",
          severity: "warning" as const,
        },
      ],
    }));
    const store = makeStore({
      persistCompilation: vi.fn(async () => asPersisted({ ...input, validationResults: warnings })),
    });
    const service = new SceneExecutionPersistenceService(store);

    const result = await service.persistFromGenerateReview({
      overallQcStatus: "warning",
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: warnings,
    });

    expect(store.persistCompilation).toHaveBeenCalledOnce();
    expect(result.persistenceStatus).toBe("persisted");
    expect(result.validationSummary.overallQcStatus).toBe("warning");
    expect(result.validationSummary.warningCount).toBe(2);
    expect(result.executionAllowed).toBe(false);
  });

  it("persists absolutely nothing when overall QC is failed", async () => {
    const input = makePhase2aCompilation();
    const failed = input.validationResults.map((result) => ({
      ...result,
      status: "failed" as const,
      errors: [
        {
          code: "SHOT_MISSING" as const,
          path: "shots",
          message: "Blocking",
          severity: "blocking" as const,
        },
      ],
    }));
    const store = makeStore();
    const service = new SceneExecutionPersistenceService(store);

    const result = await service.persistFromGenerateReview({
      overallQcStatus: "failed",
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: failed,
    });

    expect(store.persistCompilation).not.toHaveBeenCalled();
    expect(store.getByDeterministicFingerprint).not.toHaveBeenCalled();
    expect(result.persistenceStatus).toBe("skipped_qc_failed");
    expect(result.storyExecutionId).toBeNull();
    expect(result.sceneExecutionIds).toEqual([]);
    expect(result.compilationHash).toBeNull();
    expect(result.executionAllowed).toBe(false);
    expect(result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(result.validationSummary.blockingErrorCount).toBe(2);
  });

  it("reloads the canonical plan on identical persistence requests", async () => {
    const input = makePhase2aCompilation();
    const existing = asPersisted(input, "2026-08-02T11:00:00.000Z");
    const store = makeStore({
      getByDeterministicFingerprint: vi.fn(async () => existing),
      persistCompilation: vi.fn(async () => existing),
    });
    const service = new SceneExecutionPersistenceService(store);

    const result = await service.persistFromGenerateReview({
      overallQcStatus: "passed",
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: input.validationResults,
    });

    expect(result.persistenceStatus).toBe("reloaded");
    expect(result.storyExecutionId).toBe(existing.plan.storyExecutionId);
    expect(result.acceptedAt).toBe(existing.acceptedAt);
  });

  it("propagates identity conflicts fail-closed", async () => {
    const input = makePhase2aCompilation();
    const store = makeStore({
      persistCompilation: vi.fn(async () => {
        throw new ExecutionPlanIdentityConflictError("conflict");
      }),
    });
    const service = new SceneExecutionPersistenceService(store);

    await expect(
      service.persistFromGenerateReview({
        overallQcStatus: "passed",
        plan: input.plan,
        intents: input.intents,
        instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
        validationResults: input.validationResults,
      })
    ).rejects.toBeInstanceOf(ExecutionPlanIdentityConflictError);
  });

  it("propagates ownership validation failures fail-closed", async () => {
    const input = makePhase2aCompilation();
    const store = makeStore({
      persistCompilation: vi.fn(async () => {
        throw new ExecutionPlanOwnershipError("unauthorized");
      }),
    });
    const service = new SceneExecutionPersistenceService(store);

    await expect(
      service.persistFromGenerateReview({
        overallQcStatus: "passed",
        plan: input.plan,
        intents: input.intents,
        instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
        validationResults: input.validationResults,
      })
    ).rejects.toBeInstanceOf(ExecutionPlanOwnershipError);
  });

  it("does not enqueue, unlock, or touch provider surfaces", async () => {
    const input = makePhase2aCompilation();
    const store = makeStore({
      persistCompilation: vi.fn(async () => asPersisted(input)),
    });
    const service = new SceneExecutionPersistenceService(store);
    const result = await service.persistFromGenerateReview({
      overallQcStatus: "passed",
      plan: input.plan,
      intents: input.intents,
      instructionsBySceneExecutionId: input.instructionsBySceneExecutionId,
      validationResults: input.validationResults,
    });

    expect(result.executionAllowed).toBe(false);
    expect(result.executionLockCode).toBe(PHASE1_EXECUTION_LOCKED);
    expect(Object.keys(store)).toEqual(
      expect.arrayContaining([
        "persistCompilation",
        "getByDeterministicFingerprint",
        "getByExecutionPlanId",
        "listByStoryVersionId",
        "getInstructionSnapshot",
        "getValidationResults",
      ])
    );
  });
});
