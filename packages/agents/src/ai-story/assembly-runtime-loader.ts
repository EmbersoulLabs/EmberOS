/**
 * Sprint 3 PR 3.6 — Assembly Runtime input loader.
 * Fail-closed validation before media execution. Never mutates canonical state.
 */
import {
  ASSEMBLY_RUNTIME_CONTRACT_VERSION,
  ASSEMBLY_ENGINE_VERSION,
  ASSEMBLY_NORMALIZATION_POLICY_VERSION,
  AssemblyRuntimeInputSchema,
  type AssemblyRuntimeFailureClassification,
  type AssemblyRuntimeInput,
  type AssemblyRuntimeSceneInput,
} from "@ceo-agent/shared/server";
import type { AssemblyJob } from "@ceo-agent/shared/server";
import type {
  AssemblySceneMembership,
  CanonicalSceneResult,
  StoryAssemblyDefinition,
  RuntimeOwnershipIdentity,
} from "@ceo-agent/shared";

export class AssemblyRuntimeInputError extends Error {
  constructor(
    readonly classification: AssemblyRuntimeFailureClassification,
    message: string
  ) {
    super(message);
    this.name = "AssemblyRuntimeInputError";
  }
}

export type AssemblyRuntimeLoaderSources = {
  readonly job: AssemblyJob;
  readonly definition: StoryAssemblyDefinition;
  readonly memberships: readonly AssemblySceneMembership[];
  readonly sceneResults: readonly CanonicalSceneResult[];
};

function ownershipEquals(
  a: RuntimeOwnershipIdentity,
  b: {
    readonly orgId: string;
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly storyId: string;
    readonly storyVersionId: string;
    readonly animationPackageId: string;
    readonly executionPlanId: string;
  }
): boolean {
  return (
    a.orgId === b.orgId &&
    a.workspaceId === b.workspaceId &&
    a.campaignId === b.campaignId &&
    a.storyId === b.storyId &&
    a.storyVersionId === b.storyVersionId &&
    a.animationPackageId === b.animationPackageId &&
    a.executionPlanId === b.executionPlanId
  );
}

/**
 * Load and validate canonical assembly inputs. Fail closed before media work.
 */
