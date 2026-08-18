import { z } from "zod";
import {
  createProviderError,
  requestHash,
  responseHash,
  validateCanonicalProviderRequest,
  validateCanonicalProviderResult,
  type CanonicalProviderRequest,
  type CanonicalProviderResult,
  type ProviderErrorKind,
} from "@ceo-agent/shared";
import { callJsonModel } from "../llm";
import {
  ProviderAdapterError,
  type ProviderAdapter,
  type ProviderCapabilityDeclaration,
  type ProviderCancelResult,
  type ProviderExecutionContext,
  type ProviderLookupResult,
  type ProviderPayloadResolver,
} from "./contracts";

const OPENAI_ADAPTER_VERSION = "1.0.0";
const OPENAI_PROVIDER_VERSION = "openai-api-v1";

const OpenAIJsonPayloadSchema = z
  .object({
    system: z.string().min(1),
    user: z.string().min(1),
    schemaHint: z.string().min(1),
    preferredModel: z.enum(["gpt-4o-mini", "gpt-4o"]).optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .strict();

const CAPABILITY = Object.freeze({
  providerId: "openai",
  adapterVersion: OPENAI_ADAPTER_VERSION,
  capabilityId: "json-generation",
  capabilityVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requestSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  resultSchemaVersions: [{ minInclusive: "1.0.0", maxExclusive: "2.0.0" }],
  requiredProviderFeatures: ["STRUCTURED_OUTPUT"],
  nativeIdempotency: false,
  lookup: false,
  cancellation: false,
  callbacks: false,
  streaming: false,
  routing: {
    costClass: "LOW",
    latencyClass: "FAST",
    qualityClass: "HIGH",
    reliabilityClass: "HIGH",
    regions: [],
    modelFamilies: ["gpt-4o"],
    sensitiveDataAllowed: false,
    externalProcessing: true,
    trainingOptOut: false,
    zeroRetention: false,
    enterpriseControls: false,
  },
} satisfies ProviderCapabilityDeclaration);

type SafeProviderFailure = {
  status?: number;
  code?: string;
  name?: string;
  message: string;
};

function safeFailure(error: unknown): SafeProviderFailure {
  if (!(error instanceof Error)) return { message: "OpenAI request failed" };
  const candidate = error as Error & { status?: unknown; code?: unknown };
  return {
    status: typeof candidate.status === "number" ? candidate.status : undefined,
    code: typeof candidate.code === "string" ? candidate.code : undefined,
    name: candidate.name || undefined,
    message: error.message.slice(0, 500),
  };
}

function errorKind(failure: SafeProviderFailure): ProviderErrorKind {
  if (failure.status === 429) return "RATE_LIMITED";
  if (failure.status === 401) return "AUTHENTICATION_FAILURE";
  if (failure.status === 403) return "POLICY_REJECTION";
  if (failure.status !== undefined && failure.status >= 500) {
    return "PROVIDER_UNAVAILABLE";
  }
  if (/timeout|timed out|abort/i.test(`${failure.name ?? ""} ${failure.message}`)) {
    return "TIMEOUT_UNKNOWN";
  }
  if (/cancel/i.test(`${failure.name ?? ""} ${failure.message}`)) return "CANCELLED";
  if (/policy|content filter|safety/i.test(failure.message)) return "POLICY_REJECTION";
  if (/api[_ ]?key|auth/i.test(failure.message)) return "AUTHENTICATION_FAILURE";
  if (failure.name === "ZodError" || failure.name === "SyntaxError") {
    return "VALIDATION_FAILURE";
  }
  if (/network|connection|socket|temporar/i.test(failure.message)) return "RETRYABLE";
  return "TERMINAL_FAILURE";
}

function normalizeError(error: unknown): ProviderAdapterError {
  const failure = safeFailure(error);
  const kind = errorKind(failure);
  return new ProviderAdapterError(
    createProviderError(kind, {
      code: failure.code ?? `OPENAI_${kind}`,
      message: failure.message,
      safeDetails: {
        providerId: "openai",
        ...(failure.status === undefined ? {} : { httpStatus: failure.status }),
      },
    }),
    { cause: error }
  );
}

function assertContext(
  request: CanonicalProviderRequest,
  context: ProviderExecutionContext
): void {
  const identity = request.executionIdentity;
  if (
    context.executionId !== identity.executionId ||
    context.correlationId !== request.correlation.correlationId ||
    context.tenantId !== identity.tenantId ||
    context.workspaceId !== identity.workspaceId ||
    context.idempotencyKey !== identity.idempotencyKey ||
    context.capability.capabilityId !== identity.capabilityId ||
    context.capability.capabilityVersion !== identity.capabilityVersion ||
    context.capability.requestSchemaVersion !== request.requestSchemaVersion ||
    context.capability.resultSchemaVersion !== request.resultSchemaVersion
  ) {
    throw new Error("Provider execution context does not match canonical request identity");
  }
  const deadline = Date.parse(context.timeoutDeadline);
  if (!Number.isFinite(deadline) || deadline <= Date.now()) {
    throw new Error("Provider execution deadline has expired");
  }
  const constraints = request.providerConstraints;
  if (
    constraints.allowedProviderIds &&
    !constraints.allowedProviderIds.includes("openai")
  ) {
    throw new Error("Canonical request does not allow the OpenAI provider");
  }
  if (constraints.deniedProviderIds?.includes("openai")) {
    throw new Error("Canonical request denies the OpenAI provider");
  }
  if (constraints.nativeIdempotencyRequired) {
    throw new Error("OpenAI compatibility adapter does not declare native idempotency");
  }
  if (constraints.executionLookupRequired) {
    throw new Error("OpenAI compatibility adapter does not support execution lookup");
  }
}

function beforeDeadline<T>(promise: Promise<T>, deadline: string): Promise<T> {
  const remaining = Date.parse(deadline) - Date.now();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error("OpenAI execution timed out with provider state unknown");
      error.name = "TimeoutError";
      reject(error);
    }, remaining);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export class OpenAIJsonCompatibilityAdapter implements ProviderAdapter {
  readonly providerId = "openai";
  readonly adapterVersion = OPENAI_ADAPTER_VERSION;

  constructor(private readonly payloadResolver: ProviderPayloadResolver) {}

  capabilities(): ReadonlySet<ProviderCapabilityDeclaration> {
    return new Set([CAPABILITY]);
  }

  async execute(
    input: CanonicalProviderRequest,
    context: ProviderExecutionContext
  ): Promise<CanonicalProviderResult> {
    try {
      const request = validateCanonicalProviderRequest(input);
      assertContext(request, context);
      const payload = OpenAIJsonPayloadSchema.parse(
        await this.payloadResolver.resolve(request.normalizedPayloadReference, context)
      );
      const mappedRequest = {
        model: payload.preferredModel ?? "gpt-4o-mini",
        system: payload.system,
        user: payload.user,
        schemaHint: payload.schemaHint,
        temperature: payload.temperature,
        idempotencyKey: request.executionIdentity.idempotencyKey,
        correlationId: request.correlation.correlationId,
        outputSchema: request.outputSchema,
        timeoutDeadline: context.timeoutDeadline,
        dataHandling: context.dataHandling,
      };
      const mappedRequestHash = await requestHash(request);
      const completion = await beforeDeadline(
        callJsonModel<Record<string, unknown>>(
          mappedRequest.system,
          mappedRequest.user,
          mappedRequest.schemaHint,
          { model: mappedRequest.model }
        ),
        context.timeoutDeadline
      );
      if (!completion.result || typeof completion.result !== "object") {
        throw new SyntaxError("OpenAI returned malformed structured output");
      }
      const completionMeta = completion as typeof completion & {
        providerRequestId?: string;
        modelVersion?: string;
      };
      const providerRequestId =
        completionMeta.providerRequestId ?? context.providerAttemptId;
      const modelVersion = completionMeta.modelVersion ?? mappedRequest.model;
      const normalizedResponse = {
        output: completion.result,
        providerRequestId,
        modelVersion,
      };
      const mappedResponseHash = await responseHash(normalizedResponse);

      return validateCanonicalProviderResult({
        contractVersion: "1",
        executionId: request.executionIdentity.executionId,
        providerAttemptId: context.providerAttemptId,
        normalizedOutput: completion.result,
        resultReference: `provider-result://openai/${providerRequestId}`,
        warnings: [],
        providerMetadata: {
          providerId: this.providerId,
          providerVersion: OPENAI_PROVIDER_VERSION,
          providerRequestId,
        },
        provenance: [
          {
            providerId: this.providerId,
            adapterVersion: this.adapterVersion,
            modelVersion,
            providerRequestId,
          },
        ],
        usage: {
          inputTokens: completion.usage.input,
          outputTokens: completion.usage.output,
          totalTokens: completion.usage.input + completion.usage.output,
        },
        cost: {
          amount: completion.usage.costUsd,
          currency: "USD",
          estimated: true,
        },
        modelVersion,
        requestHash: mappedRequestHash,
        responseHash: mappedResponseHash,
        retryable: false,
        validationStatus: "VALID",
      });
    } catch (error) {
      if (error instanceof ProviderAdapterError) throw error;
      throw normalizeError(error);
    }
  }

  async lookup(
    _providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderLookupResult> {
    return { status: "UNSUPPORTED" };
  }

  async cancel(
    _providerRequestId: string,
    _context: ProviderExecutionContext
  ): Promise<ProviderCancelResult> {
    return { status: "UNSUPPORTED" };
  }
}
