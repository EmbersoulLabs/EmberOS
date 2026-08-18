/**
 * Sprint 3 PR 3.6 Phase 2 — Assembly Validation Layer.
 *
 * READ-ONLY. Validates canonical inputs before Assembly.
 * Never creates Assembly Jobs, Final Story Results, facts, or mutations.
 * Never invokes FFmpeg, Providers, or public runtime unlock.
 */
import { buildAssemblyDefinitionFingerprint } from "@ceo-agent/db";
import {
  ASSEMBLY_V1_SUPPORTED_AUDIO_CODECS,
  ASSEMBLY_V1_SUPPORTED_CONTAINERS,
  ASSEMBLY_V1_SUPPORTED_MEDIA_TYPES,
  ASSEMBLY_V1_SUPPORTED_VIDEO_CODECS,
  AssemblySceneMediaMetadataSchema,
  AssemblyValidationRequestSchema,
  AssemblyValidationResultSchema,
  assemblyIntegrityHash,
  type AssemblySceneMediaMetadata,
  type AssemblySceneMembership,
  type AssemblyValidationExecutionPlan,
  type AssemblyValidationIssue,
  type AssemblyValidationOwnershipExpectation,
  type AssemblyValidationRequest,
  type AssemblyValidationResult,
  type CanonicalSceneResult,
  type StoryAssemblyDefinition,
} from "@ceo-agent/shared/server";
import type { AssemblyValidationRepository } from "./assembly-validation-repository";

export type AssemblyValidatorDependencies = {
  readonly repository: AssemblyValidationRepository;
};

