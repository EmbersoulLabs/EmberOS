import { z } from "zod";
import {
  AiStoryCompiledProviderRequestSchema,
  AiStoryModeResolutionSnapshotSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryModeResolutionSnapshot,
  type AiStoryProviderAttemptBinding,
  type AiStoryProviderRuntimeJob,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import { integrityHash } from "./scene-execution-compiler";
import {
  AiStoryProviderCapabilityDeclarationSchema,
  AiStoryProviderCompileIntentSchema,
  AiStoryProviderResolutionSchema,
  assertProviderCompileIntentConsistency,
  type AiStoryProviderCapabilityDeclaration,
  type AiStoryProviderCompileIntent,
  type AiStoryProviderResolution,
} from "./provider-capability-resolution";

export const AI_STORY_CANONICAL_EXECUTION_AUTHORITY_VERSION =
  "ai-story-canonical-execution-authority.v1" as const;

const Id = z.string().uuid();
const Hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Text = z.string().trim().min(1);

export const AiStoryAnalysisAuthorityPinSchema = z
  .object({
    bindingId: Id,
    assetId: Id,
    contentHash: Hash,
    analysisSnapshotId: Id,
    analysisFingerprint: Hash,
  })
  .strict();

export const AiStoryCanonicalCharacterAuthoritySchema = z
  .object({
    characterId: Id,
    characterVersionId: Id,
    characterDnaVersionId: Id,
    characterDnaFingerprint: Hash,
  })
  .strict();

const ExecutionTraceEntrySchema = z
  .object({
    stage: z.enum([
      "STORY_VERSION",
      "ASSET_MATCHING",
      "EXECUTION_PLAN",
      "MODE_RESOLUTION",
      "PROVIDER_RESOLUTION",
      "PROVIDER_COMPILE_INTENT",
      "CANONICAL_QUEUE",
      "WORKER_AUTHORITY_VALIDATION",
      "AUTHORIZED_PROVIDER_DISPATCH",
    ]),
    authorityId: Text,
    authorityFingerprint: Text,
  })
  .strict();

export const AiStoryCanonicalExecutionAuthoritySchema = z
  .object({
    contractVersion: z.literal(
      AI_STORY_CANONICAL_EXECUTION_AUTHORITY_VERSION
    ),
    executionAuthorityId: Id,
    authorityFingerprint: Hash,
    orgId: Id,
    workspaceId: Id,
    storyId: Id,
    storyVersionId: Id,
    matchingResultId: Id,
    matchingContractVersion: Text,
    plannerSnapshot: AiStoryModeResolutionSnapshotSchema,
    analysisAuthorities: z.array(AiStoryAnalysisAuthorityPinSchema),
    castSnapshotFingerprint: Hash,
    characterAuthority:
      AiStoryCanonicalCharacterAuthoritySchema.nullable(),
    providerResolution: AiStoryProviderResolutionSchema,
    providerCapability: AiStoryProviderCapabilityDeclarationSchema,
    providerCompileIntent: AiStoryProviderCompileIntentSchema,
    compiledRequestId: Id,
    requestFingerprint: Hash,
    providerAttemptId: Id,
    idempotencyKey: Text,
    attemptNumber: z.number().int().positive(),
    executionTrace: z.array(ExecutionTraceEntrySchema).min(6),
    createdAt: z.string().datetime(),
  })
  .strict();

export type AiStoryCanonicalExecutionAuthority = z.infer<
  typeof AiStoryCanonicalExecutionAuthoritySchema
>;

export class AiStoryExecutionAuthorityError extends Error {
  constructor(
    readonly code:
      | "EXECUTION_PLAN_MISMATCH"
      | "STALE_EXECUTION_AUTHORITY"
      | "STALE_STORY_VERSION"
      | "STALE_ASSET_AUTHORITY"
      | "MISSING_ANALYSIS_SNAPSHOT"
      | "ASSET_CONTENT_HASH_MISMATCH"
      | "CHARACTER_DNA_MISMATCH"
      | "PROVIDER_CAPABILITY_STALE"
      | "PROVIDER_UNAVAILABLE"
      | "INVALID_AUDIO_COMPILE_CONTRACT"
      | "MISSING_AUTHORIZED_SOURCE_ASSET"
      | "UNSUPPORTED_PINNED_PROVIDER_MODE",
    message: string
  ) {
    super(message);
    this.name = "AiStoryExecutionAuthorityError";
  }
}

function canonicalAuthorityHashInput(
  authority: Omit<
    AiStoryCanonicalExecutionAuthority,
    "authorityFingerprint"
  >
) {
  return {
    kind: AI_STORY_CANONICAL_EXECUTION_AUTHORITY_VERSION,
    ...authority,
  };
}

export function computeAiStoryCanonicalExecutionAuthorityFingerprint(
  authority: Omit<
    AiStoryCanonicalExecutionAuthority,
    "authorityFingerprint"
  >
): string {
  return integrityHash(canonicalAuthorityHashInput(authority));
}

export function validateAiStoryCanonicalExecutionAuthorityFingerprint(
  authority: AiStoryCanonicalExecutionAuthority
): boolean {
  const { authorityFingerprint: _fingerprint, ...withoutFingerprint } =
    authority;
  return (
    computeAiStoryCanonicalExecutionAuthorityFingerprint(
      withoutFingerprint
    ) === authority.authorityFingerprint
  );
}

function providerMode(
  mode: AiStoryModeResolutionSnapshot["resolvedGenerationMode"]
): AiStoryCompiledProviderRequest["generationMode"] {
  if (mode === "TEXT_TO_VIDEO") return "TEXT_TO_VIDEO";
  if (mode === "IMAGE_TO_VIDEO")
    return "FIRST_FRAME_IMAGE_TO_VIDEO";
  throw new AiStoryExecutionAuthorityError(
    "UNSUPPORTED_PINNED_PROVIDER_MODE",
    "The selected EmberOS Provider implementation is not certified for VIDEO_TO_VIDEO"
  );
}

function assertCompileChain(input: {
  planner: AiStoryModeResolutionSnapshot;
  resolution: AiStoryProviderResolution;
  capability: AiStoryProviderCapabilityDeclaration;
  compileIntent: AiStoryProviderCompileIntent;
  request: AiStoryCompiledProviderRequest;
  analysisAuthorities: readonly z.infer<
    typeof AiStoryAnalysisAuthorityPinSchema
  >[];
}): void {
  const { planner, resolution, capability, compileIntent, request } = input;
  if (
    planner.resolutionStatus !== "RESOLVED" ||
    !planner.resolvedGenerationMode ||
    resolution.status !== "SELECTED" ||
    resolution.plannerSnapshotId !== planner.plannerSnapshotId ||
    compileIntent.plannerSnapshotId !== planner.plannerSnapshotId ||
    compileIntent.providerResolutionId !==
      resolution.providerResolutionId ||
    resolution.selectedProviderId !== capability.providerId ||
    resolution.selectedImplementationId !==
      capability.implementationId ||
    compileIntent.implementationId !== capability.implementationId ||
    compileIntent.providerId !== capability.providerId ||
    request.providerId !== capability.providerId ||
    request.generationMode !== providerMode(planner.resolvedGenerationMode) ||
    compileIntent.generationMode !== planner.resolvedGenerationMode ||
    compileIntent.generateAudio !==
      request.structuredRequest.generateAudio ||
    compileIntent.requestFacts.duration !==
      request.structuredRequest.duration ||
    compileIntent.requestFacts.ratio !== request.structuredRequest.ratio ||
    compileIntent.requestFacts.resolution !==
      request.structuredRequest.resolution
  ) {
    throw new AiStoryExecutionAuthorityError(
      "EXECUTION_PLAN_MISMATCH",
      "Planner, Provider resolution, compile intent, and compiled request do not form one immutable execution chain"
    );
  }
  try {
    assertProviderCompileIntentConsistency(compileIntent);
  } catch (error) {
    throw new AiStoryExecutionAuthorityError(
      "INVALID_AUDIO_COMPILE_CONTRACT",
      error instanceof Error ? error.message : "Invalid audio contract"
    );
  }
  const audioBlocked = request.blockedCapabilities.includes("AUDIO");
  if (
    compileIntent.generateAudio === audioBlocked ||
    compileIntent.blockedCapabilities.includes("AUDIO") !== audioBlocked
  ) {
    throw new AiStoryExecutionAuthorityError(
      "INVALID_AUDIO_COMPILE_CONTRACT",
      "Compiled request changed the authorized audio capability decision"
    );
  }

  const analysisByBinding = new Map(
    input.analysisAuthorities.map((authority) => [
      authority.bindingId,
      authority,
    ])
  );
  for (const binding of planner.bindingAuthorities) {
    const analysis = analysisByBinding.get(binding.bindingId);
    if (!analysis) {
      throw new AiStoryExecutionAuthorityError(
        "MISSING_ANALYSIS_SNAPSHOT",
        `Binding ${binding.bindingId} lacks immutable Analysis Snapshot authority`
      );
    }
    if (
      analysis.assetId !== binding.assetId ||
      analysis.contentHash !== binding.contentHash ||
      analysis.analysisSnapshotId !== binding.analysisSnapshotId
    ) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_ASSET_AUTHORITY",
        "Analysis authority does not match the exact planned Asset binding"
      );
    }
  }
  if (analysisByBinding.size !== planner.bindingAuthorities.length) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_ASSET_AUTHORITY",
      "Execution authority contains an unplanned Asset binding"
    );
  }

  const selectedBindingIds = new Set(planner.selectedBindingIds);
  const selectedMappings = compileIntent.sourceMappings;
  if (
    selectedMappings.length !== selectedBindingIds.size ||
    selectedMappings.some((mapping) => {
      const binding = planner.bindingAuthorities.find(
        (candidate) => candidate.bindingId === mapping.bindingId
      );
      return (
        !selectedBindingIds.has(mapping.bindingId) ||
        !binding ||
        binding.assetId !== mapping.assetId ||
        binding.contentHash !== mapping.contentHash ||
        binding.analysisSnapshotId !== mapping.analysisSnapshotId
      );
    })
  ) {
    throw new AiStoryExecutionAuthorityError(
      "MISSING_AUTHORIZED_SOURCE_ASSET",
      "Provider compile intent does not preserve the selected source Asset authority"
    );
  }
  const expectedReferenceAssetIds = selectedMappings.map(
    (mapping) => mapping.assetId
  );
  const requestReferenceAssetIds = request.referenceMappings.map(
    (mapping) => mapping.assetId
  );
  if (
    JSON.stringify(expectedReferenceAssetIds) !==
    JSON.stringify(requestReferenceAssetIds)
  ) {
    throw new AiStoryExecutionAuthorityError(
      "MISSING_AUTHORIZED_SOURCE_ASSET",
      "Compiled Provider request substituted or omitted the authorized source Asset"
    );
  }

  const plannedDna = planner.characterDnaAuthority;
  const compiledDna = request.characterDnaAuthority;
  if (
    Boolean(plannedDna) !== Boolean(compiledDna) ||
    (plannedDna &&
      compiledDna &&
      (plannedDna.reusableCharacterId !==
        compiledDna.reusableCharacterId ||
        plannedDna.reusableCharacterVersionId !==
          compiledDna.reusableCharacterVersionId ||
        plannedDna.characterDnaFingerprint !==
          compiledDna.characterDnaFingerprint ||
        compiledDna.sourcePhotoSentToVideoProvider !== false))
  ) {
    throw new AiStoryExecutionAuthorityError(
      "CHARACTER_DNA_MISMATCH",
      "Compiled request does not preserve the pinned Character DNA authority"
    );
  }
}

