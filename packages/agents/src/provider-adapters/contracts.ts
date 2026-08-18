import type {
  CanonicalProviderRequest,
  CanonicalProviderResult,
  CompatibilityRange,
  ProviderError,
} from "@ceo-agent/shared";

export type ProviderFeature =
  | "STRUCTURED_OUTPUT"
  | "NATIVE_IDEMPOTENCY"
  | "LOOKUP"
  | "CANCELLATION"
  | "CALLBACKS"
  | "STREAMING";

export type ProviderCostClass = "LOW" | "MEDIUM" | "HIGH";
export type ProviderLatencyClass = "FAST" | "STANDARD" | "SLOW";
export type ProviderQualityClass = "STANDARD" | "HIGH" | "PREMIUM";
export type ProviderReliabilityClass = "STANDARD" | "HIGH" | "CRITICAL";

export interface ProviderRoutingMetadata {
  readonly costClass: ProviderCostClass;
  readonly estimatedCostUsd?: number;
  readonly latencyClass: ProviderLatencyClass;
  readonly qualityClass: ProviderQualityClass;
  readonly reliabilityClass: ProviderReliabilityClass;
  readonly regions: readonly string[];
  readonly modelFamilies: readonly string[];
  readonly sensitiveDataAllowed: boolean;
  readonly externalProcessing: boolean;
  readonly trainingOptOut: boolean;
  readonly zeroRetention: boolean;
  readonly maximumRetentionDays?: number;
  readonly enterpriseControls: boolean;
}

export interface ProviderCapabilityDeclaration {
  readonly providerId: string;
  readonly adapterVersion: string;
  readonly capabilityId: string;
  readonly capabilityVersions: readonly CompatibilityRange[];
  readonly requestSchemaVersions: readonly CompatibilityRange[];
  readonly resultSchemaVersions: readonly CompatibilityRange[];
  readonly requiredProviderFeatures: readonly ProviderFeature[];
  readonly nativeIdempotency: boolean;
  readonly lookup: boolean;
  readonly cancellation: boolean;
  readonly callbacks: boolean;
  readonly streaming: boolean;
  readonly routing: ProviderRoutingMetadata;
}

export interface ProviderExecutionContext {
  readonly executionId: string;
  readonly providerAttemptId: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly timeoutDeadline: string;
  readonly idempotencyKey: string;
  readonly capability: Readonly<{
    capabilityId: string;
    capabilityVersion: string;
    requestSchemaVersion: string;
    resultSchemaVersion: string;
  }>;
  readonly dataHandling: Readonly<{
    allowedRegions?: readonly string[];
    sensitiveData: boolean;
    retentionAllowed: boolean;
  }>;
  readonly trace: Readonly<Record<string, string>>;
}

export type ProviderLookupResult =
  | Readonly<{ status: "RUNNING"; providerRequestId: string }>
  | Readonly<{
      status: "SUCCEEDED";
      providerRequestId: string;
      result?: CanonicalProviderResult;
    }>
  | Readonly<{ status: "FAILED"; providerRequestId: string; error: ProviderError }>
  | Readonly<{ status: "NOT_FOUND" | "UNKNOWN" | "UNSUPPORTED" }>;

export type ProviderCancelResult =
  | Readonly<{
      status: "CANCELLATION_REQUESTED" | "CANCELLATION_CONFIRMED";
      providerRequestId: string;
    }>
  | Readonly<{ status: "ALREADY_TERMINAL"; providerRequestId: string }>
  | Readonly<{ status: "UNKNOWN" | "UNSUPPORTED" }>;

export interface ProviderAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;

  capabilities(): ReadonlySet<ProviderCapabilityDeclaration>;

  execute(
    request: CanonicalProviderRequest,
    context: ProviderExecutionContext
  ): Promise<CanonicalProviderResult>;

  lookup?(
    providerRequestId: string,
    context: ProviderExecutionContext
  ): Promise<ProviderLookupResult>;

  cancel?(
    providerRequestId: string,
    context: ProviderExecutionContext
  ): Promise<ProviderCancelResult>;
}

export interface ProviderPayloadResolver {
  resolve(
    reference: CanonicalProviderRequest["normalizedPayloadReference"],
    context: ProviderExecutionContext
  ): Promise<unknown>;
}

export class ProviderAdapterError extends Error {
  constructor(readonly providerError: ProviderError, options?: { cause?: unknown }) {
    super(providerError.message, options);
    this.name = "ProviderAdapterError";
  }
}
