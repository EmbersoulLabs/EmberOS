import {
  CanonicalProviderRequestSchema,
  type AiStorySceneCompiledInstructions,
  type AiStorySceneExecutionIntent,
  type CanonicalProviderRequest,
  type RuntimeAuthorizedFact,
  type RuntimeOwnershipIdentity,
} from "@ceo-agent/shared";
import { deterministicPersistenceUuid } from "@ceo-agent/db";
import type { PersistedSceneRoutingDecision } from "@ceo-agent/shared";
import { integrityHash } from "./scene-execution-compiler";

export const SCENE_PROVIDER_CAPABILITY_ID = "animation-video-generation" as const;
export const SCENE_PROVIDER_CAPABILITY_VERSION = "1.0.0" as const;
export const SCENE_PROVIDER_REQUEST_SCHEMA_VERSION = "1.0.0" as const;
export const SCENE_PROVIDER_RESULT_SCHEMA_VERSION = "1.0.0" as const;

export type BuildCanonicalSceneProviderRequestInput = {
  readonly runtimeAuthorization: RuntimeAuthorizedFact;
  readonly routingDecision: PersistedSceneRoutingDecision;
  readonly sceneIntent: AiStorySceneExecutionIntent;
  readonly instructions: AiStorySceneCompiledInstructions;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly timeoutDeadline: string;
  /** EXEC-04: >1 creates a new provider execution of the same frozen payload. */
  readonly retryGeneration?: number;
  /** Immutable authority differentiating retry lifecycles that share a generation number. */
  readonly retryAuthorityHash?: string;
};

export type BuildCanonicalSceneProviderRequestCompatInput = {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly sceneExecutionId: string;
  readonly sceneId: string;
  readonly sceneOrder: number;
  readonly runtimeAuthorizationId: string;
  readonly payloadReference: CanonicalProviderRequest["normalizedPayloadReference"];
  readonly correlationId: string;
  readonly pipelineRunId: string;
  readonly capabilityVersion?: string;
  readonly queueJobId?: string;
  readonly [ignoredClientField: string]: unknown;
};

export type CanonicalSceneProviderRequestResult = {
  readonly canonicalRequest: CanonicalProviderRequest;
  readonly payloadReference: string;
  readonly normalizedPayloadReference: CanonicalProviderRequest["normalizedPayloadReference"];
  readonly requestContentHash: string;
};