export function buildAiStoryCanonicalExecutionAuthority(input: {
  readonly plannerSnapshot: AiStoryModeResolutionSnapshot;
  readonly analysisAuthorities: readonly z.input<
    typeof AiStoryAnalysisAuthorityPinSchema
  >[];
  readonly providerResolution: AiStoryProviderResolution;
  readonly providerCapability: AiStoryProviderCapabilityDeclaration;
  readonly providerCompileIntent: AiStoryProviderCompileIntent;
  readonly compiledRequest: AiStoryCompiledProviderRequest;
  readonly providerAttempt: AiStoryProviderAttemptBinding;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}): AiStoryCanonicalExecutionAuthority {
  const planner = AiStoryModeResolutionSnapshotSchema.parse(
    input.plannerSnapshot
  );
  const resolution = AiStoryProviderResolutionSchema.parse(
    input.providerResolution
  );
  const capability = AiStoryProviderCapabilityDeclarationSchema.parse(
    input.providerCapability
  );
  const compileIntent = AiStoryProviderCompileIntentSchema.parse(
    input.providerCompileIntent
  );
  const request = AiStoryCompiledProviderRequestSchema.parse(
    input.compiledRequest
  );
  const analysisAuthorities = input.analysisAuthorities.map((authority) =>
    AiStoryAnalysisAuthorityPinSchema.parse(authority)
  );
  if (
    planner.orgId !== request.orgId ||
    planner.workspaceId !== request.workspaceId ||
    planner.storyId !== request.storyId ||
    planner.storyVersionId !== request.storyVersionId ||
    input.providerAttempt.compiledRequestId !== request.compiledRequestId ||
    input.providerAttempt.requestFingerprint !== request.requestFingerprint ||
    input.providerAttempt.idempotencyKey !== input.idempotencyKey
  ) {
    throw new AiStoryExecutionAuthorityError(
      "EXECUTION_PLAN_MISMATCH",
      "Attempt or compiled request is outside the immutable planner authority"
    );
  }
  assertCompileChain({
    planner,
    resolution,
    capability,
    compileIntent,
    request,
    analysisAuthorities,
  });
  const characterAuthority = planner.characterDnaAuthority
    ? {
        characterId: planner.characterDnaAuthority.reusableCharacterId,
        characterVersionId:
          planner.characterDnaAuthority.reusableCharacterVersionId,
        characterDnaVersionId:
          planner.characterDnaAuthority.reusableCharacterVersionId,
        characterDnaFingerprint:
          planner.characterDnaAuthority.characterDnaFingerprint,
      }
    : null;
  const executionAuthorityId = deterministicPersistenceUuid(
    "ai-story-canonical-execution-authority",
    {
      plannerSnapshotId: planner.plannerSnapshotId,
      providerResolutionId: resolution.providerResolutionId,
      compileIntentId: compileIntent.compileIntentId,
      compiledRequestId: request.compiledRequestId,
      providerAttemptId: input.providerAttempt.providerAttemptId,
    }
  );
  const withoutFingerprint = {
    contractVersion: AI_STORY_CANONICAL_EXECUTION_AUTHORITY_VERSION,
    executionAuthorityId,
    orgId: planner.orgId,
    workspaceId: planner.workspaceId,
    storyId: planner.storyId,
    storyVersionId: planner.storyVersionId,
    matchingResultId: planner.matchingResultId,
    matchingContractVersion: planner.matchingContractVersion,
    plannerSnapshot: planner,
    analysisAuthorities,
    castSnapshotFingerprint: request.castSnapshotFingerprint,
    characterAuthority,
    providerResolution: resolution,
    providerCapability: capability,
    providerCompileIntent: compileIntent,
    compiledRequestId: request.compiledRequestId,
    requestFingerprint: request.requestFingerprint,
    providerAttemptId: input.providerAttempt.providerAttemptId,
    idempotencyKey: input.idempotencyKey,
    attemptNumber: input.providerAttempt.attemptNumber,
    executionTrace: [
      {
        stage: "STORY_VERSION" as const,
        authorityId: planner.storyVersionId,
        authorityFingerprint: planner.storyVersionId,
      },
      {
        stage: "ASSET_MATCHING" as const,
        authorityId: planner.matchingResultId,
        authorityFingerprint: planner.matchingContractVersion,
      },
      {
        stage: "EXECUTION_PLAN" as const,
        authorityId: planner.plannerSnapshotId,
        authorityFingerprint: planner.contractVersion,
      },
      {
        stage: "MODE_RESOLUTION" as const,
        authorityId: planner.plannerSnapshotId,
        authorityFingerprint: planner.resolverVersion,
      },
      {
        stage: "PROVIDER_RESOLUTION" as const,
        authorityId: resolution.providerResolutionId,
        authorityFingerprint: resolution.contractVersion,
      },
      {
        stage: "PROVIDER_COMPILE_INTENT" as const,
        authorityId: compileIntent.compileIntentId,
        authorityFingerprint: compileIntent.contractVersion,
      },
      {
        stage: "CANONICAL_QUEUE" as const,
        authorityId: input.providerAttempt.providerAttemptId,
        authorityFingerprint: input.providerAttempt.attemptInputFingerprint,
      },
    ],
    createdAt: input.createdAt,
  };
  return AiStoryCanonicalExecutionAuthoritySchema.parse({
    ...withoutFingerprint,
    authorityFingerprint:
      computeAiStoryCanonicalExecutionAuthorityFingerprint(
        withoutFingerprint
      ),
  });
}