function issue(
  classification: AssemblyValidationIssue["classification"],
  message: string,
  extras: Omit<AssemblyValidationIssue, "classification" | "message"> = {}
): AssemblyValidationIssue {
  return { classification, message, ...extras };
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSupportedContainer(container: string): boolean {
  const normalized = normalizeToken(container);
  return (ASSEMBLY_V1_SUPPORTED_CONTAINERS as readonly string[]).some(
    (allowed) => normalizeToken(allowed) === normalized
  );
}

function isSupportedVideoCodec(codec: string): boolean {
  const normalized = normalizeToken(codec);
  return (ASSEMBLY_V1_SUPPORTED_VIDEO_CODECS as readonly string[]).some(
    (allowed) => normalizeToken(allowed) === normalized
  );
}

function isSupportedAudioCodec(codec: string): boolean {
  const normalized = normalizeToken(codec);
  return (ASSEMBLY_V1_SUPPORTED_AUDIO_CODECS as readonly string[]).some(
    (allowed) => normalizeToken(allowed) === normalized
  );
}

function isSupportedMediaType(mediaType: string): boolean {
  return (ASSEMBLY_V1_SUPPORTED_MEDIA_TYPES as readonly string[]).includes(
    mediaType.trim().toLowerCase() as (typeof ASSEMBLY_V1_SUPPORTED_MEDIA_TYPES)[number]
  );
}

export function computeAssemblyValidationExecutionPlanIntegrityHash(
  plan: Omit<AssemblyValidationExecutionPlan, "integrityHash">
): string {
  return assemblyIntegrityHash({
    kind: "assembly-validation-execution-plan",
    ...plan,
  });
}

function ownershipMatches(
  expected: AssemblyValidationOwnershipExpectation,
  actual: {
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
    actual.orgId === expected.orgId &&
    actual.workspaceId === expected.workspaceId &&
    actual.campaignId === expected.campaignId &&
    actual.storyId === expected.storyId &&
    actual.storyVersionId === expected.storyVersionId &&
    actual.animationPackageId === expected.animationPackageId &&
    actual.executionPlanId === expected.executionPlanId
  );
}

function validateExecutionPlan(
  plan: AssemblyValidationExecutionPlan | null,
  request: AssemblyValidationRequest
): AssemblyValidationIssue[] {
  if (!plan) {
    return [
      issue(
        "ASSEMBLY_DEFINITION_INVALID",
        "Execution Plan does not exist",
        { executionPlanId: request.executionPlanId }
      ),
    ];
  }

  const issues: AssemblyValidationIssue[] = [];
  const expectedHash = computeAssemblyValidationExecutionPlanIntegrityHash({
    executionPlanId: plan.executionPlanId,
    orgId: plan.orgId,
    workspaceId: plan.workspaceId,
    campaignId: plan.campaignId,
    storyId: plan.storyId,
    storyVersionId: plan.storyVersionId,
    animationPackageId: plan.animationPackageId,
  });
  if (plan.integrityHash !== expectedHash) {
    issues.push(
      issue("ASSEMBLY_DEFINITION_INVALID", "Execution Plan integrity hash is invalid", {
        executionPlanId: plan.executionPlanId,
      })
    );
  }

  if (
    !ownershipMatches(request.ownership, {
      orgId: plan.orgId,
      workspaceId: plan.workspaceId,
      campaignId: plan.campaignId,
      storyId: plan.storyId,
      storyVersionId: plan.storyVersionId,
      animationPackageId: plan.animationPackageId,
      executionPlanId: plan.executionPlanId,
    })
  ) {
    issues.push(
      issue(
        "ASSEMBLY_DEFINITION_INVALID",
        "Execution Plan ownership chain does not match expected organization/workspace/campaign/story/version/package",
        { executionPlanId: plan.executionPlanId }
      )
    );
  }

  if (plan.executionPlanId !== request.executionPlanId) {
    issues.push(
      issue("ASSEMBLY_DEFINITION_INVALID", "Execution Plan identity mismatch", {
        executionPlanId: request.executionPlanId,
      })
    );
  }

  return issues;
}

function validateAssemblyDefinition(
  definition: StoryAssemblyDefinition | null,
  plan: AssemblyValidationExecutionPlan,
  memberships: readonly AssemblySceneMembership[]
): AssemblyValidationIssue[] {
  if (!definition) {
    return [
      issue(
        "ASSEMBLY_DEFINITION_INVALID",
        "Accepted Assembly Definition does not exist for Execution Plan",
        { executionPlanId: plan.executionPlanId }
      ),
    ];
  }

  const issues: AssemblyValidationIssue[] = [];
  const expectedFingerprint = buildAssemblyDefinitionFingerprint({
    executionPlanId: definition.executionPlanId,
    orderedSceneExecutionIds: definition.orderedSceneExecutionIds,
  });
  if (definition.deterministicFingerprint !== expectedFingerprint) {
    issues.push(
      issue("ASSEMBLY_DEFINITION_INVALID", "Assembly Definition deterministic fingerprint is invalid", {
        executionPlanId: plan.executionPlanId,
        assemblyDefinitionId: definition.assemblyDefinitionId,
      })
    );
  }

  if (definition.executionPlanId !== plan.executionPlanId) {
    issues.push(
      issue("ASSEMBLY_DEFINITION_INVALID", "Assembly Definition execution plan mismatch", {
        executionPlanId: plan.executionPlanId,
        assemblyDefinitionId: definition.assemblyDefinitionId,
      })
    );
  }

  if (
    definition.orgId !== plan.orgId ||
    definition.workspaceId !== plan.workspaceId ||
    definition.campaignId !== plan.campaignId ||
    definition.storyId !== plan.storyId ||
    definition.storyVersionId !== plan.storyVersionId ||
    definition.animationPackageId !== plan.animationPackageId
  ) {
    issues.push(
      issue("ASSEMBLY_DEFINITION_INVALID", "Assembly Definition ownership is invalid", {
        executionPlanId: plan.executionPlanId,
        assemblyDefinitionId: definition.assemblyDefinitionId,
      })
    );
  }

  if (memberships.length !== definition.sceneCount) {
    issues.push(
      issue(
        "ASSEMBLY_MEMBERSHIP_INVALID",
        "Assembly membership count does not match declared scene count",
        {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
        }
      )
    );
  }

  if (definition.orderedSceneExecutionIds.length !== definition.sceneCount) {
    issues.push(
      issue(
        "ASSEMBLY_DEFINITION_INVALID",
        "Assembly Definition ordered Scene Execution ids do not match scene count",
        {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
        }
      )
    );
  }

  const sceneExecutionIds = new Set<string>();
  const sceneOrders = new Set<number>();
  for (const membership of memberships) {
    if (membership.assemblyDefinitionId !== definition.assemblyDefinitionId) {
      issues.push(
        issue("ASSEMBLY_MEMBERSHIP_INVALID", "Membership does not belong to Assembly Definition", {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    if (membership.executionPlanId !== plan.executionPlanId) {
      issues.push(
        issue("ASSEMBLY_MEMBERSHIP_INVALID", "Membership execution plan mismatch", {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
          sceneExecutionId: membership.sceneExecutionId,
        })
      );
    }
    if (sceneExecutionIds.has(membership.sceneExecutionId)) {
      issues.push(
        issue("ASSEMBLY_MEMBERSHIP_INVALID", "Duplicate Scene Execution membership", {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    sceneExecutionIds.add(membership.sceneExecutionId);

    if (sceneOrders.has(membership.sceneOrder)) {
      issues.push(
        issue("ASSEMBLY_ORDER_INVALID", "Duplicate scene order in Assembly membership", {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    sceneOrders.add(membership.sceneOrder);
  }

  const orderedByDefinition = definition.orderedSceneExecutionIds;
  const orderedByMembership = [...memberships]
    .sort((a, b) => a.sceneOrder - b.sceneOrder)
    .map((row) => row.sceneExecutionId);
  if (
    orderedByDefinition.length === orderedByMembership.length &&
    orderedByDefinition.some((id, index) => id !== orderedByMembership[index])
  ) {
    issues.push(
      issue("ASSEMBLY_ORDER_INVALID", "Membership order does not match Assembly Definition order", {
        executionPlanId: plan.executionPlanId,
        assemblyDefinitionId: definition.assemblyDefinitionId,
      })
    );
  }

  return issues;
}

function validateMembershipsAndSceneResults(
  plan: AssemblyValidationExecutionPlan,
  definition: StoryAssemblyDefinition,
  memberships: readonly AssemblySceneMembership[],
  sceneResults: readonly CanonicalSceneResult[],
  ownership: AssemblyValidationOwnershipExpectation
): {
  readonly issues: AssemblyValidationIssue[];
  readonly orderedResults: CanonicalSceneResult[];
} {
  const issues: AssemblyValidationIssue[] = [];
  const orderedMemberships = [...memberships].sort((a, b) => a.sceneOrder - b.sceneOrder);
  const resultsBySceneExecution = new Map<string, CanonicalSceneResult[]>();
  for (const result of sceneResults) {
    const list = resultsBySceneExecution.get(result.sceneExecutionId) ?? [];
    list.push(result);
    resultsBySceneExecution.set(result.sceneExecutionId, list);
  }

  const orderedResults: CanonicalSceneResult[] = [];
  const acceptedResultIds = new Set<string>();

  for (const membership of orderedMemberships) {
    const matches = resultsBySceneExecution.get(membership.sceneExecutionId) ?? [];
    if (matches.length === 0) {
      issues.push(
        issue("SCENE_RESULT_MISSING", "Canonical Scene Result is missing for Assembly membership", {
          executionPlanId: plan.executionPlanId,
          assemblyDefinitionId: definition.assemblyDefinitionId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneOrder: membership.sceneOrder,
        })
      );
      continue;
    }
    if (matches.length > 1) {
      issues.push(
        issue(
          "SCENE_RESULT_CONFLICT",
          "Multiple Canonical Scene Results exist for one Scene Execution membership",
          {
            executionPlanId: plan.executionPlanId,
            assemblyDefinitionId: definition.assemblyDefinitionId,
            sceneExecutionId: membership.sceneExecutionId,
            sceneOrder: membership.sceneOrder,
          }
        )
      );
      continue;
    }

    const result = matches[0]!;
    acceptedResultIds.add(result.sceneResultId);

    if (result.executionPlanId !== plan.executionPlanId) {
      issues.push(
        issue("SCENE_RESULT_CONFLICT", "Scene Result does not belong to Execution Plan", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    if (result.sceneExecutionId !== membership.sceneExecutionId) {
      issues.push(
        issue("SCENE_RESULT_CONFLICT", "Scene Result SceneExecution identity mismatch", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
        })
      );
    }
    if (result.sceneId !== membership.sceneId) {
      issues.push(
        issue("SCENE_RESULT_CONFLICT", "Scene Result scene identity mismatch", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    if (result.sceneOrder !== membership.sceneOrder) {
      issues.push(
        issue("ASSEMBLY_ORDER_INVALID", "Scene Result order does not match membership order", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    if (!ownershipMatches(ownership, result.ownership)) {
      issues.push(
        issue("ASSEMBLY_MEMBERSHIP_INVALID", "Scene Result ownership mismatch", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }
    if (result.status === "FAILED") {
      issues.push(
        issue("SCENE_RESULT_FAILED", "Scene Result status is FAILED", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    } else if (result.status !== "SUCCEEDED") {
      issues.push(
        issue("SCENE_RESULT_CONFLICT", "Scene Result is not SUCCEEDED", {
          executionPlanId: plan.executionPlanId,
          sceneExecutionId: membership.sceneExecutionId,
          sceneResultId: result.sceneResultId,
          sceneOrder: membership.sceneOrder,
        })
      );
    }

    orderedResults.push(result);
  }

  for (const result of sceneResults) {
    if (result.executionPlanId !== plan.executionPlanId) {
      issues.push(
        issue("SCENE_RESULT_CONFLICT", "Foreign Scene Result referenced for Execution Plan", {
          executionPlanId: plan.executionPlanId,
          sceneResultId: result.sceneResultId,
          sceneExecutionId: result.sceneExecutionId,
          sceneOrder: result.sceneOrder,
        })
      );
      continue;
    }
    if (!acceptedResultIds.has(result.sceneResultId)) {
      const membershipMatch = orderedMemberships.some(
        (membership) => membership.sceneExecutionId === result.sceneExecutionId
      );
      if (!membershipMatch) {
        issues.push(
          issue(
            "SCENE_RESULT_CONFLICT",
            "Foreign or stale Scene Result is not part of Assembly membership",
            {
              executionPlanId: plan.executionPlanId,
              sceneResultId: result.sceneResultId,
              sceneExecutionId: result.sceneExecutionId,
              sceneOrder: result.sceneOrder,
            }
          )
        );
      }
    }
  }

  return { issues, orderedResults };
}

function validateMediaMetadata(
  result: CanonicalSceneResult,
  metadata: AssemblySceneMediaMetadata | null
): AssemblyValidationIssue[] {
  const base = {
    executionPlanId: result.executionPlanId,
    sceneExecutionId: result.sceneExecutionId,
    sceneResultId: result.sceneResultId,
    sceneOrder: result.sceneOrder,
  };

  if (!result.mediaReference) {
    return [issue("SCENE_MEDIA_MISSING", "Scene Result is missing immutable media reference", base)];
  }
  if (!result.mediaReference.contentHash) {
    return [issue("SCENE_MEDIA_HASH_MISMATCH", "Scene Result media content hash is missing", base)];
  }
  if (!metadata) {
    return [issue("SCENE_MEDIA_MISSING", "Scene media metadata is missing", base)];
  }

  const issues: AssemblyValidationIssue[] = [];
  const parsed = AssemblySceneMediaMetadataSchema.safeParse(metadata);
  if (!parsed.success) {
    return [
      issue("SCENE_MEDIA_CORRUPTED", "Scene media metadata is invalid", base),
    ];
  }
  const media = parsed.data;

  if (!media.metadataReadable) {
    issues.push(issue("SCENE_MEDIA_CORRUPTED", "Scene media metadata is not readable", base));
  }
  if (!media.contentHash) {
    issues.push(issue("SCENE_MEDIA_HASH_MISMATCH", "Scene media content hash is missing", base));
  } else if (media.contentHash !== result.mediaReference.contentHash) {
    issues.push(
      issue(
        "SCENE_MEDIA_HASH_MISMATCH",
        "Scene media content hash does not match Scene Result media reference",
        base
      )
    );
  }
  if (result.durationMs == null || result.durationMs <= 0 || media.durationMs <= 0) {
    issues.push(issue("SCENE_MEDIA_CORRUPTED", "Scene media duration is invalid", base));
  } else if (result.durationMs !== media.durationMs) {
    issues.push(
      issue("SCENE_MEDIA_CORRUPTED", "Scene media duration metadata does not match Scene Result", base)
    );
  }
  if (!isSupportedMediaType(media.mediaType) || !isSupportedMediaType(result.mediaReference.mediaType)) {
    issues.push(issue("SCENE_MEDIA_UNSUPPORTED", "Scene media type is unsupported", base));
  }
  if (!isSupportedContainer(media.container)) {
    issues.push(issue("SCENE_MEDIA_UNSUPPORTED", "Scene media container is unsupported", base));
  }
  if (!isSupportedVideoCodec(media.videoCodec)) {
    issues.push(issue("SCENE_MEDIA_UNSUPPORTED", "Scene media video codec is unsupported", base));
  }
  if (!isSupportedAudioCodec(media.audioCodec)) {
    issues.push(issue("SCENE_MEDIA_UNSUPPORTED", "Scene media audio codec is unsupported", base));
  }
  if (media.videoStreamCount !== 1) {
    issues.push(
      issue("SCENE_MEDIA_UNSUPPORTED", "Scene media must declare exactly one video stream", base)
    );
  }

  return issues;
}

function buildValidationFingerprint(input: {
  readonly request: AssemblyValidationRequest;
  readonly ok: boolean;
  readonly issues: readonly AssemblyValidationIssue[];
  readonly orderedSceneResultIds?: readonly string[];
  readonly orderedSceneContentHashes?: readonly string[];
  readonly assemblyDefinitionId?: string;
}): string {
  return assemblyIntegrityHash({
    kind: "assembly-validation-result",
    request: input.request,
    ok: input.ok,
    issues: input.issues,
    orderedSceneResultIds: input.orderedSceneResultIds ?? [],
    orderedSceneContentHashes: input.orderedSceneContentHashes ?? [],
    assemblyDefinitionId: input.assemblyDefinitionId ?? null,
  });
}

/**
 * Validate assembly inputs. Fail closed. Never mutates canonical state.
 */
export async function validateAssemblyInputs(
  dependencies: AssemblyValidatorDependencies,
  rawRequest: AssemblyValidationRequest
): Promise<AssemblyValidationResult> {
  const request = AssemblyValidationRequestSchema.parse(rawRequest);
  const { repository } = dependencies;

  const plan = await repository.getExecutionPlan(request.executionPlanId);
  const planIssues = validateExecutionPlan(plan, request);
  if (planIssues.length > 0 || !plan) {
    const issues = planIssues;
    return AssemblyValidationResultSchema.parse({
      ok: false,
      executionPlanId: request.executionPlanId,
      issues,
      validationFingerprint: buildValidationFingerprint({ request, ok: false, issues }),
    });
  }

  const definition = await repository.getAssemblyDefinition(request.executionPlanId);
  const memberships = definition
    ? await repository.listMemberships(definition.assemblyDefinitionId)
    : [];
  const definitionIssues = validateAssemblyDefinition(definition, plan, memberships);
  if (definitionIssues.length > 0 || !definition) {
    const issues = definitionIssues;
    return AssemblyValidationResultSchema.parse({
      ok: false,
      executionPlanId: request.executionPlanId,
      issues,
      validationFingerprint: buildValidationFingerprint({ request, ok: false, issues }),
    });
  }

  const sceneResults = await repository.listCanonicalSceneResults(request.executionPlanId);
  const membershipValidation = validateMembershipsAndSceneResults(
    plan,
    definition,
    memberships,
    sceneResults,
    request.ownership
  );

  const mediaIssues: AssemblyValidationIssue[] = [];
  for (const result of membershipValidation.orderedResults) {
    if (result.status !== "SUCCEEDED") continue;
    const metadata = await repository.getSceneMediaMetadata(result.sceneResultId);
    mediaIssues.push(...validateMediaMetadata(result, metadata));
  }

  const issues = [...membershipValidation.issues, ...mediaIssues];
  if (issues.length > 0) {
    return AssemblyValidationResultSchema.parse({
      ok: false,
      executionPlanId: request.executionPlanId,
      issues,
      validationFingerprint: buildValidationFingerprint({
        request,
        ok: false,
        issues,
        assemblyDefinitionId: definition.assemblyDefinitionId,
      }),
    });
  }

  const orderedSceneResultIds = membershipValidation.orderedResults.map(
    (result) => result.sceneResultId
  );
  const orderedSceneContentHashes = membershipValidation.orderedResults.map(
    (result) => result.mediaReference!.contentHash
  );

  return AssemblyValidationResultSchema.parse({
    ok: true,
    executionPlanId: request.executionPlanId,
    assemblyDefinitionId: definition.assemblyDefinitionId,
    orderedSceneResultIds,
    orderedSceneContentHashes,
    validationFingerprint: buildValidationFingerprint({
      request,
      ok: true,
      issues: [],
      orderedSceneResultIds,
      orderedSceneContentHashes,
      assemblyDefinitionId: definition.assemblyDefinitionId,
    }),
  });
}
