/**
 * Deterministic Seedance test adapter — animation-video only.
 * Registers when real SEEDANCE_API_KEY is absent and test providers are enabled
 * (NODE_ENV=test or EMBERO_S_TEST_PROVIDERS=1). Not a production mock.
 */
import {
  createProviderError,
  requestHash,
  responseHash,
  validateCanonicalProviderRequest,
  validateCanonicalProviderResult,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
} from "@ceo-agent/shared";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderCapabilityDeclaration,
  type ProviderCancelResult,
  type ProviderExecutionContext,
  type ProviderLookupResult,
  type ProviderPayloadResolver,
} from "./contracts";

const ADAPTER_VERSION = "1.0.0-test";

const CAPABILITY = Object.freeze({
  providerId: "seedance",
  adapterVersion: ADAPTER_VERSION,
  capabilityId: "animation-video-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["LOOKUP"],
  nativeIdempotency: true,
  lookup: true,
  cancellation: true,
  callbacks: false,
  streaming: false,
  routing: {
    costClass: "LOW",
    estimatedCostUsd: 0,
    latencyClass: "FAST",
    qualityClass: "STANDARD",
    reliabilityClass: "HIGH",
    regions: [],
    modelFamilies: ["seedance-test"],
    sensitiveDataAllowed: false,
    externalProcessing: false,
    trainingOptOut: true,
    zeroRetention: true,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

export function testProvidersEnabled(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.EMBEROS_TEST_PROVIDERS === "1" ||
    process.env.EMBER_OS_TEST_PROVIDERS === "1"
  );
}

export class DeterministicSeedanceTestAdapter implements ProviderAdapter {
  readonly providerId = "seedance";
  readonly adapterVersion = ADAPTER_VERSION;

  constructor(private readonly payloadResolver: ProviderPayloadResolver) {}

  capabilities(): ReadonlySet<ProviderCapabilityDeclaration> {
    if (!testProvidersEnabled()) return new Set();
    return new Set([CAPABILITY]);
  }

  async execute(
    input: CanonicalProviderRequest,
    context: ProviderExecutionContext
  ): Promise<CanonicalProviderResult> {
    try {
      const request = validateCanonicalProviderRequest(input);
      const payload = (await this.payloadResolver.resolve(
        request.normalizedPayloadReference,
        context
      )) as Record<string, unknown>;
      const prompt =
        typeof payload.prompt === "string" && payload.prompt.length > 0
          ? payload.prompt
          : "deterministic-test";
      const outputIndex =
        typeof payload.outputIndex === "number" ? payload.outputIndex : 0;
      const hash = await requestHash({
        prompt,
        outputIndex,
        executionId: request.executionIdentity.executionId,
      });
      const providerRequestId = `seedance-test-${hash.slice(0, 24)}`;
      const videoUrl = `memory://seedance-test/${providerRequestId}.mp4`;
      const normalizedOutput = {
        mediaKind: "video" as const,
        videoUrl,
        providerRequestId,
        status: "succeeded",
        outputIndex,
        deterministic: true,
      };
      return validateCanonicalProviderResult({
        contractVersion: "1",
        executionId: request.executionIdentity.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput,
        resultReference: `provider-result://seedance-test/${providerRequestId}`,
        warnings: ["DeterministicSeedanceTestAdapter — test-only provider"],
        providerMetadata: {
          providerId: "seedance",
          providerVersion: "seedance-test-v1",
        },
        usage: {},
        cost: { amount: 0, currency: "USD", estimated: false },
        modelVersion: "seedance-test",
        requestHash: await requestHash(request),
        responseHash: await responseHash(normalizedOutput),
        retryable: false,
        validationStatus: "VALID",
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) throw error;
      throw new ProviderAdapterError(
        createProviderError("TERMINAL_FAILURE", {
          code: "SEEDANCE_TEST_FAILED",
          message:
            error instanceof Error ? error.message : "Deterministic Seedance test failed",
          safeDetails: { providerId: "seedance" },
        }),
        { cause: error }
      );
    }
  }

  async lookup(
    providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderLookupResult> {
    if (!providerRequestId.startsWith("seedance-test-")) {
      return { status: "NOT_FOUND" };
    }
    const videoUrl = `memory://seedance-test/${providerRequestId}.mp4`;
    return {
      status: "SUCCEEDED",
      providerRequestId,
      result: {
        contractVersion: "1",
        executionId: "lookup",
        providerAttemptId: "lookup",
        normalizedOutput: { videoUrl, mediaKind: "video", deterministic: true },
        resultReference: `provider-result://seedance-test/${providerRequestId}`,
        warnings: [],
        providerMetadata: {
          providerId: "seedance",
          providerVersion: "seedance-test-v1",
        },
        usage: {},
        cost: { amount: 0, currency: "USD", estimated: false },
        modelVersion: "seedance-test",
        requestHash: `sha256:${"0".repeat(64)}`,
        responseHash: `sha256:${"1".repeat(64)}`,
        retryable: false,
        validationStatus: "VALID",
      },
    };
  }

  async cancel(
    providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderCancelResult> {
    if (!providerRequestId.startsWith("seedance-test-")) {
      return { status: "UNKNOWN" };
    }
    return { status: "CANCELLATION_CONFIRMED", providerRequestId };
  }
}
