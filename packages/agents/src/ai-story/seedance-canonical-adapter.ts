/**
 * Sprint 3 PR 3.4A — Canonical Seedance Adapter.
 * Translates immutable Envelope requests into Seedance HTTP and normalizes results.
 * No Finalizer, no Usage/Cost ledger writes, no alternate Provider Adapter, no fallback, no public unlock.
 *
 * Raw Seedance request/response payloads:
 * - must not enter Scene Result / Final Story contracts
 * - must not be logged or returned as canonical results
 * - must not contain credentials when retained
 * - may be retained only via approved restricted operational storage if required
 * Prefer not storing raw payloads unless needed for reconciliation/support.
 */
import type {
  AiStoryProviderCreateResponseDiagnostic,
  CanonicalProviderState,
  ProviderCallbackNormalizationInput,
  ProviderCallbackReceipt,
  WorkerFailureClassification,
} from "@ceo-agent/shared";
import { WORKER_RUNTIME_CONTRACT_VERSION, configuredEstimateForProvider } from "@ceo-agent/shared";
import { canonicalPersistenceHash } from "@ceo-agent/db";
import type { ProviderCapabilityDeclaration } from "../provider-adapters/contracts";
import {
  failureFromCode,
  type CanonicalAdapterErrorInput,
  type CanonicalAdapterLookupInput,
  type CanonicalAdapterLookupResult,
  type CanonicalAdapterSubmitInput,
  type CanonicalAdapterSubmitResult,
  type CanonicalProviderAdapter,
} from "./canonical-provider-adapter";
import {
  SEEDANCE_ADAPTER_VERSION,
  SEEDANCE_CALLBACKS_SUPPORTED,
  SEEDANCE_PROVIDER_ID,
  buildSeedanceCapabilityDeclaration,
  seedanceCapabilityDetails,
} from "./seedance-capability";
import {
  loadSeedanceAdapterConfig,
  type SeedanceAdapterConfig,
} from "./seedance-config";
import {
  assertFallbackDisabled,
  classifySeedanceError,
} from "./seedance-error-classification";
import {
  createSeedanceHttpClient,
  SeedanceHttpTransportError,
  type SeedanceHttpClient,
  type SeedanceHttpResponse,
  type SeedanceFetch,
} from "./seedance-http-client";
import {
  mapCanonicalEnvelopeToSeedanceRequest,
  type SeedanceAssetAccessResolver,
  type SeedancePayloadResolver,
} from "./seedance-request-mapping";
import {
  buildProviderCreateResponseDiagnostic,
  buildProviderTransportFailureDiagnostic,
  type AiStoryProviderCreateResponseDiagnosticSink,
  type ProviderCreateResponseDiagnosticBinding,
} from "./provider-create-response-diagnostic";

export type SeedanceCanonicalAdapterOptions = {
  readonly config?: SeedanceAdapterConfig;
  readonly http?: SeedanceHttpClient;
  readonly fetchImpl?: SeedanceFetch;
  readonly payloadResolver: SeedancePayloadResolver;
  readonly assetAccessResolver?: SeedanceAssetAccessResolver;
  /**
   * Durable create-response diagnostic sink. When omitted the adapter keeps
   * its legacy behaviour and historical attempts stay valid records with the
   * envelope simply NOT PERSISTED.
   */
  readonly diagnostics?: AiStoryProviderCreateResponseDiagnosticSink;
  readonly now?: () => Date;
};

/**
 * Raised when Provider evidence could not be committed durably. The adapter
 * refuses to report a clean terminal outcome it cannot substantiate, so this
 * surfaces as ACCEPTANCE_UNKNOWN with reconciliation rather than a fabricated
 * rejection.
 */