export interface AiStoryCanonicalExecutionAuthorityRepository {
  acceptAuthority(
    authority: AiStoryCanonicalExecutionAuthority,
    job?: AiStoryProviderRuntimeJob
  ): Promise<AiStoryCanonicalExecutionAuthority>;
  getAuthority(
    executionAuthorityId: string
  ): Promise<AiStoryCanonicalExecutionAuthority | null>;
}

export type AiStoryCanonicalExecutionAuthorityStorage = {
  acceptExecutionAuthorityRecord(input: {
    readonly providerAttemptId: string;
    readonly executionAuthorityId: string;
    readonly authorityFingerprint: string;
    readonly authority: unknown;
    readonly job: unknown;
  }): Promise<void>;
  getExecutionAuthorityRecord(input: {
    readonly providerAttemptId: string;
    readonly executionAuthorityId: string;
  }): Promise<{ readonly authority: unknown; readonly job: unknown } | null>;
};

/** Durable adapter over the existing Provider Attempt metadata authority. */
export class DurableAiStoryCanonicalExecutionAuthorityRepository
  implements AiStoryCanonicalExecutionAuthorityRepository
{
  constructor(
    private readonly storage: AiStoryCanonicalExecutionAuthorityStorage,
    private readonly providerAttemptId?: string
  ) {}

  async acceptAuthority(
    authority: AiStoryCanonicalExecutionAuthority,
    job?: AiStoryProviderRuntimeJob
  ): Promise<AiStoryCanonicalExecutionAuthority> {
    const parsed = AiStoryCanonicalExecutionAuthoritySchema.parse(authority);
    if (
      (this.providerAttemptId &&
        parsed.providerAttemptId !== this.providerAttemptId) ||
      !validateAiStoryCanonicalExecutionAuthorityFingerprint(parsed) ||
      !job
    ) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_EXECUTION_AUTHORITY",
        "Durable execution authority is not bound to the exact Provider Attempt and queue job"
      );
    }
    await this.storage.acceptExecutionAuthorityRecord({
      providerAttemptId: parsed.providerAttemptId,
      executionAuthorityId: parsed.executionAuthorityId,
      authorityFingerprint: parsed.authorityFingerprint,
      authority: parsed,
      job,
    });
    return parsed;
  }

  async getAuthority(
    executionAuthorityId: string
  ): Promise<AiStoryCanonicalExecutionAuthority | null> {
    if (!this.providerAttemptId) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_EXECUTION_AUTHORITY",
        "Provider Attempt identity is required to load durable execution authority"
      );
    }
    const record = await this.storage.getExecutionAuthorityRecord({
      providerAttemptId: this.providerAttemptId,
      executionAuthorityId,
    });
    if (!record) return null;
    const authority = AiStoryCanonicalExecutionAuthoritySchema.parse(
      record.authority
    );
    if (
      authority.providerAttemptId !== this.providerAttemptId ||
      !validateAiStoryCanonicalExecutionAuthorityFingerprint(authority)
    ) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_EXECUTION_AUTHORITY",
        "Persisted execution authority fingerprint or Attempt identity is invalid"
      );
    }
    return authority;
  }
}

