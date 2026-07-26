import type {
  ProviderCapabilityDeclaration,
  ProviderCostClass,
  ProviderFeature,
  ProviderLatencyClass,
  ProviderQualityClass,
  ProviderReliabilityClass,
} from "../provider-adapters/contracts";

export interface ProviderRoutingDataConstraints {
  readonly sensitiveData: boolean;
  readonly externalProcessingAllowed: boolean;
  readonly providerTrainingAllowed: boolean;
  readonly maximumRetentionDays?: number;
  readonly requiredRegions?: readonly string[];
  readonly enterpriseControlsRequired: boolean;
  readonly zeroRetentionRequired: boolean;
}

export interface ProviderRoutingRequest {
  readonly routingRequestId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly requestSchemaVersion: string;
  readonly resultSchemaVersion: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly correlationId: string;
  readonly policyVersion: string;
  readonly requiredFeatures: readonly ProviderFeature[];
  readonly requireLookup: boolean;
  readonly requireCancellation: boolean;
  readonly requireCallbacks: boolean;
  readonly requireStreaming: boolean;
  readonly allowedProviders?: readonly string[];
  readonly deniedProviders?: readonly string[];
  readonly preferredProviders?: readonly string[];
  readonly maximumEstimatedCostUsd?: number;
  readonly maximumLatencyClass?: ProviderLatencyClass;
  readonly minimumQualityClass?: ProviderQualityClass;
  readonly dataHandling: ProviderRoutingDataConstraints;
}

export interface ProviderRoutingPolicy {
  readonly policyVersion: string;
  readonly allowedProviders?: readonly string[];
  readonly deniedProviders?: readonly string[];
  readonly preferredProviders: readonly string[];
  readonly workspaceDeniedProviders?: Readonly<Record<string, readonly string[]>>;
  readonly capabilityAllowedProviders?: Readonly<Record<string, readonly string[]>>;
  readonly allowedModelFamilies?: readonly string[];
  readonly allowedRegions?: readonly string[];
  readonly requireTrainingOptOut: boolean;
  readonly maximumRetentionDays?: number;
  readonly maximumCostClass?: ProviderCostClass;
  readonly maximumLatencyClass?: ProviderLatencyClass;
  readonly minimumQualityClass?: ProviderQualityClass;
  readonly minimumReliabilityClass?: ProviderReliabilityClass;
}

export type ProviderRoutingExclusionCode =
  | "CAPABILITY_ID_MISMATCH"
  | "CAPABILITY_VERSION_MISMATCH"
  | "REQUEST_SCHEMA_MISMATCH"
  | "RESULT_SCHEMA_MISMATCH"
  | "REQUIRED_FEATURE_MISSING"
  | "LOOKUP_UNSUPPORTED"
  | "CANCELLATION_UNSUPPORTED"
  | "CALLBACK_UNSUPPORTED"
  | "STREAMING_UNSUPPORTED"
  | "PROVIDER_NOT_ALLOWED"
  | "PROVIDER_DENIED"
  | "WORKSPACE_RESTRICTION"
  | "CAPABILITY_RESTRICTION"
  | "MODEL_FAMILY_RESTRICTION"
  | "REGION_RESTRICTION"
  | "SENSITIVE_DATA_UNSUPPORTED"
  | "EXTERNAL_PROCESSING_DENIED"
  | "TRAINING_OPT_OUT_REQUIRED"
  | "RETENTION_LIMIT_EXCEEDED"
  | "ZERO_RETENTION_REQUIRED"
  | "ENTERPRISE_CONTROLS_REQUIRED"
  | "COST_CEILING_EXCEEDED"
  | "COST_UNKNOWN"
  | "LATENCY_CEILING_EXCEEDED"
  | "QUALITY_REQUIREMENT_UNMET"
  | "RELIABILITY_REQUIREMENT_UNMET";

export interface ProviderRoutingExclusion {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly capabilityId: string;
  readonly reasons: readonly Readonly<{
    code: ProviderRoutingExclusionCode;
    message: string;
  }>[];
}

export interface ProviderRoutingScore {
  readonly preferredProviderRank: number;
  readonly quality: number;
  readonly cost: number;
  readonly latency: number;
  readonly reliability: number;
  readonly residency: number;
  readonly nativeIdempotency: number;
  readonly lookup: number;
  readonly cancellation: number;
  readonly total: number;
}

export interface ProviderRoutingCandidate {
  readonly declaration: ProviderCapabilityDeclaration;
  readonly score: ProviderRoutingScore;
  readonly selectionReasons: readonly string[];
}

export interface ProviderRoutingDecision {
  readonly routingRequestId: string;
  readonly selectedProviderId: string;
  readonly selectedAdapterVersion: string;
  readonly selectedCapability: ProviderCapabilityDeclaration;
  readonly policyVersion: string;
  readonly registrySnapshotHash: string;
  readonly score: ProviderRoutingScore;
  readonly selectionReasons: readonly string[];
  readonly excludedCandidates: readonly ProviderRoutingExclusion[];
  readonly decisionHash: string;
  readonly createdAt: string;
}

export class NoEligibleProviderError extends Error {
  readonly code = "NO_ELIGIBLE_PROVIDER";

  constructor(
    readonly details: Readonly<{
      routingRequestId: string;
      capabilityId: string;
      capabilityVersion: string;
      requestSchemaVersion: string;
      resultSchemaVersion: string;
      policyVersion: string;
      exclusions: readonly ProviderRoutingExclusion[];
    }>
  ) {
    super(`No eligible provider for capability ${details.capabilityId}`);
    this.name = "NoEligibleProviderError";
  }
}
