/**
 * Sprint 3 PR 3.6 Phase 2 — read-only Assembly Validation Repository.
 *
 * Loads canonical inputs for validation. Never writes, updates, or deletes.
 * Never creates Assembly Jobs, Final Story Results, or facts.
 */
import type {
  AssemblySceneMediaMetadata,
  AssemblyValidationExecutionPlan,
  CanonicalSceneResult,
  StoryAssemblyDefinition,
  AssemblySceneMembership,
} from "@ceo-agent/shared/server";

export type AssemblyValidationRepository = {
  readonly getExecutionPlan: (
    executionPlanId: string
  ) => Promise<AssemblyValidationExecutionPlan | null>;

  readonly getAssemblyDefinition: (
    executionPlanId: string
  ) => Promise<StoryAssemblyDefinition | null>;

  readonly listMemberships: (
    assemblyDefinitionId: string
  ) => Promise<readonly AssemblySceneMembership[]>;

  readonly listCanonicalSceneResults: (
    executionPlanId: string
  ) => Promise<readonly CanonicalSceneResult[]>;

  readonly getSceneMediaMetadata: (
    sceneResultId: string
  ) => Promise<AssemblySceneMediaMetadata | null>;
};

/**
 * In-memory read-only repository for unit tests and deterministic replay.
 * Construction seals the snapshot; no mutating methods are exposed.
 */
export function createInMemoryAssemblyValidationRepository(input: {
  readonly executionPlans?: readonly AssemblyValidationExecutionPlan[];
  readonly assemblyDefinitions?: readonly StoryAssemblyDefinition[];
  readonly memberships?: readonly AssemblySceneMembership[];
  readonly sceneResults?: readonly CanonicalSceneResult[];
  readonly mediaMetadata?: readonly AssemblySceneMediaMetadata[];
}): AssemblyValidationRepository {
  const plans = Object.freeze(
    new Map(
      (input.executionPlans ?? []).map((plan) => [plan.executionPlanId, Object.freeze({ ...plan })])
    )
  );
  const definitionsByPlan = Object.freeze(
    new Map(
      (input.assemblyDefinitions ?? []).map((definition) => [
        definition.executionPlanId,
        Object.freeze({ ...definition }),
      ])
    )
  );
  const membershipsByDefinition = Object.freeze(
    groupFrozen(input.memberships ?? [], (row) => row.assemblyDefinitionId)
  );
  const resultsByPlan = Object.freeze(
    groupFrozen(input.sceneResults ?? [], (row) => row.executionPlanId)
  );
  const mediaByResult = Object.freeze(
    new Map(
      (input.mediaMetadata ?? []).map((row) => [
        row.sceneResultId,
        Object.freeze({ ...row }),
      ])
    )
  );

  return Object.freeze({
    async getExecutionPlan(executionPlanId) {
      return plans.get(executionPlanId) ?? null;
    },
    async getAssemblyDefinition(executionPlanId) {
      return definitionsByPlan.get(executionPlanId) ?? null;
    },
    async listMemberships(assemblyDefinitionId) {
      return membershipsByDefinition.get(assemblyDefinitionId) ?? Object.freeze([]);
    },
    async listCanonicalSceneResults(executionPlanId) {
      return resultsByPlan.get(executionPlanId) ?? Object.freeze([]);
    },
    async getSceneMediaMetadata(sceneResultId) {
      return mediaByResult.get(sceneResultId) ?? null;
    },
  });
}

function groupFrozen<T>(
  rows: readonly T[],
  keyOf: (row: T) => string
): ReadonlyMap<string, readonly T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const list = map.get(key);
    if (list) list.push(Object.freeze({ ...row }) as T);
    else map.set(key, [Object.freeze({ ...row }) as T]);
  }
  return new Map(
    [...map.entries()].map(([key, list]) => [key, Object.freeze(list.slice())])
  );
}
