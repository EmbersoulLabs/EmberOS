import {
  AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION,
  AI_STORY_POST_GENERATION_QC_HOOK_VERSION,
  AI_STORY_PROVIDER_RUNTIME_VERSION,
  AI_STORY_SEEDANCE_MAPPING_VERSION,
  AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION,
  AI_STORY_SEEDANCE_REFERENCE_BUDGET,
  AiStoryCompiledProviderRequestSchema,
  AiStoryPostGenerationQcInputSchema,
  AiStoryProviderAttemptBindingSchema,
  AiStoryProviderRuntimeJobSchema,
  type AiStoryCompiledProviderRequest,
  type AiStoryPostGenerationQcInput,
  type AiStoryProviderAttemptBinding,
  type AiStoryProviderRuntimeJob,
  type AiStorySceneExecutionPackage,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
  isAiStoryProviderAttemptTransitionAllowed,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import { integrityHash } from "./scene-execution-compiler";
import { compileSceneExecutionPackageForSeedance } from "./seedance-director-adapter";
import type { SeedanceModelArkCreateRequest } from "./seedance-request-mapping";

export const SEEDANCE_RUNTIME_ADAPTER_VERSION = "seedance-canonical-runtime.v1" as const;

export function assertAiStoryProviderAttemptTransition(
  from: AiStoryProviderAttemptBinding["status"],
  to: AiStoryProviderAttemptBinding["status"]
): void {
  if (!isAiStoryProviderAttemptTransitionAllowed(from, to)) {
    throw new AiStoryProviderRuntimeError("COMPILED_REQUEST_INVALID", `Invalid Provider Attempt transition: ${from} → ${to}`);
  }
}

export class AiStoryProviderRuntimeError extends Error {
  constructor(
    readonly code:
      | "COMPILED_REQUEST_INVALID"
      | "COMPILED_REQUEST_STALE"
      | "REQUEST_TAMPERED"
      | "QC_NOT_ELIGIBLE"
      | "COMMERCIAL_AUTHORIZATION_REQUIRED"
      | "ATTEMPT_SCOPE_MISMATCH"
      | "ATTEMPT_NOT_FOUND"
      | "SUBMISSION_NOT_CLAIMED"
      | "PROVIDER_RECONCILIATION_REQUIRED",
    message: string
  ) {
    super(message);
    this.name = "AiStoryProviderRuntimeError";
  }
}

function compiledRequestHashInput(
  request: Omit<AiStoryCompiledProviderRequest, "requestFingerprint">
) {
  return { kind: AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION, ...request };
}

export function computeAiStoryCompiledRequestFingerprint(
  request: Omit<AiStoryCompiledProviderRequest, "requestFingerprint">
): string {
  return integrityHash(compiledRequestHashInput(request));
}

export function validateAiStoryCompiledRequestFingerprint(
  request: AiStoryCompiledProviderRequest
): boolean {
  const { requestFingerprint: _fingerprint, ...withoutFingerprint } = request;
  return computeAiStoryCompiledRequestFingerprint(withoutFingerprint) === request.requestFingerprint;
}

export function compileImmutableSeedanceRequest(input: {
  readonly package: AiStorySceneExecutionPackage;
  readonly sceneExecutionId: string;
  readonly compiledAt?: string;
  readonly estimatedCost?: {
    readonly currency: string;
    readonly amount: number | null;
    readonly source: "CONFIGURED_ESTIMATE" | "UNKNOWN";
  };
}): AiStoryCompiledProviderRequest {
  const compiled = compileSceneExecutionPackageForSeedance(input.package);
  const compiledAt = input.compiledAt ?? new Date().toISOString();
  const compiledPromptFingerprint = integrityHash({
    kind: "ai-story-seedance-compiled-prompt.v1",
    prompt: compiled.prompt,
  });
  const semanticPlanFingerprint = integrityHash({
    kind: compiled.semanticPlan.contractVersion,
    semanticPlan: compiled.semanticPlan,
  });
  const compiledRequestId = deterministicPersistenceUuid(
    "ai-story-compiled-provider-request",
    {
      sceneExecutionId: input.sceneExecutionId,
      packageFingerprint: input.package.packageFingerprint,
      semanticPlanFingerprint,
      compiledPromptFingerprint,
      generationMode: compiled.requestFacts.generationMode,
      mappingVersion: AI_STORY_SEEDANCE_MAPPING_VERSION,
      compiledAt,
    }
  );
  const withoutFingerprint = {
    compiledRequestId,
    contractVersion: AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION,
    runtimeVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
    orgId: input.package.orgId,
    workspaceId: input.package.workspaceId,
    campaignId: input.package.campaignId,
    storyId: input.package.storyId,
    storyVersionId: input.package.storyVersionId,
    sceneExecutionId: input.sceneExecutionId,
    sceneExecutionPackageId: input.package.sceneExecutionPackageId,
    generationMode: compiled.requestFacts.generationMode,
    ...(input.package.generationAuthority
      ? { generationAuthority: input.package.generationAuthority }
      : {}),
    providerId: "seedance" as const,
    modelId: compiled.requestFacts.model,
    adapterVersion: SEEDANCE_RUNTIME_ADAPTER_VERSION,
    mappingVersion: input.package.providerBinding.adapterMappingVersion,
    capabilityVersion: input.package.providerBinding.capabilityContractVersion,
    qcCapabilityVersion: input.package.providerBinding.qcCapabilityVersion,
    qcEvaluationId: input.package.qcEvaluation.qcEvaluationId,
    qcFingerprint: input.package.qcEvaluation.qcFingerprint,
    sceneFingerprint: input.package.scene.fingerprint,
    directorFingerprint: input.package.directorFingerprint,
    motionFingerprint: input.package.motionFingerprint,
    castSnapshotFingerprint: integrityHash({ kind: "ai-story-cast-snapshot.v1", authorities: input.package.castAuthorities }),
    locationSnapshotFingerprint: integrityHash({ kind: "ai-story-location-snapshot.v1", authority: input.package.locationAuthority, binding: input.package.scene.locationBinding }),
    productSnapshotFingerprint: integrityHash({ kind: "ai-story-product-snapshot.v1", authorities: input.package.productAuthorities }),
    packageFingerprint: input.package.packageFingerprint,
    semanticPlan: compiled.semanticPlan,
    semanticPlanFingerprint,
    compiledPrompt: compiled.prompt,
    compiledPromptFingerprint,
    structuredRequest: {
      model: compiled.requestFacts.model,
      duration: compiled.requestFacts.duration,
      ratio: compiled.requestFacts.ratio,
      resolution: compiled.requestFacts.resolution,
      generateAudio: false as const,
      watermark: compiled.requestFacts.watermark,
    },
    referenceMappings: compiled.selectedReferences.map((reference) => ({
      referenceId: reference.referenceId,
      assetId: reference.assetId,
      authorityType: reference.authorityType,
      authorityId: reference.authorityId,
      authorityClass: reference.authorityClass,
      wireRole: reference.firstFrame ? "first_frame" as const : "reference_image" as const,
      semanticBinding: reference.semanticBinding,
      ...(reference.mediaType ? { mediaType: reference.mediaType } : {}),
      ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
    })),
    referenceBudget: AI_STORY_SEEDANCE_REFERENCE_BUDGET,
    degradations: compiled.degradations.map((item) => ({ ...item })),
    blockedCapabilities: [
      "AUDIO",
      "FIRST_LAST_FRAME",
      "MULTI_SHOT",
      "CHAINING",
      "VIDEO_EXTENSION",
      "4K",
      "CANCELLATION",
    ],
    estimatedCost: input.estimatedCost ?? {
      currency: "USD",
      amount: null,
      source: "UNKNOWN" as const,
    },
    dispatchReady: true as const,
    compiledAt,
  };
  return AiStoryCompiledProviderRequestSchema.parse({
    ...withoutFingerprint,
    requestFingerprint: computeAiStoryCompiledRequestFingerprint(withoutFingerprint),
  });
}

export type PersistedSceneProviderCompilationAuthority = {
  readonly qcEvaluationId: string;
  readonly qcFingerprint: string;
  readonly qcCapabilityVersion: string;
  readonly directorFingerprint: string;
  readonly motionFingerprint: string;
};

export function compiledProviderRequestIdForSchedule(input: {
  readonly sceneExecutionId: string;
  readonly scheduledAt: string;
}): string {
  return deterministicPersistenceUuid(
    "ai-story-compiled-provider-request",
    {
      sceneExecutionId: input.sceneExecutionId,
      compiledAt: input.scheduledAt,
    }
  );
}

/**
 * Freezes the already-persisted Scene execution compilation into the canonical
 * Provider request authority used by both scheduling and the Worker. This is
 * the compatibility compiler for V1 Execution Plans that predate the richer
 * SceneExecutionPackage projection; it never reconstructs creative authority
 * in the Worker.
 */
export function compileImmutableSeedanceRequestFromSceneCompilation(input: {
  readonly intent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly authority: PersistedSceneProviderCompilationAuthority;
  readonly adapterVersion: string;
  readonly compiledAt: string;
  readonly resolution?: "480p" | "720p" | "1080p";
}): AiStoryCompiledProviderRequest {
  const authority = input.intent.generationAuthority ?? input.instructions.generationAuthority;
  if (
    input.intent.generationAuthority &&
    input.instructions.generationAuthority &&
    JSON.stringify(input.intent.generationAuthority) !== JSON.stringify(input.instructions.generationAuthority)
  ) {
    throw new AiStoryProviderRuntimeError(
      "COMPILED_REQUEST_INVALID",
      "Scene generation authority conflicts with its immutable instruction snapshot"
    );
  }
  const explicitT2v =
    authority?.strategy === "TEXT_TO_VIDEO" &&
    authority.referenceSource === "REFERENCE_FREE_T2V";
  const referenceIds = authority?.effectiveReferenceIds ?? input.intent.referencedAssetIds;
  if (!authority && referenceIds.length === 0) {
    throw new AiStoryProviderRuntimeError(
      "COMPILED_REQUEST_INVALID",
      "Reference-free compilation requires explicit TEXT_TO_VIDEO authority"
    );
  }
  if (explicitT2v && referenceIds.length !== 0) {
    throw new AiStoryProviderRuntimeError(
      "COMPILED_REQUEST_INVALID",
      "Reference-free TEXT_TO_VIDEO compilation cannot contain references"
    );
  }
  if (!explicitT2v && referenceIds.length === 0) {
    throw new AiStoryProviderRuntimeError(
      "COMPILED_REQUEST_INVALID",
      "Image-conditioned compilation is missing required references"
    );
  }

  const supportedDurations = [4, 5, 6, 8, 10, 12] as const;
  const requestedDuration = Math.max(1, Math.round(input.intent.plannedDurationMs / 1000));
  const duration = supportedDurations.reduce((best, candidate) =>
    Math.abs(candidate - requestedDuration) < Math.abs(best - requestedDuration)
      ? candidate
      : best
  );
  const orderedShots = [...input.instructions.shots].sort(
    (left, right) => left.order - right.order || left.shotId.localeCompare(right.shotId)
  );
  const compiledPrompt = [
    input.instructions.purpose,
    input.instructions.continuityNotes
      ? `Continuity: ${input.instructions.continuityNotes}`
      : "",
    ...orderedShots.map(
      (shot, index) =>
        `${index + 1}. ${shot.information} (${shot.cameraType}; ${shot.cameraMovement}; ${shot.composition})`
    ),
    ...input.instructions.productIdentityConstraints,
  ].filter(Boolean).join("\n");
  const semanticPlan = {
    contractVersion: "ai-story-seedance-semantic-plan.v1" as const,
    sceneExecutionPackageId: deterministicPersistenceUuid(
      "ai-story-scene-execution-package",
      {
        sceneExecutionId: input.intent.identity.sceneExecutionId,
        compilationHash: input.intent.compilationHash,
        qcFingerprint: input.authority.qcFingerprint,
      }
    ),
    packageFingerprint: integrityHash({
      kind: "ai-story-scene-execution-compilation-capsule.v1",
      intent: input.intent,
      instructions: input.instructions,
      authority: input.authority,
    }),
    sections: [
      { section: "SCENE_PURPOSE" as const, facts: [input.instructions.purpose] },
      ...(input.instructions.continuityNotes
        ? [{ section: "ENTRY_STATE" as const, facts: [input.instructions.continuityNotes] }]
        : []),
      { section: "ACTION_PROGRESSION" as const, facts: orderedShots.map((shot) => shot.information) },
      { section: "CAMERA" as const, facts: orderedShots.map((shot) => `${shot.cameraType}: ${shot.cameraMovement}`) },
      { section: "MUST_KEEP" as const, facts: [...input.instructions.productIdentityConstraints] },
    ],
    translationClasses: [
      { concept: "generation mode", translationClass: "DIRECT_STRUCTURED_MAPPING" as const },
      { concept: "duration", translationClass: "DIRECT_STRUCTURED_MAPPING" as const },
      { concept: "ratio", translationClass: "DIRECT_STRUCTURED_MAPPING" as const },
      { concept: "resolution", translationClass: "DIRECT_STRUCTURED_MAPPING" as const },
      { concept: "Scene purpose", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" as const },
      { concept: "Camera", translationClass: "CERTIFIED_PROMPT_SEMANTIC_MAPPING" as const },
    ],
  };
  const compiledPromptFingerprint = integrityHash({
    kind: "ai-story-seedance-compiled-prompt.v1",
    prompt: compiledPrompt,
  });
  const semanticPlanFingerprint = integrityHash({
    kind: semanticPlan.contractVersion,
    semanticPlan,
  });
  const sceneExecutionId = input.intent.identity.sceneExecutionId;
  const compiledRequestId = compiledProviderRequestIdForSchedule({
    sceneExecutionId,
    scheduledAt: input.compiledAt,
  });
  const snapshot = (kind: string, value: unknown) => integrityHash({ kind, value });
  const withoutFingerprint = {
    compiledRequestId,
    contractVersion: AI_STORY_COMPILED_PROVIDER_REQUEST_VERSION,
    runtimeVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
    orgId: input.intent.identity.tenantId,
    workspaceId: input.intent.identity.workspaceId,
    campaignId: input.intent.identity.campaignId,
    storyId: input.intent.identity.storyId,
    storyVersionId: input.intent.identity.storyVersionId,
    sceneExecutionId,
    sceneExecutionPackageId: semanticPlan.sceneExecutionPackageId,
    generationMode: explicitT2v
      ? "TEXT_TO_VIDEO" as const
      : "FIRST_FRAME_IMAGE_TO_VIDEO" as const,
    ...(authority ? { generationAuthority: authority } : {}),
    providerId: "seedance" as const,
    modelId: "dreamina-seedance-2-0-260128" as const,
    adapterVersion: input.adapterVersion,
    mappingVersion: AI_STORY_SEEDANCE_MAPPING_VERSION,
    capabilityVersion: AI_STORY_SEEDANCE_CAPABILITY_CONTRACT_VERSION,
    qcCapabilityVersion: input.authority.qcCapabilityVersion,
    qcEvaluationId: input.authority.qcEvaluationId,
    qcFingerprint: input.authority.qcFingerprint,
    sceneFingerprint: input.intent.compilationHash,
    directorFingerprint: input.authority.directorFingerprint,
    motionFingerprint: input.authority.motionFingerprint,
    castSnapshotFingerprint: snapshot("ai-story-cast-instruction-snapshot.v1", input.instructions.characterReferences),
    locationSnapshotFingerprint: snapshot("ai-story-location-instruction-snapshot.v1", input.instructions.worldContinuity),
    productSnapshotFingerprint: snapshot("ai-story-product-instruction-snapshot.v1", {
      constraints: input.instructions.productIdentityConstraints,
      referenceIds,
    }),
    packageFingerprint: semanticPlan.packageFingerprint,
    semanticPlan,
    semanticPlanFingerprint,
    compiledPrompt,
    compiledPromptFingerprint,
    structuredRequest: {
      model: "dreamina-seedance-2-0-260128" as const,
      duration,
      ratio: "9:16" as const,
      resolution: input.resolution ?? "480p" as const,
      generateAudio: false as const,
      watermark: false,
    },
    referenceMappings: referenceIds.map((assetId, index) => ({
      referenceId: deterministicPersistenceUuid("ai-story-compiled-reference", {
        sceneExecutionId,
        assetId,
        index,
      }),
      assetId,
      authorityType: "PRODUCT" as const,
      authorityId: assetId,
      authorityClass: "REQUIRED" as const,
      wireRole: index === 0 ? "first_frame" as const : "reference_image" as const,
      semanticBinding: index === 0
        ? "Canonical first-frame Product authority"
        : "Canonical Product reference authority",
    })),
    referenceBudget: AI_STORY_SEEDANCE_REFERENCE_BUDGET,
    degradations: [],
    blockedCapabilities: ["AUDIO", "FIRST_LAST_FRAME", "MULTI_SHOT", "CHAINING", "VIDEO_EXTENSION", "4K", "CANCELLATION"],
    estimatedCost: { currency: "USD", amount: null, source: "UNKNOWN" as const },
    dispatchReady: true as const,
    compiledAt: input.compiledAt,
  };
  return AiStoryCompiledProviderRequestSchema.parse({
    ...withoutFingerprint,
    requestFingerprint: computeAiStoryCompiledRequestFingerprint(withoutFingerprint),
  });
}

export type AiStoryRuntimeFreshness = {
  readonly qcDispatchEligible: boolean;
  readonly commercialAuthorizationValid: boolean;
  readonly sceneFingerprint: string;
  readonly directorFingerprint: string;
  readonly motionFingerprint: string;
  readonly qcFingerprint: string;
  readonly packageFingerprint: string;
  readonly castSnapshotFingerprint: string;
  readonly locationSnapshotFingerprint: string;
  readonly productSnapshotFingerprint: string;
  readonly sceneSuperseded: boolean;
  readonly directorSuperseded: boolean;
  readonly motionSuperseded: boolean;
  readonly authoritySnapshotsMatch: boolean;
};

export interface AiStoryProviderRuntimeRepository {
  acceptCompiledRequest(request: AiStoryCompiledProviderRequest): Promise<AiStoryCompiledProviderRequest>;
  getCompiledRequest(compiledRequestId: string): Promise<AiStoryCompiledProviderRequest | null>;
  acceptAttempt(binding: AiStoryProviderAttemptBinding): Promise<{ attempt: AiStoryProviderAttemptBinding; replayed: boolean }>;
  getAttempt(providerAttemptId: string): Promise<AiStoryProviderAttemptBinding | null>;
  claimSubmission(input: { providerAttemptId: string; workerId: string; claimedAt: string }): Promise<AiStoryProviderAttemptBinding | null>;
  updateAttempt(input: AiStoryProviderAttemptBinding): Promise<AiStoryProviderAttemptBinding>;
}

function assertFreshness(
  request: AiStoryCompiledProviderRequest,
  freshness: AiStoryRuntimeFreshness
): void {
  if (!validateAiStoryCompiledRequestFingerprint(request)) {
    throw new AiStoryProviderRuntimeError("REQUEST_TAMPERED", "Compiled request fingerprint mismatch");
  }
  if (!freshness.qcDispatchEligible) {
    throw new AiStoryProviderRuntimeError("QC_NOT_ELIGIBLE", "Pre-Generation QC does not authorize dispatch");
  }
  if (!freshness.commercialAuthorizationValid) {
    throw new AiStoryProviderRuntimeError("COMMERCIAL_AUTHORIZATION_REQUIRED", "Commercial authorization is required");
  }
  if (
    freshness.sceneSuperseded ||
    freshness.directorSuperseded ||
    freshness.motionSuperseded ||
    !freshness.authoritySnapshotsMatch ||
    freshness.sceneFingerprint !== request.sceneFingerprint ||
    freshness.directorFingerprint !== request.directorFingerprint ||
    freshness.motionFingerprint !== request.motionFingerprint ||
    freshness.qcFingerprint !== request.qcFingerprint ||
    freshness.packageFingerprint !== request.packageFingerprint
    || freshness.castSnapshotFingerprint !== request.castSnapshotFingerprint
    || freshness.locationSnapshotFingerprint !== request.locationSnapshotFingerprint
    || freshness.productSnapshotFingerprint !== request.productSnapshotFingerprint
  ) {
    throw new AiStoryProviderRuntimeError("COMPILED_REQUEST_STALE", "Compiled request no longer binds current frozen authority");
  }
}

export async function createAiStoryProviderAttempt(input: {
  readonly repository: AiStoryProviderRuntimeRepository;
  readonly request: AiStoryCompiledProviderRequest;
  readonly freshness: AiStoryRuntimeFreshness;
  readonly idempotencyKey: string;
  /** Existing canonical Provider Execution identity; required by durable DB integration. */
  readonly providerExecutionId?: string;
  readonly attemptNumber?: number;
  readonly now?: string;
}): Promise<{ attempt: AiStoryProviderAttemptBinding; job: AiStoryProviderRuntimeJob; replayed: boolean }> {
  const request = AiStoryCompiledProviderRequestSchema.parse(input.request);
  assertFreshness(request, input.freshness);
  await input.repository.acceptCompiledRequest(request);
  const attemptNumber = input.attemptNumber ?? 1;
  const now = input.now ?? new Date().toISOString();
  const attemptInputFingerprint = integrityHash({
    kind: "ai-story-provider-attempt-input.v1",
    compiledRequestId: request.compiledRequestId,
    requestFingerprint: request.requestFingerprint,
    attemptNumber,
    idempotencyKey: input.idempotencyKey,
  });
  const providerAttemptId = deterministicPersistenceUuid(
    "ai-story-provider-attempt-binding",
    { idempotencyKey: input.idempotencyKey, attemptInputFingerprint }
  );
  const binding = AiStoryProviderAttemptBindingSchema.parse({
    providerAttemptId,
    providerExecutionId: input.providerExecutionId ?? request.sceneExecutionId,
    contractVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
    compiledRequestId: request.compiledRequestId,
    requestFingerprint: request.requestFingerprint,
    attemptInputFingerprint,
    idempotencyKey: input.idempotencyKey,
    attemptNumber,
    orgId: request.orgId,
    workspaceId: request.workspaceId,
    campaignId: request.campaignId,
    storyId: request.storyId,
    storyVersionId: request.storyVersionId,
    sceneExecutionId: request.sceneExecutionId,
    generationMode: request.generationMode,
    ...(request.generationAuthority
      ? { generationAuthority: request.generationAuthority }
      : {}),
    providerId: request.providerId,
    modelId: request.modelId,
    adapterVersion: request.adapterVersion,
    mappingVersion: request.mappingVersion,
    capabilityVersion: request.capabilityVersion,
    qcEvaluationId: request.qcEvaluationId,
    qcFingerprint: request.qcFingerprint,
    sceneFingerprint: request.sceneFingerprint,
    directorFingerprint: request.directorFingerprint,
    motionFingerprint: request.motionFingerprint,
    castSnapshotFingerprint: request.castSnapshotFingerprint,
    locationSnapshotFingerprint: request.locationSnapshotFingerprint,
    productSnapshotFingerprint: request.productSnapshotFingerprint,
    estimatedCost: request.estimatedCost,
    status: "READY",
    pollCount: 0,
    createdAt: now,
    updatedAt: now,
    automaticPaidRetry: false,
    providerFallback: false,
  });
  const accepted = await input.repository.acceptAttempt(binding);
  return {
    attempt: accepted.attempt,
    replayed: accepted.replayed,
    job: AiStoryProviderRuntimeJobSchema.parse({
      providerAttemptId: accepted.attempt.providerAttemptId,
      workspaceId: accepted.attempt.workspaceId,
      sceneExecutionId: accepted.attempt.sceneExecutionId,
      contractVersion: AI_STORY_PROVIDER_RUNTIME_VERSION,
    }),
  };
}

export type AiStoryProviderSubmitResult =
  | { readonly kind: "ACCEPTED"; readonly providerTaskId: string }
  | { readonly kind: "AMBIGUOUS" }
  | { readonly kind: "REJECTED"; readonly failureClass: "PROVIDER_MODERATION_REJECTED" | "PROVIDER_TRANSPORT_FAILURE" };

export type AiStoryProviderPollResult =
  | { readonly status: "queued" | "running" }
  | { readonly status: "failed" | "cancelled" | "expired"; readonly moderationRejected?: boolean }
  | { readonly status: "succeeded"; readonly artifactUrl: string; readonly usage?: Readonly<Record<string, unknown>>; readonly metadata?: Readonly<Record<string, unknown>> };

export interface AiStoryProviderRuntimeTransport {
  submit(input: { readonly request: SeedanceModelArkCreateRequest; readonly providerAttemptId: string }): Promise<AiStoryProviderSubmitResult>;
  poll(input: { readonly providerTaskId: string; readonly providerAttemptId: string }): Promise<AiStoryProviderPollResult>;
}

/** Deterministic, non-network transport for runtime certification. */
export class DeterministicFakeAiStoryProviderTransport implements AiStoryProviderRuntimeTransport {
  readonly submittedRequests: SeedanceModelArkCreateRequest[] = [];
  readonly submittedAttemptIds: string[] = [];
  private pollIndex = 0;
  constructor(private readonly fixture: {
    submit?: AiStoryProviderSubmitResult;
    polls?: readonly AiStoryProviderPollResult[];
  } = {}) {}
  async submit(input: { request: SeedanceModelArkCreateRequest; providerAttemptId: string }) {
    this.submittedRequests.push(structuredClone(input.request));
    this.submittedAttemptIds.push(input.providerAttemptId);
    return this.fixture.submit ?? { kind: "ACCEPTED" as const, providerTaskId: "fake-seedance-task" };
  }
  async poll() {
    const values = this.fixture.polls ?? [{ status: "succeeded" as const, artifactUrl: "https://fake-provider.invalid/result.mp4" }];
    const result = values[Math.min(this.pollIndex, values.length - 1)]!;
    this.pollIndex += 1;
    return result;
  }
}

export interface AiStoryRuntimeAssetAccess {
  resolveHttpsAsset(input: { readonly assetId: string; readonly workspaceId: string; readonly storagePath?: string }): Promise<string>;
}

export interface AiStoryRuntimeMediaIngest {
  ingest(input: { readonly artifactUrl: string; readonly attempt: AiStoryProviderAttemptBinding; readonly request: AiStoryCompiledProviderRequest }): Promise<{ readonly mediaAssetId: string }>;
}

async function serializeTransportRequest(input: {
  request: AiStoryCompiledProviderRequest;
  assetAccess: AiStoryRuntimeAssetAccess;
}): Promise<SeedanceModelArkCreateRequest> {
  const images = await Promise.all(input.request.referenceMappings.map(async (reference) => ({
    type: "image_url" as const,
    image_url: { url: await input.assetAccess.resolveHttpsAsset({
      assetId: reference.assetId,
      workspaceId: input.request.workspaceId,
      ...(reference.storagePath ? { storagePath: reference.storagePath } : {}),
    }) },
    role: reference.wireRole,
  })));
  return {
    model: input.request.structuredRequest.model,
    content: [{ type: "text", text: input.request.compiledPrompt }, ...images],
    duration: input.request.structuredRequest.duration,
    ratio: input.request.structuredRequest.ratio,
    resolution: input.request.structuredRequest.resolution,
    generate_audio: false,
    watermark: input.request.structuredRequest.watermark,
  };
}

export class AiStoryCompiledRequestWorkerRuntime {
  constructor(private readonly dependencies: {
    repository: AiStoryProviderRuntimeRepository;
    transport: AiStoryProviderRuntimeTransport;
    assetAccess: AiStoryRuntimeAssetAccess;
    mediaIngest: AiStoryRuntimeMediaIngest;
    now?: () => Date;
  }) {}

  async process(jobInput: AiStoryProviderRuntimeJob, workerId: string): Promise<{
    attempt: AiStoryProviderAttemptBinding;
    postGenerationQcInput?: AiStoryPostGenerationQcInput;
    providerSubmitted: boolean;
  }> {
    const job = AiStoryProviderRuntimeJobSchema.parse(jobInput);
    let attempt = await this.dependencies.repository.getAttempt(job.providerAttemptId);
    if (!attempt) throw new AiStoryProviderRuntimeError("ATTEMPT_NOT_FOUND", "Provider Attempt does not exist");
    if (attempt.workspaceId !== job.workspaceId || attempt.sceneExecutionId !== job.sceneExecutionId) {
      throw new AiStoryProviderRuntimeError("ATTEMPT_SCOPE_MISMATCH", "Worker job ownership does not match Provider Attempt");
    }
    const request = await this.dependencies.repository.getCompiledRequest(attempt.compiledRequestId);
    if (!request || request.requestFingerprint !== attempt.requestFingerprint || !validateAiStoryCompiledRequestFingerprint(request)) {
      throw new AiStoryProviderRuntimeError("REQUEST_TAMPERED", "Attempt compiled request is missing or has been modified");
    }
    const now = () => (this.dependencies.now ?? (() => new Date()))().toISOString();
    let providerSubmitted = false;

    if (attempt.status === "READY") {
      const claimed = await this.dependencies.repository.claimSubmission({
        providerAttemptId: attempt.providerAttemptId,
        workerId,
        claimedAt: now(),
      });
      if (!claimed) {
        attempt = (await this.dependencies.repository.getAttempt(attempt.providerAttemptId))!;
        return { attempt, providerSubmitted: false };
      }
      attempt = claimed;
    }

    if (attempt.status === "DISPATCHING" && !attempt.providerTaskId) {
      const transportRequest = await serializeTransportRequest({ request, assetAccess: this.dependencies.assetAccess });
      const result = await this.dependencies.transport.submit({ request: transportRequest, providerAttemptId: attempt.providerAttemptId });
      providerSubmitted = true;
      if (result.kind === "AMBIGUOUS") {
        attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: "RECONCILIATION_REQUIRED", updatedAt: now() });
        return { attempt, providerSubmitted };
      }
      if (result.kind === "REJECTED") {
        attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: "FAILED", failureClass: result.failureClass, updatedAt: now() });
        return { attempt, providerSubmitted };
      }
      attempt = await this.dependencies.repository.updateAttempt({
        ...attempt,
        status: "SUBMITTED",
        providerTaskId: result.providerTaskId,
        submittedAt: now(),
        updatedAt: now(),
      });
    }

    if (attempt.status === "RECONCILIATION_REQUIRED" && !attempt.providerTaskId) {
      return { attempt, providerSubmitted: false };
    }
    if (!attempt.providerTaskId || !["SUBMITTED", "RUNNING"].includes(attempt.status)) {
      return { attempt, providerSubmitted };
    }

    const poll = await this.dependencies.transport.poll({ providerTaskId: attempt.providerTaskId, providerAttemptId: attempt.providerAttemptId });
    const pollCount = attempt.pollCount + 1;
    if (poll.status === "queued" || poll.status === "running") {
      attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: poll.status === "running" ? "RUNNING" : "SUBMITTED", pollCount, updatedAt: now() });
      return { attempt, providerSubmitted };
    }
    if (poll.status !== "succeeded") {
      const failureClass = "moderationRejected" in poll && poll.moderationRejected
        ? "PROVIDER_MODERATION_REJECTED" as const
        : poll.status === "cancelled"
          ? "PROVIDER_CANCELLED" as const
          : poll.status === "expired"
            ? "PROVIDER_EXPIRED" as const
            : "PROVIDER_GENERATION_FAILED" as const;
      attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: poll.status === "cancelled" ? "CANCELLED" : poll.status === "expired" ? "EXPIRED" : "FAILED", failureClass, pollCount, updatedAt: now() });
      return { attempt, providerSubmitted };
    }

    attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: "PROVIDER_RESULT_READY", pollCount, actualUsage: poll.usage ?? {}, updatedAt: now() });
    try {
      const media = await this.dependencies.mediaIngest.ingest({ artifactUrl: poll.artifactUrl, attempt, request });
      attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: "POST_GENERATION_QC_PENDING", mediaAssetId: media.mediaAssetId, updatedAt: now() });
      const section = (name: string) => request.semanticPlan.sections.find((candidate) => candidate.section === name)?.facts ?? [];
      return {
        attempt,
        providerSubmitted,
        postGenerationQcInput: AiStoryPostGenerationQcInputSchema.parse({
          contractVersion: AI_STORY_POST_GENERATION_QC_HOOK_VERSION,
          providerAttemptId: attempt.providerAttemptId,
          compiledRequestId: request.compiledRequestId,
          sceneExecutionId: request.sceneExecutionId,
          generationMode: request.generationMode,
          requestFingerprint: request.requestFingerprint,
          sceneFingerprint: request.sceneFingerprint,
          directorFingerprint: request.directorFingerprint,
          motionFingerprint: request.motionFingerprint,
          castSnapshotFingerprint: request.castSnapshotFingerprint,
          locationSnapshotFingerprint: request.locationSnapshotFingerprint,
          productSnapshotFingerprint: request.productSnapshotFingerprint,
          mediaAssetId: media.mediaAssetId,
          requiredExitState: section("REQUIRED_EXIT_STATE"),
          mustKeep: section("MUST_KEEP"),
          mustAvoid: section("MUST_AVOID"),
          providerMetadata: { providerId: request.providerId, modelId: request.modelId, providerTaskId: attempt.providerTaskId },
        }),
      };
    } catch {
      attempt = await this.dependencies.repository.updateAttempt({ ...attempt, status: "MEDIA_INGESTION_FAILED", failureClass: "MEDIA_INGESTION_FAILED", updatedAt: now() });
      return { attempt, providerSubmitted };
    }
  }
}

