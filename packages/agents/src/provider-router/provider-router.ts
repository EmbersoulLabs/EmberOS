import {
  isAnyVersionCompatible,
  requestHash,
} from "@ceo-agent/shared";
import type {
  ProviderCapabilityDeclaration,
  ProviderCostClass,
  ProviderLatencyClass,
  ProviderQualityClass,
  ProviderReliabilityClass,
} from "../provider-adapters/contracts";
import type { ProviderAdapterRegistry } from "./adapter-registry";
import {
  NoEligibleProviderError,
  type ProviderRoutingCandidate,
  type ProviderRoutingDecision,
  type ProviderRoutingExclusion,
  type ProviderRoutingExclusionCode,
  type ProviderRoutingPolicy,
  type ProviderRoutingRequest,
  type ProviderRoutingScore,
} from "./contracts";

const COST_RANK: Record<ProviderCostClass, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const LATENCY_RANK: Record<ProviderLatencyClass, number> = {
  FAST: 0,
  STANDARD: 1,
  SLOW: 2,
};
const QUALITY_RANK: Record<ProviderQualityClass, number> = {
  STANDARD: 0,
  HIGH: 1,
  PREMIUM: 2,
};
const RELIABILITY_RANK: Record<ProviderReliabilityClass, number> = {
  STANDARD: 0,
  HIGH: 1,
  CRITICAL: 2,
};