export class SeedanceDiagnosticPersistenceError extends Error {
  readonly code = "PROVIDER_CREATE_RESPONSE_DIAGNOSTIC_NOT_PERSISTED";
  constructor(readonly cause: unknown) {
    super("Provider create-response diagnostic evidence was not persisted");
    this.name = "SeedanceDiagnosticPersistenceError";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * ModelArk create/lookup returns task id in `id` (e.g. `cgt-…`).
 * HTTP 200 alone is never ACCEPTED without a valid id.
 */
export function extractSeedanceProviderRequestId(body: unknown): string | undefined {
  const record = asRecord(body);
  return (
    readString(record.id) ??
    readString(record.task_id) ??
    readString(asRecord(record.data).id)
  );
}

function readModelArkErrorText(record: Record<string, unknown>): string {
  const error = record.error;
  if (typeof error === "string") return error;
  const nested = asRecord(error);
  return (
    readString(nested.message) ??
    readString(nested.code) ??
    readString(record.message) ??
    ""
  );
}

function normalizeCreateStatus(body: unknown, httpStatus: number): {
  readonly acceptanceClassification: CanonicalAdapterSubmitResult["acceptanceClassification"];
  readonly canonicalProviderState: CanonicalProviderState;
  readonly providerRequestId?: string;
  readonly reconciliationRequired: boolean;
  readonly failureClassification?: WorkerFailureClassification;
} {
  const record = asRecord(body);
  const providerRequestId = extractSeedanceProviderRequestId(body);
  const status = (readString(record.status) ?? "").toLowerCase();
  const errorText = readModelArkErrorText(record);

  if (httpStatus === 400 || httpStatus === 403 || httpStatus === 422) {
    const moderation =
      httpStatus === 422 ||
      /moderation|safety|sensitive|content.?policy/i.test(errorText);
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        moderation ? "PROVIDER_MODERATION_REJECTED" : "PROVIDER_NOT_ACCEPTED",
        moderation
          ? "Provider moderation rejected the submission"
          : "Provider rejected the submission"
      ),
    };
  }

  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      acceptanceClassification: "NOT_SUBMITTED",
      canonicalProviderState: "NOT_SUBMITTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_TIMEOUT",
        "Temporary provider infrastructure error",
        { retryable: true, terminal: false }
      ),
    };
  }

  if (!providerRequestId) {
    // HTTP 200 without task id must never be treated as ACCEPTED.
    if (httpStatus >= 200 && httpStatus < 300) {
      return {
        acceptanceClassification: "ACCEPTANCE_UNKNOWN",
        canonicalProviderState: "ACCEPTANCE_UNKNOWN",
        reconciliationRequired: true,
        failureClassification: failureFromCode(
          "PROVIDER_ACCEPTANCE_UNKNOWN",
          "Provider acceptance is unknown; reconciliation required",
          { terminal: false, reconciliationRequired: true }
        ),
      };
    }
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_NOT_ACCEPTED",
        "Provider rejected the submission"
      ),
    };
  }

  if (
    status === "failed" ||
    status === "expired" ||
    status === "cancelled" ||
    /fail|reject|error/.test(status)
  ) {
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      providerRequestId,
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_NOT_ACCEPTED",
        "Provider rejected the submission"
      ),
    };
  }

  // Create acceptance freezes when a valid task id is present (queued/running/omitted).
  return {
    acceptanceClassification: "ACCEPTED",
    canonicalProviderState: "ACCEPTED",
    providerRequestId,
    reconciliationRequired: false,
  };
}