function sortText(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function fullIdentitySeed(input: BuildCanonicalSceneProviderRequestInput) {
  const retryGeneration = input.retryGeneration ?? 1;
  return {
    sceneExecutionId: input.sceneIntent.identity.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorization.runtimeAuthorizationId,
    instructionHash: input.sceneIntent.normalizedPayloadReference.contentHash,
    routingDecisionHash: input.routingDecision.deterministicIntegrityHash,
    ...(retryGeneration > 1 ? { retryGeneration } : {}),
    ...(retryGeneration > 1 && input.retryAuthorityHash
      ? { retryAuthorityHash: input.retryAuthorityHash }
      : {}),
  };
}

function compatIdentitySeed(input: BuildCanonicalSceneProviderRequestCompatInput) {
  return {
    sceneExecutionId: input.sceneExecutionId,
    runtimeAuthorizationId: input.runtimeAuthorizationId,
    instructionHash: input.payloadReference.contentHash,
    routingDecisionHash: null,
  };
}

function buildPayloadReferenceContent(input: BuildCanonicalSceneProviderRequestInput) {
  return {
    kind: "ai-story-canonical-scene-provider-payload",
    sceneExecutionId: input.sceneIntent.identity.sceneExecutionId,
    sceneId: input.sceneIntent.identity.sceneId,
    sceneOrder: input.sceneIntent.identity.sceneOrder,
    instructionSnapshotHash: input.sceneIntent.normalizedPayloadReference.contentHash,
    referencedAssetIds: sortText(input.sceneIntent.referencedAssetIds),
    durationMs: input.sceneIntent.plannedDurationMs,
    shotMap: [...input.instructions.shots]
      .sort((left, right) => left.order - right.order || left.shotId.localeCompare(right.shotId))
      .map((shot) => ({
        shotId: shot.shotId,
        order: shot.order,
        durationMs: shot.durationMs,
        cameraType: shot.cameraType,
        cameraMovement: shot.cameraMovement,
        composition: shot.composition,
        framing: shot.framing,
        lensSuggestion: shot.lensSuggestion,
        focus: shot.focus,
        emotion: shot.emotion,
        information: shot.information,
      })),
    identityConstraints: {
      characterReferences: input.instructions.characterReferences,
      productIdentityConstraints: input.instructions.productIdentityConstraints,
    },
  };
}

function buildRequest(input: {
  readonly ownership: RuntimeOwnershipIdentity;
  readonly executionId: string;
  readonly idempotencyKey: string;
  readonly deterministicFingerprint: string;
  readonly pipelineRunId: string;
  readonly correlationId: string;
  readonly normalizedPayloadReference: CanonicalProviderRequest["normalizedPayloadReference"];
  readonly queueJobId?: string;
}): CanonicalProviderRequest {
  return CanonicalProviderRequestSchema.parse({
    contractVersion: "1",
    executionIdentity: {
      executionId: input.executionId,
      tenantId: input.ownership.orgId,
      workspaceId: input.ownership.workspaceId,
      campaignId: input.ownership.campaignId,
      pipelineRunId: input.pipelineRunId,
      capabilityId: SCENE_PROVIDER_CAPABILITY_ID,
      capabilityVersion: SCENE_PROVIDER_CAPABILITY_VERSION,
      idempotencyKey: input.idempotencyKey,
      deterministicFingerprint: input.deterministicFingerprint,
    },
    requestSchemaVersion: SCENE_PROVIDER_REQUEST_SCHEMA_VERSION,
    resultSchemaVersion: SCENE_PROVIDER_RESULT_SCHEMA_VERSION,
    normalizedPayloadReference: input.normalizedPayloadReference,
    outputSchema: {
      schemaId: "AnimationVideoResult",
      schemaVersion: SCENE_PROVIDER_RESULT_SCHEMA_VERSION,
    },
    contextVersions: {
      "ai-story-scene-instructions": "1.0.0",
      "ai-story-runtime-authorization": "1.0.0",
      "ai-story-scene-routing": "1.0.0",
    },
    correlation: {
      correlationId: input.correlationId,
      pipelineRunId: input.pipelineRunId,
      ...(input.queueJobId ? { queueJobId: input.queueJobId } : {}),
    },
    timeoutPolicy: { timeoutMs: 600_000, reconciliationDelayMs: 5_000 },
    retryPolicy: {
      // A new paid attempt requires the explicit generated-media Retry action.
      // The Scene-level max-attempt limit is enforced by that human-authorized
      // path; a single canonical provider request must never retry itself.
      maxAttempts: 1,
      initialDelayMs: 500,
      maximumDelayMs: 8_000,
      backoffMultiplier: 2,
    },
    providerConstraints: {
      executionLookupRequired: true,
    },
  });
}

function buildFull(
  input: BuildCanonicalSceneProviderRequestInput
): CanonicalSceneProviderRequestResult {
  const seed = fullIdentitySeed(input);
  const payloadContent = buildPayloadReferenceContent(input);
  const contentHash = integrityHash(payloadContent);
  const retryGeneration = input.retryGeneration ?? 1;
  const payloadReference = `memory://ai-story/scene-provider-request/${
    input.sceneIntent.identity.sceneExecutionId
  }/${contentHash.replace(/^sha256:/, "")}${
    retryGeneration > 1 ? `/retry/${retryGeneration}` : ""
  }`;
  const normalizedPayloadReference = {
    uri: payloadReference,
    contentHash,
    mediaType: "application/json",
  };
  const canonicalRequest = buildRequest({
    ownership: input.runtimeAuthorization.ownership,
    executionId: deterministicPersistenceUuid(
      "ai-story-scene-provider-execution",
      seed
    ),
    idempotencyKey: `ai-story-scene:${deterministicPersistenceUuid(
      "ai-story-scene-provider-idempotency",
      seed
    )}`,
    deterministicFingerprint: integrityHash({
      kind: "ai-story-scene-provider-execution",
      ...seed,
    }),
    pipelineRunId: input.runtimeAuthorization.executionPlanId,
    correlationId: input.correlationId,
    normalizedPayloadReference,
  });

  return {
    canonicalRequest,
    payloadReference,
    normalizedPayloadReference,
    requestContentHash: integrityHash(canonicalRequest),
  };
}

function buildCompat(
  input: BuildCanonicalSceneProviderRequestCompatInput
): CanonicalProviderRequest {
  const seed = compatIdentitySeed(input);
  return buildRequest({
    ownership: input.ownership,
    executionId: deterministicPersistenceUuid(
      "ai-story-scene-provider-execution",
      seed
    ),
    idempotencyKey: `ai-story-scene:${deterministicPersistenceUuid(
      "ai-story-scene-provider-idempotency",
      seed
    )}`,
    deterministicFingerprint: integrityHash({
      kind: "ai-story-scene-provider-execution",
      ...seed,
    }),
    pipelineRunId: input.pipelineRunId,
    correlationId: input.correlationId,
    normalizedPayloadReference: input.payloadReference,
    queueJobId: input.queueJobId,
  });
}

function isFullInput(
  input:
    | BuildCanonicalSceneProviderRequestInput
    | BuildCanonicalSceneProviderRequestCompatInput
): input is BuildCanonicalSceneProviderRequestInput {
  return (
    "runtimeAuthorization" in input &&
    typeof input.runtimeAuthorization === "object" &&
    input.runtimeAuthorization !== null
  );
}

export function buildCanonicalSceneProviderRequest(
  input: BuildCanonicalSceneProviderRequestInput
): CanonicalSceneProviderRequestResult;
export function buildCanonicalSceneProviderRequest(
  input: BuildCanonicalSceneProviderRequestCompatInput
): CanonicalProviderRequest;
export function buildCanonicalSceneProviderRequest(
  input:
    | BuildCanonicalSceneProviderRequestInput
    | BuildCanonicalSceneProviderRequestCompatInput
): CanonicalSceneProviderRequestResult | CanonicalProviderRequest {
  if (isFullInput(input)) return buildFull(input);
  return buildCompat(input);
}