export class InMemoryAiStoryCanonicalExecutionAuthorityRepository
  implements AiStoryCanonicalExecutionAuthorityRepository
{
  private readonly authorities = new Map<
    string,
    AiStoryCanonicalExecutionAuthority
  >();

  async acceptAuthority(
    authority: AiStoryCanonicalExecutionAuthority,
    _job?: AiStoryProviderRuntimeJob
  ): Promise<AiStoryCanonicalExecutionAuthority> {
    const parsed = AiStoryCanonicalExecutionAuthoritySchema.parse(authority);
    if (!validateAiStoryCanonicalExecutionAuthorityFingerprint(parsed)) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_EXECUTION_AUTHORITY",
        "Execution authority fingerprint is invalid"
      );
    }
    const existing = this.authorities.get(parsed.executionAuthorityId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) {
      throw new AiStoryExecutionAuthorityError(
        "EXECUTION_PLAN_MISMATCH",
        "Execution authority identity conflicts with existing immutable authority"
      );
    }
    this.authorities.set(parsed.executionAuthorityId, Object.freeze(parsed));
    return parsed;
  }

  async getAuthority(executionAuthorityId: string) {
    return this.authorities.get(executionAuthorityId) ?? null;
  }
}

export const AiStoryCurrentExecutionAuthorityStateSchema = z
  .object({
    storyVersionId: Id,
    assets: z.array(AiStoryAnalysisAuthorityPinSchema),
    castSnapshotFingerprint: Hash,
    characterAuthority:
      AiStoryCanonicalCharacterAuthoritySchema.nullable(),
    providerImplementationId: Text,
    providerCapabilityVersion: Text,
    providerAvailable: z.boolean(),
  })
  .strict();