function normalizeLookupBody(
  providerRequestId: string,
  body: unknown,
  httpStatus: number
): CanonicalAdapterLookupResult {
  if (httpStatus === 404) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "FAILED",
      providerRequestId,
      reconciliationRequired: true,
      failureClassification: failureFromCode(
        "PROVIDER_ACCEPTANCE_UNKNOWN",
        "Accepted request was not found during lookup",
        { terminal: false, reconciliationRequired: true }
      ),
    };
  }
  if (httpStatus >= 500 || httpStatus === 429) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "PROCESSING",
      providerRequestId,
      reconciliationRequired: true,
      failureClassification: failureFromCode(
        "PROVIDER_TIMEOUT",
        "Temporary lookup infrastructure error",
        { retryable: true, terminal: false, reconciliationRequired: true }
      ),
    };
  }

  const record = asRecord(body);
  const status = (readString(record.status) ?? "").toLowerCase();
  const content = asRecord(record.content);
  const errorText = readModelArkErrorText(record);
  const videoUrl =
    readString(content.video_url) ??
    readString(record.video_url) ??
    readString(record.output_url) ??
    readString(asRecord(record.output).url);
  const contentHash = readString(record.content_hash) ?? readString(record.hash);
  const durationSec =
    typeof record.duration === "number" ? record.duration : undefined;
  const durationMs =
    typeof record.duration_ms === "number"
      ? record.duration_ms
      : durationSec !== undefined
        ? Math.round(durationSec * 1000)
        : undefined;
  const width = typeof record.width === "number" ? record.width : undefined;
  const height = typeof record.height === "number" ? record.height : undefined;
  const usage = asRecord(record.usage);
  const completionTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : undefined;

  if (
    /moderation|safety|content_policy|sensitive/i.test(status) ||
    /moderation|safety|sensitive|content.?policy/i.test(errorText) ||
    httpStatus === 422
  ) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "REJECTED",
      providerRequestId,
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_MODERATION_REJECTED",
        "Provider moderation rejected the request"
      ),
    };
  }
  if (
    status === "failed" ||
    status === "expired" ||
    status === "cancelled" ||
    /reject|failed|error|cancelled|expired/.test(status)
  ) {
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "FAILED",
      providerRequestId,
      reconciliationRequired: false,
      failureClassification: failureFromCode(
        "PROVIDER_FAILED",
        "Provider failed the accepted request"
      ),
    };
  }
  if (status === "succeeded" || status === "completed" || status === "done") {
    if (!videoUrl) {
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: "FAILED",
        providerRequestId,
        reconciliationRequired: false,
        failureClassification: failureFromCode(
          "PROVIDER_FAILED",
          "Provider reported success without media reference"
        ),
      };
    }
    return {
      acceptanceClassification: "ACCEPTED",
      canonicalProviderState: "SUCCEEDED",
      providerRequestId,
      normalizedResultReference: videoUrl,
      terminalMedia: {
        mediaType: "video/mp4",
        uriReference: videoUrl,
        ...(contentHash ? { contentHash } : {}),
        ...(durationMs ? { durationMs } : {}),
        ...(width ? { width } : {}),
        ...(height ? { height } : {}),
      },
      normalizedUsageFacts:
        durationMs !== undefined
          ? {
              durationMs,
              units: completionTokens ?? 1,
              unitKind: completionTokens !== undefined ? "tokens" : "video",
            }
          : {
              units: completionTokens ?? 1,
              unitKind: completionTokens !== undefined ? "tokens" : "video",
            },
      normalizedCostMetadata: {
        ...configuredEstimateForProvider("seedance")!,
        modelKey: readString(record.model) ?? "seedance",
      },
      reconciliationRequired: false,
      operationalMetadata: {
        model: readString(record.model) ?? "seedance",
        providerStatus: status || "succeeded",
      },
    };
  }

  // queued | running | unknown non-terminal
  return {
    acceptanceClassification: "ACCEPTED",
    canonicalProviderState: "PROCESSING",
    providerRequestId,
    reconciliationRequired: false,
    operationalMetadata: {
      providerStatus: status || "processing",
    },
  };
}

export class SeedanceCanonicalAdapter implements CanonicalProviderAdapter {
  readonly providerId = SEEDANCE_PROVIDER_ID;
  readonly adapterVersion = SEEDANCE_ADAPTER_VERSION;

  private readonly config: SeedanceAdapterConfig;
  private readonly http: SeedanceHttpClient;
  private readonly payloadResolver: SeedancePayloadResolver;
  private readonly assetAccessResolver?: SeedanceAssetAccessResolver;
  private readonly diagnostics?: AiStoryProviderCreateResponseDiagnosticSink;
  private readonly now: () => Date;

  constructor(options: SeedanceCanonicalAdapterOptions) {
    this.config = options.config ?? loadSeedanceAdapterConfig();
    this.http =
      options.http ??
      createSeedanceHttpClient({
        config: this.config,
        fetchImpl: options.fetchImpl,
      });
    this.payloadResolver = options.payloadResolver;
    this.assetAccessResolver = options.assetAccessResolver;
    this.diagnostics = options.diagnostics;
    this.now = options.now ?? (() => new Date());
  }

  describeCapabilities(): ReadonlyArray<ProviderCapabilityDeclaration> {
    return [
      buildSeedanceCapabilityDeclaration({
        defaultModel: this.config.defaultModel,
      }),
    ];
  }

  capabilityDetails() {
    return seedanceCapabilityDetails({ defaultModel: this.config.defaultModel });
  }

