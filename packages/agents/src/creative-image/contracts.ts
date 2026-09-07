export const CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION =
  "creative-image-execution.v1" as const;

export type CreativeImageExecutionScope = Readonly<{
  tenantId: string;
  workspaceId: string;
  correlationId?: string;
}>;

export type CreativeImageReference = Readonly<{
  assetId: string;
  contentHash: string;
  mimeType: string;
  bytes: Buffer;
  role: "INPUT_IMAGE" | "REFERENCE_IMAGE" | "MASK_IMAGE";
}>;

export type CreativeImageRequestedOutput = Readonly<{
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width?: number;
  height?: number;
  sizeConstraint?: string;
  quality: "STANDARD" | "HIGH";
}>;

/**
 * Provider-neutral execution facts only. Product and Story authorities compile
 * their own semantics into this boundary before invoking it.
 */
export type CreativeImageGenerationInput = Readonly<{
  contractVersion: typeof CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION;
  scope: CreativeImageExecutionScope;
  executionIdentity: string;
  idempotencyKey: string;
  authorizationId: string;
  prompt: string;
  references: readonly CreativeImageReference[];
  requestedOutput: CreativeImageRequestedOutput;
  correlationMetadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

/** Provider-observed evidence; never EmberOS pricing or charging authority. */
export type CreativeImageProviderUsageEvidence = Readonly<{
  inputUnits?: number;
  outputUnits?: number;
  providerReportedCost?: Readonly<{
    currency: string;
    amount: number;
  }>;
}>;

export type CreativeImageGenerationOutput = Readonly<{
  bytes: Buffer;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  providerId: string;
  modelId: string;
  adapterVersion: string;
  providerRequestId: string;
  revisedPrompt?: string;
  usage?: CreativeImageProviderUsageEvidence;
  metadata?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export interface CreativeImageGenerationAdapter {
  readonly providerId: string;
  readonly modelId: string;
  readonly adapterVersion: string;
  readonly externalPaidCall: boolean;
  generate(input: CreativeImageGenerationInput): Promise<CreativeImageGenerationOutput>;
}

export type CreativeImageExecutionAuthorization = Readonly<{
  contractVersion: typeof CREATIVE_IMAGE_EXECUTION_CONTRACT_VERSION;
  authorizationId: string;
  executionIdentity: string;
  idempotencyKey: string;
  scope: CreativeImageExecutionScope;
  providerId: string;
  modelId: string;
  maximumProviderCalls: number;
  authorizedBy: string;
  authorizedAt: string;
}>;

export const CREATIVE_IMAGE_EXECUTION_ERROR_CODES = [
  "INVALID_INPUT",
  "AUTHORIZATION_REQUIRED",
  "AUTHORIZATION_EXHAUSTED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_REJECTED",
  "PROVIDER_RESULT_INVALID",
  "EXECUTION_FAILED",
] as const;

export type CreativeImageExecutionErrorCode =
  (typeof CREATIVE_IMAGE_EXECUTION_ERROR_CODES)[number];

export type CreativeImageBoundedProviderEvidence = Readonly<{
  status?: number;
  code?: string;
  type?: string;
  message?: string;
  requestId?: string;
}>;

export type CreativeImageExecutionFailure = Readonly<{
  code: CreativeImageExecutionErrorCode;
  message: string;
  providerEvidence?: CreativeImageBoundedProviderEvidence;
}>;

export class CreativeImageExecutionError extends Error {
  constructor(
    readonly code: CreativeImageExecutionErrorCode,
    message: string,
    readonly providerEvidence?: CreativeImageBoundedProviderEvidence
  ) {
    super(message);
    this.name = "CreativeImageExecutionError";
  }
}

/** Adapter-facing bounded error. Raw Provider/SDK responses are forbidden. */
export class CreativeImageAdapterError extends Error {
  constructor(
    readonly code: Extract<
      CreativeImageExecutionErrorCode,
      "PROVIDER_UNAVAILABLE" | "PROVIDER_REJECTED" | "PROVIDER_RESULT_INVALID"
    >,
    message: string,
    readonly providerEvidence?: CreativeImageBoundedProviderEvidence
  ) {
    super(message);
    this.name = "CreativeImageAdapterError";
  }
}

export type CreativeImageExecutionResult =
  | Readonly<{
      status: "SUCCEEDED";
      executionIdentity: string;
      idempotencyKey: string;
      providerCallsUsed: number;
      replayed: boolean;
      output: CreativeImageGenerationOutput;
    }>
  | Readonly<{
      status: "FAILED";
      executionIdentity: string;
      idempotencyKey: string;
      providerCallsUsed: number;
      replayed: boolean;
      failure: CreativeImageExecutionFailure;
    }>;