export type AiStoryCurrentExecutionAuthorityState = z.infer<
  typeof AiStoryCurrentExecutionAuthorityStateSchema
>;

export function assertAiStoryCurrentExecutionAuthority(input: {
  readonly authority: AiStoryCanonicalExecutionAuthority;
  readonly job: AiStoryProviderRuntimeJob;
  readonly attempt: AiStoryProviderAttemptBinding;
  readonly request: AiStoryCompiledProviderRequest;
  readonly current: AiStoryCurrentExecutionAuthorityState;
}): void {
  const authority = AiStoryCanonicalExecutionAuthoritySchema.parse(
    input.authority
  );
  const current = AiStoryCurrentExecutionAuthorityStateSchema.parse(
    input.current
  );
  if (!validateAiStoryCanonicalExecutionAuthorityFingerprint(authority)) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_EXECUTION_AUTHORITY",
      "Loaded execution authority fingerprint is invalid"
    );
  }
  if (
    input.job.executionAuthorityId !== authority.executionAuthorityId ||
    input.job.executionAuthorityFingerprint !==
      authority.authorityFingerprint ||
    input.job.plannerSnapshotId !==
      authority.plannerSnapshot.plannerSnapshotId ||
    input.job.providerResolutionId !==
      authority.providerResolution.providerResolutionId ||
    input.job.compileIntentId !==
      authority.providerCompileIntent.compileIntentId ||
    input.job.compiledRequestId !== authority.compiledRequestId ||
    input.job.requestFingerprint !== authority.requestFingerprint ||
    input.attempt.providerAttemptId !== authority.providerAttemptId ||
    input.request.compiledRequestId !== authority.compiledRequestId ||
    input.request.requestFingerprint !== authority.requestFingerprint
  ) {
    throw new AiStoryExecutionAuthorityError(
      "EXECUTION_PLAN_MISMATCH",
      "Queue, Attempt, request, and execution authority references differ"
    );
  }
  if (current.storyVersionId !== authority.storyVersionId) {
    throw new AiStoryExecutionAuthorityError(
      "STALE_STORY_VERSION",
      "Current Story Version differs from scheduled authority"
    );
  }
  const currentAssets = new Map(
    current.assets.map((asset) => [asset.bindingId, asset])
  );
  for (const expected of authority.analysisAuthorities) {
    const actual = currentAssets.get(expected.bindingId);
    if (!actual) {
      throw new AiStoryExecutionAuthorityError(
        "MISSING_ANALYSIS_SNAPSHOT",
        "Current authority is missing a pinned Analysis Snapshot"
      );
    }
    if (
      actual.assetId !== expected.assetId ||
      actual.analysisSnapshotId !== expected.analysisSnapshotId ||
      actual.analysisFingerprint !== expected.analysisFingerprint
    ) {
      throw new AiStoryExecutionAuthorityError(
        "STALE_ASSET_AUTHORITY",
        "Current Asset or Analysis Snapshot authority changed"
      );
    }
    if (actual.contentHash !== expected.contentHash) {
      throw new AiStoryExecutionAuthorityError(
        "ASSET_CONTENT_HASH_MISMATCH",
        "Current Asset bytes differ from the scheduled content hash"
      );
    }
  }
  if (
    JSON.stringify(current.characterAuthority) !==
      JSON.stringify(authority.characterAuthority) ||
    current.castSnapshotFingerprint !==
      authority.castSnapshotFingerprint
  ) {
    throw new AiStoryExecutionAuthorityError(
      "CHARACTER_DNA_MISMATCH",
      "Current Character/DNA authority differs from the scheduled version"
    );
  }
  if (
    current.providerImplementationId !==
      authority.providerCapability.implementationId ||
    current.providerCapabilityVersion !==
      authority.providerCapability.capabilityVersion
  ) {
    throw new AiStoryExecutionAuthorityError(
      "PROVIDER_CAPABILITY_STALE",
      "Current Provider capability declaration differs from scheduled authority"
    );
  }
  if (!current.providerAvailable) {
    throw new AiStoryExecutionAuthorityError(
      "PROVIDER_UNAVAILABLE",
      "Pinned Provider is unavailable; substitution requires new authority"
    );
  }
  assertCompileChain({
    planner: authority.plannerSnapshot,
    resolution: authority.providerResolution,
    capability: authority.providerCapability,
    compileIntent: authority.providerCompileIntent,
    request: input.request,
    analysisAuthorities: authority.analysisAuthorities,
  });
}