  async submit(input: CanonicalAdapterSubmitInput): Promise<CanonicalAdapterSubmitResult> {
    const binding = this.diagnosticBinding(input);
    try {
      const mapped = await mapCanonicalEnvelopeToSeedanceRequest({
        envelope: input.envelope,
        idempotencyKey: input.idempotencyKey,
        model: this.config.defaultModel,
        payloadResolver: this.payloadResolver,
        assetAccessResolver: this.assetAccessResolver,
      });

      let response: SeedanceHttpResponse;
      try {
        response = await this.http.createGeneration(mapped);
      } catch (transportError) {
        if (transportError instanceof SeedanceHttpTransportError) {
          await this.persistTransportFailureDiagnostic(
            input,
            binding,
            transportError
          );
        }
        throw transportError;
      }

      // Provider-native detail is read off the raw response and committed
      // durably before the Worker result lifecycle continues, so normalization
      // can never be the reason the rejection reason is unrecoverable.
      const normalized = normalizeCreateStatus(response.body, response.status);
      await this.persistCreateResponseDiagnostic({
        input,
        binding,
        response,
        normalized,
      });

      return {
        acceptanceClassification: normalized.acceptanceClassification,
        canonicalProviderState: normalized.canonicalProviderState,
        ...(normalized.providerRequestId
          ? { providerRequestId: normalized.providerRequestId }
          : {}),
        reconciliationRequired: normalized.reconciliationRequired,
        ...(normalized.failureClassification
          ? { failureClassification: normalized.failureClassification }
          : {}),
        operationalMetadata: {
          adapterVersion: this.adapterVersion,
          model: this.config.defaultModel,
          httpStatus: response.status,
        },
      };
    } catch (error) {
      if (error instanceof SeedanceDiagnosticPersistenceError) {
        // Never report a terminal Provider verdict that has no durable evidence.
        return {
          acceptanceClassification: "ACCEPTANCE_UNKNOWN",
          canonicalProviderState: "ACCEPTANCE_UNKNOWN",
          reconciliationRequired: true,
          failureClassification: failureFromCode(
            "PROVIDER_ACCEPTANCE_UNKNOWN",
            "Provider evidence was not persisted; reconciliation required",
            { terminal: false, reconciliationRequired: true }
          ),
        };
      }
      return this.toSubmitFailure(error);
    }
  }

  private diagnosticBinding(
    input: CanonicalAdapterSubmitInput
  ): ProviderCreateResponseDiagnosticBinding {
    return {
      provider: this.providerId,
      model: this.config.defaultModel,
      providerAttemptId: input.providerAttemptId,
      compiledRequestId: input.envelope.envelopeId,
      requestFingerprint: input.envelope.requestHash,
      observedAt: this.now().toISOString(),
    };
  }

  private async persistCreateResponseDiagnostic(args: {
    readonly input: CanonicalAdapterSubmitInput;
    readonly binding: ProviderCreateResponseDiagnosticBinding;
    readonly response: SeedanceHttpResponse;
    readonly normalized: ReturnType<typeof normalizeCreateStatus>;
  }): Promise<void> {
    if (!this.diagnostics) {
      return;
    }
    const { input, binding, response, normalized } = args;
    const responseHash =
      response.bodyHash ??
      canonicalPersistenceHash({
        kind: "ai-story-provider-create-response-body",
        status: response.status,
        body: response.body ?? null,
      });
    const diagnostic = buildProviderCreateResponseDiagnostic({
      binding,
      httpStatus: response.status,
      body: response.body,
      responseHash,
      ...(response.traceId ? { headerTraceId: response.traceId } : {}),
      ...(normalized.providerRequestId
        ? { taskId: normalized.providerRequestId }
        : {}),
      classification: {
        accepted: normalized.acceptanceClassification === "ACCEPTED",
        retryable: normalized.failureClassification?.retryable ?? false,
        reconciliationRequired: normalized.reconciliationRequired,
        normalizationResult: normalized.acceptanceClassification,
      },
    });
    await this.appendDiagnostic(input, diagnostic);
  }

  private async persistTransportFailureDiagnostic(
    input: CanonicalAdapterSubmitInput,
    binding: ProviderCreateResponseDiagnosticBinding,
    transportError: SeedanceHttpTransportError
  ): Promise<void> {
    if (!this.diagnostics) {
      return;
    }
    const classified = this.classifyError({
      error: transportError,
      phase: "submit",
    });
    const diagnostic = buildProviderTransportFailureDiagnostic({
      binding,
      transportError,
      classification: {
        retryable: classified.retryable,
        reconciliationRequired: classified.reconciliationRequired,
        // Transport uncertainty is never a Provider rejection.
        normalizationResult: "ACCEPTANCE_UNKNOWN",
      },
    });
    await this.appendDiagnostic(input, diagnostic);
  }