export class InMemoryAiStoryProviderRuntimeRepository implements AiStoryProviderRuntimeRepository {
  private readonly requests = new Map<string, AiStoryCompiledProviderRequest>();
  private readonly attempts = new Map<string, AiStoryProviderAttemptBinding>();
  private readonly idempotency = new Map<string, string>();

  async acceptCompiledRequest(request: AiStoryCompiledProviderRequest): Promise<AiStoryCompiledProviderRequest> {
    const parsed = AiStoryCompiledProviderRequestSchema.parse(request);
    const existing = this.requests.get(parsed.compiledRequestId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(parsed)) throw new AiStoryProviderRuntimeError("REQUEST_TAMPERED", "Compiled request identity conflicts");
    this.requests.set(parsed.compiledRequestId, Object.freeze(parsed));
    return parsed;
  }
  async getCompiledRequest(id: string) { return this.requests.get(id) ?? null; }
  async acceptAttempt(binding: AiStoryProviderAttemptBinding) {
    const existingId = this.idempotency.get(binding.idempotencyKey);
    if (existingId) {
      const existing = this.attempts.get(existingId)!;
      if (existing.attemptInputFingerprint !== binding.attemptInputFingerprint) {
        throw new AiStoryProviderRuntimeError("REQUEST_TAMPERED", "Idempotency key conflicts with Provider Attempt input");
      }
      return { attempt: existing, replayed: true };
    }
    this.attempts.set(binding.providerAttemptId, Object.freeze(binding));
    this.idempotency.set(binding.idempotencyKey, binding.providerAttemptId);
    return { attempt: binding, replayed: false };
  }
  async getAttempt(id: string) { return this.attempts.get(id) ?? null; }
  async claimSubmission(input: { providerAttemptId: string; workerId: string; claimedAt: string }) {
    const attempt = this.attempts.get(input.providerAttemptId);
    if (!attempt || attempt.status !== "READY") return null;
    const claimed = AiStoryProviderAttemptBindingSchema.parse({ ...attempt, status: "DISPATCHING", submissionClaimOwner: input.workerId, submissionClaimedAt: input.claimedAt, submitStartedAt: input.claimedAt, updatedAt: input.claimedAt });
    this.attempts.set(input.providerAttemptId, Object.freeze(claimed));
    return claimed;
  }
  async updateAttempt(input: AiStoryProviderAttemptBinding) {
    const parsed = AiStoryProviderAttemptBindingSchema.parse(input);
    const existing = this.attempts.get(parsed.providerAttemptId);
    if (!existing || existing.compiledRequestId !== parsed.compiledRequestId || existing.requestFingerprint !== parsed.requestFingerprint || existing.attemptInputFingerprint !== parsed.attemptInputFingerprint) {
      throw new AiStoryProviderRuntimeError("REQUEST_TAMPERED", "Immutable Provider Attempt input changed");
    }
    assertAiStoryProviderAttemptTransition(existing.status, parsed.status);
    this.attempts.set(parsed.providerAttemptId, Object.freeze(parsed));
    return parsed;
  }
}
