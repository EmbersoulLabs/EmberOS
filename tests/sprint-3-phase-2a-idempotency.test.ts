import { describe, expect, it } from "vitest";
import {
  ExecutionPlanIdentityConflictError,
  assertEquivalentExecutionPlan,
  canonicalPersistenceHash,
  deterministicPersistenceUuid,
  executionPlanDeterministicFingerprint,
  validateSceneExecutionPersistenceInput,
} from "@ceo-agent/db";
import { makePhase2aCompilation, PHASE_2A_IDS, PHASE_2A_WORKSPACE_B_IDS } from "./helpers/ai-story-phase-2a";

describe("Sprint 3 Phase 2A deterministic persistence identity", () => {
  it("same deterministic compile produces the same Execution Plan ID", () => {
    const first = makePhase2aCompilation();
    const repeated = makePhase2aCompilation();
    expect(first.plan.storyExecutionId).toBe(repeated.plan.storyExecutionId);
    expect(first.plan.compilationHash).toBe(repeated.plan.compilationHash);
    expect(executionPlanDeterministicFingerprint(first.plan)).toBe(
      executionPlanDeterministicFingerprint(repeated.plan)
    );
    expect(() => assertEquivalentExecutionPlan(first.plan, repeated.plan)).not.toThrow();
    expect(deterministicPersistenceUuid("execution-plan", first.plan.compilationHash)).toBe(
      deterministicPersistenceUuid("execution-plan", first.plan.compilationHash)
    );
  });

  it("different Animation Package fails with 409 EXECUTION_PLAN_IDENTITY_CONFLICT", () => {
    const accepted = makePhase2aCompilation();
    const conflicting = makePhase2aCompilation({
      animationPackageId: "20000000-0000-4000-8000-000000000006",
    });
    expect(conflicting.plan.storyExecutionId).not.toBe(accepted.plan.storyExecutionId);
    expect(executionPlanDeterministicFingerprint(conflicting.plan)).not.toBe(
      executionPlanDeterministicFingerprint(accepted.plan)
    );
    try {
      assertEquivalentExecutionPlan(accepted.plan, conflicting.plan);
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionPlanIdentityConflictError);
      expect(error).toMatchObject({ status: 409, code: "EXECUTION_PLAN_IDENTITY_CONFLICT" });
    }
  });

  it("different Scene ordering fails with 409 EXECUTION_PLAN_IDENTITY_CONFLICT", () => {
    const accepted = makePhase2aCompilation();
    const conflicting = makePhase2aCompilation({ sceneOrder: [1, 0] });
    expect(conflicting.plan.storyExecutionId).not.toBe(accepted.plan.storyExecutionId);
    try {
      assertEquivalentExecutionPlan(accepted.plan, conflicting.plan);
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionPlanIdentityConflictError);
      expect(error).toMatchObject({ status: 409, code: "EXECUTION_PLAN_IDENTITY_CONFLICT" });
    }
  });

  it("different instruction hash fails with 409 EXECUTION_PLAN_IDENTITY_CONFLICT", () => {
    const accepted = makePhase2aCompilation();
    const conflicting = makePhase2aCompilation({ instructionPurpose: "Different immutable instructions" });
    expect(conflicting.plan.storyExecutionId).not.toBe(accepted.plan.storyExecutionId);
    expect(conflicting.intents[0]!.normalizedPayloadReference.contentHash).not.toBe(
      accepted.intents[0]!.normalizedPayloadReference.contentHash
    );
    try {
      assertEquivalentExecutionPlan(accepted.plan, conflicting.plan);
      throw new Error("expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionPlanIdentityConflictError);
      expect(error).toMatchObject({ status: 409, code: "EXECUTION_PLAN_IDENTITY_CONFLICT" });
    }

    const sceneExecutionId = accepted.intents[0]!.identity.sceneExecutionId;
    const altered = {
      ...accepted,
      instructionsBySceneExecutionId: {
        ...accepted.instructionsBySceneExecutionId,
        [sceneExecutionId]: {
          ...accepted.instructionsBySceneExecutionId[sceneExecutionId]!,
          purpose: "Mutated snapshot without updating Intent hash",
        },
      },
    };
    expect(() => validateSceneExecutionPersistenceInput(altered)).toThrow(
      ExecutionPlanIdentityConflictError
    );
    expect(
      canonicalPersistenceHash(altered.instructionsBySceneExecutionId[sceneExecutionId]!)
    ).not.toBe(accepted.intents[0]!.normalizedPayloadReference.contentHash);
  });

  it("workspace isolation yields independent deterministic fingerprints", () => {
    const workspaceA = makePhase2aCompilation({ ids: PHASE_2A_IDS });
    const workspaceB = makePhase2aCompilation({ ids: PHASE_2A_WORKSPACE_B_IDS });
    expect(workspaceA.plan.frozenStoryVersion.storyVersionId).not.toBe(
      workspaceB.plan.frozenStoryVersion.storyVersionId
    );
    expect(executionPlanDeterministicFingerprint(workspaceA.plan)).not.toBe(
      executionPlanDeterministicFingerprint(workspaceB.plan)
    );
    expect(workspaceA.plan.storyExecutionId).not.toBe(workspaceB.plan.storyExecutionId);
  });
});