export const PROVIDER_ROUTING_SCORE_WEIGHTS = Object.freeze({
  quality: 4,
  cost: 2,
  latency: 2,
  reliability: 4,
  residency: 2,
  nativeIdempotency: 1,
  lookup: 1,
  cancellation: 1,
});

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function overlap(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function exclusion(
  declaration: ProviderCapabilityDeclaration,
  reasons: Array<{ code: ProviderRoutingExclusionCode; message: string }>
): ProviderRoutingExclusion {
  return {
    providerId: declaration.providerId,
    adapterVersion: declaration.adapterVersion,
    capabilityId: declaration.capabilityId,
    reasons,
  };
}

function supportsFeature(
  declaration: ProviderCapabilityDeclaration,
  feature: ProviderCapabilityDeclaration["requiredProviderFeatures"][number]
): boolean {
  switch (feature) {
    case "NATIVE_IDEMPOTENCY":
      return declaration.nativeIdempotency;
    case "LOOKUP":
      return declaration.lookup;
    case "CANCELLATION":
      return declaration.cancellation;
    case "CALLBACKS":
      return declaration.callbacks;
    case "STREAMING":
      return declaration.streaming;
    case "STRUCTURED_OUTPUT":
      return declaration.requiredProviderFeatures.includes(feature);
  }
}

function evaluate(
  declaration: ProviderCapabilityDeclaration,
  request: ProviderRoutingRequest,
  policy: ProviderRoutingPolicy
): ProviderRoutingExclusion | null {
  const reasons: Array<{ code: ProviderRoutingExclusionCode; message: string }> = [];
  const add = (code: ProviderRoutingExclusionCode, message: string) =>
    reasons.push({ code, message });
  const routing = declaration.routing;

  if (declaration.capabilityId !== request.capabilityId) {
    add("CAPABILITY_ID_MISMATCH", "Capability ID is not declared");
  }
  if (!isAnyVersionCompatible(request.capabilityVersion, declaration.capabilityVersions)) {
    add("CAPABILITY_VERSION_MISMATCH", "Capability version is incompatible");
  }
  if (!isAnyVersionCompatible(request.requestSchemaVersion, declaration.requestSchemaVersions)) {
    add("REQUEST_SCHEMA_MISMATCH", "Request schema version is incompatible");
  }
  if (!isAnyVersionCompatible(request.resultSchemaVersion, declaration.resultSchemaVersions)) {
    add("RESULT_SCHEMA_MISMATCH", "Result schema version is incompatible");
  }
  const missingFeatures = request.requiredFeatures.filter(
    (feature) => !supportsFeature(declaration, feature)
  );
  if (missingFeatures.length > 0) {
    add("REQUIRED_FEATURE_MISSING", `Missing features: ${missingFeatures.join(", ")}`);
  }
  if (request.requireLookup && !declaration.lookup) add("LOOKUP_UNSUPPORTED", "Lookup is required");
  if (request.requireCancellation && !declaration.cancellation) {
    add("CANCELLATION_UNSUPPORTED", "Cancellation is required");
  }
  if (request.requireCallbacks && !declaration.callbacks) {
    add("CALLBACK_UNSUPPORTED", "Callbacks are required");
  }
  if (request.requireStreaming && !declaration.streaming) {
    add("STREAMING_UNSUPPORTED", "Streaming is required");
  }

  if (
    (request.allowedProviders &&
      !request.allowedProviders.includes(declaration.providerId)) ||
    (policy.allowedProviders &&
      !policy.allowedProviders.includes(declaration.providerId))
  ) {
    add("PROVIDER_NOT_ALLOWED", "Provider is not in the allowed list");
  }
  if (
    request.deniedProviders?.includes(declaration.providerId) ||
    policy.deniedProviders?.includes(declaration.providerId)
  ) {
    add("PROVIDER_DENIED", "Provider is explicitly denied");
  }
  if (policy.workspaceDeniedProviders?.[request.workspaceId]?.includes(declaration.providerId)) {
    add("WORKSPACE_RESTRICTION", "Provider is denied for this workspace");
  }
  const capabilityAllowed = policy.capabilityAllowedProviders?.[request.capabilityId];
  if (capabilityAllowed && !capabilityAllowed.includes(declaration.providerId)) {
    add("CAPABILITY_RESTRICTION", "Provider is not approved for this capability");
  }
  if (
    policy.allowedModelFamilies &&
    !overlap(policy.allowedModelFamilies, routing.modelFamilies)
  ) {
    add("MODEL_FAMILY_RESTRICTION", "No declared model family is permitted");
  }

  const requiredRegions = request.dataHandling.requiredRegions ?? [];
  if (requiredRegions.length > 0 && !overlap(requiredRegions, routing.regions)) {
    add("REGION_RESTRICTION", "Provider does not declare a required region");
  }
  if (
    policy.allowedRegions &&
    !overlap(policy.allowedRegions, routing.regions)
  ) {
    add("REGION_RESTRICTION", "Provider regions are outside policy");
  }
  if (request.dataHandling.sensitiveData && !routing.sensitiveDataAllowed) {
    add("SENSITIVE_DATA_UNSUPPORTED", "Provider does not allow sensitive data");
  }
  if (!request.dataHandling.externalProcessingAllowed && routing.externalProcessing) {
    add("EXTERNAL_PROCESSING_DENIED", "External processing is prohibited");
  }
  if (
    (!request.dataHandling.providerTrainingAllowed || policy.requireTrainingOptOut) &&
    !routing.trainingOptOut
  ) {
    add("TRAINING_OPT_OUT_REQUIRED", "Provider does not declare training opt-out");
  }
  const retentionLimit =
    request.dataHandling.maximumRetentionDays ?? policy.maximumRetentionDays;
  const declaredRetention = routing.zeroRetention
    ? 0
    : routing.maximumRetentionDays;
  if (
    retentionLimit !== undefined &&
    (declaredRetention === undefined || declaredRetention > retentionLimit)
  ) {
    add("RETENTION_LIMIT_EXCEEDED", "Provider retention exceeds the allowed limit");
  }
  if (request.dataHandling.zeroRetentionRequired && !routing.zeroRetention) {
    add("ZERO_RETENTION_REQUIRED", "Zero retention is required");
  }
  if (request.dataHandling.enterpriseControlsRequired && !routing.enterpriseControls) {
    add("ENTERPRISE_CONTROLS_REQUIRED", "Enterprise controls are required");
  }

  if (request.maximumEstimatedCostUsd !== undefined) {
    if (routing.estimatedCostUsd === undefined) {
      add("COST_UNKNOWN", "Estimated provider cost is not declared");
    } else if (routing.estimatedCostUsd > request.maximumEstimatedCostUsd) {
      add("COST_CEILING_EXCEEDED", "Estimated provider cost exceeds request ceiling");
    }
  }
  if (
    policy.maximumCostClass &&
    COST_RANK[routing.costClass] > COST_RANK[policy.maximumCostClass]
  ) {
    add("COST_CEILING_EXCEEDED", "Provider cost class exceeds policy");
  }
  const latencyCeiling = request.maximumLatencyClass ?? policy.maximumLatencyClass;
  if (
    latencyCeiling &&
    LATENCY_RANK[routing.latencyClass] > LATENCY_RANK[latencyCeiling]
  ) {
    add("LATENCY_CEILING_EXCEEDED", "Provider latency class exceeds the ceiling");
  }
  const qualityMinimum = request.minimumQualityClass ?? policy.minimumQualityClass;
  if (
    qualityMinimum &&
    QUALITY_RANK[routing.qualityClass] < QUALITY_RANK[qualityMinimum]
  ) {
    add("QUALITY_REQUIREMENT_UNMET", "Provider quality class is below the minimum");
  }
  if (
    policy.minimumReliabilityClass &&
    RELIABILITY_RANK[routing.reliabilityClass] <
      RELIABILITY_RANK[policy.minimumReliabilityClass]
  ) {
    add("RELIABILITY_REQUIREMENT_UNMET", "Provider reliability is below policy");
  }

  return reasons.length > 0 ? exclusion(declaration, reasons) : null;
}

function score(
  declaration: ProviderCapabilityDeclaration,
  request: ProviderRoutingRequest,
  policy: ProviderRoutingPolicy
): ProviderRoutingScore {
  const preferred = request.preferredProviders ?? policy.preferredProviders;
  const index = preferred.indexOf(declaration.providerId);
  const preferredProviderRank = index === -1 ? Number.MAX_SAFE_INTEGER : index;
  const routing = declaration.routing;
  const quality = QUALITY_RANK[routing.qualityClass];
  const cost = 2 - COST_RANK[routing.costClass];
  const latency = 2 - LATENCY_RANK[routing.latencyClass];
  const reliability = RELIABILITY_RANK[routing.reliabilityClass];
  const residency =
    request.dataHandling.requiredRegions &&
    overlap(request.dataHandling.requiredRegions, routing.regions)
      ? 1
      : 0;
  const nativeIdempotency = declaration.nativeIdempotency ? 1 : 0;
  const lookup = declaration.lookup ? 1 : 0;
  const cancellation = declaration.cancellation ? 1 : 0;
  const total =
    quality * PROVIDER_ROUTING_SCORE_WEIGHTS.quality +
    cost * PROVIDER_ROUTING_SCORE_WEIGHTS.cost +
    latency * PROVIDER_ROUTING_SCORE_WEIGHTS.latency +
    reliability * PROVIDER_ROUTING_SCORE_WEIGHTS.reliability +
    residency * PROVIDER_ROUTING_SCORE_WEIGHTS.residency +
    nativeIdempotency * PROVIDER_ROUTING_SCORE_WEIGHTS.nativeIdempotency +
    lookup * PROVIDER_ROUTING_SCORE_WEIGHTS.lookup +
    cancellation * PROVIDER_ROUTING_SCORE_WEIGHTS.cancellation;
  return {
    preferredProviderRank,
    quality,
    cost,
    latency,
    reliability,
    residency,
    nativeIdempotency,
    lookup,
    cancellation,
    total,
  };
}

function compareCandidates(
  left: ProviderRoutingCandidate,
  right: ProviderRoutingCandidate
): number {
  return (
    left.score.preferredProviderRank - right.score.preferredProviderRank ||
    right.score.total - left.score.total ||
    left.declaration.providerId.localeCompare(right.declaration.providerId) ||
    right.declaration.adapterVersion.localeCompare(left.declaration.adapterVersion)
  );
}

export interface ProviderRouter {
  route(
    request: ProviderRoutingRequest,
    policy: ProviderRoutingPolicy
  ): Promise<ProviderRoutingDecision>;
}

export class CanonicalProviderRouter implements ProviderRouter {
  constructor(
    private readonly registry: ProviderAdapterRegistry,
    private readonly now: () => Date = () => new Date()
  ) {}

  async route(
    request: ProviderRoutingRequest,
    policy: ProviderRoutingPolicy
  ): Promise<ProviderRoutingDecision> {
    const routingRequest = freeze(
      structuredClone(request)
    ) as ProviderRoutingRequest;
    const routingPolicy = freeze(
      structuredClone(policy)
    ) as ProviderRoutingPolicy;
    if (routingRequest.policyVersion !== routingPolicy.policyVersion) {
      throw new Error("Routing request and policy versions do not match");
    }
    const snapshot = await this.registry.snapshot();
    const exclusions: ProviderRoutingExclusion[] = [];
    const candidates: ProviderRoutingCandidate[] = [];

    for (const declaration of snapshot.declarations) {
      const rejected = evaluate(declaration, routingRequest, routingPolicy);
      if (rejected) exclusions.push(rejected);
      else {
        const candidateScore = score(declaration, routingRequest, routingPolicy);
        candidates.push({
          declaration,
          score: candidateScore,
          selectionReasons: [
            `preferred-rank:${candidateScore.preferredProviderRank}`,
            `policy-score:${candidateScore.total}`,
            `quality:${declaration.routing.qualityClass}`,
            `cost:${declaration.routing.costClass}`,
            `latency:${declaration.routing.latencyClass}`,
            `reliability:${declaration.routing.reliabilityClass}`,
          ],
        });
      }
    }
    candidates.sort(compareCandidates);
    exclusions.sort(
      (left, right) =>
        left.providerId.localeCompare(right.providerId) ||
        left.adapterVersion.localeCompare(right.adapterVersion) ||
        left.capabilityId.localeCompare(right.capabilityId)
    );
    const selected = candidates[0];
    if (!selected) {
      throw new NoEligibleProviderError(
        freeze({
          routingRequestId: request.routingRequestId,
          capabilityId: routingRequest.capabilityId,
          capabilityVersion: routingRequest.capabilityVersion,
          requestSchemaVersion: routingRequest.requestSchemaVersion,
          resultSchemaVersion: routingRequest.resultSchemaVersion,
          policyVersion: routingPolicy.policyVersion,
          exclusions,
        })
      );
    }

    const hashInput = {
      routingRequest,
      policy: routingPolicy,
      registrySnapshotHash: snapshot.snapshotHash,
      selectedProviderId: selected.declaration.providerId,
      selectedAdapterVersion: selected.declaration.adapterVersion,
      selectedCapability: selected.declaration,
      score: selected.score,
      exclusions,
    };
    return freeze({
      routingRequestId: routingRequest.routingRequestId,
      selectedProviderId: selected.declaration.providerId,
      selectedAdapterVersion: selected.declaration.adapterVersion,
      selectedCapability: selected.declaration,
      policyVersion: routingPolicy.policyVersion,
      registrySnapshotHash: snapshot.snapshotHash,
      score: selected.score,
      selectionReasons: selected.selectionReasons,
      excludedCandidates: exclusions,
      decisionHash: await requestHash(hashInput),
      createdAt: this.now().toISOString(),
    }) as ProviderRoutingDecision;
  }
}