  private async appendDiagnostic(
    input: CanonicalAdapterSubmitInput,
    diagnostic: AiStoryProviderCreateResponseDiagnostic
  ): Promise<void> {
    try {
      await this.diagnostics!.appendProviderCreateResponseDiagnostic({
        orgId: input.envelope.tenantId,
        workspaceId: input.envelope.workspaceId,
        diagnostic,
      });
    } catch (error) {
      throw new SeedanceDiagnosticPersistenceError(error);
    }
  }

  async lookup(input: CanonicalAdapterLookupInput): Promise<CanonicalAdapterLookupResult> {
    try {
      if (!input.providerRequestId.trim()) {
        return {
          acceptanceClassification: "ACCEPTANCE_UNKNOWN",
          canonicalProviderState: "ACCEPTANCE_UNKNOWN",
          providerRequestId: input.providerRequestId,
          reconciliationRequired: true,
          failureClassification: failureFromCode(
            "PROVIDER_ACCEPTANCE_UNKNOWN",
            "Lookup requires a persisted providerRequestId",
            { terminal: false, reconciliationRequired: true }
          ),
        };
      }
      const response = await this.http.getGeneration(input.providerRequestId);
      return normalizeLookupBody(input.providerRequestId, response.body, response.status);
    } catch (error) {
      const classified = this.classifyError({ error, phase: "lookup" });
      return {
        acceptanceClassification: "ACCEPTED",
        canonicalProviderState: classified.reconciliationRequired
          ? "ACCEPTANCE_UNKNOWN"
          : "FAILED",
        providerRequestId: input.providerRequestId,
        reconciliationRequired: classified.reconciliationRequired,
        failureClassification: classified,
      };
    }
  }

  async normalizeCallback(
    _input: ProviderCallbackNormalizationInput
  ): Promise<ProviderCallbackReceipt> {
    if (!SEEDANCE_CALLBACKS_SUPPORTED) {
      throw Object.assign(new Error("Seedance callbacks are not supported"), {
        code: "SEEDANCE_CALLBACKS_UNSUPPORTED",
      });
    }
    // Unreachable while callbacks remain unsupported.
    throw new Error("Seedance callbacks are not supported");
  }

  classifyError(input: CanonicalAdapterErrorInput): WorkerFailureClassification {
    const { policy, failure } = classifySeedanceError(input.error, input.phase);
    assertFallbackDisabled(policy);
    return failure;
  }

  private toSubmitFailure(error: unknown): CanonicalAdapterSubmitResult {
    const classified = this.classifyError({ error, phase: "submit" });
    if (classified.reconciliationRequired) {
      return {
        acceptanceClassification: "ACCEPTANCE_UNKNOWN",
        canonicalProviderState: "ACCEPTANCE_UNKNOWN",
        reconciliationRequired: true,
        failureClassification: classified,
      };
    }
    if (classified.retryable) {
      return {
        acceptanceClassification: "NOT_SUBMITTED",
        canonicalProviderState: "NOT_SUBMITTED",
        reconciliationRequired: false,
        failureClassification: classified,
      };
    }
    return {
      acceptanceClassification: "NOT_ACCEPTED",
      canonicalProviderState: "NOT_ACCEPTED",
      reconciliationRequired: false,
      failureClassification: classified,
    };
  }
}

/** Deterministic memory payload resolver for tests / harnesses. */
export function createMemorySeedancePayloadResolver(
  payloads: ReadonlyMap<string, unknown> | Record<string, unknown>
): SeedancePayloadResolver {
  const map =
    payloads instanceof Map ? payloads : new Map(Object.entries(payloads));
  return {
    async resolve(reference) {
      const value = map.get(reference.uri) ?? map.get(reference.contentHash);
      if (value === undefined) {
        throw new Error(`Seedance payload not found for ${reference.uri}`);
      }
      return value;
    },
  };
}

export function seedanceResultIntegrityToken(input: {
  readonly providerRequestId: string;
  readonly dispatchId: string;
}): string {
  return canonicalPersistenceHash({
    kind: "seedance-canonical-result-token",
    providerRequestId: input.providerRequestId,
    dispatchId: input.dispatchId,
    contractVersion: WORKER_RUNTIME_CONTRACT_VERSION,
  });
}