export function loadAssemblyRuntimeInput(
  sources: AssemblyRuntimeLoaderSources
): AssemblyRuntimeInput {
  const { job, definition, memberships, sceneResults } = sources;

  if (definition.executionPlanId !== job.executionPlanId) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_INPUT_INCOMPLETE",
      "Assembly Definition does not belong to Assembly Job Execution Plan"
    );
  }
  if (definition.assemblyDefinitionId !== job.assemblyDefinitionId) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_INPUT_INCOMPLETE",
      "Assembly Definition id does not match Assembly Job"
    );
  }
  if (
    definition.orgId !== job.ownership.orgId ||
    definition.workspaceId !== job.ownership.workspaceId
  ) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_MEMBERSHIP_CONFLICT",
      "Assembly Definition ownership does not match Assembly Job"
    );
  }

  const orderedMemberships = [...memberships].sort((a, b) => a.sceneOrder - b.sceneOrder);
  if (orderedMemberships.length !== definition.sceneCount) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_MEMBERSHIP_CONFLICT",
      "Membership count does not match Assembly Definition scene count"
    );
  }
  if (orderedMemberships.length !== job.orderedSceneResultIds.length) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_MEMBERSHIP_CONFLICT",
      "Membership count does not match Assembly Job ordered Scene Results"
    );
  }

  const membershipOrders = new Set<number>();
  const membershipExecutions = new Set<string>();
  for (const membership of orderedMemberships) {
    if (membership.executionPlanId !== job.executionPlanId) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Membership Execution Plan mismatch"
      );
    }
    if (membership.assemblyDefinitionId !== definition.assemblyDefinitionId) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Membership Assembly Definition mismatch"
      );
    }
    if (membershipOrders.has(membership.sceneOrder)) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_ORDER_CONFLICT",
        "Duplicate membership scene order"
      );
    }
    if (membershipExecutions.has(membership.sceneExecutionId)) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Duplicate membership Scene Execution"
      );
    }
    membershipOrders.add(membership.sceneOrder);
    membershipExecutions.add(membership.sceneExecutionId);
  }

  const orderedByDefinition = definition.orderedSceneExecutionIds;
  const orderedByMembership = orderedMemberships.map((row) => row.sceneExecutionId);
  if (
    orderedByDefinition.length !== orderedByMembership.length ||
    orderedByDefinition.some((id, index) => id !== orderedByMembership[index])
  ) {
    throw new AssemblyRuntimeInputError(
      "ASSEMBLY_ORDER_CONFLICT",
      "Membership order does not match Assembly Definition"
    );
  }

  const resultsByExecution = new Map<string, CanonicalSceneResult[]>();
  for (const result of sceneResults) {
    if (result.executionPlanId !== job.executionPlanId) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Foreign Scene Result Execution Plan"
      );
    }
    if (!ownershipEquals(job.ownership, result.ownership)) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Scene Result ownership mismatch"
      );
    }
    const list = resultsByExecution.get(result.sceneExecutionId) ?? [];
    list.push(result);
    resultsByExecution.set(result.sceneExecutionId, list);
  }

  const orderedScenes: AssemblyRuntimeSceneInput[] = [];
  for (let index = 0; index < orderedMemberships.length; index++) {
    const membership = orderedMemberships[index]!;
    const matches = resultsByExecution.get(membership.sceneExecutionId) ?? [];
    if (matches.length === 0) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_INPUT_INCOMPLETE",
        "Missing canonical Scene Result for membership"
      );
    }
    if (matches.length > 1) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Duplicate canonical Scene Results for membership"
      );
    }
    const result = matches[0]!;
    if (result.sceneResultId !== job.orderedSceneResultIds[index]) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_ORDER_CONFLICT",
        "Scene Result order does not match Assembly Job ordered ids"
      );
    }
    if (result.sceneId !== membership.sceneId || result.sceneOrder !== membership.sceneOrder) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_ORDER_CONFLICT",
        "Scene Result identity/order does not match membership"
      );
    }
    if (result.status !== "SUCCEEDED") {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_INPUT_INCOMPLETE",
        "Scene Result is not SUCCEEDED"
      );
    }
    if (!result.mediaReference?.uri || !result.mediaReference.contentHash) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEDIA_UNAVAILABLE",
        "Scene Result media reference is incomplete"
      );
    }
    if (result.mediaReference.contentHash !== job.orderedSceneContentHashes[index]) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEDIA_HASH_MISMATCH",
        "Scene Result content hash does not match Assembly Job"
      );
    }
    if (!result.durationMs || result.durationMs <= 0) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEDIA_UNSUPPORTED",
        "Scene Result duration is invalid"
      );
    }

    orderedScenes.push({
      sceneResultId: result.sceneResultId,
      sceneExecutionId: result.sceneExecutionId,
      sceneId: result.sceneId,
      sceneOrder: result.sceneOrder,
      contentHash: result.mediaReference.contentHash,
      mediaReference: result.mediaReference,
      durationMs: result.durationMs,
    });
  }

  for (const result of sceneResults) {
    if (!orderedScenes.some((scene) => scene.sceneResultId === result.sceneResultId)) {
      throw new AssemblyRuntimeInputError(
        "ASSEMBLY_MEMBERSHIP_CONFLICT",
        "Extra Scene Result is not part of Assembly membership"
      );
    }
  }

  return AssemblyRuntimeInputSchema.parse({
    assemblyJobId: job.assemblyJobId,
    executionPlanId: job.executionPlanId,
    assemblyDefinitionId: job.assemblyDefinitionId,
    ownership: job.ownership,
    assemblyRuntimeContractVersion: ASSEMBLY_RUNTIME_CONTRACT_VERSION,
    assemblyEngineVersion: ASSEMBLY_ENGINE_VERSION,
    normalizationPolicyVersion: ASSEMBLY_NORMALIZATION_POLICY_VERSION,
    orderedScenes,
    job,
  });
}
